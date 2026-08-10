import type { AdminPreviewImage } from "./content/daily-experience-preview";
import {
  adminApi,
  createIdempotencyKey,
  type AdminImageAsset,
  type DailyImageSlot,
  type DayCorrectionImageStatus,
  type DayCorrectionWorkingCopy,
  type ReusableDayCorrectionImage,
} from "./admin-api";

export type CorrectionSession = {
  etag: string;
  workingCopy: DayCorrectionWorkingCopy;
};

export type ImageChoiceResult = {
  choices: AdminPreviewImage[];
  correction: CorrectionSession;
};

export type ImageSelectionResult = {
  correction: CorrectionSession;
  selectedImage: AdminPreviewImage;
};

type AdapterBaseInput = {
  correction: CorrectionSession;
  csrfToken: string;
  imageSlot: DailyImageSlot;
};

export type AdminDayImageAdapter = {
  listExisting(input: AdapterBaseInput): Promise<ImageChoiceResult>;
  listLibrary(input: AdapterBaseInput): Promise<ReusableDayCorrectionImage[]>;
  regenerate(input: AdapterBaseInput): Promise<ImageChoiceResult>;
  selectCandidate(input: AdapterBaseInput & { assetId: string }): Promise<ImageSelectionResult>;
  selectLibrary(
    input: AdapterBaseInput & { assetId: string; sourceContentVersion: string },
  ): Promise<ImageSelectionResult>;
  upload(
    input: AdapterBaseInput & { altText?: string; file: File; reason: string },
  ): Promise<ImageSelectionResult>;
  withdrawPublished(input: {
    activeContentVersion: string;
    assetId: string;
    csrfToken: string;
    fortuneDate: string;
    imageSlot: DailyImageSlot;
  }): Promise<{ previewImage: AdminPreviewImage | null }>;
};

type AdapterOptions = {
  maxPolls?: number;
  pollIntervalMs?: number;
  wait?: (durationMs: number) => Promise<void>;
};

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs));
}

function requireEtag(response: Response): string {
  const etag = response.headers.get("ETag");
  if (etag === null) throw new Error("missing correction ETag");
  return etag;
}

function sessionFromStatus(
  current: CorrectionSession,
  status: DayCorrectionImageStatus,
  response: Response,
): CorrectionSession {
  return {
    etag: requireEtag(response),
    workingCopy: {
      ...current.workingCopy,
      correctionRevision: status.correctionRevision,
      draftRevision: status.draftRevision,
    },
  };
}

function imageFromCandidate(
  candidate: NonNullable<DayCorrectionImageStatus["candidate"]>,
): AdminPreviewImage {
  return {
    asset: candidate.asset,
    imageSlot: candidate.imageSlot,
    previewUrl: candidate.previewUrl,
    selectedForSlot: candidate.selectedForSlot,
  };
}

async function readDraftImages(
  correction: CorrectionSession,
  imageSlot: DailyImageSlot,
): Promise<AdminPreviewImage[]> {
  const result = await adminApi.listDraftImages(correction.workingCopy.draftId);
  if (!result.ok) throw new Error("unable to read correction image candidates");
  return result.data.items
    .filter((candidate) => candidate.imageSlot === imageSlot)
    .map((candidate) => ({
      asset: candidate.asset,
      imageSlot: candidate.imageSlot,
      previewUrl: candidate.previewUrl,
      selectedForSlot: candidate.selectedForSlot,
    }));
}

async function selectedDraftImage(
  correction: CorrectionSession,
  imageSlot: DailyImageSlot,
  assetId: string,
  previewUrl: string,
): Promise<AdminPreviewImage> {
  const images = await readDraftImages(correction, imageSlot);
  const selected = images.find((image) => image.asset.assetId === assetId && image.selectedForSlot);
  if (selected === undefined) throw new Error("server did not return the selected image");
  return { ...selected, previewUrl };
}

function selectedImageFromSet(
  imageSlot: DailyImageSlot,
  imageSet: {
    assets: AdminImageAsset[];
    slots: Array<{
      coverAssetId: string;
      imageSlot: DailyImageSlot;
      servedCoverAssetId: string | null;
    }>;
  },
): AdminPreviewImage | null {
  const slot = imageSet.slots.find((candidate) => candidate.imageSlot === imageSlot);
  const assetId = slot?.servedCoverAssetId ?? null;
  if (assetId === null) return null;
  const asset = imageSet.assets.find((candidate) => candidate.assetId === assetId);
  if (asset === undefined) throw new Error("withdrawal response references an unknown image");
  return {
    asset,
    imageSlot,
    previewUrl: `/admin/api/v1/image-assets/${encodeURIComponent(assetId)}/preview`,
    selectedForSlot: true,
  };
}

export function createAdminDayImageAdapter(options: AdapterOptions = {}): AdminDayImageAdapter {
  const maxPolls = options.maxPolls ?? 12;
  const pollIntervalMs = options.pollIntervalMs ?? 750;
  const pause = options.wait ?? wait;

  return {
    async listExisting(input) {
      return {
        choices: await readDraftImages(input.correction, input.imageSlot),
        correction: input.correction,
      };
    },

    async listLibrary(input) {
      const result = await adminApi.listReusableDayCorrectionImages({
        correctionId: input.correction.workingCopy.correctionId,
        imageSlot: input.imageSlot,
      });
      if (!result.ok) throw new Error("unable to read reusable image library");
      return result.data.items;
    },

    async regenerate(input) {
      const requested = await adminApi.regenerateDayCorrectionImage({
        correctionId: input.correction.workingCopy.correctionId,
        csrfToken: input.csrfToken,
        etag: input.correction.etag,
        idempotencyKey: createIdempotencyKey(),
        imageSlot: input.imageSlot,
        reason: "维护者在可视化后台请求重新生成当前图片。",
      });
      if (!requested.ok) throw new Error("unable to request image regeneration");
      let correction = sessionFromStatus(input.correction, requested.data, requested.response);
      if (requested.data.candidate !== null) {
        return { choices: [imageFromCandidate(requested.data.candidate)], correction };
      }

      for (let poll = 0; poll < maxPolls; poll += 1) {
        await pause(pollIntervalMs);
        const status = await adminApi.getDayCorrectionImageStatus({
          correctionId: correction.workingCopy.correctionId,
          imageSlot: input.imageSlot,
        });
        if (!status.ok) throw new Error("unable to read regenerated image status");
        correction = sessionFromStatus(correction, status.data, status.response);
        if (status.data.candidate !== null) {
          return { choices: [imageFromCandidate(status.data.candidate)], correction };
        }
        if (status.data.job?.status === "failed") {
          throw new Error("image regeneration failed");
        }
      }
      throw new Error("image regeneration is still running");
    },

    async selectCandidate(input) {
      const result = await adminApi.selectDayCorrectionImageCandidate({
        assetId: input.assetId,
        correctionId: input.correction.workingCopy.correctionId,
        csrfToken: input.csrfToken,
        etag: input.correction.etag,
        idempotencyKey: createIdempotencyKey(),
        imageSlot: input.imageSlot,
        reason: "维护者在可视化后台明确选择这张候选图。",
      });
      if (!result.ok) throw new Error("unable to select image candidate");
      const correction = {
        etag: requireEtag(result.response),
        workingCopy: result.data.workingCopy,
      };
      return {
        correction,
        selectedImage: await selectedDraftImage(
          correction,
          input.imageSlot,
          result.data.assetId,
          result.data.previewUrl,
        ),
      };
    },

    async selectLibrary(input) {
      const result = await adminApi.reuseDayCorrectionImage({
        assetId: input.assetId,
        correctionId: input.correction.workingCopy.correctionId,
        csrfToken: input.csrfToken,
        etag: input.correction.etag,
        idempotencyKey: createIdempotencyKey(),
        imageSlot: input.imageSlot,
        reason: "维护者在可视化后台明确选择搭配库图片。",
        sourceContentVersion: input.sourceContentVersion,
      });
      if (!result.ok) throw new Error("unable to reuse library image");
      const correction = {
        etag: requireEtag(result.response),
        workingCopy: result.data.workingCopy,
      };
      return {
        correction,
        selectedImage: await selectedDraftImage(
          correction,
          input.imageSlot,
          result.data.assetId,
          result.data.previewUrl,
        ),
      };
    },

    async upload(input) {
      const formData = new FormData();
      formData.append("file", input.file);
      formData.append("reason", input.reason);
      if (input.altText !== undefined && input.altText.trim() !== "") {
        formData.append("altText", input.altText.trim());
      }
      const result = await adminApi.uploadDayCorrectionImage({
        correctionId: input.correction.workingCopy.correctionId,
        csrfToken: input.csrfToken,
        etag: input.correction.etag,
        formData,
        idempotencyKey: createIdempotencyKey(),
        imageSlot: input.imageSlot,
      });
      if (!result.ok) throw new Error("unable to upload correction image");
      const correction = {
        etag: requireEtag(result.response),
        workingCopy: result.data.workingCopy,
      };
      return {
        correction,
        selectedImage: await selectedDraftImage(
          correction,
          input.imageSlot,
          result.data.assetId,
          result.data.previewUrl,
        ),
      };
    },

    async withdrawPublished(input) {
      const current = await adminApi.getDailyImageSet(input.activeContentVersion);
      if (!current.ok) throw new Error("unable to read active image set");
      const etag = current.response.headers.get("ETag");
      if (etag === null) throw new Error("missing active image set ETag");
      const result = await adminApi.withdrawImage({
        assetId: input.assetId,
        body: {
          expectedActiveContentVersion: input.activeContentVersion,
          reason: `维护者从 ${input.fortuneDate} 可视化后台单图下线。`,
        },
        contentVersion: input.activeContentVersion,
        csrfToken: input.csrfToken,
        etag,
        idempotencyKey: createIdempotencyKey(),
      });
      if (!result.ok) throw new Error("unable to withdraw published image");
      return {
        previewImage: selectedImageFromSet(input.imageSlot, result.data.dailyImageSet),
      };
    },
  };
}

export const adminDayImageAdapter = createAdminDayImageAdapter();
