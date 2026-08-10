import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import { PublicContentWindowResolver } from "../public-content/public-content-window-resolver";
import { type Clock, RequestContextResolver } from "../request-context/request-context-resolver";

export interface ContentReleaseBoundaryRunner {
  runOne(): Promise<ContentReleaseBoundaryRunResult>;
}

export type ContentReleaseBoundaryRunResult =
  "idle" | "published" | "retrying" | "stale" | "terminated";

export interface ContentReleaseBoundaryScheduler {
  cancel(handle: unknown): void;
  schedule(callback: () => void, delayMs: number): unknown;
}

export interface ContentReleaseBoundaryWakeupOptions {
  readonly clock?: Clock;
  readonly onError?: (error: unknown) => void;
  readonly scheduler?: ContentReleaseBoundaryScheduler;
}

const SYSTEM_CLOCK: Clock = { now: () => new Date() };
const SYSTEM_SCHEDULER: ContentReleaseBoundaryScheduler = {
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
};
const IGNORE_ERROR = (): void => undefined;

export function millisecondsUntilNextContentReleaseBoundary(now: Date): number {
  const requestContext = new RequestContextResolver({ now: () => now }).resolve();
  const publicContext = new PublicContentContextResolver().resolve(requestContext);
  const window = new PublicContentWindowResolver().resolve(publicContext.servedFortuneDate);
  const delay = new Date(window.effectiveTo).getTime() - now.getTime();

  if (!Number.isFinite(delay) || delay <= 0) {
    throw new RangeError("Unable to resolve the next public content boundary");
  }

  return delay;
}

export async function drainContentReleaseQueue(
  runner: ContentReleaseBoundaryRunner,
): Promise<void> {
  while ((await runner.runOne()) !== "idle") {
    // A retry is moved into the future transactionally, so the next claim can
    // continue draining other tasks that were already due in this batch.
  }
}

export class ContentReleaseBoundaryWakeup {
  private readonly clock: Clock;
  private readonly onError: (error: unknown) => void;
  private readonly scheduler: ContentReleaseBoundaryScheduler;
  private scheduledHandle: unknown;
  private started = false;

  constructor(
    private readonly runner: ContentReleaseBoundaryRunner,
    options: ContentReleaseBoundaryWakeupOptions = {},
  ) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.onError = options.onError ?? IGNORE_ERROR;
    this.scheduler = options.scheduler ?? SYSTEM_SCHEDULER;
  }

  start(): void {
    if (this.started) return;

    this.started = true;
    this.armNextBoundary();
  }

  stop(): void {
    this.started = false;
    if (this.scheduledHandle === undefined) return;

    this.scheduler.cancel(this.scheduledHandle);
    this.scheduledHandle = undefined;
  }

  private armNextBoundary(): void {
    if (!this.started) return;

    const delayMs = millisecondsUntilNextContentReleaseBoundary(this.clock.now());
    this.scheduledHandle = this.scheduler.schedule(() => {
      this.scheduledHandle = undefined;
      if (!this.started) return;
      void this.runAtBoundary();
    }, delayMs);
  }

  private async runAtBoundary(): Promise<void> {
    try {
      await drainContentReleaseQueue(this.runner);
    } catch (error) {
      this.onError(error);
    } finally {
      this.armNextBoundary();
    }
  }
}
