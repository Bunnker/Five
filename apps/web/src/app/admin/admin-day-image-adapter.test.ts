import { afterEach, describe, expect, it, vi } from "vitest";

import { createAdminDayImageAdapter, type CorrectionSession } from "./admin-day-image-adapter";
import {
  adminApi,
  type AdminApiResult,
  type AdminImageAsset,
  type DayCorrectionImageSelectionResult,
  type DayCorrectionImageStatus,
  type DraftImageAssetResult,
} from "./admin-api";

const asset: AdminImageAsset = {
  aiLabelStatus: "pending",
  altText: "黑色通勤模特穿搭",
  assetId: "asset-candidate-b",
  declaredModel: "gpt-image-2",
  fileUrl: null,
  generatedAt: "2026-08-06T17:05:00+08:00",
  generationMethod: "codex",
  height: 1536,
  manualReview: null,
  mediaType: "image/png",
  promptVersion: "five-look-v1",
  reproductionReference: "job-correction-image-0001",
  reviewStatus: "pending",
  rightsRecordIds: [],
  rightsStatus: "pending",
  sha256: "a".repeat(64),
  sourceMaterialReferences: ["prompt:five-look-v1"],
  sourceType: "ai_generated",
  width: 1024,
};

const correction: CorrectionSession = {
  etag: '"correction:3|draft:7"',
  workingCopy: {
    applyMode: null,
    baselineActiveContentVersion: null,
    correctionId: "correction-20260806-0001",
    correctionRevision: 3,
    createdAt: "2026-08-06T17:00:00+08:00",
    draftId: "draft-correction-20260806-0001",
    draftRevision: 7,
    fortuneDate: "2026-08-06",
    modules: {
      calendar_algorithm: null,
      copy_and_formula: null,
      poster_consistency: null,
      visual_and_rights: null,
    },
    sourceContentVersion: null,
    status: "open",
    submittedContentVersion: null,
    updatedAt: "2026-08-06T17:00:00+08:00",
  },
};

const csrfToken = "csrf-token-that-is-longer-than-thirty-two-characters";

function success<T>(data: T, etag: string): AdminApiResult<T> {
  return {
    data,
    ok: true,
    response: new Response(null, { headers: { ETag: etag } }),
  };
}

function status(
  jobStatus: "completed" | "queued",
  candidate: DraftImageAssetResult | null,
): DayCorrectionImageStatus {
  return {
    candidate,
    correctionRevision: 3,
    draftRevision: candidate === null ? 7 : 8,
    job: {
      actorId: "maintainer",
      attemptLimit: 3,
      attempts: candidate === null ? 0 : 1,
      availableAt: "2026-08-06T17:05:00+08:00",
      completedAssetId: candidate?.asset.assetId ?? null,
      correctionId: correction.workingCopy.correctionId,
      draftId: correction.workingCopy.draftId,
      fortuneDate: correction.workingCopy.fortuneDate,
      generationRevision: 1,
      imageSlot: "required_primary",
      jobId: "job-correction-image-0001",
      lastError: null,
      promptVersion: "five-look-v1",
      reason: "重新生成主图",
      requestId: "request-correction-image-0001",
      requestedAt: "2026-08-06T17:05:00+08:00",
      status: jobStatus,
    },
  };
}

describe("admin day image adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("polls a 202 regeneration to a visible candidate without selecting it", async () => {
    const candidate: DraftImageAssetResult = {
      asset,
      draftId: correction.workingCopy.draftId,
      draftRevision: 8,
      fortuneDate: correction.workingCopy.fortuneDate,
      imageSlot: "required_primary",
      previewUrl: "/admin/api/v1/image-assets/asset-candidate-b/preview",
      reviewLocked: false,
      selectedForSlot: false,
    };
    vi.spyOn(adminApi, "regenerateDayCorrectionImage").mockResolvedValue(
      success(status("queued", null), '"correction:3|draft:7"'),
    );
    vi.spyOn(adminApi, "getDayCorrectionImageStatus").mockResolvedValue(
      success(status("completed", candidate), '"correction:3|draft:8"'),
    );
    const select = vi.spyOn(adminApi, "selectDayCorrectionImageCandidate");
    const adapter = createAdminDayImageAdapter({
      maxPolls: 2,
      pollIntervalMs: 0,
      wait: async () => undefined,
    });

    const result = await adapter.regenerate({
      correction,
      csrfToken,
      imageSlot: "required_primary",
    });

    expect(result.choices).toEqual([
      {
        asset,
        imageSlot: "required_primary",
        previewUrl: candidate.previewUrl,
        selectedForSlot: false,
      },
    ]);
    expect(result.correction.etag).toBe('"correction:3|draft:8"');
    expect(select).not.toHaveBeenCalled();
  });

  it("passes the asset explicitly chosen by the maintainer and returns the authoritative selection", async () => {
    const workingCopy = {
      ...correction.workingCopy,
      correctionRevision: 4,
      draftRevision: 8,
    };
    const selection: DayCorrectionImageSelectionResult = {
      assetId: asset.assetId,
      correctionRevision: 4,
      draftRevision: 8,
      previewUrl: "/admin/api/v1/image-assets/asset-candidate-b/preview",
      workingCopy,
    };
    const select = vi
      .spyOn(adminApi, "selectDayCorrectionImageCandidate")
      .mockResolvedValue(success(selection, '"correction:4|draft:8"'));
    vi.spyOn(adminApi, "listDraftImages").mockResolvedValue(
      success(
        {
          draftId: workingCopy.draftId,
          draftRevision: 8,
          fortuneDate: workingCopy.fortuneDate,
          items: [
            {
              asset,
              imageSlot: "required_primary",
              previewUrl: selection.previewUrl,
              reviewLocked: false,
              selectedForSlot: true,
            },
          ],
        },
        '"draft:8"',
      ),
    );
    const adapter = createAdminDayImageAdapter();

    const result = await adapter.selectCandidate({
      assetId: asset.assetId,
      correction,
      csrfToken,
      imageSlot: "required_primary",
    });

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ assetId: asset.assetId }));
    expect(result.correction).toEqual({
      etag: '"correction:4|draft:8"',
      workingCopy,
    });
    expect(result.selectedImage.asset.assetId).toBe(asset.assetId);
  });
});
