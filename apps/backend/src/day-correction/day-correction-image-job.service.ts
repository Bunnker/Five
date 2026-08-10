import { createHash, randomUUID } from "node:crypto";

import { CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN } from "../content-lifecycle/content-lifecycle.values";
import type {
  DayCorrectionImageJobStore,
  DayCorrectionImageSlot,
  DayCorrectionImageWorkingCopyState,
  DayCorrectionWorkingRevision,
  RequestDayCorrectionImageGenerationStoreResult,
} from "./day-correction-image-job.store";

export const DAY_CORRECTION_IMAGE_PROMPT_VERSION = "five-outfit-model-v1";

interface DayCorrectionImageJobClock {
  now(): Date;
}

interface DayCorrectionImageJobIdentifiers {
  nextJobId(): string;
}

const SYSTEM_CLOCK: DayCorrectionImageJobClock = { now: () => new Date() };
const SYSTEM_IDENTIFIERS: DayCorrectionImageJobIdentifiers = {
  nextJobId: () => `correction-image-job-${randomUUID()}`,
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function requestHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function validRevision(revision: DayCorrectionWorkingRevision): boolean {
  return (
    Number.isSafeInteger(revision.correctionRevision) &&
    revision.correctionRevision >= 1 &&
    Number.isSafeInteger(revision.draftRevision) &&
    revision.draftRevision >= 1
  );
}

function validSlot(value: string): value is DayCorrectionImageSlot {
  return value === "required_primary" || value === "required_alternative" || value === "optional";
}

export type RequestDayCorrectionImageGenerationResult =
  RequestDayCorrectionImageGenerationStoreResult | { readonly kind: "invalid_argument" };

export class DayCorrectionImageJobService {
  constructor(
    private readonly store: DayCorrectionImageJobStore,
    private readonly clock: DayCorrectionImageJobClock = SYSTEM_CLOCK,
    private readonly identifiers: DayCorrectionImageJobIdentifiers = SYSTEM_IDENTIFIERS,
  ) {}

  getCurrent(correctionId: string, imageSlot: DayCorrectionImageSlot) {
    return this.store.getCurrent(correctionId, imageSlot);
  }

  requestGeneration(input: {
    readonly actorId: string;
    readonly correctionId: string;
    readonly expectedRevision: DayCorrectionWorkingRevision;
    readonly idempotencyKey: string;
    readonly imageSlot: string;
    readonly reason: string;
    readonly requestId: string;
  }): Promise<RequestDayCorrectionImageGenerationResult> {
    if (
      input.actorId.trim().length === 0 ||
      input.correctionId.trim().length === 0 ||
      !validRevision(input.expectedRevision) ||
      !CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey) ||
      !validSlot(input.imageSlot) ||
      input.reason.trim().length === 0 ||
      Array.from(input.reason).length > 500 ||
      input.requestId.length < 8 ||
      input.requestId.length > 128
    ) {
      return Promise.resolve({ kind: "invalid_argument" });
    }
    const requestedAt = this.clock.now().toISOString();
    const hash = requestHash({
      actorId: input.actorId,
      correctionId: input.correctionId,
      expectedRevision: input.expectedRevision,
      imageSlot: input.imageSlot,
      reason: input.reason,
    });
    return this.store.requestGeneration({
      actorId: input.actorId,
      correctionId: input.correctionId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      imageSlot: input.imageSlot,
      jobId: this.identifiers.nextJobId(),
      promptVersion: DAY_CORRECTION_IMAGE_PROMPT_VERSION,
      reason: input.reason,
      requestId: input.requestId,
      requestHash: hash,
      requestedAt,
    });
  }
}

export type { DayCorrectionImageWorkingCopyState };
