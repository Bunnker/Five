import { describe, expect, it, vi } from "vitest";

import { createWorkerCycleRunner, settleWorkerTasks } from "./worker-cycle-runner";

describe("worker cycle scheduling", () => {
  it("settles every task and reports failures without rejecting the batch", async () => {
    const success = vi.fn().mockResolvedValue("completed");
    const failure = new Error("production failed");
    const failures: Array<{ readonly error: unknown; readonly taskName: string }> = [];

    const outcomes = await settleWorkerTasks(
      [
        { name: "content production", run: () => Promise.reject(failure) },
        { name: "content release", run: success },
      ],
      {
        onTaskFailure: (reportedFailure) => failures.push(reportedFailure),
      },
    );

    expect(success).toHaveBeenCalledOnce();
    expect(failures).toEqual([{ error: failure, taskName: "content production" }]);
    expect(outcomes).toEqual([
      { error: failure, status: "rejected", taskName: "content production" },
      { status: "fulfilled", taskName: "content release", value: "completed" },
    ]);
  });

  it("keeps the cycle single-flight until every task settles and reports each failure", async () => {
    const deferred = { finish: undefined as (() => void) | undefined };
    const deferredTask = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          deferred.finish = resolve;
        }),
    );
    const failedTask = vi.fn().mockRejectedValue(new Error("release failed"));
    const failures: Array<{ readonly error: unknown; readonly taskName: string }> = [];
    const runner = createWorkerCycleRunner(
      [
        { name: "content release", run: failedTask },
        { name: "image production", run: deferredTask },
      ],
      {
        onTaskFailure: (failure) => failures.push(failure),
      },
    );

    const firstCycle = runner.run();
    await Promise.resolve();

    await expect(runner.run()).resolves.toBe("skipped");
    expect(failedTask).toHaveBeenCalledTimes(1);
    expect(deferredTask).toHaveBeenCalledTimes(1);

    deferred.finish?.();
    await expect(firstCycle).resolves.toBe("completed");
    expect(failures).toEqual([
      {
        error: expect.objectContaining({ message: "release failed" }),
        taskName: "content release",
      },
    ]);

    const nextCycle = runner.run();
    await Promise.resolve();
    expect(failedTask).toHaveBeenCalledTimes(2);
    expect(deferredTask).toHaveBeenCalledTimes(2);
    deferred.finish?.();
    await expect(nextCycle).resolves.toBe("completed");
  });
});
