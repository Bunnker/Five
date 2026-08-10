import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { isAdminDailyImageSet } from "@five/api-contract/runtime";

import { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import { InMemoryContentLifecycleStore } from "../content-lifecycle/in-memory-content-lifecycle.store";
import { StructuredDailyContentGenerator } from "../content-production/structured-daily-content.generator";
import { DailyImageAssetService } from "./daily-image-asset.service";
import type { StoredDailyImageSet } from "./daily-image-asset.store";
import type { BinaryImageAssetStore } from "./local-binary-image-asset.store";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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

class MemoryBinaryStore implements BinaryImageAssetStore {
  readonly bytes = new Map<string, Buffer>();
  putCalls = 0;

  async put(input: {
    readonly bytes: Buffer;
    readonly extension: "avif" | "jpg" | "png" | "webp";
    readonly sha256: string;
  }): Promise<{ storageKey: string }> {
    this.putCalls += 1;
    const storageKey = `${input.sha256.slice(0, 2)}/${input.sha256}.${input.extension}`;
    this.bytes.set(storageKey, Buffer.from(input.bytes));
    return { storageKey };
  }

  async read(storageKey: string): Promise<Buffer | null> {
    return this.bytes.get(storageKey) ?? null;
  }
}

function services() {
  const store = new InMemoryContentLifecycleStore();
  const binary = new MemoryBinaryStore();
  let asset = 0;
  let review = 0;
  let audit = 0;
  let purge = 0;
  const lifecycle = new ContentLifecycleService(store, {
    now: () => new Date("2026-08-02T06:00:00Z"),
  });
  const images = new DailyImageAssetService(
    store,
    binary,
    { now: () => new Date("2026-08-02T06:05:00Z") },
    {
      nextAssetId: () => `asset-${++asset}`,
      nextAuditEventId: () => `image-audit-${++audit}`,
      nextCachePurgeIntentId: () => `image-purge-${++purge}`,
      nextReviewId: () => `image-review-${++review}`,
      nextWithdrawalEventId: () => `withdrawal-${++review}`,
    },
    "https://assets.example.test/daily-images/",
  );
  return { binary, images, lifecycle, store };
}

const metadata = {
  aiLabelStatus: "not_applicable" as const,
  altText: "黑色通勤搭配",
  declaredModel: null,
  generatedAt: null,
  generationMethod: "licensed_upload" as const,
  promptVersion: null,
  reproductionReference: null,
  rightsRecordIds: ["rights-1"],
  sourceMaterialReferences: ["license:record-1"],
  sourceType: "licensed" as const,
};

const passedReview = {
  aiLabelCompliance: "passed" as const,
  aiLabelStatus: "not_applicable" as const,
  colorAndCopyConsistency: "passed" as const,
  decision: "approved" as const,
  garmentAndPersonIntegrity: "passed" as const,
  mobileAndWechatPreview: "passed" as const,
  notes: "手机与微信预览均通过。",
  rightsAndIdentityRisk: "passed" as const,
  rightsStatus: "cleared" as const,
  scenarioAndImitability: "passed" as const,
};

function safeAsset(assetId: string) {
  return {
    ...metadata,
    assetId,
    fileUrl: `https://assets.example.test/${assetId}.png`,
    height: 1,
    manualReview: {
      aiLabelCompliance: "passed" as const,
      colorAndCopyConsistency: "passed" as const,
      garmentAndPersonIntegrity: "passed" as const,
      mobileAndWechatPreview: "passed" as const,
      notes: "passed",
      reviewId: `review-${assetId}`,
      reviewedAt: "2026-08-02T06:05:00.000Z",
      reviewerAccountId: "operator-1",
      rightsAndIdentityRisk: "passed" as const,
      scenarioAndImitability: "passed" as const,
    },
    mediaType: "image/png" as const,
    reviewStatus: "approved" as const,
    rightsStatus: "cleared" as const,
    sha256: assetId.slice(-1).repeat(64),
    width: 1,
  };
}

function publicationCandidateAsset(assetId: string) {
  return {
    ...safeAsset(assetId),
    aiLabelStatus: "pending" as const,
    declaredModel: "gpt-image-2",
    fileUrl: null,
    generatedAt: "2026-08-02T06:00:00.000Z",
    generationMethod: "external_tool" as const,
    manualReview: null,
    promptVersion: "five-look-v1",
    reproductionReference: `request-${assetId}`,
    reviewStatus: "pending" as const,
    rightsStatus: "pending" as const,
    sourceType: "ai_generated" as const,
  };
}

function requiredImageSet(contentVersion: string): StoredDailyImageSet {
  return {
    assets: [
      safeAsset("asset-1"),
      safeAsset("asset-2"),
      safeAsset("asset-3"),
      safeAsset("asset-4"),
    ],
    contentVersion,
    fortuneDate: "2026-08-04",
    lifecycleRevision: 1,
    slots: [
      {
        coverAssetId: "asset-1",
        deliveryStatus: "active",
        detailAssetIds: [],
        fallbackAssetId: "asset-3",
        imageSlot: "required_primary",
        lookId: "look-1",
        servedCoverAssetId: "asset-1",
        servedDetailAssetIds: [],
      },
      {
        coverAssetId: "asset-2",
        deliveryStatus: "active",
        detailAssetIds: [],
        fallbackAssetId: "asset-4",
        imageSlot: "required_alternative",
        lookId: "look-2",
        servedCoverAssetId: "asset-2",
        servedDetailAssetIds: [],
      },
    ],
    withdrawalEvents: [],
  };
}

describe("DailyImageAssetService draft candidate seam", () => {
  it("keeps the first correction image pending and materializes the canonical visual after 2/2", async () => {
    const { images, lifecycle, store } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-correction-image-draft",
    });
    if (created.kind !== "created") throw new Error("correction draft fixture was not created");
    const modules = new StructuredDailyContentGenerator().generate(created.draft.fortuneDate);
    await store.transaction((transaction) =>
      transaction.updateDraft({
        draft: { ...created.draft, modules },
        submittedContentVersion: null,
      }),
    );

    const primary = await images.uploadDraftAsset({
      actorId: "operator-1",
      bytes: PNG,
      declaredMediaType: "image/png",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "correction-primary-upload-0001",
      imageSlot: "required_primary",
      materializeImmediateVisual: true,
      metadata,
      reason: "补齐主图。",
      requestId: "request-correction-primary-upload",
    });
    expect(primary).toMatchObject({ kind: "uploaded", result: { draftRevision: 2 } });
    expect((await lifecycle.getDraft(created.draft.draftId))?.modules.visual_and_rights).toBeNull();

    const alternative = await images.uploadDraftAsset({
      actorId: "operator-1",
      bytes: Buffer.concat([PNG, Buffer.from([0])]),
      declaredMediaType: "image/png",
      draftId: created.draft.draftId,
      expectedDraftRevision: 2,
      idempotencyKey: "correction-alternative-upload-0001",
      imageSlot: "required_alternative",
      materializeImmediateVisual: true,
      metadata: { ...metadata, altText: "白色通勤备选搭配", rightsRecordIds: ["rights-2"] },
      reason: "补齐备选图。",
      requestId: "request-correction-alternative-upload",
    });
    expect(alternative).toMatchObject({ kind: "uploaded", result: { draftRevision: 3 } });
    const ready = await lifecycle.getDraft(created.draft.draftId);
    expect(ready?.modules.visual_and_rights?.looks.map((look) => look.imageSlot)).toEqual([
      "required_primary",
      "required_alternative",
    ]);
    const draftClone = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      copyFromDraftId: created.draft.draftId,
      fortuneDate: created.draft.fortuneDate,
      requestId: "request-correction-production-draft-clone",
    });
    if (draftClone.kind !== "created") throw new Error("production draft clone was not created");
    expect(
      (await store.listDraftImageAssets(draftClone.draft.draftId)).map((item) => ({
        selected: item.selectedForSlot,
        slot: item.imageSlot,
        source: item.selectionSource,
      })),
    ).toEqual([
      {
        selected: true,
        slot: "required_primary",
        source: "correction_draft_copy",
      },
      {
        selected: true,
        slot: "required_alternative",
        source: "correction_draft_copy",
      },
    ]);

    const submitted = await lifecycle.submitCorrectionDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 3,
      idempotencyKey: "correction-submit-after-images-0001",
      requestId: "request-correction-submit-after-images",
    });
    expect(submitted).toMatchObject({ kind: "submitted", result: { state: "approved" } });
    if (submitted.kind !== "submitted") return;
    const versionClone = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: submitted.result.contentVersion,
      fortuneDate: created.draft.fortuneDate,
      requestId: "request-correction-version-clone",
    });
    if (versionClone.kind !== "created") throw new Error("version clone was not created");
    const versionSelections = await store.listDraftImageAssets(versionClone.draft.draftId);
    expect(versionSelections.map((item) => item.selectionSource)).toEqual([
      "version_copy",
      "version_copy",
    ]);
    expect(
      versionClone.draft.modules.visual_and_rights?.looks.map((look) => look.coverAssetId),
    ).toEqual(versionSelections.map((item) => item.asset.assetId));
  });

  it("uploads real bytes as a server-managed draft candidate and resumes it from the draft", async () => {
    const { images, lifecycle } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-image-draft",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;

    const uploaded = await images.uploadDraftAsset({
      actorId: "operator-1",
      bytes: PNG,
      declaredMediaType: "image/png",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "upload-image-intent-0001",
      imageSlot: "required_primary",
      metadata,
      requestId: "request-upload-image-1",
    });

    expect(uploaded).toMatchObject({
      kind: "uploaded",
      result: {
        draftRevision: 2,
        fortuneDate: "2026-08-03",
        imageSlot: "required_primary",
        previewUrl: "/admin/api/v1/image-assets/asset-1/preview",
        asset: {
          assetId: "asset-1",
          fileUrl: null,
          height: 1,
          mediaType: "image/png",
          reviewStatus: "pending",
          rightsStatus: "pending",
          width: 1,
        },
      },
    });
    const listed = await images.listDraftAssets(created.draft.draftId);
    expect(listed?.items).toEqual([
      expect.objectContaining({
        imageSlot: "required_primary",
        previewUrl: "/admin/api/v1/image-assets/asset-1/preview",
        asset: expect.objectContaining({ assetId: "asset-1" }),
      }),
    ]);
    expect((await lifecycle.getDraft(created.draft.draftId))?.modules.visual_and_rights).toBeNull();
  });

  it("requires a slot for every new upload while preserving null only for legacy replay", async () => {
    const { binary, images, lifecycle } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-reject-unassigned-upload",
    });
    if (created.kind !== "created") return;

    await expect(
      images.uploadDraftAsset({
        actorId: "operator-1",
        bytes: PNG,
        declaredMediaType: "image/png",
        draftId: created.draft.draftId,
        expectedDraftRevision: 1,
        idempotencyKey: "upload-unassigned-image-intent-0001",
        imageSlot: null,
        metadata,
        requestId: "request-upload-unassigned-image",
      }),
    ).resolves.toEqual({ kind: "invalid_metadata" });
    expect(binary.putCalls).toBe(0);
  });

  it("selects an optional manual upload explicitly and can switch a slot candidate with ETag revision", async () => {
    const { images, lifecycle } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-manual-slot-selection",
    });
    if (created.kind !== "created") return;
    const uploaded = await images.uploadDraftAsset({
      actorId: "operator-1",
      bytes: PNG,
      declaredMediaType: "image/png",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "upload-optional-image-intent-0001",
      imageSlot: "optional",
      metadata,
      requestId: "request-upload-optional-image",
    });
    expect(uploaded).toMatchObject({
      kind: "uploaded",
      result: { draftRevision: 2, imageSlot: "optional", selectedForSlot: true },
    });
    if (uploaded.kind !== "uploaded") return;

    const second = await images.uploadDraftAsset({
      actorId: "operator-1",
      bytes: PNG,
      declaredMediaType: "image/png",
      draftId: created.draft.draftId,
      expectedDraftRevision: 2,
      idempotencyKey: "upload-optional-history-intent-0002",
      imageSlot: "optional",
      metadata: { ...metadata, altText: "可选槽位第二候选" },
      requestId: "request-upload-optional-history",
      selectForSlot: false,
    });
    if (second.kind !== "uploaded") return;
    const selected = await images.selectDraftAssetForSlot({
      actorId: "operator-1",
      assetId: second.result.asset.assetId,
      draftId: created.draft.draftId,
      expectedDraftRevision: 3,
      idempotencyKey: "select-optional-image-intent-0001",
      imageSlot: "optional",
      reason: "切换到人工确认的可选候选。",
      requestId: "request-select-optional-image",
    });
    expect(selected).toMatchObject({
      kind: "selected",
      result: { draftRevision: 4, imageSlot: "optional", selectedForSlot: true },
    });
    const listed = await images.listDraftAssets(created.draft.draftId);
    expect(listed?.draftRevision).toBe(4);
    expect(
      listed?.items
        .filter(({ selectedForSlot }) => selectedForSlot)
        .map(({ asset }) => asset.assetId),
    ).toEqual([second.result.asset.assetId]);
  });

  it("advances the revision when explicitly freezing the same automatically selected asset", async () => {
    const { images, lifecycle, store } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-freeze-automatic-selection",
    });
    if (created.kind !== "created") return;
    const uploaded = await images.uploadDraftAsset({
      actorId: "system:image-worker",
      bytes: PNG,
      declaredMediaType: "image/png",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "upload-automatic-candidate-intent-0001",
      imageSlot: "required_primary",
      metadata,
      requestId: "request-upload-automatic-candidate",
      selectForSlot: false,
    });
    if (uploaded.kind !== "uploaded") return;
    await store.transaction(async (transaction) => {
      const candidate = await transaction.findDraftImageAssetForUpdate(
        created.draft.draftId,
        uploaded.result.asset.assetId,
      );
      if (candidate === null) throw new Error("automatic candidate fixture disappeared");
      await transaction.updateDraftImageAsset({
        ...candidate,
        selectedForSlot: true,
        selectionSource: "automatic_generation",
      });
    });

    const frozen = await images.selectDraftAssetForSlot({
      actorId: "operator-1",
      assetId: uploaded.result.asset.assetId,
      draftId: created.draft.draftId,
      expectedDraftRevision: 2,
      idempotencyKey: "freeze-automatic-selection-intent-0001",
      imageSlot: "required_primary",
      reason: "维护者确认保留当前自动生成图片。",
      requestId: "request-freeze-automatic-selection",
    });
    expect(frozen).toMatchObject({ kind: "selected", result: { draftRevision: 3 } });
    await expect(
      images.selectDraftAssetForSlot({
        actorId: "operator-1",
        assetId: uploaded.result.asset.assetId,
        draftId: created.draft.draftId,
        expectedDraftRevision: 3,
        idempotencyKey: "freeze-manual-selection-intent-0002",
        imageSlot: "required_primary",
        reason: "再次确认同一张人工选定图片。",
        requestId: "request-freeze-manual-selection",
      }),
    ).resolves.toMatchObject({ kind: "selected", result: { draftRevision: 3 } });
  });

  it("does not persist binary bytes when the draft revision is already stale", async () => {
    const { binary, images, lifecycle } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-stale-image-upload",
    });
    if (created.kind !== "created") return;

    await expect(
      images.uploadDraftAsset({
        actorId: "operator-1",
        bytes: PNG,
        declaredMediaType: "image/png",
        draftId: created.draft.draftId,
        expectedDraftRevision: 2,
        idempotencyKey: "upload-stale-image-intent-0001",
        imageSlot: "required_primary",
        metadata,
        requestId: "request-upload-stale-image",
      }),
    ).resolves.toEqual({ currentRevision: 1, kind: "revision_mismatch" });
    expect(binary.bytes.size).toBe(0);
    expect(binary.putCalls).toBe(0);
    await expect(
      images.uploadDraftAsset({
        actorId: "operator-1",
        bytes: PNG,
        declaredMediaType: "image/png",
        draftId: "draft-does-not-exist",
        expectedDraftRevision: 1,
        idempotencyKey: "upload-missing-image-intent-0001",
        imageSlot: "required_primary",
        metadata,
        requestId: "request-upload-missing-image",
      }),
    ).resolves.toEqual({ kind: "not_found" });
    expect(binary.putCalls).toBe(0);
  });

  it("returns candidates and draft revision from one committed view", async () => {
    const { images, lifecycle, store } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-consistent-image-list",
    });
    if (created.kind !== "created") return;
    let signalInserted: () => void = () => undefined;
    const inserted = new Promise<void>((resolve) => {
      signalInserted = resolve;
    });
    let releaseMutation: () => void = () => undefined;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const mutation = store.transaction(async (transaction) => {
      const draft = await transaction.findDraftForUpdate(created.draft.draftId);
      if (draft === null) throw new Error("draft missing");
      await transaction.insertDraftImageAsset({
        asset: {
          ...metadata,
          assetId: "asset-consistent",
          fileUrl: null,
          height: 1,
          manualReview: null,
          mediaType: "image/png",
          reviewStatus: "pending",
          rightsStatus: "pending",
          sha256: "c".repeat(64),
          width: 1,
        },
        draftId: created.draft.draftId,
        fortuneDate: created.draft.fortuneDate,
        imageSlot: null,
        reviewLocked: false,
        selectionSource: null,
        selectedForSlot: false,
        storageKey: `cc/${"c".repeat(64)}.png`,
        uploadedAt: "2026-08-02T06:05:00.000Z",
      });
      signalInserted();
      await mutationGate;
      await transaction.updateDraft({
        draft: { ...draft.draft, draftRevision: 2 },
        submittedContentVersion: null,
      });
    });
    await inserted;

    let resolved = false;
    const read = images.listDraftAssets(created.draft.draftId).then((result) => {
      resolved = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const resolvedBeforeCommit = resolved;
    releaseMutation();

    const [view] = await Promise.all([read, mutation]);
    expect(resolvedBeforeCommit).toBe(false);
    expect(view).toMatchObject({
      draftRevision: 2,
      items: [{ asset: { assetId: "asset-consistent" } }],
    });
  });

  it("atomically falls a published required cover back and returns the same result on retry", async () => {
    const { images, lifecycle, store } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-withdrawal",
    });
    if (created.kind !== "created") return;
    const submitted = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-image-withdrawal-0001",
      requestId: "request-submit-withdrawal",
    });
    if (submitted.kind !== "submitted") return;
    const imageSet = requiredImageSet(submitted.result.contentVersion);
    store.seedDailyImageSetForTest(imageSet);
    store.publishVersionForTest(submitted.result.contentVersion);
    const input = {
      actorId: "operator-1",
      assetId: "asset-1",
      contentVersion: submitted.result.contentVersion,
      expectedActiveContentVersion: submitted.result.contentVersion,
      expectedLifecycleRevision: 1,
      idempotencyKey: "withdraw-image-intent-0001",
      reason: "版权材料被撤销。",
      requestId: "request-withdraw-image",
    } as const;

    const concurrent = await Promise.all([
      images.withdrawVersionAsset(input),
      images.withdrawVersionAsset({ ...input, requestId: "request-withdraw-retry" }),
    ]);

    expect(concurrent.map((result) => result.kind).sort()).toEqual(["existing", "withdrawn"]);
    const applied = concurrent.find((result) => result.kind === "withdrawn");
    expect(applied).toMatchObject({
      kind: "withdrawn",
      result: {
        assetId: "asset-1",
        deliveryAction: "fallback_activated",
        lifecycleRevision: 2,
        dailyImageSet: {
          lifecycleRevision: 2,
          slots: [
            expect.objectContaining({
              deliveryStatus: "fallback",
              servedCoverAssetId: "asset-3",
            }),
            expect.objectContaining({ deliveryStatus: "active" }),
          ],
        },
      },
    });
    expect(
      isAdminDailyImageSet(applied?.kind === "withdrawn" ? applied.result.dailyImageSet : null),
    ).toBe(true);
    expect(store.readCachePurgeIntentsForTest()).toHaveLength(1);
    await expect(
      images.withdrawVersionAsset({ ...input, reason: "different payload" }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
  });

  it("withdraws one pending automatic cover by activating the other publication candidate", async () => {
    const { images, lifecycle, store } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-pending-withdrawal",
    });
    if (created.kind !== "created") throw new Error("pending withdrawal draft was not created");
    const submitted = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-pending-withdrawal-0001",
      requestId: "request-submit-pending-withdrawal",
    });
    if (submitted.kind !== "submitted") throw new Error("pending withdrawal draft was not frozen");
    const primary = publicationCandidateAsset("asset-pending-1");
    const alternative = publicationCandidateAsset("asset-pending-2");
    store.seedDailyImageSetForTest({
      assets: [primary, alternative],
      contentVersion: submitted.result.contentVersion,
      fortuneDate: created.draft.fortuneDate,
      lifecycleRevision: 1,
      slots: [
        {
          coverAssetId: primary.assetId,
          deliveryStatus: "active",
          detailAssetIds: [],
          fallbackAssetId: alternative.assetId,
          imageSlot: "required_primary",
          lookId: "look-pending-primary",
          servedCoverAssetId: primary.assetId,
          servedDetailAssetIds: [],
        },
        {
          coverAssetId: alternative.assetId,
          deliveryStatus: "active",
          detailAssetIds: [],
          fallbackAssetId: primary.assetId,
          imageSlot: "required_alternative",
          lookId: "look-pending-alternative",
          servedCoverAssetId: alternative.assetId,
          servedDetailAssetIds: [],
        },
      ],
      withdrawalEvents: [],
    });
    store.publishVersionForTest(submitted.result.contentVersion);

    await expect(
      images.withdrawVersionAsset({
        actorId: "operator-1",
        assetId: primary.assetId,
        contentVersion: submitted.result.contentVersion,
        expectedActiveContentVersion: submitted.result.contentVersion,
        expectedLifecycleRevision: 1,
        idempotencyKey: "withdraw-pending-primary-0001", // gitleaks:allow -- deterministic test fixture
        reason: "自动生成主图存在问题。",
        requestId: "request-withdraw-pending-primary",
      }),
    ).resolves.toMatchObject({
      kind: "withdrawn",
      result: {
        deliveryAction: "fallback_activated",
        dailyImageSet: {
          slots: [
            expect.objectContaining({
              deliveryStatus: "fallback",
              servedCoverAssetId: alternative.assetId,
            }),
            expect.objectContaining({
              deliveryStatus: "active",
              servedCoverAssetId: alternative.assetId,
            }),
          ],
        },
      },
    });

    await expect(
      images.withdrawVersionAsset({
        actorId: "operator-1",
        assetId: alternative.assetId,
        contentVersion: submitted.result.contentVersion,
        expectedActiveContentVersion: submitted.result.contentVersion,
        expectedLifecycleRevision: 2,
        idempotencyKey: "withdraw-last-pending-fallback-0001",
        reason: "尝试下线最后一张安全图。",
        requestId: "request-withdraw-last-pending-fallback",
      }),
    ).resolves.toEqual({ kind: "withdrawal_blocked" });
  });

  it("blocks a global withdrawal that would break another date's active required slot", async () => {
    const { images, lifecycle, store } = services();
    const targetDraft = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-shared-withdrawal-target",
    });
    if (targetDraft.kind !== "created") throw new Error("target draft was not created");
    const targetVersion = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: targetDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-shared-withdrawal-target-0001",
      requestId: "request-submit-shared-withdrawal-target",
    });
    if (targetVersion.kind !== "submitted") throw new Error("target version was not frozen");
    store.seedDailyImageSetForTest(requiredImageSet(targetVersion.result.contentVersion));

    const activeDraft = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-05",
      requestId: "request-create-shared-withdrawal-active",
    });
    if (activeDraft.kind !== "created") throw new Error("active draft was not created");
    const activeVersion = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: activeDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-shared-withdrawal-active-0001",
      requestId: "request-submit-shared-withdrawal-active",
    });
    if (activeVersion.kind !== "submitted") throw new Error("active version was not frozen");
    const activeImageSet = requiredImageSet(activeVersion.result.contentVersion);
    store.seedDailyImageSetForTest({
      ...activeImageSet,
      assets: activeImageSet.assets.map((asset) =>
        asset.assetId === "asset-3" ? { ...asset, reviewStatus: "rejected" as const } : asset,
      ),
      fortuneDate: activeDraft.draft.fortuneDate,
    });
    store.publishVersionForTest(activeVersion.result.contentVersion);

    await expect(
      images.withdrawVersionAsset({
        actorId: "operator-1",
        assetId: "asset-1",
        contentVersion: targetVersion.result.contentVersion,
        expectedActiveContentVersion: null,
        expectedLifecycleRevision: 1,
        idempotencyKey: "withdraw-shared-asset-target-0001",
        reason: "共享素材权利材料失效。",
        requestId: "request-withdraw-shared-asset-target",
      }),
    ).resolves.toEqual({ kind: "active_version_asset_reference" });
  });

  it("reads the frozen set and lifecycle revision through one committed store view", async () => {
    const { images, lifecycle, store } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-image-set-view",
    });
    if (created.kind !== "created") return;
    const submitted = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-image-set-view-0001",
      requestId: "request-submit-image-set-view",
    });
    if (submitted.kind !== "submitted") return;
    store.seedDailyImageSetForTest(requiredImageSet(submitted.result.contentVersion));

    const atomicRead = store.readDailyImageSetView.bind(store);
    store.readDailyImageSet = async () => {
      throw new Error("daily image set must not be read independently");
    };
    store.readVersionView = async () => {
      throw new Error("lifecycle projection must not be read independently");
    };
    store.readDailyImageSetView = atomicRead;

    await expect(images.getDailyImageSet(submitted.result.contentVersion)).resolves.toMatchObject({
      contentVersion: submitted.result.contentVersion,
      lifecycleRevision: 1,
    });
  });

  it("allows frozen non-active versions and records non-served fallback withdrawal without public change", async () => {
    const { images, lifecycle, store } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-non-active-withdrawal",
    });
    if (created.kind !== "created") return;
    const submitted = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-non-active-withdrawal-0001",
      requestId: "request-submit-non-active-withdrawal",
    });
    if (submitted.kind !== "submitted") return;
    store.seedDailyImageSetForTest(requiredImageSet(submitted.result.contentVersion));

    await expect(
      images.withdrawVersionAsset({
        actorId: "operator-1",
        assetId: "asset-3",
        contentVersion: submitted.result.contentVersion,
        expectedActiveContentVersion: null,
        expectedLifecycleRevision: 1,
        idempotencyKey: "withdraw-unused-fallback-0001",
        reason: "备用素材授权被撤销。",
        requestId: "request-withdraw-unused-fallback",
      }),
    ).resolves.toMatchObject({
      kind: "withdrawn",
      result: {
        deliveryAction: "no_public_change",
        lifecycleRevision: 2,
        dailyImageSet: {
          slots: expect.arrayContaining([
            expect.objectContaining({ deliveryStatus: "active", servedCoverAssetId: "asset-1" }),
          ]),
        },
      },
    });
    expect(store.readCachePurgeIntentsForTest()).toHaveLength(1);
  });

  it("globally denies and purges an asset after its whole content version was withdrawn", async () => {
    const { images, lifecycle, store } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-withdrawn-version-asset",
    });
    if (created.kind !== "created") return;
    const submitted = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-withdrawn-version-asset-0001",
      requestId: "request-submit-withdrawn-version-asset",
    });
    if (submitted.kind !== "submitted") return;
    const imageSet = requiredImageSet(submitted.result.contentVersion);
    store.seedDailyImageSetForTest({
      ...imageSet,
      slots: [
        {
          ...imageSet.slots[0]!,
          deliveryStatus: "fallback",
          servedCoverAssetId: "asset-3",
        } as StoredDailyImageSet["slots"][number],
        imageSet.slots[1]!,
      ],
      withdrawalEvents: [
        {
          assetId: "asset-1",
          auditEventId: "audit-withdrawn-version-cover",
          reason: "原封面已下线。",
          withdrawalEventId: "withdraw-withdrawn-version-cover",
          withdrawnAt: "2026-08-02T05:00:00.000Z",
        },
      ],
    });
    await store.transaction((transaction) =>
      transaction.updateVersionState(submitted.result.contentVersion, "withdrawn"),
    );

    await expect(
      images.withdrawVersionAsset({
        actorId: "operator-1",
        assetId: "asset-3",
        contentVersion: submitted.result.contentVersion,
        expectedActiveContentVersion: null,
        expectedLifecycleRevision: 1,
        idempotencyKey: "withdraw-withdrawn-version-asset-0001",
        reason: "整版下线后发现图片授权失效。",
        requestId: "request-withdraw-withdrawn-version-asset",
      }),
    ).resolves.toMatchObject({
      kind: "withdrawn",
      result: {
        dailyImageSet: {
          slots: expect.arrayContaining([
            expect.objectContaining({
              deliveryStatus: "unavailable",
              servedCoverAssetId: null,
            }),
          ]),
        },
        deliveryAction: "no_public_change",
      },
    });
    await expect(images.getDailyImageSet(submitted.result.contentVersion)).resolves.toMatchObject({
      slots: expect.arrayContaining([
        expect.objectContaining({ deliveryStatus: "unavailable", servedCoverAssetId: null }),
      ]),
    });
    expect(store.readCachePurgeIntentsForTest()).toEqual([
      expect.objectContaining({
        assetId: "asset-3",
        contentVersion: submitted.result.contentVersion,
      }),
    ]);
  });

  it("allows a non-active withdrawal when the active version can safely switch to its fallback", async () => {
    const { images, lifecycle, store } = services();
    const firstDraft = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-shared-asset-v1",
    });
    if (firstDraft.kind !== "created") return;
    const first = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: firstDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-shared-asset-v1-0001",
      requestId: "request-submit-shared-asset-v1",
    });
    if (first.kind !== "submitted") return;
    const secondDraft = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-shared-asset-v2",
    });
    if (secondDraft.kind !== "created") return;
    const second = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: secondDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-shared-asset-v2-0001",
      requestId: "request-submit-shared-asset-v2",
    });
    if (second.kind !== "submitted") return;
    store.seedDailyImageSetForTest(requiredImageSet(first.result.contentVersion));
    store.seedDailyImageSetForTest({
      ...requiredImageSet(second.result.contentVersion),
      lifecycleRevision: 2,
    });
    await store.transaction(async (transaction) => {
      await transaction.updateVersionState(first.result.contentVersion, "superseded");
    });
    store.publishVersionForTest(second.result.contentVersion);

    await expect(
      images.withdrawVersionAsset({
        actorId: "operator-1",
        assetId: "asset-1",
        contentVersion: first.result.contentVersion,
        expectedActiveContentVersion: second.result.contentVersion,
        expectedLifecycleRevision: 2,
        idempotencyKey: "withdraw-shared-non-active-0001",
        reason: "素材被判定为全局不可继续公开。",
        requestId: "request-withdraw-shared-non-active",
      }),
    ).resolves.toMatchObject({
      kind: "withdrawn",
      result: {
        deliveryAction: "no_public_change",
      },
    });
    await expect(images.getDailyImageSet(second.result.contentVersion)).resolves.toMatchObject({
      slots: expect.arrayContaining([
        expect.objectContaining({
          deliveryStatus: "fallback",
          servedCoverAssetId: "asset-3",
        }),
      ]),
      withdrawalEvents: [expect.objectContaining({ assetId: "asset-1" })],
    });
  });

  it("blocks a non-active withdrawal when it would leave an active required slot unavailable", async () => {
    const { images, lifecycle, store } = services();
    const firstDraft = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-unsafe-shared-asset-v1",
    });
    if (firstDraft.kind !== "created") return;
    const first = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: firstDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-unsafe-shared-asset-v1-0001",
      requestId: "request-submit-unsafe-shared-asset-v1",
    });
    if (first.kind !== "submitted") return;
    const secondDraft = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-unsafe-shared-asset-v2",
    });
    if (secondDraft.kind !== "created") return;
    const second = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: secondDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-unsafe-shared-asset-v2-0001",
      requestId: "request-submit-unsafe-shared-asset-v2",
    });
    if (second.kind !== "submitted") return;
    store.seedDailyImageSetForTest(requiredImageSet(first.result.contentVersion));
    store.seedDailyImageSetForTest({
      ...requiredImageSet(second.result.contentVersion),
      lifecycleRevision: 2,
    });
    await store.transaction(async (transaction) => {
      await transaction.updateVersionState(first.result.contentVersion, "superseded");
      await transaction.insertImageAssetWithdrawalEvent({
        contentVersion: first.result.contentVersion,
        event: {
          assetId: "asset-3",
          auditEventId: "audit-unsafe-shared-fallback",
          reason: "共享降级图已先行全局下线。",
          withdrawalEventId: "withdrawal-unsafe-shared-fallback",
          withdrawnAt: "2026-08-02T05:00:00.000Z",
        },
      });
    });
    store.publishVersionForTest(second.result.contentVersion);

    await expect(
      images.withdrawVersionAsset({
        actorId: "operator-1",
        assetId: "asset-1",
        contentVersion: first.result.contentVersion,
        expectedActiveContentVersion: second.result.contentVersion,
        expectedLifecycleRevision: 2,
        idempotencyKey: "withdraw-unsafe-shared-non-active-0001",
        reason: "主图也失去公开资格。",
        requestId: "request-withdraw-unsafe-shared-non-active",
      }),
    ).resolves.toEqual({ kind: "active_version_asset_reference" });
    await expect(images.getDailyImageSet(second.result.contentVersion)).resolves.toMatchObject({
      slots: expect.arrayContaining([
        expect.objectContaining({
          deliveryStatus: "active",
          servedCoverAssetId: "asset-1",
        }),
      ]),
      withdrawalEvents: [expect.objectContaining({ assetId: "asset-3" })],
    });
  });

  it("omits optional covers and served details, but blocks withdrawing a served required fallback", async () => {
    const optional = services();
    const optionalDraft = await optional.lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-optional-withdrawal",
    });
    if (optionalDraft.kind !== "created") return;
    const optionalSubmit = await optional.lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: optionalDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-optional-withdrawal-0001",
      requestId: "request-submit-optional-withdrawal",
    });
    if (optionalSubmit.kind !== "submitted") return;
    const optionalSet = requiredImageSet(optionalSubmit.result.contentVersion);
    optional.store.seedDailyImageSetForTest({
      ...optionalSet,
      assets: [...optionalSet.assets, safeAsset("asset-5"), safeAsset("asset-6")],
      slots: [
        {
          ...optionalSet.slots[0]!,
          detailAssetIds: ["asset-5"],
          servedDetailAssetIds: ["asset-5"],
        } as StoredDailyImageSet["slots"][number],
        optionalSet.slots[1]!,
        {
          coverAssetId: "asset-6",
          deliveryStatus: "active",
          detailAssetIds: [],
          fallbackAssetId: null,
          imageSlot: "optional",
          lookId: "look-3",
          servedCoverAssetId: "asset-6",
          servedDetailAssetIds: [],
        },
      ],
    });
    optional.store.publishVersionForTest(optionalSubmit.result.contentVersion);
    const base = {
      actorId: "operator-1",
      contentVersion: optionalSubmit.result.contentVersion,
      expectedActiveContentVersion: optionalSubmit.result.contentVersion,
      reason: "素材不再公开使用。",
    } as const;
    await expect(
      optional.images.withdrawVersionAsset({
        ...base,
        assetId: "asset-5",
        expectedLifecycleRevision: 1,
        idempotencyKey: "withdraw-served-detail-0001",
        requestId: "request-withdraw-served-detail",
      }),
    ).resolves.toMatchObject({ kind: "withdrawn", result: { deliveryAction: "detail_omitted" } });
    await expect(
      optional.images.withdrawVersionAsset({
        ...base,
        assetId: "asset-6",
        expectedLifecycleRevision: 2,
        idempotencyKey: "withdraw-optional-cover-0001",
        requestId: "request-withdraw-optional-cover",
      }),
    ).resolves.toMatchObject({
      kind: "withdrawn",
      result: {
        deliveryAction: "optional_omitted",
        dailyImageSet: {
          slots: expect.arrayContaining([expect.objectContaining({ deliveryStatus: "omitted" })]),
        },
      },
    });

    const required = services();
    const requiredDraft = await required.lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-served-fallback",
    });
    if (requiredDraft.kind !== "created") return;
    const requiredSubmit = await required.lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: requiredDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-served-fallback-0001",
      requestId: "request-submit-served-fallback",
    });
    if (requiredSubmit.kind !== "submitted") return;
    const fallbackSet = requiredImageSet(requiredSubmit.result.contentVersion);
    required.store.seedDailyImageSetForTest({
      ...fallbackSet,
      slots: [
        {
          ...fallbackSet.slots[0]!,
          deliveryStatus: "fallback",
          servedCoverAssetId: "asset-3",
        } as StoredDailyImageSet["slots"][number],
        fallbackSet.slots[1]!,
      ],
      withdrawalEvents: [
        {
          assetId: "asset-1",
          auditEventId: "prior-audit-1",
          reason: "原图已下线。",
          withdrawalEventId: "prior-withdrawal-1",
          withdrawnAt: "2026-08-02T06:00:00.000Z",
        },
      ],
    });
    required.store.publishVersionForTest(requiredSubmit.result.contentVersion);
    await expect(
      required.images.withdrawVersionAsset({
        actorId: "operator-1",
        assetId: "asset-3",
        contentVersion: requiredSubmit.result.contentVersion,
        expectedActiveContentVersion: requiredSubmit.result.contentVersion,
        expectedLifecycleRevision: 1,
        idempotencyKey: "withdraw-served-fallback-0001",
        reason: "备用图也失去授权。",
        requestId: "request-withdraw-served-fallback",
      }),
    ).resolves.toEqual({ kind: "withdrawal_blocked" });
  });

  it("keeps no-public-change when an initially unavailable cover is already fallback or omitted", async () => {
    const { images, lifecycle, store } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-initial-image-projection",
    });
    if (created.kind !== "created") return;
    const submitted = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-initial-image-projection-0001",
      requestId: "request-submit-initial-image-projection",
    });
    if (submitted.kind !== "submitted") return;
    const set = requiredImageSet(submitted.result.contentVersion);
    store.seedDailyImageSetForTest({
      ...set,
      assets: [
        { ...safeAsset("asset-1"), fileUrl: null, reviewStatus: "rejected" },
        ...set.assets.slice(1),
        { ...safeAsset("asset-6"), fileUrl: null, reviewStatus: "rejected" },
      ],
      slots: [
        {
          ...set.slots[0]!,
          deliveryStatus: "fallback",
          servedCoverAssetId: "asset-3",
        } as StoredDailyImageSet["slots"][number],
        set.slots[1]!,
        {
          coverAssetId: "asset-6",
          deliveryStatus: "omitted",
          detailAssetIds: [],
          fallbackAssetId: null,
          imageSlot: "optional",
          lookId: "look-3",
          servedCoverAssetId: null,
          servedDetailAssetIds: [],
        },
      ],
    });
    const base = {
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      expectedActiveContentVersion: null,
      reason: "记录素材不再可用。",
    } as const;
    await expect(
      images.withdrawVersionAsset({
        ...base,
        assetId: "asset-1",
        expectedLifecycleRevision: 1,
        idempotencyKey: "withdraw-initial-fallback-cover-0001",
        requestId: "request-withdraw-initial-fallback-cover",
      }),
    ).resolves.toMatchObject({
      kind: "withdrawn",
      result: { deliveryAction: "no_public_change" },
    });
    await expect(
      images.withdrawVersionAsset({
        ...base,
        assetId: "asset-6",
        expectedLifecycleRevision: 2,
        idempotencyKey: "withdraw-initial-omitted-cover-0001",
        requestId: "request-withdraw-initial-omitted-cover",
      }),
    ).resolves.toMatchObject({
      kind: "withdrawn",
      result: { deliveryAction: "no_public_change" },
    });
  });

  it("marks an inactive slot unavailable instead of reviving a globally withdrawn fallback", async () => {
    const { images, lifecycle, store } = services();
    const firstDraft = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-global-fallback-source",
    });
    if (firstDraft.kind !== "created") return;
    const first = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: firstDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-global-fallback-source-0001",
      requestId: "request-submit-global-fallback-source",
    });
    if (first.kind !== "submitted") return;
    const secondDraft = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-global-fallback-target",
    });
    if (secondDraft.kind !== "created") return;
    const second = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: secondDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-global-fallback-target-0001",
      requestId: "request-submit-global-fallback-target",
    });
    if (second.kind !== "submitted") return;
    store.seedDailyImageSetForTest(requiredImageSet(first.result.contentVersion));
    store.seedDailyImageSetForTest({
      ...requiredImageSet(second.result.contentVersion),
      lifecycleRevision: 2,
    });
    await store.transaction(async (transaction) => {
      await transaction.insertImageAssetWithdrawalEvent({
        contentVersion: first.result.contentVersion,
        event: {
          assetId: "asset-3",
          auditEventId: "audit-global-fallback",
          reason: "共享备用图已全局撤销。",
          withdrawalEventId: "withdraw-global-fallback",
          withdrawnAt: "2026-08-02T05:00:00.000Z",
        },
      });
    });

    await expect(
      images.withdrawVersionAsset({
        actorId: "operator-1",
        assetId: "asset-1",
        contentVersion: second.result.contentVersion,
        expectedActiveContentVersion: null,
        expectedLifecycleRevision: 2,
        idempotencyKey: "withdraw-cover-global-fallback-0001",
        reason: "当前主图也被撤销。",
        requestId: "request-withdraw-cover-global-fallback",
      }),
    ).resolves.toMatchObject({
      kind: "withdrawn",
      result: {
        dailyImageSet: {
          slots: expect.arrayContaining([
            expect.objectContaining({
              deliveryStatus: "unavailable",
              servedCoverAssetId: null,
            }),
          ]),
        },
        deliveryAction: "no_public_change",
      },
    });
  });

  it("replays a global withdrawal into every referencing image set and rejects a second withdrawal", async () => {
    const { images, lifecycle, store } = services();
    const firstDraft = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-global-projection-v1",
    });
    const secondDraft = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-global-projection-v2",
    });
    if (firstDraft.kind !== "created" || secondDraft.kind !== "created") return;
    const first = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: firstDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-global-projection-v1-0001",
      requestId: "request-submit-global-projection-v1",
    });
    const second = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: secondDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-global-projection-v2-0001",
      requestId: "request-submit-global-projection-v2",
    });
    if (first.kind !== "submitted" || second.kind !== "submitted") return;
    store.seedDailyImageSetForTest(requiredImageSet(first.result.contentVersion));
    store.seedDailyImageSetForTest({
      ...requiredImageSet(second.result.contentVersion),
      lifecycleRevision: 2,
    });
    await store.transaction(async (transaction) => {
      await transaction.insertImageAssetWithdrawalEvent({
        contentVersion: first.result.contentVersion,
        event: {
          assetId: "asset-1",
          auditEventId: "audit-global-projection",
          reason: "共享主图已全局撤销。",
          withdrawalEventId: "withdraw-global-projection",
          withdrawnAt: "2026-08-02T05:00:00.000Z",
        },
      });
    });

    await expect(images.getDailyImageSet(second.result.contentVersion)).resolves.toMatchObject({
      slots: expect.arrayContaining([
        expect.objectContaining({
          deliveryStatus: "fallback",
          servedCoverAssetId: "asset-3",
        }),
      ]),
      withdrawalEvents: [expect.objectContaining({ assetId: "asset-1" })],
    });
    await expect(
      images.withdrawVersionAsset({
        actorId: "operator-1",
        assetId: "asset-1",
        contentVersion: second.result.contentVersion,
        expectedActiveContentVersion: null,
        expectedLifecycleRevision: 2,
        idempotencyKey: "withdraw-global-projection-v2-0001",
        reason: "不应重复追加全局下线事件。",
        requestId: "request-withdraw-global-projection-v2",
      }),
    ).resolves.toEqual({ kind: "invalid_state" });
  });

  it("returns the first upload for an identical retry and conflicts on a changed payload", async () => {
    const { binary, images, lifecycle } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-image-retry",
    });
    if (created.kind !== "created") return;
    const input = {
      actorId: "operator-1",
      bytes: PNG,
      declaredMediaType: "image/png",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "upload-image-intent-0002",
      imageSlot: "required_primary",
      metadata,
      requestId: "request-upload-image-retry",
    } as const;

    const first = await images.uploadDraftAsset(input);
    expect(first.kind).toBe("uploaded");
    expect(binary.putCalls).toBe(1);
    await expect(
      images.uploadDraftAsset({ ...input, requestId: "request-network-retry" }),
    ).resolves.toEqual({
      kind: "existing",
      result: first.kind === "uploaded" ? first.result : undefined,
    });
    expect(binary.putCalls).toBe(1);
    await expect(
      images.uploadDraftAsset({ ...input, metadata: { ...metadata, altText: "另一份描述" } }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    expect(binary.putCalls).toBe(1);
  });

  it("replays a legacy null-slot upload record and rejects using it for a named slot", async () => {
    const { binary, images, lifecycle, store } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-legacy-upload-retry",
    });
    if (created.kind !== "created") return;
    const sha256 = createHash("sha256").update(PNG).digest("hex");
    const idempotencyKey = "legacy-upload-image-intent-0001";
    const legacyResponse = {
      asset: {
        ...metadata,
        assetId: "asset-legacy-upload",
        fileUrl: null,
        height: 1,
        manualReview: null,
        mediaType: "image/png",
        reviewStatus: "pending",
        rightsStatus: "pending",
        sha256,
        width: 1,
      },
      draftId: created.draft.draftId,
      draftRevision: 2,
      fortuneDate: "2026-08-03",
      previewUrl: "/admin/api/v1/image-assets/asset-legacy-upload/preview",
      reviewLocked: false,
    };
    await store.transaction((transaction) =>
      transaction.insertIdempotency({
        idempotencyKey,
        operation: "image_upload",
        requestHash: requestHash({
          draftId: created.draft.draftId,
          expectedDraftRevision: 1,
          metadata,
          sha256,
        }),
        resourceId: created.draft.draftId,
        response: legacyResponse,
      }),
    );
    const baseInput = {
      actorId: "operator-1",
      bytes: PNG,
      declaredMediaType: "image/png",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey,
      metadata,
      requestId: "request-replay-legacy-upload",
    } as const;

    await expect(images.uploadDraftAsset({ ...baseInput, imageSlot: null })).resolves.toEqual({
      kind: "existing",
      result: { ...legacyResponse, imageSlot: null, selectedForSlot: false },
    });
    await expect(
      images.uploadDraftAsset({ ...baseInput, imageSlot: "required_primary" }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    expect(binary.putCalls).toBe(0);
  });

  it("normalizes a legacy image review response with a null image slot", async () => {
    const { images, lifecycle, store } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-legacy-review-retry",
    });
    if (created.kind !== "created") return;
    const uploaded = await images.uploadDraftAsset({
      actorId: "operator-1",
      bytes: PNG,
      declaredMediaType: "image/png",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "upload-before-legacy-review-0001",
      imageSlot: null,
      metadata,
      requestId: "request-upload-before-legacy-review",
    });
    if (uploaded.kind !== "uploaded") return;
    const legacyResponse = structuredClone(uploaded.result) as Record<string, unknown>;
    delete legacyResponse.imageSlot;
    const idempotencyKey = "legacy-image-review-intent-0001";
    await store.transaction((transaction) =>
      transaction.insertIdempotency({
        idempotencyKey,
        operation: "image_review",
        requestHash: requestHash({
          assetId: uploaded.result.asset.assetId,
          draftId: created.draft.draftId,
          expectedDraftRevision: 2,
          review: passedReview,
        }),
        resourceId: uploaded.result.asset.assetId,
        response: legacyResponse,
      }),
    );

    await expect(
      images.reviewDraftAsset({
        actorId: "operator-1",
        assetId: uploaded.result.asset.assetId,
        draftId: created.draft.draftId,
        expectedDraftRevision: 2,
        idempotencyKey,
        requestId: "request-replay-legacy-review",
        review: passedReview,
      }),
    ).resolves.toEqual({
      kind: "existing",
      result: { ...legacyResponse, imageSlot: null },
    });
  });

  it("records server-owned review identity and only approves all-pass, rights-cleared assets", async () => {
    const { images, lifecycle } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-image-review",
    });
    if (created.kind !== "created") return;
    const uploaded = await images.uploadDraftAsset({
      actorId: "operator-1",
      bytes: PNG,
      declaredMediaType: "image/png",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "upload-image-intent-0003",
      imageSlot: "required_primary",
      metadata,
      requestId: "request-upload-image-review",
    });
    if (uploaded.kind !== "uploaded") return;

    const reviewed = await images.reviewDraftAsset({
      actorId: "operator-1",
      assetId: uploaded.result.asset.assetId,
      draftId: created.draft.draftId,
      expectedDraftRevision: 2,
      idempotencyKey: "review-image-intent-0001",
      requestId: "request-review-image",
      review: passedReview,
    });

    expect(reviewed).toMatchObject({
      kind: "reviewed",
      result: {
        draftRevision: 3,
        asset: {
          fileUrl: expect.stringMatching(/\/daily-images\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/u),
          reviewStatus: "approved",
          rightsStatus: "cleared",
          manualReview: {
            reviewId: "image-review-1",
            reviewerAccountId: "operator-1",
            reviewedAt: "2026-08-02T06:05:00.000Z",
          },
        },
      },
    });
  });

  it("does not invent a loopback public file URL when no public asset base is configured", async () => {
    const store = new InMemoryContentLifecycleStore();
    const binary = new MemoryBinaryStore();
    const lifecycle = new ContentLifecycleService(store, {
      now: () => new Date("2026-08-02T06:00:00Z"),
    });
    let identifier = 0;
    const images = new DailyImageAssetService(
      store,
      binary,
      { now: () => new Date("2026-08-02T06:05:00Z") },
      {
        nextAssetId: () => `asset-unconfigured-${++identifier}`,
        nextAuditEventId: () => `audit-unconfigured-${++identifier}`,
        nextCachePurgeIntentId: () => `purge-unconfigured-${++identifier}`,
        nextReviewId: () => `review-unconfigured-${++identifier}`,
        nextWithdrawalEventId: () => `withdrawal-unconfigured-${++identifier}`,
      },
    );
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-unconfigured-public-assets",
    });
    if (created.kind !== "created") return;
    const uploaded = await images.uploadDraftAsset({
      actorId: "operator-1",
      bytes: PNG,
      declaredMediaType: "image/png",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "upload-unconfigured-assets-0001",
      imageSlot: "required_primary",
      metadata,
      requestId: "request-upload-unconfigured-assets",
    });
    if (uploaded.kind !== "uploaded") return;
    const reviewed = await images.reviewDraftAsset({
      actorId: "operator-1",
      assetId: uploaded.result.asset.assetId,
      draftId: created.draft.draftId,
      expectedDraftRevision: 2,
      idempotencyKey: "review-unconfigured-assets-0001",
      requestId: "request-review-unconfigured-assets",
      review: passedReview,
    });
    expect(reviewed).toMatchObject({
      kind: "reviewed",
      result: { asset: { fileUrl: null, reviewStatus: "approved" } },
    });
  });

  it("locks copied candidate reviews so sibling draft revisions and metadata cannot change silently", async () => {
    const { images, lifecycle } = services();
    const source = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-review-lock-source",
    });
    if (source.kind !== "created") return;
    const uploaded = await images.uploadDraftAsset({
      actorId: "operator-1",
      bytes: PNG,
      declaredMediaType: "image/png",
      draftId: source.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "upload-review-lock-source-0001",
      imageSlot: "required_primary",
      metadata,
      requestId: "request-upload-review-lock-source",
    });
    if (uploaded.kind !== "uploaded") return;
    const reviewed = await images.reviewDraftAsset({
      actorId: "operator-1",
      assetId: uploaded.result.asset.assetId,
      draftId: source.draft.draftId,
      expectedDraftRevision: 2,
      idempotencyKey: "review-lock-source-0001",
      requestId: "request-review-lock-source",
      review: passedReview,
    });
    if (reviewed.kind !== "reviewed") return;
    const submitted = await lifecycle.submitDraft({
      actorId: "operator-1",
      draftId: source.draft.draftId,
      expectedDraftRevision: 3,
      idempotencyKey: "submit-review-lock-source-0001",
      requestId: "request-submit-review-lock-source",
    });
    if (submitted.kind !== "submitted") return;
    const first = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: submitted.result.contentVersion,
      fortuneDate: source.draft.fortuneDate,
      requestId: "request-create-review-lock-copy-1",
    });
    const second = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: submitted.result.contentVersion,
      fortuneDate: source.draft.fortuneDate,
      requestId: "request-create-review-lock-copy-2",
    });
    if (first.kind !== "created" || second.kind !== "created") return;
    const firstBefore = await images.listDraftAssets(first.draft.draftId);
    const secondBefore = await images.listDraftAssets(second.draft.draftId);
    expect(firstBefore?.items[0]?.reviewLocked).toBe(true);
    expect(secondBefore?.items[0]?.reviewLocked).toBe(true);

    await expect(
      images.reviewDraftAsset({
        actorId: "operator-1",
        assetId: uploaded.result.asset.assetId,
        draftId: first.draft.draftId,
        expectedDraftRevision: 1,
        idempotencyKey: "review-locked-copy-0001",
        requestId: "request-review-locked-copy",
        review: { ...passedReview, decision: "rejected" },
      }),
    ).resolves.toEqual({ kind: "review_locked" });
    expect(await images.listDraftAssets(first.draft.draftId)).toEqual(firstBefore);
    expect(await images.listDraftAssets(second.draft.draftId)).toEqual(secondBefore);
    expect((await lifecycle.getDraft(first.draft.draftId))?.draftRevision).toBe(1);
    expect((await lifecycle.getDraft(second.draft.draftId))?.draftRevision).toBe(1);
  });

  it("rejects upload metadata without both source and rights references", async () => {
    const { images, lifecycle } = services();
    const created = await lifecycle.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-invalid-image",
    });
    if (created.kind !== "created") return;

    await expect(
      images.uploadDraftAsset({
        actorId: "operator-1",
        bytes: PNG,
        declaredMediaType: "image/png",
        draftId: created.draft.draftId,
        expectedDraftRevision: 1,
        idempotencyKey: "upload-image-intent-0004",
        imageSlot: "required_primary",
        metadata: { ...metadata, rightsRecordIds: [] },
        requestId: "request-upload-invalid-image",
      }),
    ).resolves.toEqual({ kind: "invalid_metadata" });
  });

  it("rejects a whitespace-only withdrawal reason before opening a transaction", async () => {
    const { images } = services();
    await expect(
      images.withdrawVersionAsset({
        actorId: "operator-1",
        assetId: "asset-1",
        contentVersion: "content-1",
        expectedActiveContentVersion: null,
        expectedLifecycleRevision: 1,
        idempotencyKey: "withdraw-blank-reason-0001",
        reason: "   ",
        requestId: "request-withdraw-blank-reason",
      }),
    ).resolves.toEqual({ kind: "invalid_argument" });
  });
});
