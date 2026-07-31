import type { components } from "@five/api-contract";

type CreatePosterJobRequest = components["schemas"]["CreatePosterJobRequest"];
type PosterJob = components["schemas"]["PosterJob"];

export const POSTER_JOB_REPOSITORY = Symbol("POSTER_JOB_REPOSITORY");

export interface PosterJobRecord extends PosterJob {
  assetKey: string | null;
  attemptToken: string | null;
  attempts: number;
  fortuneDate: string;
  landingUrl: string;
  lockedBy: string | null;
}

export interface CreatePosterJobRecordInput extends CreatePosterJobRequest {
  currentActiveContentVersion: string;
  idempotencyKey: string;
  jobId: string;
  landingUrl: string;
  posterTemplateVersion: string;
  requestHash: string;
}

export type CreateOrReusePosterJobResult =
  | { kind: "created"; record: PosterJobRecord }
  | { kind: "existing"; record: PosterJobRecord }
  | { kind: "idempotency_conflict" }
  | { kind: "rate_limited"; queueCapacity: number };

export type FindIdempotentPosterJobResult =
  | { kind: "existing"; record: PosterJobRecord }
  | { kind: "idempotency_conflict" }
  | { kind: "missing" };

export interface PosterJobRepository {
  acknowledgeGarbageAsset(assetKey: string): Promise<boolean>;
  claimGarbageAssetKeys(input: ClaimPosterAssetGarbageInput): Promise<string[]>;
  claimNext(input: ClaimPosterJobInput): Promise<PosterJobRecord | null>;
  completeReady(input: CompletePosterJobInput): Promise<boolean>;
  createOrReuse(input: CreatePosterJobRecordInput): Promise<CreateOrReusePosterJobResult>;
  findById(jobId: string): Promise<PosterJobRecord | null>;
  findRetainedAssetKeys(assetKeys: readonly string[]): Promise<string[]>;
  findByIdempotency(
    idempotencyKey: string,
    requestHash: string,
  ): Promise<FindIdempotentPosterJobResult>;
  markVersionChanged(input: MarkPosterVersionChangedInput): Promise<boolean>;
  recordFailure(input: RecordPosterFailureInput): Promise<"failed" | "lost" | "retrying">;
  reserveAsset(input: ReservePosterAssetInput): Promise<boolean>;
}

export interface ClaimPosterAssetGarbageInput {
  limit: number;
}

export interface ClaimPosterJobInput {
  attemptToken: string;
  workerId: string;
}

export interface CompletePosterJobInput {
  assetKey: string;
  assetUrl: string;
  attemptToken: string;
  currentActiveContentVersion: string;
  jobId: string;
  posterInstanceId: string;
  workerId: string;
}

export interface MarkPosterVersionChangedInput {
  attemptToken: string;
  currentActiveContentVersion: string | null;
  jobId: string;
  workerId: string;
}

export interface RecordPosterFailureInput {
  attemptToken: string;
  errorMessage: string;
  jobId: string;
  maxAttempts: number;
  workerId: string;
}

export interface ReservePosterAssetInput {
  assetKey: string;
  attemptToken: string;
  jobId: string;
  workerId: string;
}

interface IdempotencyRecord {
  jobId: string;
  requestHash: string;
}

interface AssetReservation {
  assetKey: string;
  attemptToken: string;
  jobId: string;
  lastCleanupAt: number | null;
  workerId: string;
}

export class InMemoryPosterJobRepository implements PosterJobRepository {
  private readonly assetReservations = new Map<string, AssetReservation>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly jobs = new Map<string, PosterJobRecord>();
  private readonly lockedAt = new Map<string, number>();

  constructor(
    private readonly queueCapacity = 100,
    private readonly now: () => number = Date.now,
    private readonly staleLockMilliseconds = 300_000,
  ) {}

  createOrReuse(input: CreatePosterJobRecordInput): Promise<CreateOrReusePosterJobResult> {
    const previous = this.idempotency.get(input.idempotencyKey);
    if (previous !== undefined) {
      if (previous.requestHash !== input.requestHash) {
        return Promise.resolve({ kind: "idempotency_conflict" });
      }

      const record = this.jobs.get(previous.jobId);
      if (record === undefined) {
        throw new Error("Poster idempotency record points to a missing job");
      }
      return Promise.resolve({ kind: "existing", record });
    }

    const reusable = [...this.jobs.values()].find(
      (candidate) =>
        candidate.sourceContentVersion === input.expectedContentVersion &&
        candidate.posterTemplateVersion === input.posterTemplateVersion &&
        candidate.channelId === input.channelId &&
        (candidate.status === "processing" || candidate.status === "ready"),
    );
    if (reusable !== undefined) {
      this.idempotency.set(input.idempotencyKey, {
        jobId: reusable.jobId,
        requestHash: input.requestHash,
      });
      return Promise.resolve({ kind: "existing", record: reusable });
    }

    const queuedCount = [...this.jobs.values()].filter(
      (candidate) => candidate.status === "processing",
    ).length;
    if (queuedCount >= this.queueCapacity) {
      return Promise.resolve({ kind: "rate_limited", queueCapacity: this.queueCapacity });
    }

    const record: PosterJobRecord = {
      assetKey: null,
      assetUrl: null,
      attemptToken: null,
      attempts: 0,
      channelId: input.channelId,
      currentActiveContentVersion: input.currentActiveContentVersion,
      entry: null,
      fortuneDate: input.fortuneDate,
      jobId: input.jobId,
      landingUrl: input.landingUrl,
      lockedBy: null,
      posterInstanceId: null,
      posterTemplateVersion: input.posterTemplateVersion,
      sourceContentVersion: input.expectedContentVersion,
      status: "processing",
    };
    this.jobs.set(record.jobId, record);
    this.idempotency.set(input.idempotencyKey, {
      jobId: record.jobId,
      requestHash: input.requestHash,
    });
    return Promise.resolve({ kind: "created", record });
  }

  findById(jobId: string): Promise<PosterJobRecord | null> {
    return Promise.resolve(this.jobs.get(jobId) ?? null);
  }

  findRetainedAssetKeys(assetKeys: readonly string[]): Promise<string[]> {
    const candidates = new Set(assetKeys);
    const retained = new Set<string>();
    for (const assetKey of this.assetReservations.keys()) {
      if (candidates.has(assetKey)) {
        retained.add(assetKey);
      }
    }
    for (const job of this.jobs.values()) {
      if (job.status === "ready" && job.assetKey !== null && candidates.has(job.assetKey)) {
        retained.add(job.assetKey);
      }
    }
    return Promise.resolve([...retained]);
  }

  findByIdempotency(
    idempotencyKey: string,
    requestHash: string,
  ): Promise<FindIdempotentPosterJobResult> {
    const previous = this.idempotency.get(idempotencyKey);
    if (previous === undefined) {
      return Promise.resolve({ kind: "missing" });
    }
    if (previous.requestHash !== requestHash) {
      return Promise.resolve({ kind: "idempotency_conflict" });
    }
    const record = this.jobs.get(previous.jobId);
    if (record === undefined) {
      throw new Error("Poster idempotency record points to a missing job");
    }
    return Promise.resolve({ kind: "existing", record });
  }

  claimNext(input: ClaimPosterJobInput): Promise<PosterJobRecord | null> {
    const staleBefore = this.now() - this.staleLockMilliseconds;
    const record = [...this.jobs.values()].find(
      (candidate) =>
        candidate.status === "processing" &&
        (candidate.lockedBy === null || (this.lockedAt.get(candidate.jobId) ?? 0) < staleBefore),
    );
    if (record === undefined) {
      return Promise.resolve(null);
    }
    const claimed = {
      ...record,
      attempts: record.attempts + 1,
      attemptToken: input.attemptToken,
      lockedBy: input.workerId,
    };
    this.jobs.set(claimed.jobId, claimed);
    this.lockedAt.set(claimed.jobId, this.now());
    return Promise.resolve(claimed);
  }

  claimGarbageAssetKeys(input: ClaimPosterAssetGarbageInput): Promise<string[]> {
    const retryBefore = this.now() - this.staleLockMilliseconds;
    const claimed: string[] = [];
    for (const reservation of this.assetReservations.values()) {
      if (claimed.length >= input.limit) {
        break;
      }
      const job = this.jobs.get(reservation.jobId);
      const stillOwned =
        job?.status === "processing" &&
        job.lockedBy === reservation.workerId &&
        job.attemptToken === reservation.attemptToken;
      if (
        stillOwned ||
        (reservation.lastCleanupAt !== null && reservation.lastCleanupAt >= retryBefore)
      ) {
        continue;
      }
      reservation.lastCleanupAt = this.now();
      claimed.push(reservation.assetKey);
    }
    return Promise.resolve(claimed);
  }

  acknowledgeGarbageAsset(assetKey: string): Promise<boolean> {
    const reservation = this.assetReservations.get(assetKey);
    if (reservation === undefined || reservation.lastCleanupAt === null) {
      return Promise.resolve(false);
    }
    const job = this.jobs.get(reservation.jobId);
    const stillOwned =
      job?.status === "processing" &&
      job.lockedBy === reservation.workerId &&
      job.attemptToken === reservation.attemptToken;
    if (stillOwned) {
      return Promise.resolve(false);
    }
    return Promise.resolve(this.assetReservations.delete(assetKey));
  }

  reserveAsset(input: ReservePosterAssetInput): Promise<boolean> {
    if (this.lockedRecord(input.jobId, input.workerId, input.attemptToken) === null) {
      return Promise.resolve(false);
    }
    const existing = this.assetReservations.get(input.assetKey);
    if (existing !== undefined) {
      return Promise.resolve(
        existing.jobId === input.jobId &&
          existing.workerId === input.workerId &&
          existing.attemptToken === input.attemptToken,
      );
    }
    this.assetReservations.set(input.assetKey, {
      ...input,
      lastCleanupAt: null,
    });
    return Promise.resolve(true);
  }

  completeReady(input: CompletePosterJobInput): Promise<boolean> {
    const record = this.lockedRecord(input.jobId, input.workerId, input.attemptToken);
    const reservation = this.assetReservations.get(input.assetKey);
    if (
      record === null ||
      reservation?.jobId !== input.jobId ||
      reservation.workerId !== input.workerId ||
      reservation.attemptToken !== input.attemptToken
    ) {
      return Promise.resolve(false);
    }
    this.jobs.set(record.jobId, {
      ...record,
      assetKey: input.assetKey,
      assetUrl: input.assetUrl,
      attemptToken: null,
      currentActiveContentVersion: input.currentActiveContentVersion,
      entry: { landingUrl: record.landingUrl, type: "web_qr" },
      lockedBy: null,
      posterInstanceId: input.posterInstanceId,
      status: "ready",
    });
    this.lockedAt.delete(record.jobId);
    this.assetReservations.delete(input.assetKey);
    return Promise.resolve(true);
  }

  markVersionChanged(input: MarkPosterVersionChangedInput): Promise<boolean> {
    const record = this.lockedRecord(input.jobId, input.workerId, input.attemptToken);
    if (record === null) {
      return Promise.resolve(false);
    }
    this.jobs.set(record.jobId, {
      ...record,
      assetKey: null,
      assetUrl: null,
      attemptToken: null,
      currentActiveContentVersion: input.currentActiveContentVersion,
      entry: null,
      lockedBy: null,
      posterInstanceId: null,
      status: "version_changed",
    });
    this.lockedAt.delete(record.jobId);
    return Promise.resolve(true);
  }

  recordFailure(input: RecordPosterFailureInput): Promise<"failed" | "lost" | "retrying"> {
    const record = this.lockedRecord(input.jobId, input.workerId, input.attemptToken);
    if (record === null) {
      return Promise.resolve("lost");
    }
    const failed = record.attempts >= input.maxAttempts;
    this.jobs.set(record.jobId, {
      ...record,
      attemptToken: null,
      lockedBy: null,
      status: failed ? "failed" : "processing",
    });
    this.lockedAt.delete(record.jobId);
    return Promise.resolve(failed ? "failed" : "retrying");
  }

  private lockedRecord(
    jobId: string,
    workerId: string,
    attemptToken: string,
  ): PosterJobRecord | null {
    const record = this.jobs.get(jobId);
    return record?.status === "processing" &&
      record.lockedBy === workerId &&
      record.attemptToken === attemptToken
      ? record
      : null;
  }
}
