import {
  drainContentReleaseQueue,
  type ContentReleaseBoundaryRunner,
  type ContentReleaseBoundaryScheduler,
} from "./content-release-boundary-wakeup";

export interface ContentReleaseRetryWakeupOptions {
  readonly onError?: (error: unknown) => void;
  readonly scheduler?: ContentReleaseBoundaryScheduler;
}

const RETRY_POLL_INTERVAL_MILLISECONDS = 30_000;
const SYSTEM_SCHEDULER: ContentReleaseBoundaryScheduler = {
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
};
const IGNORE_ERROR = (): void => undefined;

/**
 * Keeps release retries independent from the shared worker cycle. Thirty seconds
 * matches the first retry delay, so a due retry is never stranded behind a slow
 * image or production pass (nor behind a larger WORKER_POLL_INTERVAL_MS).
 */
export class ContentReleaseRetryWakeup {
  private readonly onError: (error: unknown) => void;
  private readonly scheduler: ContentReleaseBoundaryScheduler;
  private scheduledHandle: unknown;
  private started = false;

  constructor(
    private readonly runner: ContentReleaseBoundaryRunner,
    options: ContentReleaseRetryWakeupOptions = {},
  ) {
    this.onError = options.onError ?? IGNORE_ERROR;
    this.scheduler = options.scheduler ?? SYSTEM_SCHEDULER;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.arm();
  }

  stop(): void {
    this.started = false;
    if (this.scheduledHandle === undefined) return;
    this.scheduler.cancel(this.scheduledHandle);
    this.scheduledHandle = undefined;
  }

  private arm(): void {
    if (!this.started) return;
    this.scheduledHandle = this.scheduler.schedule(() => {
      this.scheduledHandle = undefined;
      if (!this.started) return;
      void this.run();
    }, RETRY_POLL_INTERVAL_MILLISECONDS);
  }

  private async run(): Promise<void> {
    try {
      await drainContentReleaseQueue(this.runner);
    } catch (error) {
      this.onError(error);
    } finally {
      this.arm();
    }
  }
}
