import type { components } from "@five/api-contract";

export const CONTENT_LIFECYCLE_STORE = Symbol("CONTENT_LIFECYCLE_STORE");

export type AddMasterReviewEvidenceRequest =
  components["schemas"]["AddMasterReviewEvidenceRequest"];
export type AdminContentVersion = components["schemas"]["AdminContentVersion"];
export type AuditEvent = components["schemas"]["AuditEvent"];
export type ContentDraft = components["schemas"]["ContentDraft"];
export type ContentDraftSummary = components["schemas"]["ContentDraftSummary"];
export type ContentState = components["schemas"]["ContentState"];
export type ContentVersionSummary = components["schemas"]["ContentVersionSummary"];
export type DraftModules = components["schemas"]["DraftModules"];
export type LifecycleActionResult = components["schemas"]["LifecycleActionResult"];
export type MasterReviewEvidence = components["schemas"]["MasterReviewEvidence"];
export type ModuleCode = components["schemas"]["ModuleCode"];
export type PreflightCheck = components["schemas"]["PreflightCheck"];

export interface DraftModuleByCode {
  calendar_algorithm: components["schemas"]["CalendarAlgorithmModule"];
  copy_and_formula: components["schemas"]["CopyAndFormulaModule"];
  poster_consistency: components["schemas"]["PosterConsistencyModule"];
  visual_and_rights: components["schemas"]["VisualAndRightsModule"];
}

export interface StoredDraft {
  readonly draft: ContentDraft;
  readonly submittedContentVersion: string | null;
}

export interface StoredContentVersion {
  readonly contentVersion: string;
  readonly createdAt: string;
  readonly draftId: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly fortuneDate: string;
  readonly preflightChecks: readonly PreflightCheck[];
  readonly snapshot: DraftModules;
  readonly state: Exclude<ContentState, "draft">;
}

export interface StoredMasterReviewEvidence extends MasterReviewEvidence {
  readonly contentVersion: string;
  readonly recordedAt: string;
  readonly recordedRevision: number;
}

export interface LifecycleProjection {
  readonly activeContentVersion: string | null;
  readonly fortuneDate: string;
  readonly revision: number;
}

export interface ContentVersionReadView {
  readonly evidence: readonly StoredMasterReviewEvidence[];
  readonly projection: LifecycleProjection;
  readonly version: StoredContentVersion;
}

export interface ContentVersionListReadView {
  readonly projection: LifecycleProjection | null;
  readonly versions: readonly StoredContentVersion[];
}

export type IdempotencyOperation = "add_master_review_evidence" | "review_decision" | "submit";

export interface StoredLifecycleIdempotency {
  readonly idempotencyKey: string;
  readonly operation: IdempotencyOperation;
  readonly requestHash: string;
  readonly resourceId: string;
  readonly response: unknown;
}

export interface StoredAuditEvent extends AuditEvent {
  readonly actorId: string;
  readonly fromState: ContentState | null;
  readonly idempotencyKey: string;
  readonly toState: ContentState;
}

export interface AuditCursor {
  readonly auditEventId: string;
  readonly occurredAt: string;
}

export interface ContentLifecycleTransaction {
  findDraftForUpdate(draftId: string): Promise<StoredDraft | null>;
  findIdempotency(
    operation: IdempotencyOperation,
    resourceId: string,
    idempotencyKey: string,
  ): Promise<StoredLifecycleIdempotency | null>;
  findVersion(contentVersion: string): Promise<StoredContentVersion | null>;
  getOrCreateProjectionForUpdate(fortuneDate: string): Promise<LifecycleProjection>;
  insertAuditEvent(event: StoredAuditEvent): Promise<void>;
  insertDraft(draft: StoredDraft): Promise<void>;
  insertEvidence(evidence: StoredMasterReviewEvidence): Promise<void>;
  insertIdempotency(record: StoredLifecycleIdempotency): Promise<void>;
  insertVersion(version: StoredContentVersion): Promise<void>;
  listEvidence(contentVersion: string): Promise<StoredMasterReviewEvidence[]>;
  lockIdempotency(
    operation: IdempotencyOperation,
    resourceId: string,
    idempotencyKey: string,
  ): Promise<void>;
  markDraftSubmitted(draftId: string, contentVersion: string, submittedAt: string): Promise<void>;
  updateDraft(draft: StoredDraft): Promise<void>;
  updateProjection(projection: LifecycleProjection): Promise<void>;
  updateVersionState(contentVersion: string, state: Exclude<ContentState, "draft">): Promise<void>;
}

export interface ContentLifecycleStore {
  findDraft(draftId: string): Promise<ContentDraft | null>;
  listAuditEvents(input: {
    readonly contentVersion: string | null;
    readonly cursor: AuditCursor | null;
    readonly fortuneDate: string | null;
    readonly limit: number;
  }): Promise<{ readonly items: StoredAuditEvent[]; readonly hasMore: boolean }>;
  listDrafts(fortuneDate: string | null): Promise<ContentDraftSummary[]>;
  readVersionListView(fortuneDate: string): Promise<ContentVersionListReadView>;
  readVersionView(contentVersion: string): Promise<ContentVersionReadView | null>;
  transaction<T>(work: (transaction: ContentLifecycleTransaction) => Promise<T>): Promise<T>;
}
