export interface WorkerCycleTask {
  readonly name: string;
  readonly run: () => Promise<unknown>;
}

export type WorkerCycleTaskOutcome =
  | { readonly status: "fulfilled"; readonly taskName: string; readonly value: unknown }
  | { readonly error: unknown; readonly status: "rejected"; readonly taskName: string };

export interface WorkerCycleObserver {
  readonly onCycleSettled?: (outcomes: ReadonlyArray<WorkerCycleTaskOutcome>) => void;
  readonly onTaskFailure: (failure: { readonly error: unknown; readonly taskName: string }) => void;
}

export interface WorkerCycleRunner {
  run(): Promise<"completed" | "skipped">;
}

export async function settleWorkerTasks(
  tasks: ReadonlyArray<WorkerCycleTask>,
  observer: WorkerCycleObserver,
): Promise<ReadonlyArray<WorkerCycleTaskOutcome>> {
  const settled = await Promise.allSettled(
    tasks.map((task) => Promise.resolve().then(() => task.run())),
  );
  const outcomes = settled.map<WorkerCycleTaskOutcome>((result, index) => {
    const taskName = tasks[index]!.name;
    if (result.status === "fulfilled") {
      return { status: "fulfilled", taskName, value: result.value };
    }
    const failure = { error: result.reason, taskName };
    observer.onTaskFailure(failure);
    return { ...failure, status: "rejected" };
  });
  observer.onCycleSettled?.(outcomes);
  return outcomes;
}

export function createWorkerCycleRunner(
  tasks: ReadonlyArray<WorkerCycleTask>,
  observer: WorkerCycleObserver,
): WorkerCycleRunner {
  let activeCycle: Promise<void> | null = null;

  return {
    async run(): Promise<"completed" | "skipped"> {
      if (activeCycle !== null) return "skipped";

      activeCycle = (async () => {
        await settleWorkerTasks(tasks, observer);
      })().finally(() => {
        activeCycle = null;
      });

      await activeCycle;
      return "completed";
    },
  };
}
