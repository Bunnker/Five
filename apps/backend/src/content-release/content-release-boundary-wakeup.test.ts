import { describe, expect, it, vi } from "vitest";

import {
  ContentReleaseBoundaryWakeup,
  millisecondsUntilNextContentReleaseBoundary,
} from "./content-release-boundary-wakeup";

describe("millisecondsUntilNextContentReleaseBoundary", () => {
  it("waits exactly until the next Beijing 18:00 boundary", () => {
    expect(millisecondsUntilNextContentReleaseBoundary(new Date("2026-08-06T09:59:59.500Z"))).toBe(
      500,
    );
  });

  it("advances to the following boundary when the current instant is exactly 18:00", () => {
    expect(millisecondsUntilNextContentReleaseBoundary(new Date("2026-08-06T10:00:00.000Z"))).toBe(
      86_400_000,
    );
  });
});

describe("ContentReleaseBoundaryWakeup", () => {
  it("drains every task due in the boundary batch and then arms the following boundary", async () => {
    let now = new Date("2026-08-06T09:59:59.500Z");
    let nextHandle = 0;
    const callbacks = new Map<number, () => void>();
    const schedule = vi.fn((callback: () => void): unknown => {
      const handle = ++nextHandle;
      callbacks.set(handle, callback);
      return handle;
    });
    const cancel = vi.fn((handle: unknown): void => {
      callbacks.delete(handle as number);
    });
    const runOne = vi
      .fn()
      .mockResolvedValueOnce("terminated")
      .mockResolvedValueOnce("published")
      .mockResolvedValue("idle");
    const wakeup = new ContentReleaseBoundaryWakeup(
      { runOne },
      {
        clock: { now: () => now },
        scheduler: { cancel, schedule },
      },
    );

    wakeup.start();

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), 500);

    now = new Date("2026-08-06T10:00:00.000Z");
    callbacks.get(1)?.();
    await vi.waitFor(() => expect(schedule).toHaveBeenCalledTimes(2));

    expect(runOne).toHaveBeenCalledTimes(3);
    expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), 86_400_000);

    wakeup.stop();
    expect(cancel).toHaveBeenCalledWith(2);
  });

  it("reports a boundary run error and keeps the next wakeup armed", async () => {
    let now = new Date("2026-08-06T09:59:59.500Z");
    const callbacks: Array<() => void> = [];
    const schedule = vi.fn((callback: () => void): unknown => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const onError = vi.fn();
    const expectedError = new Error("temporary database outage");
    const wakeup = new ContentReleaseBoundaryWakeup(
      { runOne: vi.fn().mockRejectedValue(expectedError) },
      {
        clock: { now: () => now },
        onError,
        scheduler: { cancel: vi.fn(), schedule },
      },
    );

    wakeup.start();
    now = new Date("2026-08-06T10:00:00.000Z");
    callbacks[0]?.();
    await vi.waitFor(() => expect(schedule).toHaveBeenCalledTimes(2));

    expect(onError).toHaveBeenCalledWith(expectedError);
  });
});
