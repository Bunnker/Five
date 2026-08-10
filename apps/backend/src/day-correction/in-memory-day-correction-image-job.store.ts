import type {
  ClaimedDayCorrectionImageJob,
  DayCorrectionImageJobFailureResult,
  DayCorrectionImageJobStore,
  DayCorrectionImageJobView,
  DayCorrectionImageSlot,
  DayCorrectionImageWorkingCopyState,
  RequestDayCorrectionImageGenerationStoreResult,
  StoredDayCorrectionImageJob,
} from "./day-correction-image-job.store";

type MutableJob = {
  -readonly [Key in keyof StoredDayCorrectionImageJob]: StoredDayCorrectionImageJob[Key];
} & {
  attemptToken: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  workerId: string | null;
};

interface StoredIdempotency {
  readonly requestHash: string;
  readonly response: DayCorrectionImageJobView;
}

function currentKey(correctionId: string, imageSlot: DayCorrectionImageSlot): string {
  return `${correctionId}\u0000${imageSlot}`;
}

function idempotencyKey(correctionId: string, key: string): string {
  return `${correctionId}\u0000${key}`;
}

function cloneJob(job: MutableJob): StoredDayCorrectionImageJob {
  const {
    attemptToken: _attemptToken,
    claimedAt: _claimedAt,
    leaseExpiresAt: _leaseExpiresAt,
    workerId: _workerId,
    ...stored
  } = job;
  void _attemptToken;
  void _claimedAt;
  void _leaseExpiresAt;
  void _workerId;
  return structuredClone(stored);
}

export class InMemoryDayCorrectionImageJobStore implements DayCorrectionImageJobStore {
  private readonly currents = new Map<string, string>();
  private readonly idempotency = new Map<string, StoredIdempotency>();
  private readonly jobs = new Map<string, MutableJob>();
  private readonly workingCopies = new Map<string, DayCorrectionImageWorkingCopyState>();

  constructor(seed: readonly DayCorrectionImageWorkingCopyState[] = []) {
    for (const workingCopy of seed) this.setWorkingCopy(workingCopy);
  }

  setWorkingCopy(workingCopy: DayCorrectionImageWorkingCopyState): void {
    this.workingCopies.set(workingCopy.correctionId, structuredClone(workingCopy));
  }

  async claimNext(
    input: Parameters<DayCorrectionImageJobStore["claimNext"]>[0],
  ): Promise<ClaimedDayCorrectionImageJob | null> {
    const candidates = [...this.currents.values()]
      .map((jobId) => this.jobs.get(jobId))
      .filter((job): job is MutableJob => job !== undefined)
      .filter((job) => {
        const workingCopy = this.workingCopies.get(job.correctionId);
        return (
          workingCopy?.correctionStatus === "open" &&
          workingCopy.submittedContentVersion === null &&
          job.attempts < job.attemptLimit &&
          (job.status === "queued" || job.status === "retryable"
            ? job.availableAt <= input.claimedAt
            : job.status === "claimed" &&
              job.leaseExpiresAt !== null &&
              job.leaseExpiresAt <= input.claimedAt)
        );
      })
      .sort((left, right) =>
        left.availableAt === right.availableAt
          ? left.jobId.localeCompare(right.jobId)
          : left.availableAt.localeCompare(right.availableAt),
      );
    const job = candidates[0];
    if (job === undefined) return null;
    const workingCopy = this.workingCopies.get(job.correctionId);
    if (workingCopy === undefined) return null;
    job.attempts += 1;
    job.attemptToken = input.attemptToken;
    job.claimedAt = input.claimedAt;
    job.leaseExpiresAt = input.leaseExpiresAt;
    job.status = "claimed";
    job.workerId = input.workerId;
    return {
      ...cloneJob(job),
      draftRevision: workingCopy.draftRevision,
      modules: structuredClone(workingCopy.modules),
    };
  }

  complete(
    input: Parameters<DayCorrectionImageJobStore["complete"]>[0],
  ): Promise<"completed" | "stale"> {
    const job = this.jobs.get(input.jobId);
    if (
      job === undefined ||
      job.status !== "claimed" ||
      job.attemptToken !== input.attemptToken ||
      job.workerId !== input.workerId
    ) {
      return Promise.resolve("stale");
    }
    job.completedAssetId = input.assetId;
    job.status = "completed";
    job.attemptToken = null;
    job.claimedAt = null;
    job.leaseExpiresAt = null;
    job.workerId = null;
    const isCurrent = this.currents.get(currentKey(job.correctionId, job.imageSlot)) === job.jobId;
    return Promise.resolve(isCurrent ? "completed" : "stale");
  }

  getCurrent(
    correctionId: string,
    imageSlot: DayCorrectionImageSlot,
  ): Promise<DayCorrectionImageJobView | null> {
    const workingCopy = this.workingCopies.get(correctionId);
    if (workingCopy === undefined) return Promise.resolve(null);
    const jobId = this.currents.get(currentKey(correctionId, imageSlot));
    const job = jobId === undefined ? undefined : this.jobs.get(jobId);
    return Promise.resolve({
      job: job === undefined ? null : cloneJob(job),
      revision: {
        correctionRevision: workingCopy.correctionRevision,
        draftRevision: workingCopy.draftRevision,
      },
    });
  }

  recordFailure(
    input: Parameters<DayCorrectionImageJobStore["recordFailure"]>[0],
  ): Promise<DayCorrectionImageJobFailureResult> {
    const job = this.jobs.get(input.jobId);
    if (
      job === undefined ||
      job.status !== "claimed" ||
      job.attemptToken !== input.attemptToken ||
      job.workerId !== input.workerId
    ) {
      return Promise.resolve("stale");
    }
    const isCurrent = this.currents.get(currentKey(job.correctionId, job.imageSlot)) === job.jobId;
    job.lastError = input.error;
    job.attemptToken = null;
    job.claimedAt = null;
    job.leaseExpiresAt = null;
    job.workerId = null;
    if (!isCurrent) {
      job.status = "failed";
      return Promise.resolve("stale");
    }
    if (job.attempts >= job.attemptLimit) {
      job.status = "failed";
      return Promise.resolve("exhausted");
    }
    job.availableAt = input.retryAt;
    job.status = "retryable";
    return Promise.resolve("retry_scheduled");
  }

  requestGeneration(
    input: Parameters<DayCorrectionImageJobStore["requestGeneration"]>[0],
  ): Promise<RequestDayCorrectionImageGenerationStoreResult> {
    const replayKey = idempotencyKey(input.correctionId, input.idempotencyKey);
    const prior = this.idempotency.get(replayKey);
    if (prior !== undefined) {
      return Promise.resolve(
        prior.requestHash === input.requestHash
          ? { kind: "existing", view: structuredClone(prior.response) }
          : { kind: "idempotency_conflict" },
      );
    }
    const workingCopy = this.workingCopies.get(input.correctionId);
    if (workingCopy === undefined) return Promise.resolve({ kind: "not_found" });
    if (workingCopy.correctionStatus !== "open" || workingCopy.submittedContentVersion !== null) {
      return Promise.resolve({ kind: "invalid_state" });
    }
    const currentRevision = {
      correctionRevision: workingCopy.correctionRevision,
      draftRevision: workingCopy.draftRevision,
    };
    if (
      input.expectedRevision.correctionRevision !== currentRevision.correctionRevision ||
      input.expectedRevision.draftRevision !== currentRevision.draftRevision
    ) {
      return Promise.resolve({ currentRevision, kind: "revision_mismatch" });
    }
    const key = currentKey(input.correctionId, input.imageSlot);
    const priorJobId = this.currents.get(key);
    const priorJob = priorJobId === undefined ? undefined : this.jobs.get(priorJobId);
    const generationRevision = (priorJob?.generationRevision ?? 0) + 1;
    const job: MutableJob = {
      actorId: input.actorId,
      attempts: 0,
      attemptLimit: 3,
      attemptToken: null,
      availableAt: input.requestedAt,
      claimedAt: null,
      completedAssetId: null,
      correctionId: input.correctionId,
      draftId: workingCopy.draftId,
      fortuneDate: workingCopy.fortuneDate,
      generationRevision,
      imageSlot: input.imageSlot,
      jobId: input.jobId,
      lastError: null,
      leaseExpiresAt: null,
      promptVersion: input.promptVersion,
      reason: input.reason,
      requestId: input.requestId,
      requestedAt: input.requestedAt,
      status: "queued",
      workerId: null,
    };
    this.jobs.set(job.jobId, job);
    this.currents.set(key, job.jobId);
    const view: DayCorrectionImageJobView = {
      job: cloneJob(job),
      revision: currentRevision,
    };
    this.idempotency.set(replayKey, {
      requestHash: input.requestHash,
      response: structuredClone(view),
    });
    return Promise.resolve({ kind: "requested", view });
  }
}
