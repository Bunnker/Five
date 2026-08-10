import type { components } from "@five/api-contract";

import type {
  StoredAuditEvent,
  StoredContentVersion,
  StoredMasterReviewEvidence,
} from "../content-lifecycle/content-lifecycle.store";
import type { StoredDailyImageSet } from "../daily-images/daily-image-asset.store";

export const CONTENT_RELEASE_STORE = Symbol("CONTENT_RELEASE_STORE");

export type ContentReleaseIdempotencyOperation =
  "cancel_schedule" | "publish" | "rollback" | "schedule" | "withdraw";

export type ContentScheduleTaskStatus =
  "completed" | "pending" | "processing" | "retrying" | "terminated";

export type ContentScheduleTaskEventAction =
  "claimed" | "completed" | "created" | "retry_scheduled" | "terminated";

export type ContentReleaseEventAction =
  | "cancel_schedule"
  | "publish"
  | "rollback"
  | "schedule"
  | "scheduled_publish"
  | "scheduled_publish_failed"
  | "withdraw";

export type PublicCachePurgeIntentStatus = "completed" | "pending" | "processing";

export type ReleaseStateTransition = components["schemas"]["StateTransition"];

export interface ContentReleaseProjection {
  readonly activeContentVersion: string | null;
  readonly fortuneDate: string;
  readonly lifecycleRevision: number;
  readonly scheduleSlotRevision: number;
  readonly scheduledContentVersion: string | null;
  readonly scheduledEffectiveFrom: string | null;
}

export interface StoredContentReleaseIdempotency {
  readonly idempotencyKey: string;
  readonly operation: ContentReleaseIdempotencyOperation;
  readonly requestHash: string;
  readonly resourceId: string;
  readonly response: unknown;
}

export interface StoredContentScheduleTask {
  readonly attemptToken: string | null;
  readonly attempts: number;
  readonly availableAt: string;
  readonly claimedAt: string | null;
  readonly completedAt: string | null;
  readonly contentVersion: string;
  readonly createdAt: string;
  readonly effectiveFrom: string;
  readonly fortuneDate: string;
  readonly lastError: string | null;
  readonly leaseExpiresAt: string | null;
  readonly scheduleSlotRevision: number;
  readonly status: ContentScheduleTaskStatus;
  readonly taskId: string;
  readonly terminatedAt: string | null;
  readonly terminationReason: string | null;
  readonly updatedAt: string;
  readonly workerId: string | null;
}

export interface StoredContentScheduleTaskEvent {
  readonly action: ContentScheduleTaskEventAction;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly reason: string;
  readonly status: ContentScheduleTaskStatus;
  readonly taskId: string;
}

export interface StoredContentReleaseEvent {
  readonly action: ContentReleaseEventAction;
  readonly actorId: string;
  readonly afterActiveContentVersion: string | null;
  readonly afterScheduleSlotRevision: number;
  readonly beforeActiveContentVersion: string | null;
  readonly beforeScheduleSlotRevision: number;
  readonly contentVersion: string;
  readonly fortuneDate: string;
  readonly idempotencyKey: string | null;
  readonly occurredAt: string;
  readonly reason: string;
  readonly releaseEventId: string;
  readonly requestId: string;
  readonly scheduleTaskId: string | null;
  readonly transitions: readonly ReleaseStateTransition[];
}

export interface StoredPublicCachePurgeIntent {
  readonly action: ContentReleaseEventAction;
  readonly afterActiveContentVersion: string | null;
  readonly attemptToken: string | null;
  readonly attempts: number;
  readonly availableAt: string;
  readonly beforeActiveContentVersion: string | null;
  readonly claimedAt: string | null;
  readonly createdAt: string;
  readonly fortuneDate: string;
  readonly lastError: string | null;
  readonly leaseExpiresAt: string | null;
  readonly processedAt: string | null;
  readonly purgeIntentId: string;
  readonly requestId: string;
  readonly status: PublicCachePurgeIntentStatus;
  readonly workerId: string | null;
}

export type NewPublicCachePurgeIntent = Pick<
  StoredPublicCachePurgeIntent,
  | "action"
  | "afterActiveContentVersion"
  | "beforeActiveContentVersion"
  | "createdAt"
  | "fortuneDate"
  | "purgeIntentId"
  | "requestId"
> & { readonly processedAt: null };

export interface StoredReleasePosterJob {
  readonly currentActiveContentVersion: string | null;
  readonly fortuneDate: string;
  readonly jobId: string;
  readonly sourceContentVersion: string;
  readonly status: "failed" | "processing" | "ready" | "version_changed";
}

export interface RecordScheduleTaskFailureInput {
  readonly attemptToken: string;
  readonly auditEventId: string;
  readonly auditIdempotencyKey: string;
  readonly error: string;
  readonly failedAt: string;
  readonly releaseEventId: string;
  readonly retryAt: string;
  readonly taskId: string;
  readonly workerId: string;
}

export interface UpdateReleaseVersionInput {
  readonly contentVersion: string;
  readonly expectedState: StoredContentVersion["state"];
  readonly state: StoredContentVersion["state"];
}

export interface ContentReleaseTransaction {
  completeScheduleTask(input: {
    readonly attemptToken: string;
    readonly completedAt: string;
    readonly taskId: string;
    readonly workerId: string;
  }): Promise<StoredContentScheduleTask | null>;
  findDailyImageSetForUpdate(contentVersion: string): Promise<StoredDailyImageSet | null>;
  findIdempotency(
    operation: ContentReleaseIdempotencyOperation,
    resourceId: string,
    idempotencyKey: string,
  ): Promise<StoredContentReleaseIdempotency | null>;
  findScheduleTask(taskId: string): Promise<StoredContentScheduleTask | null>;
  findScheduleTaskForUpdate(taskId: string): Promise<StoredContentScheduleTask | null>;
  findVersion(contentVersion: string): Promise<StoredContentVersion | null>;
  getProjectionForUpdate(fortuneDate: string): Promise<ContentReleaseProjection | null>;
  insertAuditEvent(event: StoredAuditEvent): Promise<void>;
  insertIdempotency(record: StoredContentReleaseIdempotency): Promise<void>;
  insertPublicCachePurgeIntent(intent: NewPublicCachePurgeIntent): Promise<void>;
  insertReleaseEvent(event: StoredContentReleaseEvent): Promise<void>;
  insertScheduleTask(task: StoredContentScheduleTask): Promise<void>;
  listEvidence(contentVersion: string): Promise<StoredMasterReviewEvidence[]>;
  listGloballyWithdrawnAssetIds(assetIds: readonly string[]): Promise<string[]>;
  lockIdempotency(
    operation: ContentReleaseIdempotencyOperation,
    resourceId: string,
    idempotencyKey: string,
  ): Promise<void>;
  markProcessingPosterJobsVersionChanged(input: {
    readonly changedAt: string;
    readonly currentActiveContentVersion: string | null;
    readonly fortuneDate: string;
  }): Promise<number>;
  terminateClaimedScheduleTask(input: {
    readonly attemptToken: string;
    readonly reason: string;
    readonly taskId: string;
    readonly terminatedAt: string;
    readonly workerId: string;
  }): Promise<StoredContentScheduleTask | null>;
  terminateOpenScheduleTasks(input: {
    readonly exceptTaskId: string | null;
    readonly fortuneDate: string;
    readonly reason: string;
    readonly terminatedAt: string;
  }): Promise<StoredContentScheduleTask[]>;
  updateProjection(input: {
    readonly expectedLifecycleRevision: number;
    readonly expectedScheduleSlotRevision: number;
    readonly projection: ContentReleaseProjection;
  }): Promise<boolean>;
  updateVersion(input: UpdateReleaseVersionInput): Promise<boolean>;
}

export interface ContentReleaseStore {
  claimNextPublicCachePurgeIntent(input: {
    readonly attemptToken: string;
    readonly claimedAt: string;
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  }): Promise<StoredPublicCachePurgeIntent | null>;
  claimNextScheduleTask(input: {
    readonly attemptToken: string;
    readonly claimedAt: string;
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  }): Promise<StoredContentScheduleTask | null>;
  completePublicCachePurgeIntent(input: {
    readonly attemptToken: string;
    readonly completedAt: string;
    readonly purgeIntentId: string;
    readonly workerId: string;
  }): Promise<StoredPublicCachePurgeIntent | null>;
  listPublicCachePurgeIntents(fortuneDate: string): Promise<StoredPublicCachePurgeIntent[]>;
  listReleaseEvents(fortuneDate: string): Promise<StoredContentReleaseEvent[]>;
  listScheduleTaskEvents(taskId: string): Promise<StoredContentScheduleTaskEvent[]>;
  readProjection(fortuneDate: string): Promise<ContentReleaseProjection | null>;
  readScheduleTask(taskId: string): Promise<StoredContentScheduleTask | null>;
  recordPublicCachePurgeFailure(input: {
    readonly attemptToken: string;
    readonly error: string;
    readonly failedAt: string;
    readonly purgeIntentId: string;
    readonly retryAt: string;
    readonly workerId: string;
  }): Promise<StoredPublicCachePurgeIntent | null>;
  recordScheduleTaskFailure(
    input: RecordScheduleTaskFailureInput,
  ): Promise<StoredContentScheduleTask | null>;
  transaction<T>(work: (transaction: ContentReleaseTransaction) => Promise<T>): Promise<T>;
}
