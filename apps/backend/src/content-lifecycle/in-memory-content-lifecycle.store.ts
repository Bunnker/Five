import type {
  AuditCursor,
  ContentDraft,
  ContentDraftSummary,
  ContentLifecycleStore,
  ContentLifecycleTransaction,
  DailyImageSetReadView,
  DraftImageAssetReadView,
  ContentVersionListReadView,
  ContentVersionReadView,
  IdempotencyOperation,
  LifecycleProjection,
  StoredAuditEvent,
  StoredContentVersion,
  StoredDraft,
  StoredLifecycleIdempotency,
  StoredMasterReviewEvidence,
} from "./content-lifecycle.store";
import type {
  StoredDailyImageSet,
  StoredDraftImageAsset,
  StoredImageCachePurgeIntent,
  StoredImageAssetWithdrawalEvent,
} from "../daily-images/daily-image-asset.store";
import { projectDailyImageSet } from "../daily-images/image-delivery-projection";
import type { ImageCachePurgeStore } from "../daily-images/image-cache-purge.store";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function idempotencyId(
  operation: IdempotencyOperation,
  resourceId: string,
  idempotencyKey: string,
): string {
  return `${operation}\u0000${resourceId}\u0000${idempotencyKey}`;
}

export class InMemoryContentLifecycleStore implements ContentLifecycleStore, ImageCachePurgeStore {
  private audits: StoredAuditEvent[] = [];
  private cachePurgeIntents: StoredImageCachePurgeIntent[] = [];
  private dailyImageSets = new Map<string, StoredDailyImageSet>();
  private drafts = new Map<string, StoredDraft>();
  private draftImageAssets = new Map<string, StoredDraftImageAsset>();
  private evidence = new Map<string, StoredMasterReviewEvidence[]>();
  private idempotency = new Map<string, StoredLifecycleIdempotency>();
  private imageWithdrawalEvents: StoredImageAssetWithdrawalEvent[] = [];
  private projections = new Map<string, LifecycleProjection>();
  private transactionTail: Promise<void> = Promise.resolve();
  private versions = new Map<string, StoredContentVersion>();

  seedDraftImageAssetsForTest(assets: readonly StoredDraftImageAsset[]): void {
    for (const asset of assets) {
      this.draftImageAssets.set(`${asset.draftId}\u0000${asset.asset.assetId}`, clone(asset));
    }
  }

  seedDailyImageSetForTest(imageSet: StoredDailyImageSet): void {
    this.dailyImageSets.set(imageSet.contentVersion, clone(imageSet));
  }

  publishVersionForTest(contentVersion: string): void {
    const version = this.versions.get(contentVersion);
    if (version === undefined) throw new Error("version missing from test fixture");
    this.versions.set(contentVersion, { ...clone(version), state: "published" });
    const projection = this.projections.get(version.fortuneDate);
    if (projection === undefined) throw new Error("projection missing from test fixture");
    this.projections.set(version.fortuneDate, {
      ...clone(projection),
      activeContentVersion: contentVersion,
    });
  }

  readCachePurgeIntentsForTest(): StoredImageCachePurgeIntent[] {
    return clone(this.cachePurgeIntents);
  }

  async claimNextImageCachePurgeIntent(input: {
    readonly attemptToken: string;
    readonly claimedAt: string;
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  }): Promise<StoredImageCachePurgeIntent | null> {
    return this.transaction(async () => {
      const claimedAt = new Date(input.claimedAt).getTime();
      const intent = this.cachePurgeIntents
        .filter(
          (candidate) =>
            (candidate.status === "pending" &&
              new Date(candidate.availableAt).getTime() <= claimedAt) ||
            (candidate.status === "processing" &&
              candidate.leaseExpiresAt !== null &&
              new Date(candidate.leaseExpiresAt).getTime() <= claimedAt),
        )
        .sort(
          (left, right) =>
            new Date(
              left.status === "processing" ? left.leaseExpiresAt! : left.availableAt,
            ).getTime() -
              new Date(
                right.status === "processing" ? right.leaseExpiresAt! : right.availableAt,
              ).getTime() ||
            new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
            left.purgeIntentId.localeCompare(right.purgeIntentId),
        )[0];
      if (intent === undefined) return null;
      const claimed: StoredImageCachePurgeIntent = {
        ...intent,
        attemptToken: input.attemptToken,
        attempts: intent.attempts + 1,
        claimedAt: input.claimedAt,
        leaseExpiresAt: input.leaseExpiresAt,
        status: "processing",
        workerId: input.workerId,
      };
      this.replaceImageCachePurgeIntent(claimed);
      return clone(claimed);
    });
  }

  async completeImageCachePurgeIntent(input: {
    readonly attemptToken: string;
    readonly completedAt: string;
    readonly purgeIntentId: string;
    readonly workerId: string;
  }): Promise<StoredImageCachePurgeIntent | null> {
    return this.transaction(async () => {
      const intent = this.cachePurgeIntents.find(
        (candidate) => candidate.purgeIntentId === input.purgeIntentId,
      );
      if (
        intent === undefined ||
        intent.status !== "processing" ||
        intent.workerId !== input.workerId ||
        intent.attemptToken !== input.attemptToken
      ) {
        return null;
      }
      const completed: StoredImageCachePurgeIntent = {
        ...intent,
        attemptToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
        processedAt: input.completedAt,
        status: "completed",
        workerId: null,
      };
      this.replaceImageCachePurgeIntent(completed);
      return clone(completed);
    });
  }

  async recordImageCachePurgeFailure(input: {
    readonly attemptToken: string;
    readonly error: string;
    readonly failedAt: string;
    readonly purgeIntentId: string;
    readonly retryAt: string;
    readonly workerId: string;
  }): Promise<StoredImageCachePurgeIntent | null> {
    return this.transaction(async () => {
      const intent = this.cachePurgeIntents.find(
        (candidate) => candidate.purgeIntentId === input.purgeIntentId,
      );
      if (
        intent === undefined ||
        intent.status !== "processing" ||
        intent.workerId !== input.workerId ||
        intent.attemptToken !== input.attemptToken
      ) {
        return null;
      }
      const pending: StoredImageCachePurgeIntent = {
        ...intent,
        attemptToken: null,
        availableAt: input.retryAt,
        claimedAt: null,
        lastError: input.error,
        leaseExpiresAt: null,
        status: "pending",
        workerId: null,
      };
      this.replaceImageCachePurgeIntent(pending);
      return clone(pending);
    });
  }

  async findDraft(draftId: string): Promise<ContentDraft | null> {
    const stored = this.drafts.get(draftId);
    return stored === undefined || stored.submittedContentVersion !== null
      ? null
      : clone(stored.draft);
  }

  async listDraftImageAssets(draftId: string): Promise<StoredDraftImageAsset[]> {
    await this.transactionTail;
    return clone(
      [...this.draftImageAssets.values()]
        .filter((candidate) => candidate.draftId === draftId)
        .sort(
          (left, right) =>
            left.uploadedAt.localeCompare(right.uploadedAt) ||
            left.asset.assetId.localeCompare(right.asset.assetId),
        ),
    );
  }

  async readDraftImageAssetView(draftId: string): Promise<DraftImageAssetReadView | null> {
    await this.transactionTail;
    const stored = this.drafts.get(draftId);
    if (stored === undefined || stored.submittedContentVersion !== null) return null;
    return clone({
      candidates: [...this.draftImageAssets.values()]
        .filter((candidate) => candidate.draftId === draftId)
        .sort(
          (left, right) =>
            left.uploadedAt.localeCompare(right.uploadedAt) ||
            left.asset.assetId.localeCompare(right.asset.assetId),
        ),
      draft: stored.draft,
    });
  }

  async readDailyImageSet(contentVersion: string): Promise<StoredDailyImageSet | null> {
    await this.transactionTail;
    const imageSet = this.dailyImageSets.get(contentVersion);
    return imageSet === undefined ? null : clone(this.projectImageSet(imageSet));
  }

  async readDailyImageSetView(contentVersion: string): Promise<DailyImageSetReadView | null> {
    await this.transactionTail;
    const imageSet = this.dailyImageSets.get(contentVersion);
    if (imageSet === undefined) return null;
    const projection = this.projections.get(imageSet.fortuneDate);
    if (projection === undefined) {
      throw new Error(`Lifecycle projection missing for ${contentVersion}`);
    }
    return clone({ imageSet: this.projectImageSet(imageSet), projection });
  }

  async readImageAsset(assetId: string): Promise<StoredDraftImageAsset | null> {
    await this.transactionTail;
    return clone(
      [...this.draftImageAssets.values()].find(
        (candidate) => candidate.asset.assetId === assetId,
      ) ?? null,
    );
  }

  async listAuditEvents(input: {
    readonly contentVersion: string | null;
    readonly cursor: AuditCursor | null;
    readonly fortuneDate: string | null;
    readonly limit: number;
  }): Promise<{ readonly items: StoredAuditEvent[]; readonly hasMore: boolean }> {
    const ordered = this.audits
      .filter((event) => input.fortuneDate === null || event.fortuneDate === input.fortuneDate)
      .filter(
        (event) => input.contentVersion === null || event.contentVersion === input.contentVersion,
      )
      .sort(
        (left, right) =>
          right.occurredAt.localeCompare(left.occurredAt) ||
          right.auditEventId.localeCompare(left.auditEventId),
      )
      .filter(
        (event) =>
          input.cursor === null ||
          event.occurredAt < input.cursor.occurredAt ||
          (event.occurredAt === input.cursor.occurredAt &&
            event.auditEventId < input.cursor.auditEventId),
      );
    return {
      hasMore: ordered.length > input.limit,
      items: clone(ordered.slice(0, input.limit)),
    };
  }

  async listDrafts(fortuneDate: string | null): Promise<ContentDraftSummary[]> {
    return [...this.drafts.values()]
      .filter((stored) => stored.submittedContentVersion === null)
      .map((stored) => stored.draft)
      .filter((draft) => fortuneDate === null || draft.fortuneDate === fortuneDate)
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.draftId.localeCompare(left.draftId),
      )
      .map(({ createdAt, draftId, draftRevision, fortuneDate: date, state, updatedAt }) => ({
        createdAt,
        draftId,
        draftRevision,
        fortuneDate: date,
        state,
        updatedAt,
      }));
  }

  async readVersionListView(fortuneDate: string): Promise<ContentVersionListReadView> {
    await this.transactionTail;
    const view = {
      projection: this.projections.get(fortuneDate) ?? null,
      versions: [...this.versions.values()]
        .filter((version) => version.fortuneDate === fortuneDate)
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.contentVersion.localeCompare(left.contentVersion),
        ),
    };
    return clone(view);
  }

  async readVersionView(contentVersion: string): Promise<ContentVersionReadView | null> {
    await this.transactionTail;
    const version = this.versions.get(contentVersion);
    if (version === undefined) return null;
    const imageSet = this.dailyImageSets.get(contentVersion);
    const projection = this.projections.get(version.fortuneDate);
    if (projection === undefined) {
      throw new Error(`Lifecycle projection missing for ${contentVersion}`);
    }
    return clone({
      evidence: this.evidence.get(contentVersion) ?? [],
      imageSet: imageSet === undefined ? null : this.projectImageSet(imageSet),
      projection,
      version,
    });
  }

  async transaction<T>(work: (transaction: ContentLifecycleTransaction) => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const prior = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    const snapshot = {
      audits: clone(this.audits),
      cachePurgeIntents: clone(this.cachePurgeIntents),
      dailyImageSets: clone(this.dailyImageSets),
      drafts: clone(this.drafts),
      draftImageAssets: clone(this.draftImageAssets),
      evidence: clone(this.evidence),
      idempotency: clone(this.idempotency),
      imageWithdrawalEvents: clone(this.imageWithdrawalEvents),
      projections: clone(this.projections),
      versions: clone(this.versions),
    };
    try {
      return await work(this.transactionAdapter());
    } catch (error) {
      this.audits = snapshot.audits;
      this.cachePurgeIntents = snapshot.cachePurgeIntents;
      this.dailyImageSets = snapshot.dailyImageSets;
      this.drafts = snapshot.drafts;
      this.draftImageAssets = snapshot.draftImageAssets;
      this.evidence = snapshot.evidence;
      this.idempotency = snapshot.idempotency;
      this.imageWithdrawalEvents = snapshot.imageWithdrawalEvents;
      this.projections = snapshot.projections;
      this.versions = snapshot.versions;
      throw error;
    } finally {
      release?.();
    }
  }

  private transactionAdapter(): ContentLifecycleTransaction {
    return {
      findDraftImageAssetForUpdate: async (draftId, assetId) => {
        const candidate = this.draftImageAssets.get(`${draftId}\u0000${assetId}`);
        return clone(candidate?.draftId === draftId ? candidate : null);
      },
      findDraftForUpdate: async (draftId) => clone(this.drafts.get(draftId) ?? null),
      findIdempotency: async (operation, resourceId, idempotencyKey) =>
        clone(this.idempotency.get(idempotencyId(operation, resourceId, idempotencyKey)) ?? null),
      findVersion: async (contentVersion) => clone(this.versions.get(contentVersion) ?? null),
      findDailyImageSetForUpdate: async (contentVersion) => {
        const imageSet = this.dailyImageSets.get(contentVersion);
        return imageSet === undefined ? null : clone(this.projectImageSet(imageSet));
      },
      listGloballyWithdrawnAssetIds: async (assetIds) => {
        const selected = new Set(assetIds);
        return [
          ...new Set(
            this.imageWithdrawalEvents
              .map(({ event }) => event.assetId)
              .filter((assetId) => selected.has(assetId)),
          ),
        ].sort();
      },
      listDraftImageAssets: async (draftId) =>
        clone([...this.draftImageAssets.values()].filter((asset) => asset.draftId === draftId)),
      getOrCreateProjectionForUpdate: async (fortuneDate) => {
        const current = this.projections.get(fortuneDate) ?? {
          activeContentVersion: null,
          fortuneDate,
          revision: 0,
        };
        this.projections.set(fortuneDate, clone(current));
        return clone(current);
      },
      insertAuditEvent: async (event) => {
        this.audits.push(clone(event));
      },
      insertCachePurgeIntent: async (intent) => {
        this.cachePurgeIntents.push(
          clone({
            ...intent,
            attemptToken: null,
            attempts: 0,
            availableAt: intent.createdAt,
            claimedAt: null,
            lastError: null,
            leaseExpiresAt: null,
            processedAt: null,
            status: "pending",
            workerId: null,
          }),
        );
      },
      insertDailyImageSet: async (imageSet) => {
        if (this.dailyImageSets.has(imageSet.contentVersion)) {
          throw new Error("duplicate daily image set");
        }
        this.dailyImageSets.set(imageSet.contentVersion, clone(imageSet));
      },
      insertDraft: async (draft) => {
        if (this.drafts.has(draft.draft.draftId)) throw new Error("duplicate draft id");
        this.drafts.set(draft.draft.draftId, clone(draft));
      },
      insertDraftImageAsset: async (asset) => {
        const key = `${asset.draftId}\u0000${asset.asset.assetId}`;
        if (this.draftImageAssets.has(key)) {
          throw new Error("duplicate draft image asset");
        }
        this.draftImageAssets.set(key, clone(asset));
      },
      insertEvidence: async (record) => {
        const records = this.evidence.get(record.contentVersion) ?? [];
        records.push(clone(record));
        this.evidence.set(record.contentVersion, records);
      },
      insertIdempotency: async (record) => {
        const key = idempotencyId(record.operation, record.resourceId, record.idempotencyKey);
        if (this.idempotency.has(key)) throw new Error("duplicate idempotency key");
        this.idempotency.set(key, clone(record));
      },
      insertImageAssetWithdrawalEvent: async (event) => {
        const imageSet = this.dailyImageSets.get(event.contentVersion);
        if (
          imageSet === undefined ||
          !imageSet.assets.some((asset) => asset.assetId === event.event.assetId)
        ) {
          throw new Error("withdrawal asset does not belong to daily image set");
        }
        if (
          this.imageWithdrawalEvents.some(
            (existing) => existing.event.assetId === event.event.assetId,
          )
        ) {
          throw new Error("image asset already globally withdrawn");
        }
        this.imageWithdrawalEvents.push(clone(event));
      },
      insertVersion: async (version) => {
        if (this.versions.has(version.contentVersion)) throw new Error("duplicate content version");
        this.versions.set(version.contentVersion, clone(version));
      },
      listEvidence: async (contentVersion) => clone(this.evidence.get(contentVersion) ?? []),
      lockIdempotency: async () => undefined,
      lockImageAssetWithdrawal: async () => undefined,
      markDraftSubmitted: async (draftId, contentVersion) => {
        const stored = this.drafts.get(draftId);
        if (stored === undefined) throw new Error("draft disappeared");
        this.drafts.set(draftId, { ...clone(stored), submittedContentVersion: contentVersion });
      },
      updateDraft: async (draft) => {
        if (!this.drafts.has(draft.draft.draftId)) throw new Error("draft disappeared");
        this.drafts.set(draft.draft.draftId, clone(draft));
      },
      updateDraftImageAsset: async (asset) => {
        const key = `${asset.draftId}\u0000${asset.asset.assetId}`;
        if (!this.draftImageAssets.has(key)) {
          throw new Error("draft image asset disappeared");
        }
        this.draftImageAssets.set(key, clone(asset));
      },
      updateDailyImageSet: async (imageSet) => {
        if (!this.dailyImageSets.has(imageSet.contentVersion)) {
          throw new Error("daily image set disappeared");
        }
        this.dailyImageSets.set(imageSet.contentVersion, clone(imageSet));
      },
      updateProjection: async (projection) => {
        this.projections.set(projection.fortuneDate, clone(projection));
      },
      updateVersionState: async (contentVersion, state) => {
        const version = this.versions.get(contentVersion);
        if (version === undefined) throw new Error("version disappeared");
        this.versions.set(contentVersion, { ...clone(version), state });
      },
    };
  }

  private projectImageSet(imageSet: StoredDailyImageSet): StoredDailyImageSet {
    const assetIds = new Set(imageSet.assets.map((asset) => asset.assetId));
    const globalEvents = this.imageWithdrawalEvents
      .filter(({ event }) => assetIds.has(event.assetId))
      .map(({ event }) => event);
    return projectDailyImageSet(imageSet, globalEvents);
  }

  private replaceImageCachePurgeIntent(intent: StoredImageCachePurgeIntent): void {
    const index = this.cachePurgeIntents.findIndex(
      (candidate) => candidate.purgeIntentId === intent.purgeIntentId,
    );
    if (index === -1) throw new Error("image cache purge intent disappeared");
    this.cachePurgeIntents[index] = clone(intent);
  }
}
