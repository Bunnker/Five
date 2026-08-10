import type { DailyImageAssetService } from "../daily-images/daily-image-asset.service";
import type { GeneratedImageUploader } from "./content-image-production.worker";

interface CandidateUploaderClock {
  now(): Date;
}

const SYSTEM_CLOCK: CandidateUploaderClock = { now: () => new Date() };

export class DailyImageCandidateUploader implements GeneratedImageUploader {
  constructor(
    private readonly imageService: DailyImageAssetService,
    private readonly clock: CandidateUploaderClock = SYSTEM_CLOCK,
  ) {}

  async upload(input: Parameters<GeneratedImageUploader["upload"]>[0]): Promise<{
    readonly assetId: string;
    readonly draftRevision: number;
    readonly sha256: string;
  }> {
    const origin = input.origin ?? "automatic_production";
    const sourceReference =
      origin === "automatic_production"
        ? `production-job-${input.jobId}`
        : `correction-job-${input.jobId}`;
    const existing = await this.imageService.listDraftAssets(input.draftId);
    const existingAsset = existing?.items.find(
      ({ asset, imageSlot }) =>
        imageSlot === input.imageSlot && asset.sourceMaterialReferences.includes(sourceReference),
    );
    if (existing !== null && existingAsset !== undefined) {
      return {
        assetId: existingAsset.asset.assetId,
        draftRevision: existing.draftRevision,
        sha256: existingAsset.asset.sha256,
      };
    }

    const result = await this.imageService.uploadDraftAsset({
      actorId:
        origin === "automatic_production"
          ? "system-content-production-worker"
          : "system-day-correction-image-worker",
      bytes: input.bytes,
      declaredMediaType: input.declaredMediaType,
      draftId: input.draftId,
      expectedDraftRevision: input.expectedDraftRevision,
      idempotencyKey:
        origin === "automatic_production"
          ? `automatic-image-upload:${input.jobId}:v2`
          : `correction-image-upload:${input.jobId}:v1`,
      imageSlot: input.imageSlot,
      metadata: {
        aiLabelStatus: "pending",
        altText:
          origin === "automatic_production"
            ? `${input.fortuneDate} ${input.imageSlot} 自动生成模特穿搭候选`
            : `${input.fortuneDate} ${input.imageSlot} 订正重生成模特穿搭候选`,
        declaredModel: input.model,
        generatedAt: this.clock.now().toISOString(),
        generationMethod: "external_tool",
        promptVersion: input.promptVersion,
        reproductionReference: input.reproductionReference,
        rightsRecordIds: [`rights-pending-${input.jobId}`],
        sourceMaterialReferences: [sourceReference],
        sourceType: "ai_generated",
      },
      requestId:
        origin === "automatic_production"
          ? `worker-image-${input.jobId}`
          : `worker-correction-image-${input.jobId}`,
      selectForSlot: false,
    });
    if (result.kind === "uploaded" || result.kind === "existing") {
      return {
        assetId: result.result.asset.assetId,
        draftRevision: result.result.draftRevision,
        sha256: result.result.asset.sha256,
      };
    }
    throw new Error(`自动模特图上传失败：${result.kind}`);
  }
}
