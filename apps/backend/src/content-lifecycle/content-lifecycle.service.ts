import { createHash, randomUUID } from "node:crypto";

import { evaluateContentPreflight } from "./content-preflight";
import {
  CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN,
  isStrictRfc3339DateTime,
} from "./content-lifecycle.values";
import type {
  AddMasterReviewEvidenceRequest,
  AdminContentVersion,
  ContentDraft,
  ContentLifecycleStore,
  ContentVersionSummary,
  DraftModuleByCode,
  DraftModules,
  LifecycleProjection,
  LifecycleActionResult,
  ModuleCode,
  PreflightCheck,
  StoredContentVersion,
  StoredMasterReviewEvidence,
} from "./content-lifecycle.store";

export interface ContentLifecycleClock {
  now(): Date;
}

export interface ContentLifecycleIdentifiers {
  nextAuditEventId(): string;
  nextContentVersion(): string;
  nextDraftId(): string;
  nextEvidenceId(): string;
}

const SYSTEM_CLOCK: ContentLifecycleClock = { now: () => new Date() };
const SYSTEM_IDENTIFIERS: ContentLifecycleIdentifiers = {
  nextAuditEventId: () => `audit-${randomUUID()}`,
  nextContentVersion: () => `content-${randomUUID()}`,
  nextDraftId: () => `draft-${randomUUID()}`,
  nextEvidenceId: () => `evidence-${randomUUID()}`,
};

const EMPTY_MODULES: DraftModules = {
  calendar_algorithm: null,
  copy_and_formula: null,
  poster_consistency: null,
  visual_and_rights: null,
};

function validFortuneDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export type CreateDraftResult =
  | { readonly draft: ContentDraft; readonly kind: "created" }
  | { readonly kind: "invalid_argument" }
  | { readonly kind: "source_not_found" }
  | { readonly kind: "source_date_mismatch" };

export type UpdateDraftModuleResult =
  | {
      readonly kind: "updated";
      readonly result: {
        readonly draftId: string;
        readonly draftRevision: number;
        readonly module: DraftModuleByCode[ModuleCode];
        readonly moduleCode: ModuleCode;
      };
    }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_state" }
  | { readonly currentRevision: number; readonly kind: "revision_mismatch" };

interface SubmitDraftResultBody {
  readonly contentVersion: string;
  readonly draftId: string;
  readonly lifecycleRevision: number;
  readonly state: "in_review";
}

export type SubmitDraftResult =
  | { readonly kind: "submitted" | "existing"; readonly result: SubmitDraftResultBody }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_state" }
  | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "invalid_argument" };

export type AddMasterReviewEvidenceResult =
  | { readonly kind: "added" | "existing"; readonly version: AdminContentVersion }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_state" }
  | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "invalid_argument" };

interface AppliedReviewDecision {
  readonly action: LifecycleActionResult;
}

export type ReviewDecisionResult =
  | ({ readonly kind: "applied" | "existing" } & AppliedReviewDecision)
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_state" }
  | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "invalid_argument" }
  | { readonly kind: "master_review_missing"; readonly preflightChecks: readonly PreflightCheck[] }
  | {
      readonly kind: "required_review_missing";
      readonly preflightChecks: readonly PreflightCheck[];
    };

export type AuditEventPageResult =
  | {
      readonly items: Array<{
        readonly action: string;
        readonly auditEventId: string;
        readonly contentVersion: string;
        readonly fortuneDate: string;
        readonly occurredAt: string;
        readonly reason: string;
        readonly requestId: string;
      }>;
      readonly kind: "page";
      readonly nextCursor: string | null;
    }
  | { readonly kind: "invalid_cursor" }
  | { readonly kind: "invalid_argument" };

export class ContentLifecycleService {
  constructor(
    private readonly store: ContentLifecycleStore,
    private readonly clock: ContentLifecycleClock = SYSTEM_CLOCK,
    private readonly identifiers: ContentLifecycleIdentifiers = SYSTEM_IDENTIFIERS,
  ) {}

  async createDraft(input: {
    readonly actorId: string;
    readonly copyFromContentVersion: string | null;
    readonly fortuneDate: string;
    readonly requestId: string;
  }): Promise<CreateDraftResult> {
    if (!validFortuneDate(input.fortuneDate)) return { kind: "invalid_argument" };

    return this.store.transaction(async (transaction) => {
      let modules = structuredClone(EMPTY_MODULES);
      if (input.copyFromContentVersion !== null) {
        const source = await transaction.findVersion(input.copyFromContentVersion);
        if (source === null) return { kind: "source_not_found" } as const;
        if (source.fortuneDate !== input.fortuneDate) {
          return { kind: "source_date_mismatch" } as const;
        }
        modules = structuredClone(source.snapshot);
      }

      const now = this.clock.now().toISOString();
      const draft: ContentDraft = {
        createdAt: now,
        draftId: this.identifiers.nextDraftId(),
        draftRevision: 1,
        fortuneDate: input.fortuneDate,
        modules,
        state: "draft",
        updatedAt: now,
      };
      await transaction.insertDraft({ draft, submittedContentVersion: null });
      return { draft, kind: "created" } as const;
    });
  }

  async listDrafts(
    fortuneDate: string | null,
  ): Promise<{ items: Awaited<ReturnType<ContentLifecycleStore["listDrafts"]>> }> {
    if (fortuneDate !== null && !validFortuneDate(fortuneDate)) return { items: [] };
    return { items: await this.store.listDrafts(fortuneDate) };
  }

  getDraft(draftId: string): Promise<ContentDraft | null> {
    return this.store.findDraft(draftId);
  }

  async updateDraftModule<C extends ModuleCode>(input: {
    readonly actorId: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly module: DraftModuleByCode[C];
    readonly moduleCode: C;
    readonly requestId: string;
  }): Promise<UpdateDraftModuleResult> {
    return this.store.transaction(async (transaction) => {
      const stored = await transaction.findDraftForUpdate(input.draftId);
      if (stored === null) return { kind: "not_found" } as const;
      if (stored.submittedContentVersion !== null) return { kind: "invalid_state" } as const;
      if (stored.draft.draftRevision !== input.expectedDraftRevision) {
        return {
          currentRevision: stored.draft.draftRevision,
          kind: "revision_mismatch",
        } as const;
      }

      const draftRevision = stored.draft.draftRevision + 1;
      const module = structuredClone(input.module);
      await transaction.updateDraft({
        draft: {
          ...stored.draft,
          draftRevision,
          modules: {
            ...stored.draft.modules,
            [input.moduleCode]: module,
          },
          updatedAt: this.clock.now().toISOString(),
        },
        submittedContentVersion: null,
      });
      return {
        kind: "updated",
        result: {
          draftId: input.draftId,
          draftRevision,
          module,
          moduleCode: input.moduleCode,
        },
      } as UpdateDraftModuleResult;
    });
  }

  async submitDraft(input: {
    readonly actorId: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly idempotencyKey: string;
    readonly requestId: string;
  }): Promise<SubmitDraftResult> {
    if (!validIdempotencyKey(input.idempotencyKey) || !validRevision(input.expectedDraftRevision)) {
      return { kind: "invalid_argument" };
    }
    const requestHash = contentLifecycleRequestHash({
      draftId: input.draftId,
      expectedDraftRevision: input.expectedDraftRevision,
    });

    return this.store.transaction(async (transaction) => {
      await transaction.lockIdempotency("submit", input.draftId, input.idempotencyKey);
      const prior = await transaction.findIdempotency(
        "submit",
        input.draftId,
        input.idempotencyKey,
      );
      if (prior !== null) {
        return prior.requestHash === requestHash
          ? { kind: "existing", result: prior.response as SubmitDraftResultBody }
          : { kind: "idempotency_conflict" };
      }

      const stored = await transaction.findDraftForUpdate(input.draftId);
      if (stored === null) return { kind: "not_found" } as const;
      if (stored.submittedContentVersion !== null) return { kind: "invalid_state" } as const;
      if (stored.draft.draftRevision !== input.expectedDraftRevision) {
        return {
          currentRevision: stored.draft.draftRevision,
          kind: "revision_mismatch",
        } as const;
      }

      const projection = await transaction.getOrCreateProjectionForUpdate(stored.draft.fortuneDate);
      const lifecycleRevision = projection.revision + 1;
      const contentVersion = this.identifiers.nextContentVersion();
      const now = this.clock.now().toISOString();
      const version: StoredContentVersion = {
        contentVersion,
        createdAt: now,
        draftId: stored.draft.draftId,
        effectiveFrom: null,
        effectiveTo: null,
        fortuneDate: stored.draft.fortuneDate,
        preflightChecks: evaluateContentPreflight(
          stored.draft.modules,
          [],
          stored.draft.fortuneDate,
        ),
        snapshot: structuredClone(stored.draft.modules),
        state: "in_review",
      };
      const result: SubmitDraftResultBody = {
        contentVersion,
        draftId: stored.draft.draftId,
        lifecycleRevision,
        state: "in_review",
      };
      await transaction.insertVersion(version);
      await transaction.markDraftSubmitted(stored.draft.draftId, contentVersion, now);
      await transaction.updateProjection({
        ...projection,
        revision: lifecycleRevision,
      });
      await transaction.insertAuditEvent({
        action: "content_submitted",
        actorId: input.actorId,
        auditEventId: this.identifiers.nextAuditEventId(),
        contentVersion,
        fortuneDate: stored.draft.fortuneDate,
        fromState: "draft",
        idempotencyKey: input.idempotencyKey,
        occurredAt: now,
        reason: "提交草稿并冻结为待大师核对版本。",
        requestId: input.requestId,
        toState: "in_review",
      });
      await transaction.insertIdempotency({
        idempotencyKey: input.idempotencyKey,
        operation: "submit",
        requestHash,
        resourceId: input.draftId,
        response: result,
      });
      return { kind: "submitted", result } as const;
    });
  }

  async addMasterReviewEvidence(input: {
    readonly actorId: string;
    readonly contentVersion: string;
    readonly evidence: AddMasterReviewEvidenceRequest;
    readonly expectedLifecycleRevision: number;
    readonly idempotencyKey: string;
    readonly requestId: string;
  }): Promise<AddMasterReviewEvidenceResult> {
    if (
      !validIdempotencyKey(input.idempotencyKey) ||
      !validRevision(input.expectedLifecycleRevision) ||
      !validMasterEvidence(input.evidence)
    ) {
      return { kind: "invalid_argument" };
    }
    const requestHash = contentLifecycleRequestHash({ evidence: input.evidence });

    return this.store.transaction(async (transaction) => {
      await transaction.lockIdempotency(
        "add_master_review_evidence",
        input.contentVersion,
        input.idempotencyKey,
      );
      const prior = await transaction.findIdempotency(
        "add_master_review_evidence",
        input.contentVersion,
        input.idempotencyKey,
      );
      if (prior !== null) {
        return prior.requestHash === requestHash
          ? { kind: "existing", version: prior.response as AdminContentVersion }
          : { kind: "idempotency_conflict" };
      }

      const initialVersion = await transaction.findVersion(input.contentVersion);
      if (initialVersion === null) return { kind: "not_found" } as const;
      const projection = await transaction.getOrCreateProjectionForUpdate(
        initialVersion.fortuneDate,
      );
      const version = await transaction.findVersion(input.contentVersion);
      if (version === null) return { kind: "not_found" } as const;
      if (version.state !== "in_review") return { kind: "invalid_state" } as const;
      if (projection.revision !== input.expectedLifecycleRevision) {
        return { currentRevision: projection.revision, kind: "revision_mismatch" } as const;
      }

      const now = this.clock.now().toISOString();
      const nextProjection = { ...projection, revision: projection.revision + 1 };
      const evidence: StoredMasterReviewEvidence = {
        ...structuredClone(input.evidence),
        contentVersion: input.contentVersion,
        evidenceId: this.identifiers.nextEvidenceId(),
        recordedAt: now,
        recordedRevision: nextProjection.revision,
      };
      await transaction.insertEvidence(evidence);
      await transaction.updateProjection(nextProjection);
      await transaction.insertAuditEvent({
        action: "master_review_evidence_added",
        actorId: input.actorId,
        auditEventId: this.identifiers.nextAuditEventId(),
        contentVersion: input.contentVersion,
        fortuneDate: version.fortuneDate,
        fromState: "in_review",
        idempotencyKey: input.idempotencyKey,
        occurredAt: now,
        reason: `登记大师核对依据：${evidence.conclusion}。`,
        requestId: input.requestId,
        toState: "in_review",
      });
      const allEvidence = [...(await transaction.listEvidence(input.contentVersion))];
      const view = versionView(version, nextProjection, allEvidence);
      await transaction.insertIdempotency({
        idempotencyKey: input.idempotencyKey,
        operation: "add_master_review_evidence",
        requestHash,
        resourceId: input.contentVersion,
        response: view,
      });
      return { kind: "added", version: view } as const;
    });
  }

  async decideReview(input: {
    readonly actorId: string;
    readonly contentVersion: string;
    readonly decision: "approved" | "changes_requested";
    readonly expectedLifecycleRevision: number;
    readonly idempotencyKey: string;
    readonly reason: string | null;
    readonly requestId: string;
  }): Promise<ReviewDecisionResult> {
    if (
      !validIdempotencyKey(input.idempotencyKey) ||
      !validRevision(input.expectedLifecycleRevision) ||
      !validReviewReason(input.decision, input.reason)
    ) {
      return { kind: "invalid_argument" };
    }
    const normalizedReason = input.reason?.trim() ?? null;
    const requestHash = contentLifecycleRequestHash({
      decision: input.decision,
      reason: normalizedReason,
    });

    return this.store.transaction(async (transaction) => {
      await transaction.lockIdempotency(
        "review_decision",
        input.contentVersion,
        input.idempotencyKey,
      );
      const prior = await transaction.findIdempotency(
        "review_decision",
        input.contentVersion,
        input.idempotencyKey,
      );
      if (prior !== null) {
        return prior.requestHash === requestHash
          ? { kind: "existing", ...(prior.response as AppliedReviewDecision) }
          : { kind: "idempotency_conflict" };
      }

      const initialVersion = await transaction.findVersion(input.contentVersion);
      if (initialVersion === null) return { kind: "not_found" } as const;
      const projection = await transaction.getOrCreateProjectionForUpdate(
        initialVersion.fortuneDate,
      );
      const version = await transaction.findVersion(input.contentVersion);
      if (version === null) return { kind: "not_found" } as const;
      if (version.state !== "in_review") return { kind: "invalid_state" } as const;
      if (projection.revision !== input.expectedLifecycleRevision) {
        return { currentRevision: projection.revision, kind: "revision_mismatch" } as const;
      }

      const evidence = await transaction.listEvidence(input.contentVersion);
      const preflightChecks = evaluateContentPreflight(
        version.snapshot,
        evidence,
        version.fortuneDate,
      );
      if (input.decision === "approved") {
        if (!checkPassed(preflightChecks, "master_review_evidence")) {
          return { kind: "master_review_missing", preflightChecks } as const;
        }
        if (preflightChecks.some((check) => check.status !== "passed")) {
          return { kind: "required_review_missing", preflightChecks } as const;
        }
      }

      const now = this.clock.now().toISOString();
      const nextRevision = projection.revision + 1;
      const auditEventId = this.identifiers.nextAuditEventId();
      await transaction.updateVersionState(input.contentVersion, input.decision);
      await transaction.updateProjection({ ...projection, revision: nextRevision });
      await transaction.insertAuditEvent({
        action:
          input.decision === "approved" ? "content_review_approved" : "content_changes_requested",
        actorId: input.actorId,
        auditEventId,
        contentVersion: input.contentVersion,
        fortuneDate: version.fortuneDate,
        fromState: "in_review",
        idempotencyKey: input.idempotencyKey,
        occurredAt: now,
        reason: normalizedReason ?? "全部必审检查和大师确认依据已经通过，内容可以发布。",
        requestId: input.requestId,
        toState: input.decision,
      });
      const action: LifecycleActionResult = {
        activeContentVersion: projection.activeContentVersion,
        auditEventId,
        contentVersion: input.contentVersion,
        fortuneDate: version.fortuneDate,
        lifecycleRevision: nextRevision,
        state: input.decision,
        transitions: [
          {
            contentVersion: input.contentVersion,
            fromState: "in_review",
            toState: input.decision,
          },
        ],
      };
      const response: AppliedReviewDecision = { action };
      await transaction.insertIdempotency({
        idempotencyKey: input.idempotencyKey,
        operation: "review_decision",
        requestHash,
        resourceId: input.contentVersion,
        response,
      });
      return { kind: "applied", ...response } as const;
    });
  }

  async getVersion(contentVersion: string): Promise<AdminContentVersion | null> {
    const view = await this.store.readVersionView(contentVersion);
    if (view === null) return null;
    return versionView(view.version, view.projection, view.evidence);
  }

  async listVersions(fortuneDate: string): Promise<
    | {
        readonly activeContentVersion: string | null;
        readonly fortuneDate: string;
        readonly items: ContentVersionSummary[];
      }
    | { readonly kind: "invalid_argument" }
  > {
    if (!validFortuneDate(fortuneDate)) return { kind: "invalid_argument" };
    const { projection, versions } = await this.store.readVersionListView(fortuneDate);
    return {
      activeContentVersion: projection?.activeContentVersion ?? null,
      fortuneDate,
      items: versions.map((version) => ({
        contentVersion: version.contentVersion,
        createdAt: version.createdAt,
        effectiveFrom: version.effectiveFrom,
        effectiveTo: version.effectiveTo,
        lifecycleRevision: projection?.revision ?? 0,
        state: version.state,
      })),
    };
  }

  async listAuditEvents(input: {
    readonly contentVersion: string | null;
    readonly cursor: string | null;
    readonly fortuneDate: string | null;
    readonly limit: number;
  }): Promise<AuditEventPageResult> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      (input.fortuneDate !== null && !validFortuneDate(input.fortuneDate)) ||
      (input.contentVersion !== null && input.contentVersion.trim().length === 0)
    ) {
      return { kind: "invalid_argument" };
    }
    const cursor = input.cursor === null ? null : decodeAuditCursor(input.cursor);
    if (input.cursor !== null && cursor === null) return { kind: "invalid_cursor" };
    const page = await this.store.listAuditEvents({
      contentVersion: input.contentVersion,
      cursor,
      fortuneDate: input.fortuneDate,
      limit: input.limit,
    });
    const items = page.items.map((event) => ({
      action: event.action,
      auditEventId: event.auditEventId,
      contentVersion: event.contentVersion,
      fortuneDate: event.fortuneDate,
      occurredAt: event.occurredAt,
      reason: event.reason,
      requestId: event.requestId,
    }));
    const last = items.at(-1);
    return {
      items,
      kind: "page",
      nextCursor:
        page.hasMore && last !== undefined
          ? encodeAuditCursor({ auditEventId: last.auditEventId, occurredAt: last.occurredAt })
          : null,
    };
  }
}

export function contentLifecycleRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validIdempotencyKey(value: string): boolean {
  return CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(value);
}

function validMasterEvidence(value: AddMasterReviewEvidenceRequest): boolean {
  return (
    value.reviewerDisplayName.trim().length >= 1 &&
    Array.from(value.reviewerDisplayName).length <= 80 &&
    isStrictRfc3339DateTime(value.reviewedAt) &&
    (value.conclusion === "confirmed" || value.conclusion === "changes_requested") &&
    Array.from(value.notes).length <= 2_000 &&
    value.references.length >= 1 &&
    value.references.length <= 20 &&
    value.references.every(
      (reference) =>
        ["attachment", "message_link", "document", "note"].includes(reference.kind) &&
        reference.reference.trim().length >= 1 &&
        Array.from(reference.reference).length <= 500,
    )
  );
}

function validReviewReason(
  decision: "approved" | "changes_requested",
  reason: string | null,
): boolean {
  if (decision === "changes_requested" && (reason === null || reason.trim().length === 0)) {
    return false;
  }
  return reason === null || (reason.trim().length >= 1 && Array.from(reason).length <= 2_000);
}

function checkPassed(checks: readonly PreflightCheck[], code: PreflightCheck["code"]): boolean {
  return checks.find((check) => check.code === code)?.status === "passed";
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

function versionView(
  version: StoredContentVersion,
  projection: LifecycleProjection | null,
  evidence: readonly StoredMasterReviewEvidence[],
): AdminContentVersion {
  if (projection === null || projection.revision < 1) {
    throw new Error(`Lifecycle projection missing for ${version.contentVersion}`);
  }
  return {
    activeContentVersion: projection.activeContentVersion,
    contentVersion: version.contentVersion,
    fortuneDate: version.fortuneDate,
    lifecycleRevision: projection.revision,
    masterReviewEvidence: evidence.map((record) => ({
      conclusion: record.conclusion,
      evidenceId: record.evidenceId,
      notes: record.notes,
      references: structuredClone(record.references),
      reviewedAt: record.reviewedAt,
      reviewerDisplayName: record.reviewerDisplayName,
    })),
    preflightChecks: evaluateContentPreflight(version.snapshot, evidence, version.fortuneDate),
    snapshot: structuredClone(version.snapshot),
    state: version.state,
  };
}

function encodeAuditCursor(cursor: { auditEventId: string; occurredAt: string }): string {
  return Buffer.from(
    JSON.stringify({ id: cursor.auditEventId, occurredAt: cursor.occurredAt, version: 1 }),
  ).toString("base64url");
}

function decodeAuditCursor(value: string): { auditEventId: string; occurredAt: string } | null {
  if (value.length < 1 || value.length > 256 || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded).toString("base64url") !== value) return null;
    const cursor: unknown = JSON.parse(decoded);
    if (
      typeof cursor !== "object" ||
      cursor === null ||
      !("version" in cursor) ||
      cursor.version !== 1 ||
      !("id" in cursor) ||
      typeof cursor.id !== "string" ||
      cursor.id.length < 1 ||
      cursor.id.length > 80 ||
      !("occurredAt" in cursor) ||
      typeof cursor.occurredAt !== "string" ||
      !isCanonicalAuditTimestamp(cursor.occurredAt)
    ) {
      return null;
    }
    return { auditEventId: cursor.id, occurredAt: cursor.occurredAt };
  } catch {
    return null;
  }
}

function isCanonicalAuditTimestamp(value: string): boolean {
  return (
    isStrictRfc3339DateTime(value) && value.endsWith("Z") && new Date(value).toISOString() === value
  );
}
