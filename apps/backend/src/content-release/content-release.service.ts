import { createHash, randomUUID } from "node:crypto";

import type { components } from "@five/api-contract";

import { CalendarRuleEngine } from "../calendar/calendar-rule-engine";
import { evaluateContentPreflight } from "../content-lifecycle/content-preflight";
import type {
  PreflightCheck,
  StoredContentVersion,
  StoredMasterReviewEvidence,
} from "../content-lifecycle/content-lifecycle.store";
import { CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN } from "../content-lifecycle/content-lifecycle.values";
import type { StoredDailyImageSet } from "../daily-images/daily-image-asset.store";
import type {
  ContentReleaseEventAction,
  ContentReleaseIdempotencyOperation,
  ContentReleaseProjection,
  ContentReleaseStore,
  ContentReleaseTransaction,
  ReleaseStateTransition,
  StoredContentScheduleTask,
} from "./content-release.store";

type LifecycleActionResult = components["schemas"]["LifecycleActionResult"];

export interface ContentReleaseClock {
  now(): Date;
}

export interface ContentReleaseIdentifiers {
  nextAuditEventId(): string;
  nextPurgeIntentId(): string;
  nextReleaseEventId(): string;
  nextScheduleTaskId(): string;
}

export type ContentReleasePreflightEvaluator = (
  version: StoredContentVersion,
  evidence: readonly StoredMasterReviewEvidence[],
  imageSet: StoredDailyImageSet | null,
  globallyWithdrawnAssetIds: readonly string[],
) => readonly PreflightCheck[];

const SYSTEM_CLOCK: ContentReleaseClock = { now: () => new Date() };
const SYSTEM_IDENTIFIERS: ContentReleaseIdentifiers = {
  nextAuditEventId: () => `audit-${randomUUID()}`,
  nextPurgeIntentId: () => `purge-${randomUUID()}`,
  nextReleaseEventId: () => `release-${randomUUID()}`,
  nextScheduleTaskId: () => `schedule-${randomUUID()}`,
};
const CALENDAR = new CalendarRuleEngine();
const DEFAULT_PREFLIGHT: ContentReleasePreflightEvaluator = (
  version,
  evidence,
  imageSet,
  globallyWithdrawnAssetIds,
) =>
  evaluateContentPreflight(
    version.snapshot,
    evidence,
    version.fortuneDate,
    imageSet,
    globallyWithdrawnAssetIds,
  );

export type ContentReleaseActionResult =
  | { readonly action: LifecycleActionResult; readonly kind: "applied" | "existing" }
  | { readonly currentActiveContentVersion: string | null; readonly kind: "active_version_changed" }
  | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "invalid_argument" }
  | { readonly kind: "invalid_state" }
  | { readonly kind: "not_found" }
  | { readonly kind: "preflight_failed"; readonly preflightChecks: readonly PreflightCheck[] }
  | { readonly kind: "schedule_time_invalid" }
  | { readonly kind: "version_withdrawn" };

export type ScheduledReleaseResult =
  | { readonly action: LifecycleActionResult; readonly kind: "published" }
  | { readonly kind: "lost" | "stale" }
  | { readonly kind: "window_invalid" }
  | { readonly kind: "preflight_failed"; readonly preflightChecks: readonly PreflightCheck[] };

interface CommonAdminInput {
  readonly actorId: string;
  readonly expectedActiveContentVersion: string | null;
  readonly expectedLifecycleRevision: number;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly requestId: string;
}

interface ReleaseWindow {
  readonly effectiveFrom: string;
  readonly effectiveFromMs: number;
  readonly effectiveTo: string;
  readonly effectiveToMs: number;
}

interface RecordActionInput {
  readonly action: ContentReleaseEventAction;
  readonly actorId: string;
  readonly afterProjection: ContentReleaseProjection;
  readonly beforeProjection: ContentReleaseProjection;
  readonly contentVersion: string;
  readonly idempotencyKey: string | null;
  readonly now: string;
  readonly reason: string;
  readonly requestId: string;
  readonly scheduleTaskId: string | null;
  readonly state: LifecycleActionResult["state"];
  readonly transitions: readonly ReleaseStateTransition[];
}

function releaseRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validCommonInput(input: CommonAdminInput): boolean {
  return (
    input.actorId.trim().length > 0 &&
    input.requestId.length >= 8 &&
    input.requestId.length <= 128 &&
    Number.isSafeInteger(input.expectedLifecycleRevision) &&
    input.expectedLifecycleRevision >= 1 &&
    CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey) &&
    input.reason.trim().length > 0 &&
    Array.from(input.reason).length <= 2_000
  );
}

function releaseWindow(fortuneDate: string): ReleaseWindow {
  const answer = CALENDAR.evaluate(fortuneDate);
  return {
    effectiveFrom: answer.effectiveFrom,
    effectiveFromMs: new Date(answer.effectiveFrom).getTime(),
    effectiveTo: answer.effectiveTo,
    effectiveToMs: new Date(answer.effectiveTo).getTime(),
  };
}

function sameInstant(left: string, right: string): boolean {
  const leftMs = Date.parse(left);
  return Number.isFinite(leftMs) && leftMs === Date.parse(right);
}

function hasFixedReleaseWindow(version: StoredContentVersion, window: ReleaseWindow): boolean {
  return (
    version.effectiveFrom !== null &&
    version.effectiveTo !== null &&
    sameInstant(version.effectiveFrom, window.effectiveFrom) &&
    sameInstant(version.effectiveTo, window.effectiveTo)
  );
}

function actionResult(
  contentVersion: string,
  state: LifecycleActionResult["state"],
  projection: ContentReleaseProjection,
  transitions: readonly ReleaseStateTransition[],
  auditEventId: string,
): LifecycleActionResult {
  return {
    activeContentVersion: projection.activeContentVersion,
    auditEventId,
    contentVersion,
    fortuneDate: projection.fortuneDate,
    lifecycleRevision: projection.lifecycleRevision,
    state,
    transitions: [...transitions],
  };
}

function activeMatches(
  projection: ContentReleaseProjection,
  expectedActiveContentVersion: string | null,
): boolean {
  return projection.activeContentVersion === expectedActiveContentVersion;
}

export class ContentReleaseService {
  constructor(
    private readonly store: ContentReleaseStore,
    private readonly clock: ContentReleaseClock = SYSTEM_CLOCK,
    private readonly identifiers: ContentReleaseIdentifiers = SYSTEM_IDENTIFIERS,
    private readonly preflightEvaluator: ContentReleasePreflightEvaluator = DEFAULT_PREFLIGHT,
  ) {}

  async schedule(
    input: CommonAdminInput & {
      readonly contentVersion: string;
      readonly effectiveFrom: string;
    },
  ): Promise<ContentReleaseActionResult> {
    if (!validCommonInput(input)) return { kind: "invalid_argument" };
    const requestHash = releaseRequestHash({
      effectiveFrom: input.effectiveFrom,
      expectedActiveContentVersion: input.expectedActiveContentVersion,
      expectedLifecycleRevision: input.expectedLifecycleRevision,
      reason: input.reason.trim(),
    });

    return this.store.transaction(async (transaction) => {
      const prior = await this.findIdempotent(
        transaction,
        "schedule",
        input.contentVersion,
        input.idempotencyKey,
        requestHash,
      );
      if (prior !== null) return prior;

      const version = await transaction.findVersion(input.contentVersion);
      if (version === null) return { kind: "not_found" } as const;
      if (version.state === "withdrawn") return { kind: "version_withdrawn" } as const;
      const projection = await transaction.getProjectionForUpdate(version.fortuneDate);
      if (projection === null) return { kind: "not_found" } as const;
      const conflict = this.checkConcurrency(projection, input);
      if (conflict !== null) return conflict;
      if (version.state !== "approved") return { kind: "invalid_state" } as const;

      const window = releaseWindow(version.fortuneDate);
      if (
        !hasFixedReleaseWindow(version, window) ||
        !sameInstant(input.effectiveFrom, window.effectiveFrom)
      ) {
        return { kind: "schedule_time_invalid" } as const;
      }
      const preflight = await this.currentPreflight(transaction, version);
      if (!preflight.every((check) => check.status === "passed")) {
        return { kind: "preflight_failed", preflightChecks: preflight } as const;
      }

      const operationNow = this.clock.now();
      if (operationNow.getTime() >= window.effectiveFromMs) {
        return { kind: "schedule_time_invalid" } as const;
      }
      const now = operationNow.toISOString();
      const transitions: ReleaseStateTransition[] = [];
      const priorScheduled = projection.scheduledContentVersion;
      if (priorScheduled !== null) {
        const oldVersion = await transaction.findVersion(priorScheduled);
        if (oldVersion === null || oldVersion.state !== "scheduled") {
          return { kind: "invalid_state" } as const;
        }
        if (
          !(await transaction.updateVersion({
            contentVersion: priorScheduled,
            expectedState: "scheduled",
            state: "approved",
          }))
        ) {
          throw new Error("Replaced schedule changed inside its transaction lock");
        }
        transitions.push({
          contentVersion: priorScheduled,
          fromState: "scheduled",
          toState: "approved",
        });
      }
      await transaction.terminateOpenScheduleTasks({
        exceptTaskId: null,
        fortuneDate: version.fortuneDate,
        reason: priorScheduled === null ? "排期槽已更新。" : "排期已由新版本替换。",
        terminatedAt: now,
      });

      if (
        !(await transaction.updateVersion({
          contentVersion: version.contentVersion,
          expectedState: "approved",
          state: "scheduled",
        }))
      ) {
        throw new Error("Approved version changed inside its schedule transaction lock");
      }
      transitions.push({
        contentVersion: version.contentVersion,
        fromState: "approved",
        toState: "scheduled",
      });
      const scheduleSlotRevision = projection.scheduleSlotRevision + 1;
      const scheduleTaskId = this.identifiers.nextScheduleTaskId();
      const task: StoredContentScheduleTask = {
        attemptToken: null,
        attempts: 0,
        availableAt: window.effectiveFrom,
        claimedAt: null,
        completedAt: null,
        contentVersion: version.contentVersion,
        createdAt: now,
        effectiveFrom: window.effectiveFrom,
        fortuneDate: version.fortuneDate,
        lastError: null,
        leaseExpiresAt: null,
        scheduleSlotRevision,
        status: "pending",
        taskId: scheduleTaskId,
        terminatedAt: null,
        terminationReason: null,
        updatedAt: now,
        workerId: null,
      };
      await transaction.insertScheduleTask(task);
      const nextProjection: ContentReleaseProjection = {
        ...projection,
        lifecycleRevision: projection.lifecycleRevision + 1,
        scheduleSlotRevision,
        scheduledContentVersion: version.contentVersion,
        scheduledEffectiveFrom: window.effectiveFrom,
      };
      await this.updateProjection(transaction, projection, nextProjection);
      const action = await this.recordAction(transaction, {
        action: "schedule",
        actorId: input.actorId,
        afterProjection: nextProjection,
        beforeProjection: projection,
        contentVersion: version.contentVersion,
        idempotencyKey: input.idempotencyKey,
        now,
        reason: input.reason.trim(),
        requestId: input.requestId,
        scheduleTaskId,
        state: "scheduled",
        transitions,
      });
      await this.storeIdempotent(
        transaction,
        "schedule",
        input.contentVersion,
        input.idempotencyKey,
        requestHash,
        action,
      );
      return { action, kind: "applied" } as const;
    });
  }

  async cancelSchedule(
    input: CommonAdminInput & { readonly contentVersion: string },
  ): Promise<ContentReleaseActionResult> {
    return this.changeSchedule(input, "cancel_schedule");
  }

  async publish(
    input: CommonAdminInput & { readonly contentVersion: string },
  ): Promise<ContentReleaseActionResult> {
    if (!validCommonInput(input)) return { kind: "invalid_argument" };
    const requestHash = releaseRequestHash({
      expectedActiveContentVersion: input.expectedActiveContentVersion,
      expectedLifecycleRevision: input.expectedLifecycleRevision,
      reason: input.reason.trim(),
    });
    return this.store.transaction(async (transaction) => {
      const prior = await this.findIdempotent(
        transaction,
        "publish",
        input.contentVersion,
        input.idempotencyKey,
        requestHash,
      );
      if (prior !== null) return prior;
      const version = await transaction.findVersion(input.contentVersion);
      if (version === null) return { kind: "not_found" } as const;
      if (version.state === "withdrawn") return { kind: "version_withdrawn" } as const;
      const projection = await transaction.getProjectionForUpdate(version.fortuneDate);
      if (projection === null) return { kind: "not_found" } as const;
      const conflict = this.checkConcurrency(projection, input);
      if (conflict !== null) return conflict;
      if (version.state !== "approved" && version.state !== "scheduled") {
        return { kind: "invalid_state" } as const;
      }
      const window = releaseWindow(version.fortuneDate);
      const nowDate = this.clock.now();
      if (!hasFixedReleaseWindow(version, window) || nowDate.getTime() < window.effectiveFromMs) {
        return { kind: "schedule_time_invalid" } as const;
      }
      const preflight = await this.currentPreflight(transaction, version);
      if (!preflight.every((check) => check.status === "passed")) {
        return { kind: "preflight_failed", preflightChecks: preflight } as const;
      }
      const result = await this.publishLocked(transaction, {
        action: "publish",
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        now: nowDate.toISOString(),
        projection,
        reason: input.reason.trim(),
        requestId: input.requestId,
        scheduleTask: null,
        version,
      });
      if (result.kind !== "published") return { kind: "invalid_state" } as const;
      await this.storeIdempotent(
        transaction,
        "publish",
        input.contentVersion,
        input.idempotencyKey,
        requestHash,
        result.action,
      );
      return { action: result.action, kind: "applied" } as const;
    });
  }

  async withdraw(
    input: CommonAdminInput & {
      readonly contentVersion: string;
      readonly replacementContentVersion: string | null;
    },
  ): Promise<ContentReleaseActionResult> {
    if (!validCommonInput(input)) return { kind: "invalid_argument" };
    const requestHash = releaseRequestHash({
      expectedActiveContentVersion: input.expectedActiveContentVersion,
      expectedLifecycleRevision: input.expectedLifecycleRevision,
      reason: input.reason.trim(),
      replacementContentVersion: input.replacementContentVersion,
    });
    return this.store.transaction(async (transaction) => {
      const prior = await this.findIdempotent(
        transaction,
        "withdraw",
        input.contentVersion,
        input.idempotencyKey,
        requestHash,
      );
      if (prior !== null) return prior;
      const version = await transaction.findVersion(input.contentVersion);
      if (version === null) return { kind: "not_found" } as const;
      if (version.state === "withdrawn") return { kind: "version_withdrawn" } as const;
      const projection = await transaction.getProjectionForUpdate(version.fortuneDate);
      if (projection === null) return { kind: "not_found" } as const;
      const conflict = this.checkConcurrency(projection, input);
      if (conflict !== null) return conflict;
      if (
        version.state !== "published" ||
        projection.activeContentVersion !== version.contentVersion
      ) {
        return { kind: "invalid_state" } as const;
      }
      const operationNow = this.clock.now();

      let replacement: StoredContentVersion | null = null;
      if (input.replacementContentVersion !== null) {
        replacement = await transaction.findVersion(input.replacementContentVersion);
        if (replacement === null) return { kind: "not_found" } as const;
        if (replacement.state === "withdrawn") return { kind: "version_withdrawn" } as const;
        if (
          replacement.fortuneDate !== version.fortuneDate ||
          replacement.state !== "superseded" ||
          replacement.contentVersion === version.contentVersion
        ) {
          return { kind: "invalid_state" } as const;
        }
        const preflight = await this.currentPreflight(transaction, replacement);
        if (!preflight.every((check) => check.status === "passed")) {
          return { kind: "preflight_failed", preflightChecks: preflight } as const;
        }
        const replacementWindow = releaseWindow(replacement.fortuneDate);
        const replacementNow = operationNow.getTime();
        if (
          !hasFixedReleaseWindow(replacement, replacementWindow) ||
          replacementNow < replacementWindow.effectiveFromMs
        ) {
          return { kind: "schedule_time_invalid" } as const;
        }
      }

      const now = operationNow.toISOString();
      const transitions: ReleaseStateTransition[] = [];
      if (
        !(await transaction.updateVersion({
          contentVersion: version.contentVersion,
          expectedState: "published",
          state: "withdrawn",
        }))
      ) {
        throw new Error("Published version changed inside its withdrawal transaction lock");
      }
      transitions.push({
        contentVersion: version.contentVersion,
        fromState: "published",
        toState: "withdrawn",
      });

      const cleared = await this.clearScheduleSlot(transaction, projection, transitions, now);
      let activeContentVersion: string | null = null;
      if (replacement !== null) {
        if (
          !(await transaction.updateVersion({
            contentVersion: replacement.contentVersion,
            expectedState: "superseded",
            state: "published",
          }))
        ) {
          throw new Error("Rollback replacement changed inside its withdrawal transaction lock");
        }
        transitions.push({
          contentVersion: replacement.contentVersion,
          fromState: "superseded",
          toState: "published",
        });
        activeContentVersion = replacement.contentVersion;
      }
      const nextProjection: ContentReleaseProjection = {
        ...cleared,
        activeContentVersion,
        lifecycleRevision: projection.lifecycleRevision + 1,
      };
      await this.updateProjection(transaction, projection, nextProjection);
      await transaction.markProcessingPosterJobsVersionChanged({
        changedAt: now,
        currentActiveContentVersion: activeContentVersion,
        fortuneDate: version.fortuneDate,
      });
      const action = await this.recordAction(transaction, {
        action: "withdraw",
        actorId: input.actorId,
        afterProjection: nextProjection,
        beforeProjection: projection,
        contentVersion: version.contentVersion,
        idempotencyKey: input.idempotencyKey,
        now,
        reason: input.reason.trim(),
        requestId: input.requestId,
        scheduleTaskId: null,
        state: "withdrawn",
        transitions,
      });
      await this.insertPurgeIntent(
        transaction,
        "withdraw",
        projection,
        nextProjection,
        now,
        input.requestId,
      );
      await this.storeIdempotent(
        transaction,
        "withdraw",
        input.contentVersion,
        input.idempotencyKey,
        requestHash,
        action,
      );
      return { action, kind: "applied" } as const;
    });
  }

  async rollback(
    input: CommonAdminInput & {
      readonly fortuneDate: string;
      readonly targetContentVersion: string;
    },
  ): Promise<ContentReleaseActionResult> {
    if (!validCommonInput(input)) return { kind: "invalid_argument" };
    const requestHash = releaseRequestHash({
      expectedActiveContentVersion: input.expectedActiveContentVersion,
      expectedLifecycleRevision: input.expectedLifecycleRevision,
      reason: input.reason.trim(),
      targetContentVersion: input.targetContentVersion,
    });
    return this.store.transaction(async (transaction) => {
      const prior = await this.findIdempotent(
        transaction,
        "rollback",
        input.fortuneDate,
        input.idempotencyKey,
        requestHash,
      );
      if (prior !== null) return prior;
      const projection = await transaction.getProjectionForUpdate(input.fortuneDate);
      if (projection === null) return { kind: "not_found" } as const;
      const conflict = this.checkConcurrency(projection, input);
      if (conflict !== null) return conflict;
      const target = await transaction.findVersion(input.targetContentVersion);
      if (target === null) return { kind: "not_found" } as const;
      if (target.state === "withdrawn") return { kind: "version_withdrawn" } as const;
      if (target.fortuneDate !== input.fortuneDate || target.state !== "superseded") {
        return { kind: "invalid_state" } as const;
      }
      const preflight = await this.currentPreflight(transaction, target);
      if (!preflight.every((check) => check.status === "passed")) {
        return { kind: "preflight_failed", preflightChecks: preflight } as const;
      }
      const nowDate = this.clock.now();
      const window = releaseWindow(input.fortuneDate);
      if (!hasFixedReleaseWindow(target, window) || nowDate.getTime() < window.effectiveFromMs) {
        return { kind: "schedule_time_invalid" } as const;
      }
      const now = nowDate.toISOString();
      const transitions: ReleaseStateTransition[] = [];
      if (projection.activeContentVersion !== null) {
        const current = await transaction.findVersion(projection.activeContentVersion);
        if (current === null || current.state !== "published") {
          return { kind: "invalid_state" } as const;
        }
        if (
          !(await transaction.updateVersion({
            contentVersion: current.contentVersion,
            expectedState: "published",
            state: "superseded",
          }))
        ) {
          throw new Error("Active version changed inside its rollback transaction lock");
        }
        transitions.push({
          contentVersion: current.contentVersion,
          fromState: "published",
          toState: "superseded",
        });
      }
      const cleared = await this.clearScheduleSlot(transaction, projection, transitions, now);
      if (
        !(await transaction.updateVersion({
          contentVersion: target.contentVersion,
          expectedState: "superseded",
          state: "published",
        }))
      ) {
        throw new Error("Rollback target changed inside its transaction lock");
      }
      transitions.push({
        contentVersion: target.contentVersion,
        fromState: "superseded",
        toState: "published",
      });
      const nextProjection: ContentReleaseProjection = {
        ...cleared,
        activeContentVersion: target.contentVersion,
        lifecycleRevision: projection.lifecycleRevision + 1,
      };
      await this.updateProjection(transaction, projection, nextProjection);
      await transaction.markProcessingPosterJobsVersionChanged({
        changedAt: now,
        currentActiveContentVersion: target.contentVersion,
        fortuneDate: input.fortuneDate,
      });
      const action = await this.recordAction(transaction, {
        action: "rollback",
        actorId: input.actorId,
        afterProjection: nextProjection,
        beforeProjection: projection,
        contentVersion: target.contentVersion,
        idempotencyKey: input.idempotencyKey,
        now,
        reason: input.reason.trim(),
        requestId: input.requestId,
        scheduleTaskId: null,
        state: "published",
        transitions,
      });
      await this.insertPurgeIntent(
        transaction,
        "rollback",
        projection,
        nextProjection,
        now,
        input.requestId,
      );
      await this.storeIdempotent(
        transaction,
        "rollback",
        input.fortuneDate,
        input.idempotencyKey,
        requestHash,
        action,
      );
      return { action, kind: "applied" } as const;
    });
  }

  async publishScheduledTask(input: {
    readonly attemptToken: string;
    readonly taskId: string;
    readonly workerId: string;
  }): Promise<ScheduledReleaseResult> {
    return this.store.transaction(async (transaction) => {
      const candidate = await transaction.findScheduleTask(input.taskId);
      if (candidate === null) return { kind: "lost" } as const;
      const projection = await transaction.getProjectionForUpdate(candidate.fortuneDate);
      if (projection === null) return { kind: "stale" } as const;
      const task = await transaction.findScheduleTaskForUpdate(input.taskId);
      if (
        task === null ||
        task.status !== "processing" ||
        task.workerId !== input.workerId ||
        task.attemptToken !== input.attemptToken ||
        task.fortuneDate !== candidate.fortuneDate
      ) {
        return { kind: "lost" } as const;
      }
      if (
        projection.scheduledContentVersion !== task.contentVersion ||
        projection.scheduleSlotRevision !== task.scheduleSlotRevision
      ) {
        return { kind: "stale" } as const;
      }
      const version = await transaction.findVersion(task.contentVersion);
      if (version === null || version.state !== "scheduled") return { kind: "stale" } as const;
      const preflight = await this.currentPreflight(transaction, version);
      if (!preflight.every((check) => check.status === "passed")) {
        return { kind: "preflight_failed", preflightChecks: preflight } as const;
      }
      const window = releaseWindow(version.fortuneDate);
      const now = this.clock.now();
      if (!hasFixedReleaseWindow(version, window) || now.getTime() < window.effectiveFromMs) {
        return { kind: "window_invalid" } as const;
      }
      return this.publishLocked(transaction, {
        action: "scheduled_publish",
        actorId: "system:scheduled-release-worker",
        idempotencyKey: null,
        now: now.toISOString(),
        projection,
        reason: "有效排期任务到时自动发布。",
        requestId: `scheduled-${task.taskId}`,
        scheduleTask: task,
        version,
      });
    });
  }

  private async changeSchedule(
    input: CommonAdminInput & { readonly contentVersion: string },
    operation: "cancel_schedule",
  ): Promise<ContentReleaseActionResult> {
    if (!validCommonInput(input)) return { kind: "invalid_argument" };
    const requestHash = releaseRequestHash({
      expectedActiveContentVersion: input.expectedActiveContentVersion,
      expectedLifecycleRevision: input.expectedLifecycleRevision,
      reason: input.reason.trim(),
    });
    return this.store.transaction(async (transaction) => {
      const prior = await this.findIdempotent(
        transaction,
        operation,
        input.contentVersion,
        input.idempotencyKey,
        requestHash,
      );
      if (prior !== null) return prior;
      const version = await transaction.findVersion(input.contentVersion);
      if (version === null) return { kind: "not_found" } as const;
      if (version.state === "withdrawn") return { kind: "version_withdrawn" } as const;
      const projection = await transaction.getProjectionForUpdate(version.fortuneDate);
      if (projection === null) return { kind: "not_found" } as const;
      const conflict = this.checkConcurrency(projection, input);
      if (conflict !== null) return conflict;
      if (
        version.state !== "scheduled" ||
        projection.scheduledContentVersion !== version.contentVersion
      ) {
        return { kind: "invalid_state" } as const;
      }
      const now = this.clock.now().toISOString();
      if (
        !(await transaction.updateVersion({
          contentVersion: version.contentVersion,
          expectedState: "scheduled",
          state: "approved",
        }))
      ) {
        throw new Error("Scheduled version changed inside its cancellation transaction lock");
      }
      await transaction.terminateOpenScheduleTasks({
        exceptTaskId: null,
        fortuneDate: version.fortuneDate,
        reason: input.reason.trim(),
        terminatedAt: now,
      });
      const nextProjection: ContentReleaseProjection = {
        ...projection,
        lifecycleRevision: projection.lifecycleRevision + 1,
        scheduleSlotRevision: projection.scheduleSlotRevision + 1,
        scheduledContentVersion: null,
        scheduledEffectiveFrom: null,
      };
      await this.updateProjection(transaction, projection, nextProjection);
      const transitions: ReleaseStateTransition[] = [
        {
          contentVersion: version.contentVersion,
          fromState: "scheduled",
          toState: "approved",
        },
      ];
      const action = await this.recordAction(transaction, {
        action: operation,
        actorId: input.actorId,
        afterProjection: nextProjection,
        beforeProjection: projection,
        contentVersion: version.contentVersion,
        idempotencyKey: input.idempotencyKey,
        now,
        reason: input.reason.trim(),
        requestId: input.requestId,
        scheduleTaskId: null,
        state: "approved",
        transitions,
      });
      await this.storeIdempotent(
        transaction,
        operation,
        input.contentVersion,
        input.idempotencyKey,
        requestHash,
        action,
      );
      return { action, kind: "applied" } as const;
    });
  }

  private async publishLocked(
    transaction: ContentReleaseTransaction,
    input: {
      readonly action: "publish" | "scheduled_publish";
      readonly actorId: string;
      readonly idempotencyKey: string | null;
      readonly now: string;
      readonly projection: ContentReleaseProjection;
      readonly reason: string;
      readonly requestId: string;
      readonly scheduleTask: StoredContentScheduleTask | null;
      readonly version: StoredContentVersion;
    },
  ): Promise<ScheduledReleaseResult> {
    const transitions: ReleaseStateTransition[] = [];
    if (input.projection.activeContentVersion !== null) {
      const current = await transaction.findVersion(input.projection.activeContentVersion);
      if (current === null || current.state !== "published") return { kind: "stale" };
      if (
        !(await transaction.updateVersion({
          contentVersion: current.contentVersion,
          expectedState: "published",
          state: "superseded",
        }))
      ) {
        throw new Error("Active version changed inside its publication transaction lock");
      }
      transitions.push({
        contentVersion: current.contentVersion,
        fromState: "published",
        toState: "superseded",
      });
    }

    let scheduleSlotRevision = input.projection.scheduleSlotRevision;
    if (input.projection.scheduledContentVersion !== null) {
      const scheduledVersion = input.projection.scheduledContentVersion;
      if (scheduledVersion !== input.version.contentVersion) {
        const scheduled = await transaction.findVersion(scheduledVersion);
        if (scheduled === null || scheduled.state !== "scheduled") return { kind: "stale" };
        if (
          !(await transaction.updateVersion({
            contentVersion: scheduledVersion,
            expectedState: "scheduled",
            state: "approved",
          }))
        ) {
          throw new Error("Scheduled replacement changed inside publication transaction lock");
        }
        transitions.push({
          contentVersion: scheduledVersion,
          fromState: "scheduled",
          toState: "approved",
        });
      }
      await transaction.terminateOpenScheduleTasks({
        exceptTaskId: input.scheduleTask?.taskId ?? null,
        fortuneDate: input.version.fortuneDate,
        reason: "排期槽已由发布事务终止。",
        terminatedAt: input.now,
      });
      scheduleSlotRevision += 1;
    }

    if (
      !(await transaction.updateVersion({
        contentVersion: input.version.contentVersion,
        expectedState: input.version.state,
        state: "published",
      }))
    ) {
      throw new Error("Release target changed inside its publication transaction lock");
    }
    transitions.push({
      contentVersion: input.version.contentVersion,
      fromState: input.version.state,
      toState: "published",
    });
    const nextProjection: ContentReleaseProjection = {
      ...input.projection,
      activeContentVersion: input.version.contentVersion,
      lifecycleRevision: input.projection.lifecycleRevision + 1,
      scheduleSlotRevision,
      scheduledContentVersion: null,
      scheduledEffectiveFrom: null,
    };
    await this.updateProjection(transaction, input.projection, nextProjection);
    if (input.scheduleTask !== null) {
      const completed = await transaction.completeScheduleTask({
        attemptToken: input.scheduleTask.attemptToken!,
        completedAt: input.now,
        taskId: input.scheduleTask.taskId,
        workerId: input.scheduleTask.workerId!,
      });
      if (completed === null) {
        throw new Error("Schedule task fence changed inside its publication transaction lock");
      }
    }
    await transaction.markProcessingPosterJobsVersionChanged({
      changedAt: input.now,
      currentActiveContentVersion: input.version.contentVersion,
      fortuneDate: input.version.fortuneDate,
    });
    const action = await this.recordAction(transaction, {
      action: input.action,
      actorId: input.actorId,
      afterProjection: nextProjection,
      beforeProjection: input.projection,
      contentVersion: input.version.contentVersion,
      idempotencyKey: input.idempotencyKey,
      now: input.now,
      reason: input.reason,
      requestId: input.requestId,
      scheduleTaskId: input.scheduleTask?.taskId ?? null,
      state: "published",
      transitions,
    });
    await this.insertPurgeIntent(
      transaction,
      input.action,
      input.projection,
      nextProjection,
      input.now,
      input.requestId,
    );
    return { action, kind: "published" };
  }

  private async clearScheduleSlot(
    transaction: ContentReleaseTransaction,
    projection: ContentReleaseProjection,
    transitions: ReleaseStateTransition[],
    now: string,
  ): Promise<ContentReleaseProjection> {
    if (projection.scheduledContentVersion === null) return projection;
    const scheduled = await transaction.findVersion(projection.scheduledContentVersion);
    if (scheduled !== null && scheduled.state === "scheduled") {
      const updated = await transaction.updateVersion({
        contentVersion: scheduled.contentVersion,
        expectedState: "scheduled",
        state: "approved",
      });
      if (!updated) throw new Error("Scheduled version changed while clearing its release slot");
      transitions.push({
        contentVersion: scheduled.contentVersion,
        fromState: "scheduled",
        toState: "approved",
      });
    }
    await transaction.terminateOpenScheduleTasks({
      exceptTaskId: null,
      fortuneDate: projection.fortuneDate,
      reason: "活跃内容变化，原排期任务已终止。",
      terminatedAt: now,
    });
    return {
      ...projection,
      scheduleSlotRevision: projection.scheduleSlotRevision + 1,
      scheduledContentVersion: null,
      scheduledEffectiveFrom: null,
    };
  }

  private async currentPreflight(
    transaction: ContentReleaseTransaction,
    version: StoredContentVersion,
  ): Promise<readonly PreflightCheck[]> {
    const evidence = await transaction.listEvidence(version.contentVersion);
    const imageSet = await transaction.findDailyImageSetForUpdate(version.contentVersion);
    const globallyWithdrawnAssetIds =
      imageSet === null
        ? []
        : await transaction.listGloballyWithdrawnAssetIds(
            imageSet.assets.map((asset) => asset.assetId),
          );
    return this.preflightEvaluator(version, evidence, imageSet, globallyWithdrawnAssetIds);
  }

  private checkConcurrency(
    projection: ContentReleaseProjection,
    input: CommonAdminInput,
  ):
    | {
        readonly currentActiveContentVersion: string | null;
        readonly kind: "active_version_changed";
      }
    | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
    | null {
    if (projection.lifecycleRevision !== input.expectedLifecycleRevision) {
      return { currentRevision: projection.lifecycleRevision, kind: "revision_mismatch" };
    }
    if (!activeMatches(projection, input.expectedActiveContentVersion)) {
      return {
        currentActiveContentVersion: projection.activeContentVersion,
        kind: "active_version_changed",
      };
    }
    return null;
  }

  private async findIdempotent(
    transaction: ContentReleaseTransaction,
    operation: ContentReleaseIdempotencyOperation,
    resourceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ContentReleaseActionResult | null> {
    await transaction.lockIdempotency(operation, resourceId, idempotencyKey);
    const prior = await transaction.findIdempotency(operation, resourceId, idempotencyKey);
    if (prior === null) return null;
    return prior.requestHash === requestHash
      ? { action: prior.response as LifecycleActionResult, kind: "existing" }
      : { kind: "idempotency_conflict" };
  }

  private async storeIdempotent(
    transaction: ContentReleaseTransaction,
    operation: ContentReleaseIdempotencyOperation,
    resourceId: string,
    idempotencyKey: string,
    requestHash: string,
    action: LifecycleActionResult,
  ): Promise<void> {
    await transaction.insertIdempotency({
      idempotencyKey,
      operation,
      requestHash,
      resourceId,
      response: action,
    });
  }

  private async updateProjection(
    transaction: ContentReleaseTransaction,
    before: ContentReleaseProjection,
    after: ContentReleaseProjection,
  ): Promise<void> {
    const updated = await transaction.updateProjection({
      expectedLifecycleRevision: before.lifecycleRevision,
      expectedScheduleSlotRevision: before.scheduleSlotRevision,
      projection: after,
    });
    if (!updated) throw new Error("Content release projection changed inside its transaction lock");
  }

  private async recordAction(
    transaction: ContentReleaseTransaction,
    input: RecordActionInput,
  ): Promise<LifecycleActionResult> {
    const primary =
      input.transitions.find((transition) => transition.contentVersion === input.contentVersion) ??
      input.transitions.at(-1);
    if (primary === undefined) throw new Error("Content release action requires a transition");
    const auditEventId = this.identifiers.nextAuditEventId();
    const auditKey =
      input.idempotencyKey ?? `scheduled-release:${input.scheduleTaskId ?? "system"}`;
    await transaction.insertAuditEvent({
      action: `content_${input.action}`,
      actorId: input.actorId,
      auditEventId,
      contentVersion: input.contentVersion,
      fortuneDate: input.beforeProjection.fortuneDate,
      fromState: primary.fromState,
      idempotencyKey: auditKey,
      occurredAt: input.now,
      reason: input.reason,
      requestId: input.requestId,
      toState: primary.toState,
    });
    for (const transition of input.transitions) {
      if (transition === primary) continue;
      await transaction.insertAuditEvent({
        action: `content_${input.action}_related_transition`,
        actorId: input.actorId,
        auditEventId: this.identifiers.nextAuditEventId(),
        contentVersion: transition.contentVersion,
        fortuneDate: input.beforeProjection.fortuneDate,
        fromState: transition.fromState,
        idempotencyKey: auditKey,
        occurredAt: input.now,
        reason: input.reason,
        requestId: input.requestId,
        toState: transition.toState,
      });
    }
    await transaction.insertReleaseEvent({
      action: input.action,
      actorId: input.actorId,
      afterActiveContentVersion: input.afterProjection.activeContentVersion,
      afterScheduleSlotRevision: input.afterProjection.scheduleSlotRevision,
      beforeActiveContentVersion: input.beforeProjection.activeContentVersion,
      beforeScheduleSlotRevision: input.beforeProjection.scheduleSlotRevision,
      contentVersion: input.contentVersion,
      fortuneDate: input.beforeProjection.fortuneDate,
      idempotencyKey: input.idempotencyKey,
      occurredAt: input.now,
      reason: input.reason,
      releaseEventId: this.identifiers.nextReleaseEventId(),
      requestId: input.requestId,
      scheduleTaskId: input.scheduleTaskId,
      transitions: input.transitions,
    });
    return actionResult(
      input.contentVersion,
      input.state,
      input.afterProjection,
      input.transitions,
      auditEventId,
    );
  }

  private async insertPurgeIntent(
    transaction: ContentReleaseTransaction,
    action: "publish" | "rollback" | "scheduled_publish" | "withdraw",
    before: ContentReleaseProjection,
    after: ContentReleaseProjection,
    now: string,
    requestId: string,
  ): Promise<void> {
    await transaction.insertPublicCachePurgeIntent({
      action,
      afterActiveContentVersion: after.activeContentVersion,
      beforeActiveContentVersion: before.activeContentVersion,
      createdAt: now,
      fortuneDate: before.fortuneDate,
      processedAt: null,
      purgeIntentId: this.identifiers.nextPurgeIntentId(),
      requestId,
    });
  }
}
