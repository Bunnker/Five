import { describe, expect, it, vi } from "vitest";

import { ContentReleaseRetryWakeup } from "./content-release-retry-wakeup";

describe("ContentReleaseRetryWakeup", () => {
  it("drains retries independently every 30 seconds and rearms itself", async () => {
    let nextHandle = 0;
    const callbacks = new Map<number, () => void>();
    const schedule = vi.fn((callback: () => void, delayMs: number): unknown => {
      expect(delayMs).toBe(30_000);
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    });
    const cancel = vi.fn((handle: unknown): void => {
      callbacks.delete(handle as number);
    });
    const runOne = vi
      .fn()
      .mockResolvedValueOnce("retrying")
      .mockResolvedValueOnce("published")
      .mockResolvedValue("idle");
    const wakeup = new ContentReleaseRetryWakeup({ runOne }, { scheduler: { cancel, schedule } });

    wakeup.start();
    expect(schedule).toHaveBeenCalledTimes(1);

    callbacks.get(1)?.();
    await vi.waitFor(() => expect(schedule).toHaveBeenCalledTimes(2));
    expect(runOne).toHaveBeenCalledTimes(3);

    wakeup.stop();
    expect(cancel).toHaveBeenCalledWith(2);
  });
});
