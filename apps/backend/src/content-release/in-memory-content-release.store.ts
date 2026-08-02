import { randomUUID } from "node:crypto";

import type {
  StoredAuditEvent,
  StoredContentVersion,
  StoredMasterReviewEvidence,
} from "../content-lifecycle/content-lifecycle.store";
import type { StoredDailyImageSet } from "../daily-images/daily-image-asset.store";
import type {
  ContentReleaseProjection,
  ContentReleaseStore,
  ContentReleaseTransaction,
  RecordScheduleTaskFailureInput,
  StoredContentReleaseEvent,
  StoredContentReleaseIdempotency,
  StoredContentScheduleTask,
  StoredContentScheduleTaskEvent,
  StoredPublicCachePurgeIntent,
  StoredReleasePosterJob,
} from "./content-release.store";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new RangeError(`Invalid release-store timestamp: ${value}`);
  return parsed;
}

function idempotencyId(
  operation: StoredContentReleaseIdempotency["operation"],
  resourceId: string,
  idempotencyKey: string,
): string {
  return `${operation}\u0000${resourceId}\u0000${idempotencyKey}`;
}

export class InMemoryContentReleaseStore implements ContentReleaseStore {
  private audits: StoredAuditEvent[] = [];
  private dailyImageSets = new Map<string, StoredDailyImageSet>();
  private evidence = new Map<string, StoredMasterReviewEvidence[]>();
  private globallyWithdrawnAssetIds = new Set<string>();
  private idempotency = new Map<string, StoredContentReleaseIdempotency>();
  private posterJobs = new Map<string, StoredReleasePosterJob>();
  private projections = new Map<string, ContentReleaseProjection>();
  private purgeIntents: StoredPublicCachePurgeIntent[] = [];
  private releaseEvents: StoredContentReleaseEvent[] = [];
  private scheduleTaskEvents: StoredContentScheduleTaskEvent[] = [];
  private scheduleTasks = new Map<string, StoredContentScheduleTask>();
  private transactionTail: Promise<void> = Promise.resolve();
  private versions = new Map<string, StoredContentVersion>();

  seedDailyImageSet(imageSet: StoredDailyImageSet): void {
    this.dailyImageSets.set(imageSet.contentVersion, clone(imageSet));
  }

  seedEvidence(contentVersion: string, evidence: readonly StoredMasterReviewEvidence[]): void {
    this.evidence.set(
      contentVersion,
      evidence.map((record) => clone(record)),
    );
  }

  seedGloballyWithdrawnAssetIds(assetIds: readonly string[]): void {
    for (const assetId of assetIds) this.globallyWithdrawnAssetIds.add(assetId);
  }

  seedPosterJob(job: StoredReleasePosterJob): void {
    this.posterJobs.set(job.jobId, clone(job));
  }

  seedProjection(projection: ContentReleaseProjection): void {
    this.projections.set(projection.fortuneDate, clone(projection));
  }

  seedVersion(version: StoredContentVersion): void {
    this.versions.set(version.contentVersion, clone(version));
  }

  async claimNextPublicCachePurgeIntent(input: {
    readonly attemptToken: string;
    readonly claimedAt: string;
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  }): Promise<StoredPublicCachePurgeIntent | null> {
    return this.transaction(async () => {
      const claimedAt = instant(input.claimedAt);
      const intent = this.purgeIntents
        .filter(
          (candidate) =>
            (candidate.status === "pending" && instant(candidate.availableAt) <= claimedAt) ||
            (candidate.status === "processing" &&
              candidate.leaseExpiresAt !== null &&
              instant(candidate.leaseExpiresAt) <= claimedAt),
        )
        .sort(
          (left, right) =>
            instant(left.status === "processing" ? left.leaseExpiresAt! : left.availableAt) -
              instant(right.status === "processing" ? right.leaseExpiresAt! : right.availableAt) ||
            instant(left.createdAt) - instant(right.createdAt) ||
            left.purgeIntentId.localeCompare(right.purgeIntentId),
        )[0];
      if (intent === undefined) return null;
      const claimed: StoredPublicCachePurgeIntent = {
        ...intent,
        attemptToken: input.attemptToken,
        attempts: intent.attempts + 1,
        claimedAt: input.claimedAt,
        leaseExpiresAt: input.leaseExpiresAt,
        status: "processing",
        workerId: input.workerId,
      };
      this.replacePurgeIntent(claimed);
      return clone(claimed);
    });
  }

  async claimNextScheduleTask(input: {
    readonly attemptToken: string;
    readonly claimedAt: string;
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  }): Promise<StoredContentScheduleTask | null> {
    return this.transaction(async () => {
      const claimedAt = instant(input.claimedAt);
      const task = [...this.scheduleTasks.values()]
        .filter(
          (candidate) =>
            ((candidate.status === "pending" || candidate.status === "retrying") &&
              instant(candidate.availableAt) <= claimedAt) ||
            (candidate.status === "processing" &&
              candidate.leaseExpiresAt !== null &&
              instant(candidate.leaseExpiresAt) <= claimedAt),
        )
        .sort(
          (left, right) =>
            instant(left.availableAt) - instant(right.availableAt) ||
            instant(left.createdAt) - instant(right.createdAt) ||
            left.taskId.localeCompare(right.taskId),
        )[0];
      if (task === undefined) return null;
      const claimed: StoredContentScheduleTask = {
        ...task,
        attemptToken: input.attemptToken,
        attempts: task.attempts + 1,
        claimedAt: input.claimedAt,
        leaseExpiresAt: input.leaseExpiresAt,
        status: "processing",
        updatedAt: input.claimedAt,
        workerId: input.workerId,
      };
      this.scheduleTasks.set(task.taskId, clone(claimed));
      this.appendScheduleTaskEvent(claimed, "claimed", input.claimedAt, "排期任务已领取。");
      return clone(claimed);
    });
  }

  async completePublicCachePurgeIntent(input: {
    readonly attemptToken: string;
    readonly completedAt: string;
    readonly purgeIntentId: string;
    readonly workerId: string;
  }): Promise<StoredPublicCachePurgeIntent | null> {
    return this.transaction(async () => {
      const intent = this.purgeIntents.find(
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
      const completed: StoredPublicCachePurgeIntent = {
        ...intent,
        attemptToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
        processedAt: input.completedAt,
        status: "completed",
        workerId: null,
      };
      this.replacePurgeIntent(completed);
      return clone(completed);
    });
  }

  async listPublicCachePurgeIntents(fortuneDate: string): Promise<StoredPublicCachePurgeIntent[]> {
    await this.transactionTail;
    return clone(this.purgeIntents.filter((intent) => intent.fortuneDate === fortuneDate));
  }

  async listReleaseEvents(fortuneDate: string): Promise<StoredContentReleaseEvent[]> {
    await this.transactionTail;
    return clone(this.releaseEvents.filter((event) => event.fortuneDate === fortuneDate));
  }

  async listScheduleTaskEvents(taskId: string): Promise<StoredContentScheduleTaskEvent[]> {
    await this.transactionTail;
    return clone(this.scheduleTaskEvents.filter((event) => event.taskId === taskId));
  }

  async readAuditEventsForTest(): Promise<StoredAuditEvent[]> {
    await this.transactionTail;
    return clone(this.audits);
  }

  async readPosterJobsForTest(): Promise<StoredReleasePosterJob[]> {
    await this.transactionTail;
    return clone([...this.posterJobs.values()]);
  }

  async readPosterVersionChangedCount(): Promise<number> {
    await this.transactionTail;
    return [...this.posterJobs.values()].filter((job) => job.status === "version_changed").length;
  }

  async readProjection(fortuneDate: string): Promise<ContentReleaseProjection | null> {
    await this.transactionTail;
    return clone(this.projections.get(fortuneDate) ?? null);
  }

  async readScheduleTask(taskId: string): Promise<StoredContentScheduleTask | null> {
    await this.transactionTail;
    return clone(this.scheduleTasks.get(taskId) ?? null);
  }

  async readVersion(contentVersion: string): Promise<StoredContentVersion | null> {
    await this.transactionTail;
    return clone(this.versions.get(contentVersion) ?? null);
  }

  async recordPublicCachePurgeFailure(input: {
    readonly attemptToken: string;
    readonly error: string;
    readonly failedAt: string;
    readonly purgeIntentId: string;
    readonly retryAt: string;
    readonly workerId: string;
  }): Promise<StoredPublicCachePurgeIntent | null> {
    return this.transaction(async () => {
      const intent = this.purgeIntents.find(
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
      const pending: StoredPublicCachePurgeIntent = {
        ...intent,
        attemptToken: null,
        availableAt: input.retryAt,
        claimedAt: null,
        lastError: input.error,
        leaseExpiresAt: null,
        status: "pending",
        workerId: null,
      };
      this.replacePurgeIntent(pending);
      return clone(pending);
    });
  }

  async recordScheduleTaskFailure(
    input: RecordScheduleTaskFailureInput,
  ): Promise<StoredContentScheduleTask | null> {
    return this.transaction(async () => {
      const task = this.scheduleTasks.get(input.taskId);
      if (
        task === undefined ||
        task.status !== "processing" ||
        task.workerId !== input.workerId ||
        task.attemptToken !== input.attemptToken
      ) {
        return null;
      }
      const projection = this.projections.get(task.fortuneDate);
      if (projection === undefined) {
        throw new Error("Scheduled release failure requires its locked day projection");
      }
      const retrying: StoredContentScheduleTask = {
        ...task,
        attemptToken: null,
        availableAt: input.retryAt,
        claimedAt: null,
        lastError: input.error,
        leaseExpiresAt: null,
        status: "retrying",
        updatedAt: input.failedAt,
        workerId: null,
      };
      this.scheduleTasks.set(task.taskId, clone(retrying));
      this.appendScheduleTaskEvent(retrying, "retry_scheduled", input.failedAt, input.error);
      if (
        this.releaseEvents.some((event) => event.releaseEventId === input.releaseEventId) ||
        this.audits.some((event) => event.auditEventId === input.auditEventId)
      ) {
        throw new Error("duplicate scheduled release failure event");
      }
      const transition = {
        contentVersion: task.contentVersion,
        fromState: "scheduled" as const,
        toState: "scheduled" as const,
      };
      this.releaseEvents.push({
        action: "scheduled_publish_failed",
        actorId: "system:scheduled-release-worker",
        afterActiveContentVersion: projection.activeContentVersion,
        afterScheduleSlotRevision: projection.scheduleSlotRevision,
        beforeActiveContentVersion: projection.activeContentVersion,
        beforeScheduleSlotRevision: projection.scheduleSlotRevision,
        contentVersion: task.contentVersion,
        fortuneDate: task.fortuneDate,
        idempotencyKey: null,
        occurredAt: input.failedAt,
        reason: input.error,
        releaseEventId: input.releaseEventId,
        requestId: `scheduled-${task.taskId}`,
        scheduleTaskId: task.taskId,
        transitions: [transition],
      });
      this.audits.push({
        action: "content_scheduled_publish_failed",
        actorId: "system:scheduled-release-worker",
        auditEventId: input.auditEventId,
        contentVersion: task.contentVersion,
        fortuneDate: task.fortuneDate,
        fromState: "scheduled",
        idempotencyKey: input.auditIdempotencyKey,
        occurredAt: input.failedAt,
        reason: input.error,
        requestId: `scheduled-${task.taskId}`,
        toState: "scheduled",
      });
      return clone(retrying);
    });
  }

  async transaction<T>(work: (transaction: ContentReleaseTransaction) => Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const prior = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    const snapshot = {
      audits: clone(this.audits),
      dailyImageSets: clone(this.dailyImageSets),
      evidence: clone(this.evidence),
      globallyWithdrawnAssetIds: clone(this.globallyWithdrawnAssetIds),
      idempotency: clone(this.idempotency),
      posterJobs: clone(this.posterJobs),
      projections: clone(this.projections),
      purgeIntents: clone(this.purgeIntents),
      releaseEvents: clone(this.releaseEvents),
      scheduleTaskEvents: clone(this.scheduleTaskEvents),
      scheduleTasks: clone(this.scheduleTasks),
      versions: clone(this.versions),
    };
    try {
      return await work(this.transactionAdapter());
    } catch (error) {
      this.audits = snapshot.audits;
      this.dailyImageSets = snapshot.dailyImageSets;
      this.evidence = snapshot.evidence;
      this.globallyWithdrawnAssetIds = snapshot.globallyWithdrawnAssetIds;
      this.idempotency = snapshot.idempotency;
      this.posterJobs = snapshot.posterJobs;
      this.projections = snapshot.projections;
      this.purgeIntents = snapshot.purgeIntents;
      this.releaseEvents = snapshot.releaseEvents;
      this.scheduleTaskEvents = snapshot.scheduleTaskEvents;
      this.scheduleTasks = snapshot.scheduleTasks;
      this.versions = snapshot.versions;
      throw error;
    } finally {
      release?.();
    }
  }

  private transactionAdapter(): ContentReleaseTransaction {
    return {
      completeScheduleTask: async (input) => {
        const task = this.scheduleTasks.get(input.taskId);
        if (
          task === undefined ||
          task.status !== "processing" ||
          task.workerId !== input.workerId ||
          task.attemptToken !== input.attemptToken
        ) {
          return null;
        }
        const completed: StoredContentScheduleTask = {
          ...task,
          attemptToken: null,
          claimedAt: null,
          completedAt: input.completedAt,
          leaseExpiresAt: null,
          status: "completed",
          updatedAt: input.completedAt,
          workerId: null,
        };
        this.scheduleTasks.set(task.taskId, clone(completed));
        this.appendScheduleTaskEvent(completed, "completed", input.completedAt, "排期任务已完成。");
        return clone(completed);
      },
      findDailyImageSetForUpdate: async (contentVersion) =>
        clone(this.dailyImageSets.get(contentVersion) ?? null),
      findIdempotency: async (operation, resourceId, idempotencyKey) =>
        clone(this.idempotency.get(idempotencyId(operation, resourceId, idempotencyKey)) ?? null),
      findScheduleTask: async (taskId) => clone(this.scheduleTasks.get(taskId) ?? null),
      findScheduleTaskForUpdate: async (taskId) => clone(this.scheduleTasks.get(taskId) ?? null),
      findVersion: async (contentVersion) => clone(this.versions.get(contentVersion) ?? null),
      getProjectionForUpdate: async (fortuneDate) =>
        clone(this.projections.get(fortuneDate) ?? null),
      insertAuditEvent: async (event) => {
        if (this.audits.some((candidate) => candidate.auditEventId === event.auditEventId)) {
          throw new Error("duplicate audit event");
        }
        this.audits.push(clone(event));
      },
      insertIdempotency: async (record) => {
        const key = idempotencyId(record.operation, record.resourceId, record.idempotencyKey);
        if (this.idempotency.has(key)) throw new Error("duplicate release idempotency");
        this.idempotency.set(key, clone(record));
      },
      insertPublicCachePurgeIntent: async (intent) => {
        if (
          this.purgeIntents.some((candidate) => candidate.purgeIntentId === intent.purgeIntentId)
        ) {
          throw new Error("duplicate public cache purge intent");
        }
        this.purgeIntents.push({
          ...clone(intent),
          attemptToken: null,
          attempts: 0,
          availableAt: intent.createdAt,
          claimedAt: null,
          lastError: null,
          leaseExpiresAt: null,
          status: "pending",
          workerId: null,
        });
      },
      insertReleaseEvent: async (event) => {
        if (
          this.releaseEvents.some((candidate) => candidate.releaseEventId === event.releaseEventId)
        ) {
          throw new Error("duplicate release event");
        }
        this.releaseEvents.push(clone(event));
      },
      insertScheduleTask: async (task) => {
        if (this.scheduleTasks.has(task.taskId)) throw new Error("duplicate schedule task");
        this.scheduleTasks.set(task.taskId, clone(task));
        this.appendScheduleTaskEvent(task, "created", task.createdAt, "排期任务已创建。");
      },
      listEvidence: async (contentVersion) => clone(this.evidence.get(contentVersion) ?? []),
      listGloballyWithdrawnAssetIds: async (assetIds) => {
        const selected = new Set(assetIds);
        return [...this.globallyWithdrawnAssetIds]
          .filter((assetId) => selected.has(assetId))
          .sort();
      },
      lockIdempotency: async () => undefined,
      markProcessingPosterJobsVersionChanged: async ({
        currentActiveContentVersion,
        fortuneDate,
      }) => {
        let changed = 0;
        for (const [jobId, job] of this.posterJobs) {
          if (
            job.fortuneDate !== fortuneDate ||
            job.status !== "processing" ||
            job.sourceContentVersion === currentActiveContentVersion
          ) {
            continue;
          }
          this.posterJobs.set(jobId, {
            ...clone(job),
            currentActiveContentVersion,
            status: "version_changed",
          });
          changed += 1;
        }
        return changed;
      },
      terminateOpenScheduleTasks: async ({ exceptTaskId, fortuneDate, reason, terminatedAt }) => {
        const terminated: StoredContentScheduleTask[] = [];
        for (const [taskId, task] of this.scheduleTasks) {
          if (
            task.fortuneDate !== fortuneDate ||
            taskId === exceptTaskId ||
            task.status === "completed" ||
            task.status === "terminated"
          ) {
            continue;
          }
          const next: StoredContentScheduleTask = {
            ...task,
            attemptToken: null,
            claimedAt: null,
            leaseExpiresAt: null,
            status: "terminated",
            terminatedAt,
            terminationReason: reason,
            updatedAt: terminatedAt,
            workerId: null,
          };
          this.scheduleTasks.set(taskId, clone(next));
          this.appendScheduleTaskEvent(next, "terminated", terminatedAt, reason);
          terminated.push(clone(next));
        }
        return terminated;
      },
      updateProjection: async ({
        expectedLifecycleRevision,
        expectedScheduleSlotRevision,
        projection,
      }) => {
        const current = this.projections.get(projection.fortuneDate);
        if (
          current === undefined ||
          current.lifecycleRevision !== expectedLifecycleRevision ||
          current.scheduleSlotRevision !== expectedScheduleSlotRevision
        ) {
          return false;
        }
        this.projections.set(projection.fortuneDate, clone(projection));
        return true;
      },
      updateVersion: async (input) => {
        const current = this.versions.get(input.contentVersion);
        if (current === undefined || current.state !== input.expectedState) return false;
        this.versions.set(input.contentVersion, {
          ...clone(current),
          state: input.state,
        });
        return true;
      },
    };
  }

  private appendScheduleTaskEvent(
    task: StoredContentScheduleTask,
    action: StoredContentScheduleTaskEvent["action"],
    occurredAt: string,
    reason: string,
  ): void {
    this.scheduleTaskEvents.push({
      action,
      eventId: `schedule-event-${randomUUID()}`,
      occurredAt,
      reason,
      status: task.status,
      taskId: task.taskId,
    });
  }

  private replacePurgeIntent(intent: StoredPublicCachePurgeIntent): void {
    const index = this.purgeIntents.findIndex(
      (candidate) => candidate.purgeIntentId === intent.purgeIntentId,
    );
    if (index === -1) throw new Error("public cache purge intent disappeared");
    this.purgeIntents[index] = clone(intent);
  }
}
