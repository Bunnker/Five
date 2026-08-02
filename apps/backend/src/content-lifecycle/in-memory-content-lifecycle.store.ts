import type {
  AuditCursor,
  ContentDraft,
  ContentDraftSummary,
  ContentLifecycleStore,
  ContentLifecycleTransaction,
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

export class InMemoryContentLifecycleStore implements ContentLifecycleStore {
  private audits: StoredAuditEvent[] = [];
  private drafts = new Map<string, StoredDraft>();
  private evidence = new Map<string, StoredMasterReviewEvidence[]>();
  private idempotency = new Map<string, StoredLifecycleIdempotency>();
  private projections = new Map<string, LifecycleProjection>();
  private transactionTail: Promise<void> = Promise.resolve();
  private versions = new Map<string, StoredContentVersion>();

  async findDraft(draftId: string): Promise<ContentDraft | null> {
    const stored = this.drafts.get(draftId);
    return stored === undefined || stored.submittedContentVersion !== null
      ? null
      : clone(stored.draft);
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
    const projection = this.projections.get(version.fortuneDate);
    if (projection === undefined) {
      throw new Error(`Lifecycle projection missing for ${contentVersion}`);
    }
    return clone({
      evidence: this.evidence.get(contentVersion) ?? [],
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
      drafts: clone(this.drafts),
      evidence: clone(this.evidence),
      idempotency: clone(this.idempotency),
      projections: clone(this.projections),
      versions: clone(this.versions),
    };
    try {
      return await work(this.transactionAdapter());
    } catch (error) {
      this.audits = snapshot.audits;
      this.drafts = snapshot.drafts;
      this.evidence = snapshot.evidence;
      this.idempotency = snapshot.idempotency;
      this.projections = snapshot.projections;
      this.versions = snapshot.versions;
      throw error;
    } finally {
      release?.();
    }
  }

  private transactionAdapter(): ContentLifecycleTransaction {
    return {
      findDraftForUpdate: async (draftId) => clone(this.drafts.get(draftId) ?? null),
      findIdempotency: async (operation, resourceId, idempotencyKey) =>
        clone(this.idempotency.get(idempotencyId(operation, resourceId, idempotencyKey)) ?? null),
      findVersion: async (contentVersion) => clone(this.versions.get(contentVersion) ?? null),
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
      insertDraft: async (draft) => {
        if (this.drafts.has(draft.draft.draftId)) throw new Error("duplicate draft id");
        this.drafts.set(draft.draft.draftId, clone(draft));
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
      insertVersion: async (version) => {
        if (this.versions.has(version.contentVersion)) throw new Error("duplicate content version");
        this.versions.set(version.contentVersion, clone(version));
      },
      listEvidence: async (contentVersion) => clone(this.evidence.get(contentVersion) ?? []),
      lockIdempotency: async () => undefined,
      markDraftSubmitted: async (draftId, contentVersion) => {
        const stored = this.drafts.get(draftId);
        if (stored === undefined) throw new Error("draft disappeared");
        this.drafts.set(draftId, { ...clone(stored), submittedContentVersion: contentVersion });
      },
      updateDraft: async (draft) => {
        if (!this.drafts.has(draft.draft.draftId)) throw new Error("draft disappeared");
        this.drafts.set(draft.draft.draftId, clone(draft));
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
}
