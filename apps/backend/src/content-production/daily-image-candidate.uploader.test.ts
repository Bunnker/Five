import { describe, expect, it, vi } from "vitest";

import type { DailyImageAssetService } from "../daily-images/daily-image-asset.service";
import { DailyImageCandidateUploader } from "./daily-image-candidate.uploader";

describe("DailyImageCandidateUploader", () => {
  it("recovers an already uploaded candidate after a worker crash without uploading again", async () => {
    const listDraftAssets = vi.fn().mockResolvedValue({
      draftId: "draft-automatic-0001",
      draftRevision: 2,
      fortuneDate: "2026-08-03",
      items: [
        {
          asset: {
            assetId: "asset-automatic-0001",
            sha256: "a".repeat(64),
            sourceMaterialReferences: ["production-job-image-job-automatic-0001"],
          },
          imageSlot: "required_primary",
          previewUrl: "/preview",
          reviewLocked: false,
        },
      ],
    });
    const uploadDraftAsset = vi.fn();
    const uploader = new DailyImageCandidateUploader({
      listDraftAssets,
      uploadDraftAsset,
    } as unknown as DailyImageAssetService);

    await expect(
      uploader.upload({
        bytes: Buffer.from("already-uploaded"),
        declaredMediaType: "image/png",
        draftId: "draft-automatic-0001",
        expectedDraftRevision: 1,
        fortuneDate: "2026-08-03",
        imageSlot: "required_primary",
        jobId: "image-job-automatic-0001",
        model: "gpt-image-2",
        prompt: "test prompt",
        promptVersion: "five-look-v1",
        reproductionReference: "request-automatic-0001",
      }),
    ).resolves.toEqual({
      assetId: "asset-automatic-0001",
      draftRevision: 2,
      sha256: "a".repeat(64),
    });
    expect(uploadDraftAsset).not.toHaveBeenCalled();
  });

  it("persists the generated candidate's named image slot", async () => {
    const uploadDraftAsset = vi.fn().mockResolvedValue({
      kind: "uploaded",
      result: {
        asset: { assetId: "asset-required-alternative", sha256: "b".repeat(64) },
        draftRevision: 2,
      },
    });
    const uploader = new DailyImageCandidateUploader({
      listDraftAssets: vi.fn().mockResolvedValue({
        draftId: "draft-automatic-0002",
        draftRevision: 1,
        fortuneDate: "2026-08-03",
        items: [],
      }),
      uploadDraftAsset,
    } as unknown as DailyImageAssetService);

    await uploader.upload({
      bytes: Buffer.from("generated"),
      declaredMediaType: "image/png",
      draftId: "draft-automatic-0002",
      expectedDraftRevision: 1,
      fortuneDate: "2026-08-03",
      imageSlot: "required_alternative",
      jobId: "image-job-automatic-0002",
      model: "test-image-generator",
      prompt: "test prompt",
      promptVersion: "five-look-v1",
      reproductionReference: "fake-request-automatic-0002",
    });

    expect(uploadDraftAsset).toHaveBeenCalledWith(
      expect.objectContaining({ imageSlot: "required_alternative" }),
    );
  });

  it("does not treat a historical null slot as the requested named candidate", async () => {
    const uploadDraftAsset = vi.fn().mockResolvedValue({
      kind: "uploaded",
      result: {
        asset: { assetId: "asset-new-primary", sha256: "c".repeat(64) },
        draftRevision: 3,
      },
    });
    const uploader = new DailyImageCandidateUploader({
      listDraftAssets: vi.fn().mockResolvedValue({
        draftId: "draft-automatic-legacy",
        draftRevision: 2,
        fortuneDate: "2026-08-03",
        items: [
          {
            asset: {
              assetId: "asset-legacy-null-slot",
              sourceMaterialReferences: ["production-job-image-job-automatic-legacy"],
            },
            imageSlot: null,
            previewUrl: "/preview",
            reviewLocked: false,
          },
        ],
      }),
      uploadDraftAsset,
    } as unknown as DailyImageAssetService);

    await uploader.upload({
      bytes: Buffer.from("generated"),
      declaredMediaType: "image/png",
      draftId: "draft-automatic-legacy",
      expectedDraftRevision: 2,
      fortuneDate: "2026-08-03",
      imageSlot: "required_primary",
      jobId: "image-job-automatic-legacy",
      model: "test-image-generator",
      prompt: "test prompt",
      promptVersion: "five-look-v1",
      reproductionReference: "fake-request-automatic-legacy",
    });

    expect(uploadDraftAsset).toHaveBeenCalledWith(
      expect.objectContaining({ imageSlot: "required_primary" }),
    );
  });
});
