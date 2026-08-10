import type {
  ClaimedImageProductionJob,
  ContentProductionStore,
  EnsureGeneratedDayInput,
  EnsureGeneratedDayStoreResult,
  GeneratedContentDraft,
  ImageJobFailureResult,
  RequestImageSlotGenerationStoreResult,
} from "./content-production.store";
import type { DailyContentProduction } from "./content-production.service";
import {
  AUTOMATIC_IMAGE_ATTEMPTS_PER_CYCLE,
  DAILY_IMAGE_SLOTS,
  type DailyImageSlot,
  projectImageSlotProduction,
  REQUIRED_IMAGE_SLOTS,
} from "./content-production.status";

type MemoryJobStatus = "claimed" | "completed" | "failed" | "queued" | "retryable";

type MemoryImageJob = Omit<ClaimedImageProductionJob, "attempts" | "draftRevision"> & {
  attemptLimit: number;
  attempts: number;
  attemptToken: string | null;
  availableAt: string;
  draftRevision: number;
  generationRevision: number;
  lastError: string | null;
  leaseExpiresAt: string | null;
  status: MemoryJobStatus;
  workerId: string | null;
};

interface MemoryCurrentSlot {
  currentJobId: string | null;
  generationRevision: number;
}

interface MemorySelectedSlot {
  readonly assetId: string;
  readonly sha256: string | null;
  readonly source: "automatic_generation" | "manual_selection" | "manual_upload";
}

function currentKey(fortuneDate: string, imageSlot: DailyImageSlot): string {
  return `${fortuneDate}:${imageSlot}`;
}

export class InMemoryContentProductionStore implements ContentProductionStore {
  private readonly currents = new Map<string, MemoryCurrentSlot>();
  private readonly drafts = new Map<string, GeneratedContentDraft>();
  private readonly idempotency = new Map<string, { fortuneDate: string; requestHash: string }>();
  private readonly imageJobs = new Map<string, MemoryImageJob>();
  private readonly productions = new Map<string, DailyContentProduction>();
  private readonly selectedSlots = new Map<string, MemorySelectedSlot>();
  private readonly submittedDraftIds = new Set<string>();

  constructor(
    initialSelections: readonly {
      readonly assetId: string;
      readonly fortuneDate: string;
      readonly imageSlot: DailyImageSlot;
      readonly sha256?: string;
      readonly source: "manual_selection" | "manual_upload";
    }[] = [],
  ) {
    for (const selection of initialSelections) {
      this.selectedSlots.set(currentKey(selection.fortuneDate, selection.imageSlot), {
        assetId: selection.assetId,
        sha256: selection.sha256 ?? null,
        source: selection.source,
      });
    }
  }

  private isCurrent(job: MemoryImageJob): boolean {
    const current = this.currents.get(currentKey(job.fortuneDate, job.imageSlot));
    return (
      current?.currentJobId === job.jobId && current.generationRevision === job.generationRevision
    );
  }

  markDraftSubmitted(draftId: string): void {
    if (this.drafts.has(draftId)) this.submittedDraftIds.add(draftId);
  }

  advanceDraftRevision(draftId: string, updatedAt: string): number | null {
    const draft = this.drafts.get(draftId);
    if (draft === undefined || this.submittedDraftIds.has(draftId)) return null;
    const draftRevision = draft.draftRevision + 1;
    this.drafts.set(draftId, { ...draft, draftRevision, updatedAt });
    this.refreshProduction(draft.fortuneDate, updatedAt, draftRevision);
    return draftRevision;
  }

  private refreshProduction(fortuneDate: string, updatedAt: string, draftRevision?: number): void {
    const production = this.productions.get(fortuneDate);
    if (production === undefined) return;
    const primarySelection = this.selectedSlots.get(currentKey(fortuneDate, "required_primary"));
    const slot = (imageSlot: DailyImageSlot) => {
      const current = this.currents.get(currentKey(fortuneDate, imageSlot));
      const job =
        current?.currentJobId === null
          ? undefined
          : this.imageJobs.get(current?.currentJobId ?? "");
      const status =
        job?.status === "completed"
          ? "ready"
          : job?.status === "failed"
            ? "failed"
            : job === undefined && imageSlot === "optional"
              ? "not_requested"
              : job === undefined
                ? "failed"
                : "pending";
      const selection = this.selectedSlots.get(currentKey(fortuneDate, imageSlot));
      const duplicatesPrimary =
        imageSlot === "required_alternative" &&
        selection !== undefined &&
        primarySelection !== undefined &&
        (selection.assetId === primarySelection.assetId ||
          (selection.sha256 !== null && primarySelection.sha256 === selection.sha256));
      return {
        attemptLimit: job?.attemptLimit ?? 0,
        attempts: job?.attempts ?? 0,
        canRetry: status === "failed",
        deliveryReady: selection !== undefined && !duplicatesPrimary,
        imageSlot,
        lastError: duplicatesPrimary
          ? "两张必备图片内容重复，请替换备选图。"
          : job === undefined && imageSlot !== "optional"
            ? "当前图片生成批次不可确定，请重新生成。"
            : (job?.lastError ?? null),
        nextAttemptAt:
          job?.status === "queued" || job?.status === "retryable"
            ? job.availableAt
            : job?.status === "claimed"
              ? job.leaseExpiresAt
              : null,
        status,
      };
    };
    const imageSlots = [
      slot("required_primary"),
      slot("required_alternative"),
      slot("optional"),
    ] as DailyContentProduction["imageSlots"];
    this.productions.set(
      fortuneDate,
      projectImageSlotProduction(production, imageSlots, updatedAt, draftRevision),
    );
  }

  claimNextImageJob(input: {
    readonly attemptToken: string;
    readonly claimedAt: string;
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  }): Promise<ClaimedImageProductionJob | null> {
    const refreshedDates = new Set<string>();
    for (const job of this.imageJobs.values()) {
      if (
        this.isCurrent(job) &&
        job.attempts >= job.attemptLimit &&
        ((job.status === "claimed" &&
          job.leaseExpiresAt !== null &&
          job.leaseExpiresAt <= input.claimedAt) ||
          job.status === "queued" ||
          job.status === "retryable")
      ) {
        job.status = "failed";
        job.lastError ??= "图片生成租约已过期，且本轮尝试次数已用尽。";
        job.attemptToken = null;
        job.leaseExpiresAt = null;
        job.workerId = null;
        refreshedDates.add(job.fortuneDate);
      }
    }
    for (const fortuneDate of refreshedDates) this.refreshProduction(fortuneDate, input.claimedAt);
    const entry = [...this.imageJobs.values()]
      .filter(
        (job) =>
          this.isCurrent(job) &&
          !this.submittedDraftIds.has(job.draftId) &&
          job.attempts < job.attemptLimit &&
          ((["queued", "retryable"] as const).includes(job.status as "queued" | "retryable")
            ? job.availableAt <= input.claimedAt
            : job.status === "claimed" &&
              job.leaseExpiresAt !== null &&
              job.leaseExpiresAt <= input.claimedAt),
      )
      .sort((left, right) => {
        const byDate = [left.availableAt, left.fortuneDate]
          .join(":")
          .localeCompare([right.availableAt, right.fortuneDate].join(":"));
        return byDate === 0
          ? DAILY_IMAGE_SLOTS.indexOf(left.imageSlot) - DAILY_IMAGE_SLOTS.indexOf(right.imageSlot)
          : byDate;
      })[0];
    if (entry === undefined) return Promise.resolve(null);
    entry.status = "claimed";
    entry.attemptToken = input.attemptToken;
    entry.attempts += 1;
    entry.leaseExpiresAt = input.leaseExpiresAt;
    entry.workerId = input.workerId;
    const draft = this.drafts.get(entry.draftId);
    entry.draftRevision = draft?.draftRevision ?? entry.draftRevision;
    return Promise.resolve({
      attempts: entry.attempts,
      draftId: entry.draftId,
      draftRevision: draft?.draftRevision ?? entry.draftRevision,
      fortuneDate: entry.fortuneDate,
      imageSlot: entry.imageSlot,
      jobId: entry.jobId,
      modules: structuredClone(draft?.modules ?? entry.modules),
      promptVersion: entry.promptVersion,
    });
  }

  completeImageJob(input: {
    readonly assetId: string;
    readonly attemptToken: string;
    readonly completedAt: string;
    readonly draftRevision: number;
    readonly jobId: string;
    readonly sha256: string;
    readonly workerId: string;
  }): Promise<void> {
    const job = this.imageJobs.get(input.jobId);
    if (
      job === undefined ||
      !this.isCurrent(job) ||
      job.status !== "claimed" ||
      job.attemptToken !== input.attemptToken ||
      job.workerId !== input.workerId
    ) {
      return Promise.resolve();
    }
    const key = currentKey(job.fortuneDate, job.imageSlot);
    const selection = this.selectedSlots.get(key);
    const mayReplaceSelection =
      !this.submittedDraftIds.has(job.draftId) &&
      (selection === undefined || selection.source === "automatic_generation");
    const selectionChanges =
      mayReplaceSelection && (selection === undefined || selection.assetId !== input.assetId);
    const draft = this.drafts.get(job.draftId);
    if (
      selectionChanges &&
      (draft?.draftRevision !== input.draftRevision ||
        input.draftRevision !== job.draftRevision + 1)
    ) {
      return Promise.resolve();
    }
    job.status = "completed";
    job.attemptToken = null;
    job.leaseExpiresAt = null;
    job.workerId = null;
    job.lastError = null;
    if (selectionChanges) {
      this.selectedSlots.set(key, {
        assetId: input.assetId,
        sha256: input.sha256,
        source: "automatic_generation",
      });
    }
    const draftRevision = selectionChanges
      ? input.draftRevision + 1
      : (draft?.draftRevision ?? input.draftRevision);
    if (draft !== undefined) {
      this.drafts.set(job.draftId, {
        ...draft,
        draftRevision,
        updatedAt: input.completedAt,
      });
    }
    this.refreshProduction(job.fortuneDate, input.completedAt, draftRevision);
    return Promise.resolve();
  }

  ensureGeneratedDay(input: EnsureGeneratedDayInput): Promise<EnsureGeneratedDayStoreResult> {
    const priorKey = this.idempotency.get(input.idempotencyKey);
    if (priorKey !== undefined && priorKey.requestHash !== input.requestHash) {
      return Promise.resolve({ kind: "idempotency_conflict" });
    }
    const prior = this.productions.get(input.production.fortuneDate);
    this.idempotency.set(input.idempotencyKey, {
      fortuneDate: input.production.fortuneDate,
      requestHash: input.requestHash,
    });
    if (prior !== undefined) {
      return Promise.resolve({ kind: "existing", production: structuredClone(prior) });
    }
    const jobs = new Map(input.imageJobs.map((job) => [job.imageSlot, job]));
    if (
      jobs.size !== REQUIRED_IMAGE_SLOTS.length ||
      !REQUIRED_IMAGE_SLOTS.every((slot) => jobs.has(slot)) ||
      jobs.has("optional")
    ) {
      throw new Error("Automatic production must create exactly the two required image jobs");
    }
    this.drafts.set(input.draft.draftId, structuredClone(input.draft));
    this.productions.set(input.production.fortuneDate, structuredClone(input.production));
    for (const job of input.imageJobs) {
      this.imageJobs.set(job.jobId, {
        ...structuredClone(job),
        attemptLimit: AUTOMATIC_IMAGE_ATTEMPTS_PER_CYCLE,
        attempts: 0,
        attemptToken: null,
        availableAt: input.production.updatedAt,
        draftId: input.draft.draftId,
        draftRevision: input.draft.draftRevision,
        generationRevision: 1,
        lastError: null,
        leaseExpiresAt: null,
        modules: structuredClone(input.draft.modules),
        status: "queued",
        workerId: null,
      });
    }
    for (const imageSlot of DAILY_IMAGE_SLOTS) {
      const job = jobs.get(imageSlot);
      this.currents.set(currentKey(input.production.fortuneDate, imageSlot), {
        currentJobId: job?.jobId ?? null,
        generationRevision: job === undefined ? 0 : 1,
      });
    }
    return Promise.resolve({ kind: "created" });
  }

  listProductions(): Promise<DailyContentProduction[]> {
    return Promise.resolve(
      [...this.productions.values()]
        .sort((left, right) => left.fortuneDate.localeCompare(right.fortuneDate))
        .map((item) => structuredClone(item)),
    );
  }

  recordImageJobFailure(input: {
    readonly attemptToken: string;
    readonly error: string;
    readonly failedAt: string;
    readonly jobId: string;
    readonly retryAt: string;
    readonly workerId: string;
  }): Promise<ImageJobFailureResult> {
    const job = this.imageJobs.get(input.jobId);
    if (
      job === undefined ||
      !this.isCurrent(job) ||
      job.status !== "claimed" ||
      job.attemptToken !== input.attemptToken ||
      job.workerId !== input.workerId
    ) {
      return Promise.resolve("stale");
    }
    const exhausted = job.attempts >= job.attemptLimit;
    job.status = exhausted ? "failed" : "retryable";
    job.availableAt = exhausted ? input.failedAt : input.retryAt;
    job.lastError = input.error;
    job.attemptToken = null;
    job.leaseExpiresAt = null;
    job.workerId = null;
    this.refreshProduction(job.fortuneDate, input.failedAt);
    return Promise.resolve(exhausted ? "exhausted" : "retry_scheduled");
  }

  requestImageSlotGeneration(input: {
    readonly actorId: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly fortuneDate: string;
    readonly idempotencyKey: string;
    readonly imageJob: {
      readonly fortuneDate: string;
      readonly imageSlot: DailyImageSlot;
      readonly jobId: string;
      readonly promptVersion: string;
    };
    readonly reason: string;
    readonly requestHash: string;
    readonly requestId: string;
    readonly requestedAt: string;
  }): Promise<RequestImageSlotGenerationStoreResult> {
    const prior = this.idempotency.get(input.idempotencyKey);
    if (prior !== undefined) {
      if (prior.requestHash !== input.requestHash) {
        return Promise.resolve({ kind: "idempotency_conflict" });
      }
      const production = this.productions.get(input.fortuneDate);
      return Promise.resolve(
        production === undefined
          ? { kind: "not_found" }
          : { kind: "existing", production: structuredClone(production) },
      );
    }
    const production = this.productions.get(input.fortuneDate);
    if (production === undefined || production.draftId !== input.draftId) {
      return Promise.resolve({ kind: "not_found" });
    }
    if (this.submittedDraftIds.has(input.draftId)) {
      return Promise.resolve({ kind: "invalid_state" });
    }
    if (production.draftRevision !== input.expectedDraftRevision) {
      return Promise.resolve({
        currentRevision: production.draftRevision,
        kind: "revision_mismatch",
      });
    }
    const key = currentKey(input.fortuneDate, input.imageJob.imageSlot);
    const current = this.currents.get(key);
    if (current === undefined) return Promise.resolve({ kind: "not_found" });
    const currentJob =
      current.currentJobId === null ? undefined : this.imageJobs.get(current.currentJobId);
    if (
      currentJob?.status === "queued" ||
      currentJob?.status === "retryable" ||
      currentJob?.status === "claimed"
    ) {
      return Promise.resolve({ kind: "invalid_state" });
    }
    const draft = this.drafts.get(input.draftId);
    if (draft === undefined) return Promise.resolve({ kind: "not_found" });
    const generationRevision =
      Math.max(
        0,
        ...[...this.imageJobs.values()]
          .filter(
            (job) =>
              job.fortuneDate === input.fortuneDate && job.imageSlot === input.imageJob.imageSlot,
          )
          .map((job) => job.generationRevision),
      ) + 1;
    this.imageJobs.set(input.imageJob.jobId, {
      ...structuredClone(input.imageJob),
      attemptLimit: AUTOMATIC_IMAGE_ATTEMPTS_PER_CYCLE,
      attempts: 0,
      attemptToken: null,
      availableAt: input.requestedAt,
      draftId: input.draftId,
      draftRevision: input.expectedDraftRevision,
      generationRevision,
      lastError: null,
      leaseExpiresAt: null,
      modules: structuredClone(draft.modules),
      status: "queued",
      workerId: null,
    });
    this.currents.set(key, {
      currentJobId: input.imageJob.jobId,
      generationRevision,
    });
    this.idempotency.set(input.idempotencyKey, {
      fortuneDate: input.fortuneDate,
      requestHash: input.requestHash,
    });
    this.refreshProduction(input.fortuneDate, input.requestedAt);
    const refreshed = this.productions.get(input.fortuneDate);
    if (refreshed === undefined) throw new Error("Generated content production disappeared");
    return Promise.resolve({ kind: "requested", production: structuredClone(refreshed) });
  }
}
