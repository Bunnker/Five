import type { components } from "@five/api-contract";
import { createHash, randomUUID } from "node:crypto";

import { CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN } from "../content-lifecycle/content-lifecycle.values";
import type { ContentProductionStore, ImageProductionSlot } from "./content-production.store";
import {
  DAILY_IMAGE_SLOTS,
  initialImageSlotProduction,
  REQUIRED_IMAGE_SLOTS,
} from "./content-production.status";
import { DeterministicDraftGenerator } from "./deterministic-draft.generator";

export type DailyContentProduction = components["schemas"]["DailyContentProduction"];

export type EnsureDailyContentProductionResult =
  | { readonly kind: "accepted" | "existing"; readonly production: DailyContentProduction }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "invalid_argument" };

export type RequestImageSlotGenerationResult =
  | { readonly kind: "accepted" | "existing"; readonly production: DailyContentProduction }
  | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
  | { readonly kind: "idempotency_conflict" | "invalid_argument" | "invalid_state" | "not_found" };

export interface ContentProductionService {
  ensureDay(input: {
    readonly actorId: string;
    readonly fortuneDate: string;
    readonly idempotencyKey: string;
    readonly requestId: string;
  }): Promise<EnsureDailyContentProductionResult>;

  list(): Promise<{ readonly items: DailyContentProduction[] }>;

  requestImageSlotGeneration(input: {
    readonly actorId: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly fortuneDate: string;
    readonly idempotencyKey: string;
    readonly imageSlot: ImageProductionSlot;
    readonly reason: string;
    readonly requestId: string;
  }): Promise<RequestImageSlotGenerationResult>;
}

export interface ContentProductionClock {
  now(): Date;
}

export interface ContentProductionIdentifiers {
  nextDraftId(): string;
  nextImageJobId(slot: ImageProductionSlot): string;
}

const SYSTEM_CLOCK: ContentProductionClock = { now: () => new Date() };
const SYSTEM_IDENTIFIERS: ContentProductionIdentifiers = {
  nextDraftId: () => `draft-${randomUUID()}`,
  nextImageJobId: () => `image-job-${randomUUID()}`,
};

function requestHash(fortuneDate: string): string {
  return createHash("sha256").update(JSON.stringify({ fortuneDate })).digest("hex");
}

function imageGenerationRequestHash(input: {
  readonly draftId: string;
  readonly expectedDraftRevision: number;
  readonly fortuneDate: string;
  readonly imageSlot: ImageProductionSlot;
  readonly reason: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export class AutomaticContentProductionService implements ContentProductionService {
  constructor(
    private readonly store: ContentProductionStore,
    private readonly clock: ContentProductionClock = SYSTEM_CLOCK,
    private readonly identifiers: ContentProductionIdentifiers = SYSTEM_IDENTIFIERS,
    private readonly generator = new DeterministicDraftGenerator(),
  ) {}

  async ensureDay(input: {
    readonly actorId: string;
    readonly fortuneDate: string;
    readonly idempotencyKey: string;
    readonly requestId: string;
  }): Promise<EnsureDailyContentProductionResult> {
    if (!CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
      return { kind: "invalid_argument" };
    }
    let modules: components["schemas"]["DraftModules"];
    try {
      modules = this.generator.generate(input.fortuneDate);
    } catch {
      return { kind: "invalid_argument" };
    }
    const updatedAt = this.clock.now().toISOString();
    const draftId = this.identifiers.nextDraftId();
    const production: DailyContentProduction = {
      completedImageSlots: 0,
      draftId,
      draftRevision: 1,
      fortuneDate: input.fortuneDate,
      imageSlots: initialImageSlotProduction(updatedAt),
      lastError: null,
      optionalImageStatus: "not_requested",
      pendingImageSlots: 2,
      requiredGenerationComplete: false,
      requiredImagesReady: false,
      status: "generating",
      updatedAt,
    };
    const result = await this.store.ensureGeneratedDay({
      actorId: input.actorId,
      draft: {
        createdAt: updatedAt,
        draftId,
        draftRevision: 1,
        fortuneDate: input.fortuneDate,
        modules,
        state: "draft",
        updatedAt,
      },
      idempotencyKey: input.idempotencyKey,
      imageJobs: REQUIRED_IMAGE_SLOTS.map((imageSlot) => ({
        fortuneDate: input.fortuneDate,
        imageSlot,
        jobId: this.identifiers.nextImageJobId(imageSlot),
        promptVersion: "five-look-v1",
      })),
      production,
      requestHash: requestHash(input.fortuneDate),
      requestId: input.requestId,
    });
    if (result.kind === "idempotency_conflict") return result;
    if (result.kind === "existing") return { kind: "existing", production: result.production };
    return { kind: "accepted", production };
  }

  async list(): Promise<{ readonly items: DailyContentProduction[] }> {
    return { items: await this.store.listProductions() };
  }

  async requestImageSlotGeneration(input: {
    readonly actorId: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly fortuneDate: string;
    readonly idempotencyKey: string;
    readonly imageSlot: ImageProductionSlot;
    readonly reason: string;
    readonly requestId: string;
  }): Promise<RequestImageSlotGenerationResult> {
    if (
      !CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey) ||
      !DAILY_IMAGE_SLOTS.includes(input.imageSlot) ||
      !Number.isSafeInteger(input.expectedDraftRevision) ||
      input.expectedDraftRevision < 1 ||
      input.draftId.length < 1 ||
      input.draftId.length > 80 ||
      input.reason.trim().length < 1 ||
      input.reason.length > 500
    ) {
      return { kind: "invalid_argument" };
    }
    try {
      this.generator.generate(input.fortuneDate);
    } catch {
      return { kind: "invalid_argument" };
    }
    const requestedAt = this.clock.now().toISOString();
    const result = await this.store.requestImageSlotGeneration({
      actorId: input.actorId,
      draftId: input.draftId,
      expectedDraftRevision: input.expectedDraftRevision,
      fortuneDate: input.fortuneDate,
      idempotencyKey: input.idempotencyKey,
      imageJob: {
        fortuneDate: input.fortuneDate,
        imageSlot: input.imageSlot,
        jobId: this.identifiers.nextImageJobId(input.imageSlot),
        promptVersion: "five-look-v1",
      },
      reason: input.reason,
      requestHash: imageGenerationRequestHash({
        draftId: input.draftId,
        expectedDraftRevision: input.expectedDraftRevision,
        fortuneDate: input.fortuneDate,
        imageSlot: input.imageSlot,
        reason: input.reason,
      }),
      requestId: input.requestId,
      requestedAt,
    });
    if (result.kind === "requested") {
      return { kind: "accepted", production: result.production };
    }
    return result;
  }
}
