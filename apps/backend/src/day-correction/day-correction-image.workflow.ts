import { createHash } from "node:crypto";

import type { components } from "@five/api-contract";

import { CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN } from "../content-lifecycle/content-lifecycle.values";
import type { ImageFileErrorCode } from "../daily-images/image-file";
import type {
  DayCorrectionImageActionIdempotencyStore,
  DayCorrectionImageActionOperation,
  StoredDayCorrectionImageActionSuccess,
} from "./day-correction-image-action-idempotency.store";
import type { RequestDayCorrectionImageGenerationResult } from "./day-correction-image-job.service";
import type {
  DayCorrectionWorkingRevision,
  OpenDayCorrectionResult,
  PatchDayCorrectionResult,
} from "./day-correction.workflow";

type DailyImageSlot = components["schemas"]["DailyImageSlot"];
type DraftImageAssetResult = components["schemas"]["DraftImageAssetResult"];
type ImageAssetUploadMetadata = components["schemas"]["ImageAssetUploadMetadata"];

const IMAGE_SLOTS = ["required_primary", "required_alternative", "optional"] as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function actionRequestHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

/**
 * This queue is deliberately scoped by correction + draft, not by fortuneDate production.
 * Its Worker adapter may upload a candidate with `selectForSlot: false`; it must never update
 * `daily_content_productions`, a draft slot selection, a visual module, or public release state.
 */
export interface CorrectionImageGenerationQueue {
  requestGeneration(input: {
    readonly actorId: string;
    readonly correctionId: string;
    readonly expectedRevision: DayCorrectionWorkingRevision;
    readonly idempotencyKey: string;
    readonly imageSlot: DailyImageSlot;
    readonly reason: string;
    readonly requestId: string;
  }): Promise<RequestDayCorrectionImageGenerationResult>;
}

export interface ReusableCorrectionImage {
  readonly assetId: string;
  readonly colorCodes: readonly string[];
  readonly imageSlot: DailyImageSlot;
  readonly previewUrl: string;
  readonly sourceContentVersion: string;
  readonly sourceFortuneDate: string;
}

export type CopyReusableCorrectionImageResult =
  | {
      readonly correctionRevision: number;
      readonly kind: "copied" | "existing";
      readonly result: DraftImageAssetResult;
    }
  | { readonly currentRevision: DayCorrectionWorkingRevision; readonly kind: "revision_mismatch" }
  | {
      readonly kind: "idempotency_conflict" | "ineligible" | "invalid_state" | "not_found";
    };

/**
 * The Postgres adapter must list only immutable-version cover assets that are currently
 * deliverable and not globally withdrawn. Copying creates a review-locked candidate binding
 * for the target draft; callers must never point a target draft directly at a foreign candidate.
 * The copy operation revalidates source delivery, slot and target color compatibility inside
 * the same transaction, so a stale library result cannot bypass withdrawal or ownership rules.
 */
export interface CorrectionImageLibrary {
  copyEligibleToDraft(input: {
    readonly actorId: string;
    readonly assetId: string;
    readonly correctionId: string;
    readonly expectedRevision: DayCorrectionWorkingRevision;
    readonly idempotencyKey: string;
    readonly imageSlot: DailyImageSlot;
    readonly reason: string;
    readonly requestId: string;
    readonly sourceContentVersion: string;
  }): Promise<CopyReusableCorrectionImageResult>;
  listEligible(input: {
    readonly draftId: string;
    readonly imageSlot: DailyImageSlot;
    readonly limit: number;
  }): Promise<readonly ReusableCorrectionImage[]>;
}

export type SelectDraftCandidateResult =
  | { readonly kind: "existing" | "selected"; readonly result: DraftImageAssetResult }
  | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
  | {
      readonly kind: "idempotency_conflict" | "invalid_argument" | "invalid_state" | "not_found";
    };

export type UploadCorrectionImageResult =
  | { readonly kind: "existing" | "uploaded"; readonly result: DraftImageAssetResult }
  | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
  | { readonly code: ImageFileErrorCode; readonly kind: "file_error" }
  | {
      readonly kind: "idempotency_conflict" | "invalid_metadata" | "invalid_state" | "not_found";
    };

export interface CorrectionImageAssetPort {
  selectDraftAssetForSlot(input: {
    readonly actorId: string;
    readonly assetId: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly idempotencyKey: string;
    readonly imageSlot: DailyImageSlot;
    readonly materializeImmediateVisual?: boolean;
    readonly reason: string;
    readonly requestId: string;
  }): Promise<SelectDraftCandidateResult>;
  uploadDraftAsset(input: {
    readonly actorId: string;
    readonly bytes: Buffer;
    readonly declaredMediaType: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly idempotencyKey: string;
    readonly imageSlot: DailyImageSlot;
    readonly metadata: ImageAssetUploadMetadata;
    readonly materializeImmediateVisual?: boolean;
    readonly reason: string;
    readonly requestId: string;
    readonly selectForSlot: true;
  }): Promise<UploadCorrectionImageResult>;
}

export interface CorrectionImageWorkingCopyPort {
  getWorkingCopy(correctionId: string): Promise<OpenDayCorrectionResult>;
  patch(input: {
    readonly actorId: string;
    readonly command: {
      readonly assetId: string;
      readonly imageSlot: DailyImageSlot;
      readonly kind: "replace_image_cover";
    };
    readonly correctionId: string;
    readonly expectedRevision: DayCorrectionWorkingRevision;
    readonly requestId: string;
  }): Promise<PatchDayCorrectionResult>;
}

export type PrepareCorrectionImageResult =
  | {
      readonly assetId: string;
      readonly correctionRevision: number;
      readonly draftRevision: number;
      readonly kind: "replaced" | "existing";
      readonly previewUrl: string;
    }
  | {
      readonly assetId: string;
      readonly currentRevision: DayCorrectionWorkingRevision;
      readonly kind: "candidate_ready";
    }
  | { readonly currentRevision: DayCorrectionWorkingRevision; readonly kind: "revision_mismatch" }
  | { readonly code: ImageFileErrorCode; readonly kind: "file_error" }
  | {
      readonly kind:
        | "idempotency_conflict"
        | "ineligible"
        | "invalid_argument"
        | "invalid_asset_reference"
        | "invalid_state"
        | "not_found";
    };

export type ListReusableCorrectionImagesResult =
  | { readonly items: readonly ReusableCorrectionImage[]; readonly kind: "ready" }
  | { readonly kind: "invalid_argument" | "invalid_state" | "not_found" };

function validSlot(value: DailyImageSlot): boolean {
  return IMAGE_SLOTS.includes(value);
}

function validCommonInput(input: {
  readonly actorId: string;
  readonly correctionId: string;
  readonly expectedRevision: DayCorrectionWorkingRevision;
  readonly idempotencyKey: string;
  readonly imageSlot: DailyImageSlot;
  readonly reason: string;
  readonly requestId: string;
}): boolean {
  return (
    input.actorId.trim().length > 0 &&
    input.correctionId.trim().length > 0 &&
    Number.isSafeInteger(input.expectedRevision.correctionRevision) &&
    input.expectedRevision.correctionRevision >= 1 &&
    Number.isSafeInteger(input.expectedRevision.draftRevision) &&
    input.expectedRevision.draftRevision >= 1 &&
    CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey) &&
    validSlot(input.imageSlot) &&
    input.reason.trim().length > 0 &&
    Array.from(input.reason).length <= 500 &&
    input.requestId.length >= 8 &&
    input.requestId.length <= 128
  );
}

function currentCover(
  workingCopy: Extract<OpenDayCorrectionResult, { readonly kind: "ready" }>,
  imageSlot: DailyImageSlot,
): string | null {
  return (
    workingCopy.draft.modules.visual_and_rights?.looks.find((look) => look.imageSlot === imageSlot)
      ?.coverAssetId ?? null
  );
}

function openWorkingCopy(
  result: OpenDayCorrectionResult,
):
  | Extract<OpenDayCorrectionResult, { readonly kind: "ready" }>
  | { readonly kind: "invalid_state" | "not_found" } {
  if (result.kind !== "ready") return { kind: "not_found" };
  return result.correction.status === "open" ? result : { kind: "invalid_state" };
}

export class DayCorrectionImageWorkflow {
  constructor(
    private readonly corrections: CorrectionImageWorkingCopyPort,
    private readonly assets: CorrectionImageAssetPort,
    private readonly generations: CorrectionImageGenerationQueue,
    private readonly library: CorrectionImageLibrary,
    private readonly actionIdempotency: DayCorrectionImageActionIdempotencyStore,
  ) {}

  async listReusable(input: {
    readonly correctionId: string;
    readonly imageSlot: DailyImageSlot;
    readonly limit?: number;
  }): Promise<ListReusableCorrectionImagesResult> {
    if (
      input.correctionId.trim().length === 0 ||
      !validSlot(input.imageSlot) ||
      (input.limit !== undefined &&
        (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50))
    ) {
      return { kind: "invalid_argument" };
    }
    const working = openWorkingCopy(await this.corrections.getWorkingCopy(input.correctionId));
    if ("kind" in working && working.kind !== "ready") return working;
    return {
      items: await this.library.listEligible({
        draftId: working.draft.draftId,
        imageSlot: input.imageSlot,
        limit: input.limit ?? 24,
      }),
      kind: "ready",
    };
  }

  async requestRegeneration(input: {
    readonly actorId: string;
    readonly correctionId: string;
    readonly expectedRevision: DayCorrectionWorkingRevision;
    readonly idempotencyKey: string;
    readonly imageSlot: DailyImageSlot;
    readonly reason: string;
    readonly requestId: string;
  }): Promise<RequestDayCorrectionImageGenerationResult> {
    if (!validCommonInput(input)) return { kind: "invalid_argument" };
    // The queue owns idempotency and checks an existing key before the live revision. A completed
    // candidate upload legitimately advances the draft ETag, so rejecting here would turn a
    // network retry of the original request into a false revision conflict.
    return this.generations.requestGeneration(input);
  }

  async selectDraftCandidate(input: {
    readonly actorId: string;
    readonly assetId: string;
    readonly correctionId: string;
    readonly expectedRevision: DayCorrectionWorkingRevision;
    readonly idempotencyKey: string;
    readonly imageSlot: DailyImageSlot;
    readonly reason: string;
    readonly requestId: string;
  }): Promise<PrepareCorrectionImageResult> {
    if (!validCommonInput(input) || input.assetId.trim().length === 0) {
      return { kind: "invalid_argument" };
    }
    const requestHash = actionRequestHash({
      actorId: input.actorId,
      assetId: input.assetId,
      correctionId: input.correctionId,
      expectedRevision: input.expectedRevision,
      imageSlot: input.imageSlot,
      materializeImmediateVisual: true,
      reason: input.reason,
    });
    const replay = await this.actionIdempotency.find({
      correctionId: input.correctionId,
      idempotencyKey: input.idempotencyKey,
      operation: "candidate_select",
      requestHash,
    });
    if (replay.kind === "existing") return replay.result;
    if (replay.kind === "idempotency_conflict") return replay;
    const working = openWorkingCopy(await this.corrections.getWorkingCopy(input.correctionId));
    if ("kind" in working && working.kind !== "ready") return working;
    const selected = await this.assets.selectDraftAssetForSlot({
      actorId: input.actorId,
      assetId: input.assetId,
      draftId: working.draft.draftId,
      expectedDraftRevision: input.expectedRevision.draftRevision,
      idempotencyKey: input.idempotencyKey,
      imageSlot: input.imageSlot,
      materializeImmediateVisual: true,
      reason: input.reason,
      requestId: input.requestId,
    });
    if (selected.kind === "selected" || selected.kind === "existing") {
      const replaced = await this.replaceSelectedCandidate(input, selected.result);
      return replaced.kind === "replaced" || replaced.kind === "existing"
        ? this.rememberAction("candidate_select", input, requestHash, replaced)
        : replaced;
    }
    if (selected.kind === "revision_mismatch") {
      return {
        currentRevision: {
          correctionRevision: working.correction.correctionRevision,
          draftRevision: selected.currentRevision,
        },
        kind: "revision_mismatch",
      };
    }
    return { kind: selected.kind };
  }

  async selectReusable(input: {
    readonly actorId: string;
    readonly assetId: string;
    readonly correctionId: string;
    readonly expectedRevision: DayCorrectionWorkingRevision;
    readonly idempotencyKey: string;
    readonly imageSlot: DailyImageSlot;
    readonly reason: string;
    readonly requestId: string;
    readonly sourceContentVersion: string;
  }): Promise<PrepareCorrectionImageResult> {
    if (
      !validCommonInput(input) ||
      input.assetId.trim().length === 0 ||
      input.sourceContentVersion.trim().length === 0
    ) {
      return { kind: "invalid_argument" };
    }
    const copied = await this.library.copyEligibleToDraft({
      actorId: input.actorId,
      assetId: input.assetId,
      correctionId: input.correctionId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      imageSlot: input.imageSlot,
      reason: input.reason,
      requestId: input.requestId,
      sourceContentVersion: input.sourceContentVersion,
    });
    if (copied.kind === "copied" || copied.kind === "existing") {
      return {
        assetId: copied.result.asset.assetId,
        correctionRevision: copied.correctionRevision,
        draftRevision: copied.result.draftRevision,
        kind: copied.kind === "copied" ? "replaced" : "existing",
        previewUrl: copied.result.previewUrl,
      };
    }
    if (copied.kind === "revision_mismatch") return copied;
    return { kind: copied.kind };
  }

  async uploadAndSelect(input: {
    readonly actorId: string;
    readonly bytes: Buffer;
    readonly correctionId: string;
    readonly declaredMediaType: string;
    readonly expectedRevision: DayCorrectionWorkingRevision;
    readonly idempotencyKey: string;
    readonly imageSlot: DailyImageSlot;
    readonly metadata: ImageAssetUploadMetadata;
    readonly reason: string;
    readonly requestId: string;
  }): Promise<PrepareCorrectionImageResult> {
    if (!validCommonInput(input) || input.bytes.byteLength === 0) {
      return { kind: "invalid_argument" };
    }
    const requestHash = actionRequestHash({
      actorId: input.actorId,
      bytesSha256: createHash("sha256").update(input.bytes).digest("hex"),
      correctionId: input.correctionId,
      declaredMediaType: input.declaredMediaType,
      expectedRevision: input.expectedRevision,
      imageSlot: input.imageSlot,
      metadata: input.metadata,
      materializeImmediateVisual: true,
      reason: input.reason,
    });
    const replay = await this.actionIdempotency.find({
      correctionId: input.correctionId,
      idempotencyKey: input.idempotencyKey,
      operation: "upload",
      requestHash,
    });
    if (replay.kind === "existing") return replay.result;
    if (replay.kind === "idempotency_conflict") return replay;
    const working = openWorkingCopy(await this.corrections.getWorkingCopy(input.correctionId));
    if ("kind" in working && working.kind !== "ready") return working;
    const uploaded = await this.assets.uploadDraftAsset({
      actorId: input.actorId,
      bytes: input.bytes,
      declaredMediaType: input.declaredMediaType,
      draftId: working.draft.draftId,
      expectedDraftRevision: input.expectedRevision.draftRevision,
      idempotencyKey: input.idempotencyKey,
      imageSlot: input.imageSlot,
      metadata: input.metadata,
      materializeImmediateVisual: true,
      reason: input.reason,
      requestId: input.requestId,
      selectForSlot: true,
    });
    if (uploaded.kind === "uploaded" || uploaded.kind === "existing") {
      const replaced = await this.replaceSelectedCandidate(input, uploaded.result);
      return replaced.kind === "replaced" || replaced.kind === "existing"
        ? this.rememberAction("upload", input, requestHash, replaced)
        : replaced;
    }
    if (uploaded.kind === "revision_mismatch") {
      return {
        currentRevision: {
          correctionRevision: working.correction.correctionRevision,
          draftRevision: uploaded.currentRevision,
        },
        kind: "revision_mismatch",
      };
    }
    if (uploaded.kind === "file_error") return uploaded;
    return uploaded.kind === "invalid_metadata"
      ? { kind: "invalid_argument" }
      : { kind: uploaded.kind };
  }

  private async rememberAction(
    operation: DayCorrectionImageActionOperation,
    input: { readonly correctionId: string; readonly idempotencyKey: string },
    requestHash: string,
    result: StoredDayCorrectionImageActionSuccess,
  ): Promise<PrepareCorrectionImageResult> {
    const recorded = await this.actionIdempotency.record({
      correctionId: input.correctionId,
      idempotencyKey: input.idempotencyKey,
      operation,
      requestHash,
      result,
    });
    return recorded.kind === "idempotency_conflict" ? recorded : recorded.result;
  }

  private async replaceSelectedCandidate(
    input: {
      readonly actorId: string;
      readonly correctionId: string;
      readonly imageSlot: DailyImageSlot;
      readonly requestId: string;
    },
    selected: DraftImageAssetResult,
  ): Promise<PrepareCorrectionImageResult> {
    const latest = openWorkingCopy(await this.corrections.getWorkingCopy(input.correctionId));
    if ("kind" in latest && latest.kind !== "ready") return latest;
    if (
      selected.draftId !== latest.draft.draftId ||
      selected.fortuneDate !== latest.correction.fortuneDate ||
      selected.imageSlot !== input.imageSlot
    ) {
      return { kind: "invalid_asset_reference" };
    }
    if (currentCover(latest, input.imageSlot) === selected.asset.assetId) {
      return {
        assetId: selected.asset.assetId,
        correctionRevision: latest.correction.correctionRevision,
        draftRevision: latest.draft.draftRevision,
        kind: "existing",
        previewUrl: selected.previewUrl,
      };
    }
    if (latest.draft.draftRevision !== selected.draftRevision) {
      return {
        assetId: selected.asset.assetId,
        currentRevision: {
          correctionRevision: latest.correction.correctionRevision,
          draftRevision: latest.draft.draftRevision,
        },
        kind: "candidate_ready",
      };
    }
    if (latest.draft.modules.visual_and_rights === null) {
      return {
        assetId: selected.asset.assetId,
        correctionRevision: latest.correction.correctionRevision,
        draftRevision: latest.draft.draftRevision,
        kind: "replaced",
        previewUrl: selected.previewUrl,
      };
    }
    const replaced = await this.corrections.patch({
      actorId: input.actorId,
      command: {
        assetId: selected.asset.assetId,
        imageSlot: input.imageSlot,
        kind: "replace_image_cover",
      },
      correctionId: input.correctionId,
      expectedRevision: {
        correctionRevision: latest.correction.correctionRevision,
        draftRevision: selected.draftRevision,
      },
      requestId: input.requestId,
    });
    if (replaced.kind === "updated") {
      return {
        assetId: selected.asset.assetId,
        correctionRevision: replaced.correctionRevision,
        draftRevision: replaced.draftRevision,
        kind: "replaced",
        previewUrl: selected.previewUrl,
      };
    }
    return replaced.kind === "target_not_found" ||
      replaced.kind === "invalid_command" ||
      replaced.kind === "invalid_value"
      ? { kind: "invalid_argument" }
      : replaced.kind === "algorithm_field_read_only"
        ? { kind: "invalid_state" }
        : replaced;
  }
}
