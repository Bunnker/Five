import { describe, expect, it, vi } from "vitest";

import type { components } from "@five/api-contract";

import type { OpenDayCorrectionResult } from "./day-correction.workflow";
import { InMemoryDayCorrectionImageActionIdempotencyStore } from "./day-correction-image-action-idempotency.store";
import {
  type CorrectionImageAssetPort,
  type CorrectionImageGenerationQueue,
  type CorrectionImageLibrary,
  type CorrectionImageWorkingCopyPort,
  DayCorrectionImageWorkflow,
} from "./day-correction-image.workflow";

type DailyImageSlot = components["schemas"]["DailyImageSlot"];

const metadata = {
  aiLabelStatus: "not_applicable",
  altText: "白色与蓝色通勤穿搭",
  declaredModel: null,
  generatedAt: null,
  generationMethod: "owned_upload",
  promptVersion: null,
  reproductionReference: null,
  rightsRecordIds: ["rights-reusable"],
  sourceMaterialReferences: ["source-reusable"],
  sourceType: "licensed",
} as const satisfies components["schemas"]["ImageAssetUploadMetadata"];

function assetResult(input: {
  readonly assetId: string;
  readonly draftRevision: number;
  readonly imageSlot: DailyImageSlot;
}) {
  return {
    asset: {
      ...metadata,
      assetId: input.assetId,
      fileUrl: null,
      height: 1200,
      manualReview: null,
      mediaType: "image/png",
      reviewStatus: "pending",
      rightsStatus: "pending",
      sha256: "a".repeat(64),
      width: 900,
    },
    draftId: "draft-correction",
    draftRevision: input.draftRevision,
    fortuneDate: "2026-08-08",
    imageSlot: input.imageSlot,
    previewUrl: `/admin/api/v1/image-assets/${input.assetId}/preview`,
    reviewLocked: false,
    selectedForSlot: true,
  } as const;
}

function readyWorkingCopy(input?: {
  readonly coverAssetId?: string;
  readonly draftRevision?: number;
}): Extract<OpenDayCorrectionResult, { readonly kind: "ready" }> {
  return {
    correction: {
      appliedAction: null,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      baselineActiveContentVersion: "content-live",
      baselineLifecycleRevision: 3,
      correctionId: "correction-images",
      correctionRevision: 1,
      createdAt: "2026-08-06T08:00:00.000Z",
      draftId: "draft-correction",
      fortuneDate: "2026-08-08",
      scheduledEffectiveFrom: null,
      sourceContentVersion: "content-live",
      status: "open",
      submittedContentVersion: null,
      submittedLifecycleRevision: null,
      updatedAt: "2026-08-06T08:00:00.000Z",
    },
    draft: {
      createdAt: "2026-08-06T08:00:00.000Z",
      draftId: "draft-correction",
      draftRevision: input?.draftRevision ?? 7,
      fortuneDate: "2026-08-08",
      modules: {
        calendar_algorithm: null,
        copy_and_formula: null,
        poster_consistency: null,
        visual_and_rights: {
          assetManifestVersion: "test-v1",
          assets: [],
          looks: [
            {
              alternatives: [],
              audience: { code: "all", label: "通用" },
              coverAssetId: input?.coverAssetId ?? "asset-old",
              detailAssetIds: [],
              fallbackAssetId: "asset-fallback",
              formulaId: "formula-primary",
              imageSlot: "required_primary",
              items: [],
              lookId: "look-primary",
              requiredForPublish: true,
              scenario: { code: "commute", label: "通勤" },
              sortOrder: 1,
              title: "主方案",
            },
          ],
          rightsRecords: [],
        },
      },
      state: "draft",
      updatedAt: "2026-08-06T08:00:00.000Z",
    },
    kind: "ready",
  };
}

function dependencies(initial: OpenDayCorrectionResult = readyWorkingCopy()) {
  const actionIdempotency = new InMemoryDayCorrectionImageActionIdempotencyStore();
  const corrections = {
    getWorkingCopy: vi.fn().mockResolvedValue(initial),
    patch: vi.fn().mockImplementation(async (input) => ({
      correctionId: input.correctionId,
      correctionRevision: input.expectedRevision.correctionRevision,
      draftRevision: input.expectedRevision.draftRevision + 1,
      fortuneDate: "2026-08-08",
      kind: "updated",
      moduleCode: "visual_and_rights",
    })),
  } satisfies CorrectionImageWorkingCopyPort;
  const assets = {
    selectDraftAssetForSlot: vi.fn().mockResolvedValue({
      kind: "selected",
      result: assetResult({
        assetId: "asset-generated",
        draftRevision: 8,
        imageSlot: "required_primary",
      }),
    }),
    uploadDraftAsset: vi.fn().mockResolvedValue({
      kind: "uploaded",
      result: assetResult({
        assetId: "asset-uploaded",
        draftRevision: 8,
        imageSlot: "required_primary",
      }),
    }),
  } satisfies CorrectionImageAssetPort;
  const generations = {
    requestGeneration: vi.fn().mockResolvedValue({
      kind: "requested",
      view: {
        job: {
          attempts: 0,
          attemptLimit: 3,
          availableAt: "2026-08-06T08:00:00.000Z",
          completedAssetId: null,
          correctionId: "correction-images",
          draftId: "draft-correction",
          fortuneDate: "2026-08-08",
          generationRevision: 1,
          imageSlot: "required_primary",
          jobId: "correction-image-job-1",
          lastError: null,
          promptVersion: "five-outfit-model-v1",
          status: "queued",
        },
        revision: { correctionRevision: 1, draftRevision: 7 },
      },
    }),
  } satisfies CorrectionImageGenerationQueue;
  const library = {
    copyEligibleToDraft: vi.fn().mockResolvedValue({
      correctionRevision: 1,
      kind: "copied",
      result: assetResult({
        assetId: "asset-library",
        draftRevision: 8,
        imageSlot: "required_primary",
      }),
    }),
    listEligible: vi.fn().mockResolvedValue([
      {
        assetId: "asset-library",
        colorCodes: ["white", "blue"],
        imageSlot: "required_primary",
        previewUrl: "/admin/api/v1/image-assets/asset-library/preview",
        sourceContentVersion: "content-safe-source",
        sourceFortuneDate: "2026-08-01",
      },
    ]),
  } satisfies CorrectionImageLibrary;
  return { actionIdempotency, assets, corrections, generations, library };
}

const common = {
  actorId: "admin-one",
  correctionId: "correction-images",
  expectedRevision: { correctionRevision: 1, draftRevision: 7 },
  idempotencyKey: "correction-image-action-0001",
  imageSlot: "required_primary" as const,
  reason: "替换不合适的模特图",
  requestId: "request-correction-image-0001",
};

describe("DayCorrectionImageWorkflow", () => {
  it("queues regeneration against only the correction draft and does not select or publish", async () => {
    const deps = dependencies();
    const workflow = new DayCorrectionImageWorkflow(
      deps.corrections,
      deps.assets,
      deps.generations,
      deps.library,
      deps.actionIdempotency,
    );

    await expect(workflow.requestRegeneration(common)).resolves.toEqual({
      kind: "requested",
      view: {
        job: expect.objectContaining({
          draftId: "draft-correction",
          imageSlot: "required_primary",
          jobId: "correction-image-job-1",
          status: "queued",
        }),
        revision: { correctionRevision: 1, draftRevision: 7 },
      },
    });
    expect(deps.generations.requestGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        correctionId: "correction-images",
        expectedRevision: { correctionRevision: 1, draftRevision: 7 },
      }),
    );
    expect(deps.assets.selectDraftAssetForSlot).not.toHaveBeenCalled();
    expect(deps.corrections.getWorkingCopy).not.toHaveBeenCalled();
    expect(deps.corrections.patch).not.toHaveBeenCalled();
  });

  it("lets the queue replay an existing regeneration after its candidate advanced the draft ETag", async () => {
    const deps = dependencies(readyWorkingCopy({ draftRevision: 8 }));
    deps.generations.requestGeneration.mockResolvedValue({
      kind: "existing",
      view: {
        job: {
          attempts: 1,
          attemptLimit: 3,
          availableAt: "2026-08-06T08:00:00.000Z",
          completedAssetId: "asset-generated",
          correctionId: "correction-images",
          draftId: "draft-correction",
          fortuneDate: "2026-08-08",
          generationRevision: 1,
          imageSlot: "required_primary",
          jobId: "correction-image-job-1",
          lastError: null,
          promptVersion: "five-outfit-model-v1",
          status: "completed",
        },
        revision: { correctionRevision: 1, draftRevision: 7 },
      },
    });
    const workflow = new DayCorrectionImageWorkflow(
      deps.corrections,
      deps.assets,
      deps.generations,
      deps.library,
      deps.actionIdempotency,
    );

    await expect(workflow.requestRegeneration(common)).resolves.toMatchObject({
      kind: "existing",
      view: { job: { jobId: "correction-image-job-1", status: "completed" } },
    });
    expect(deps.generations.requestGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: { correctionRevision: 1, draftRevision: 7 },
      }),
    );
    expect(deps.corrections.getWorkingCopy).not.toHaveBeenCalled();
  });

  it("does not let a late generated candidate overwrite a later manual selection", async () => {
    const deps = dependencies();
    deps.corrections.getWorkingCopy
      .mockResolvedValueOnce(readyWorkingCopy({ draftRevision: 7 }))
      .mockResolvedValueOnce(
        readyWorkingCopy({ coverAssetId: "asset-manual-newer", draftRevision: 9 }),
      );
    const workflow = new DayCorrectionImageWorkflow(
      deps.corrections,
      deps.assets,
      deps.generations,
      deps.library,
      deps.actionIdempotency,
    );

    await expect(
      workflow.selectDraftCandidate({ ...common, assetId: "asset-generated" }),
    ).resolves.toEqual({
      assetId: "asset-generated",
      currentRevision: { correctionRevision: 1, draftRevision: 9 },
      kind: "candidate_ready",
    });
    expect(deps.corrections.patch).not.toHaveBeenCalled();
  });

  it("replays a successful candidate replacement before observing an applied correction", async () => {
    const deps = dependencies();
    deps.corrections.getWorkingCopy
      .mockResolvedValueOnce(readyWorkingCopy({ draftRevision: 7 }))
      .mockResolvedValueOnce(readyWorkingCopy({ draftRevision: 8 }));
    const workflow = new DayCorrectionImageWorkflow(
      deps.corrections,
      deps.assets,
      deps.generations,
      deps.library,
      deps.actionIdempotency,
    );
    const input = { ...common, assetId: "asset-generated" };
    const replaced = {
      assetId: "asset-generated",
      correctionRevision: 1,
      draftRevision: 9,
      kind: "replaced",
      previewUrl: "/admin/api/v1/image-assets/asset-generated/preview",
    } as const;

    await expect(workflow.selectDraftCandidate(input)).resolves.toEqual(replaced);
    deps.corrections.getWorkingCopy.mockReset().mockResolvedValue({
      ...readyWorkingCopy({ coverAssetId: "asset-generated", draftRevision: 9 }),
      correction: {
        ...readyWorkingCopy().correction,
        status: "applied",
      },
    });
    await expect(
      workflow.selectDraftCandidate({ ...input, requestId: "request-candidate-response-lost" }),
    ).resolves.toEqual(replaced);
    await expect(
      workflow.selectDraftCandidate({
        ...input,
        reason: "同一个候选幂等键不能表达另一项选择。",
        requestId: "request-candidate-different-intent",
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    expect(deps.corrections.getWorkingCopy).not.toHaveBeenCalled();
  });

  it("persists a current-cover no-op before returning it", async () => {
    const deps = dependencies(
      readyWorkingCopy({ coverAssetId: "asset-generated", draftRevision: 7 }),
    );
    const workflow = new DayCorrectionImageWorkflow(
      deps.corrections,
      deps.assets,
      deps.generations,
      deps.library,
      deps.actionIdempotency,
    );
    const input = { ...common, assetId: "asset-generated" };

    await expect(workflow.selectDraftCandidate(input)).resolves.toMatchObject({
      assetId: "asset-generated",
      kind: "existing",
    });
    await expect(
      workflow.selectDraftCandidate({
        ...input,
        reason: "同键但不同当前封面意图。",
        requestId: "request-current-cover-different-intent",
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
  });

  it("atomically copies an eligible library image and replaces the cover without a second patch", async () => {
    const deps = dependencies();
    deps.library.copyEligibleToDraft
      .mockResolvedValueOnce({
        correctionRevision: 1,
        kind: "copied",
        result: assetResult({
          assetId: "asset-library",
          draftRevision: 8,
          imageSlot: "required_primary",
        }),
      })
      .mockResolvedValueOnce({
        correctionRevision: 1,
        kind: "existing",
        result: assetResult({
          assetId: "asset-library",
          draftRevision: 8,
          imageSlot: "required_primary",
        }),
      })
      .mockResolvedValueOnce({ kind: "idempotency_conflict" });
    const workflow = new DayCorrectionImageWorkflow(
      deps.corrections,
      deps.assets,
      deps.generations,
      deps.library,
      deps.actionIdempotency,
    );

    await expect(
      workflow.selectReusable({
        ...common,
        assetId: "asset-library",
        sourceContentVersion: "content-safe-source",
      }),
    ).resolves.toEqual({
      assetId: "asset-library",
      correctionRevision: 1,
      draftRevision: 8,
      kind: "replaced",
      previewUrl: "/admin/api/v1/image-assets/asset-library/preview",
    });
    expect(deps.library.copyEligibleToDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceContentVersion: "content-safe-source",
      }),
    );
    deps.corrections.getWorkingCopy.mockResolvedValue({
      ...readyWorkingCopy({ coverAssetId: "asset-library", draftRevision: 8 }),
      correction: { ...readyWorkingCopy().correction, status: "applied" },
    });
    await expect(
      workflow.selectReusable({
        ...common,
        assetId: "asset-library",
        requestId: "request-library-response-lost",
        sourceContentVersion: "content-safe-source",
      }),
    ).resolves.toMatchObject({ assetId: "asset-library", kind: "existing" });
    await expect(
      workflow.selectReusable({
        ...common,
        assetId: "asset-library",
        reason: "同一搭配库幂等键不能改原因。",
        requestId: "request-library-different-intent",
        sourceContentVersion: "content-safe-source",
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    expect(deps.corrections.getWorkingCopy).not.toHaveBeenCalled();
    expect(deps.corrections.patch).not.toHaveBeenCalled();
  });

  it("uploads, binds and replaces a manual image without exposing any release operation", async () => {
    const deps = dependencies();
    deps.corrections.getWorkingCopy
      .mockResolvedValueOnce(readyWorkingCopy({ draftRevision: 7 }))
      .mockResolvedValueOnce(readyWorkingCopy({ draftRevision: 8 }));
    const workflow = new DayCorrectionImageWorkflow(
      deps.corrections,
      deps.assets,
      deps.generations,
      deps.library,
      deps.actionIdempotency,
    );

    await expect(
      workflow.uploadAndSelect({
        ...common,
        bytes: Buffer.from("fixture-image"),
        declaredMediaType: "image/png",
        metadata,
      }),
    ).resolves.toEqual({
      assetId: "asset-uploaded",
      correctionRevision: 1,
      draftRevision: 9,
      kind: "replaced",
      previewUrl: "/admin/api/v1/image-assets/asset-uploaded/preview",
    });
    expect(deps.assets.uploadDraftAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: "draft-correction",
        imageSlot: "required_primary",
        reason: "替换不合适的模特图",
        selectForSlot: true,
      }),
    );
    expect(deps.corrections.patch).toHaveBeenCalledTimes(1);
    expect("apply" in workflow).toBe(false);
  });

  it("replays a successful upload before observing an applied correction", async () => {
    const deps = dependencies();
    deps.corrections.getWorkingCopy
      .mockResolvedValueOnce(readyWorkingCopy({ draftRevision: 7 }))
      .mockResolvedValueOnce(readyWorkingCopy({ draftRevision: 8 }));
    const workflow = new DayCorrectionImageWorkflow(
      deps.corrections,
      deps.assets,
      deps.generations,
      deps.library,
      deps.actionIdempotency,
    );
    const input = {
      ...common,
      bytes: Buffer.from("fixture-image"),
      declaredMediaType: "image/png",
      metadata,
    };
    const replaced = {
      assetId: "asset-uploaded",
      correctionRevision: 1,
      draftRevision: 9,
      kind: "replaced",
      previewUrl: "/admin/api/v1/image-assets/asset-uploaded/preview",
    } as const;

    await expect(workflow.uploadAndSelect(input)).resolves.toEqual(replaced);
    deps.corrections.getWorkingCopy.mockReset().mockResolvedValue({
      ...readyWorkingCopy({ coverAssetId: "asset-uploaded", draftRevision: 9 }),
      correction: { ...readyWorkingCopy().correction, status: "applied" },
    });
    await expect(
      workflow.uploadAndSelect({ ...input, requestId: "request-upload-response-lost" }),
    ).resolves.toEqual(replaced);
    await expect(
      workflow.uploadAndSelect({
        ...input,
        reason: "同一上传幂等键不能改原因。",
        requestId: "request-upload-different-intent",
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    expect(deps.corrections.getWorkingCopy).not.toHaveBeenCalled();
  });

  it("lists only what the safety-filtering library adapter returns", async () => {
    const deps = dependencies();
    const workflow = new DayCorrectionImageWorkflow(
      deps.corrections,
      deps.assets,
      deps.generations,
      deps.library,
      deps.actionIdempotency,
    );

    await expect(
      workflow.listReusable({
        correctionId: "correction-images",
        imageSlot: "required_primary",
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ assetId: "asset-library" })],
      kind: "ready",
    });
    expect(deps.library.listEligible).toHaveBeenCalledWith({
      draftId: "draft-correction",
      imageSlot: "required_primary",
      limit: 24,
    });
  });
});
