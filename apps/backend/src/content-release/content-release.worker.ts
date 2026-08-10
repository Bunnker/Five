import { randomUUID } from "node:crypto";

import type { ContentReleaseStore } from "./content-release.store";
import type { ContentReleaseClock, ScheduledReleaseResult } from "./content-release.service";

export interface ScheduledReleasePublisher {
  publishScheduledTask(input: {
    readonly attemptToken: string;
    readonly taskId: string;
    readonly workerId: string;
  }): Promise<ScheduledReleaseResult>;
}

export interface ContentReleaseWorkerIdentity {
  readonly workerId: string;
  nextAttemptToken(): string;
}

const SYSTEM_CLOCK: ContentReleaseClock = { now: () => new Date() };
const SYSTEM_IDENTITY: ContentReleaseWorkerIdentity = {
  nextAttemptToken: () => randomUUID(),
  workerId: `content-release-${process.pid}`,
};
const CLAIM_LEASE_MILLISECONDS = 5 * 60 * 1_000;
const MAX_RETRY_DELAY_SECONDS = 15 * 60;

export type ContentReleaseWorkerRunResult =
  "idle" | "published" | "retrying" | "stale" | "terminated";

export class ContentReleaseWorker {
  constructor(
    private readonly store: ContentReleaseStore,
    private readonly publisher: ScheduledReleasePublisher,
    private readonly clock: ContentReleaseClock = SYSTEM_CLOCK,
    private readonly identity: ContentReleaseWorkerIdentity = SYSTEM_IDENTITY,
  ) {}

  async runOne(): Promise<ContentReleaseWorkerRunResult> {
    const claimedAt = this.clock.now();
    const attemptToken = this.identity.nextAttemptToken();
    const task = await this.store.claimNextScheduleTask({
      attemptToken,
      claimedAt: claimedAt.toISOString(),
      leaseExpiresAt: new Date(claimedAt.getTime() + CLAIM_LEASE_MILLISECONDS).toISOString(),
      workerId: this.identity.workerId,
    });
    if (task === null) return "idle";

    try {
      const result = await this.publisher.publishScheduledTask({
        attemptToken,
        taskId: task.taskId,
        workerId: this.identity.workerId,
      });
      if (result.kind === "published") return "published";
      if (result.kind === "terminated") return "terminated";
      if (result.kind === "window_invalid") {
        await this.retry(task.taskId, attemptToken, task.attempts, "排期任务已不在内容有效窗口内");
        return "retrying";
      }
      if (result.kind === "preflight_failed") {
        const failedCodes = result.preflightChecks
          .filter((check) => check.status !== "passed")
          .map((check) => check.code)
          .join(",");
        await this.retry(
          task.taskId,
          attemptToken,
          task.attempts,
          `发布预检未通过：${failedCodes}`,
        );
        return "retrying";
      }
      return "stale";
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知排期发布错误";
      await this.retry(task.taskId, attemptToken, task.attempts, message);
      return "retrying";
    }
  }

  private async retry(
    taskId: string,
    attemptToken: string,
    attempts: number,
    error: string,
  ): Promise<void> {
    const failedAt = this.clock.now();
    const delaySeconds = Math.min(MAX_RETRY_DELAY_SECONDS, 30 * 2 ** Math.min(attempts - 1, 5));
    const failureId = randomUUID();
    await this.store.recordScheduleTaskFailure({
      attemptToken,
      auditEventId: `audit-failure-${failureId}`,
      auditIdempotencyKey: `scheduled-failure:${failureId}`,
      error: error.slice(0, 2_000),
      failedAt: failedAt.toISOString(),
      releaseEventId: `release-failure-${failureId}`,
      retryAt: new Date(failedAt.getTime() + delaySeconds * 1_000).toISOString(),
      taskId,
      workerId: this.identity.workerId,
    });
  }
}
