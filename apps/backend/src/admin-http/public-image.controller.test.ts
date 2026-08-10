import "reflect-metadata";

import { Module } from "@nestjs/common";
import type { components } from "@five/api-contract";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import { InMemoryContentLifecycleStore } from "../content-lifecycle/in-memory-content-lifecycle.store";
import { DailyImageAssetService } from "../daily-images/daily-image-asset.service";
import type { StoredDailyImageSet } from "../daily-images/daily-image-asset.store";
import type { BinaryImageAssetStore } from "../daily-images/local-binary-image-asset.store";
import { DAILY_IMAGE_ASSET_SERVICE } from "./admin-http.providers";
import { PublicImageController } from "./public-image.controller";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

class MemoryBinaryStore implements BinaryImageAssetStore {
  private readonly binaries = new Map<string, Buffer>();

  async put(input: {
    readonly bytes: Buffer;
    readonly extension: "avif" | "jpg" | "png" | "webp";
    readonly sha256: string;
  }): Promise<{ storageKey: string }> {
    const storageKey = `${input.sha256.slice(0, 2)}/${input.sha256}.${input.extension}`;
    this.binaries.set(storageKey, Buffer.from(input.bytes));
    return { storageKey };
  }

  async read(storageKey: string): Promise<Buffer | null> {
    const bytes = this.binaries.get(storageKey);
    return bytes === undefined ? null : Buffer.from(bytes);
  }
}

const store = new InMemoryContentLifecycleStore();
const lifecycle = new ContentLifecycleService(store, {
  now: () => new Date("2026-08-10T06:00:00.000Z"),
});
let assetSequence = 0;
let eventSequence = 0;
const images = new DailyImageAssetService(
  store,
  new MemoryBinaryStore(),
  { now: () => new Date("2026-08-10T06:05:00.000Z") },
  {
    nextAssetId: () => `asset-public-${++assetSequence}`,
    nextAuditEventId: () => `audit-public-${++eventSequence}`,
    nextCachePurgeIntentId: () => `purge-public-${++eventSequence}`,
    nextReviewId: () => `review-public-${++eventSequence}`,
    nextWithdrawalEventId: () => `withdraw-public-${++eventSequence}`,
  },
);

@Module({
  controllers: [PublicImageController],
  providers: [{ provide: DAILY_IMAGE_ASSET_SERVICE, useValue: images }],
})
class PublicImageHttpTestModule {}

const metadata: components["schemas"]["ImageAssetUploadMetadata"] = {
  aiLabelStatus: "not_applicable",
  altText: "公开图片撤回测试",
  declaredModel: null,
  generatedAt: null,
  generationMethod: "licensed_upload",
  promptVersion: null,
  reproductionReference: null,
  rightsRecordIds: ["rights-public-image"],
  sourceMaterialReferences: ["license:public-image"],
  sourceType: "licensed",
};

function safeAsset(assetId: string): components["schemas"]["AdminImageAsset"] {
  return {
    ...metadata,
    assetId,
    fileUrl: `https://assets.example.test/${assetId}.png`,
    height: 1,
    manualReview: {
      aiLabelCompliance: "passed",
      colorAndCopyConsistency: "passed",
      garmentAndPersonIntegrity: "passed",
      mobileAndWechatPreview: "passed",
      notes: "fixture approved",
      reviewId: `review-${assetId}`,
      reviewedAt: "2026-08-10T06:04:00.000Z",
      reviewerAccountId: "operator-public",
      rightsAndIdentityRisk: "passed",
      scenarioAndImitability: "passed",
    },
    mediaType: "image/png",
    reviewStatus: "approved",
    rightsStatus: "cleared",
    sha256: "a".repeat(64),
    width: 1,
  };
}

describe("public image HTTP boundary", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      PublicImageHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();
  });

  afterAll(async () => app.close());

  it("stops serving a globally withdrawn image and never marks the revocable route immutable", async () => {
    const created = await lifecycle.createDraft({
      actorId: "operator-public",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-12",
      requestId: "request-create-public-image",
    });
    if (created.kind !== "created") throw new Error("public image draft fixture was not created");
    const uploaded = await images.uploadDraftAsset({
      actorId: "operator-public",
      bytes: PNG,
      declaredMediaType: "image/png",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "upload-public-image-0001",
      imageSlot: "required_primary",
      metadata,
      requestId: "request-upload-public-image",
    });
    if (uploaded.kind !== "uploaded") throw new Error("public image fixture was not uploaded");
    const submitted = await lifecycle.submitDraft({
      actorId: "operator-public",
      draftId: created.draft.draftId,
      expectedDraftRevision: uploaded.result.draftRevision,
      idempotencyKey: "submit-public-image-0001",
      requestId: "request-submit-public-image",
    });
    if (submitted.kind !== "submitted") throw new Error("public image fixture was not submitted");

    const imageSet: StoredDailyImageSet = {
      assets: [
        uploaded.result.asset,
        safeAsset("asset-public-alternative"),
        safeAsset("asset-public-primary-fallback"),
        safeAsset("asset-public-alternative-fallback"),
      ],
      contentVersion: submitted.result.contentVersion,
      fortuneDate: created.draft.fortuneDate,
      lifecycleRevision: 1,
      slots: [
        {
          coverAssetId: uploaded.result.asset.assetId,
          deliveryStatus: "active",
          detailAssetIds: [],
          fallbackAssetId: "asset-public-primary-fallback",
          imageSlot: "required_primary",
          lookId: "look-public-primary",
          servedCoverAssetId: uploaded.result.asset.assetId,
          servedDetailAssetIds: [],
        },
        {
          coverAssetId: "asset-public-alternative",
          deliveryStatus: "active",
          detailAssetIds: [],
          fallbackAssetId: "asset-public-alternative-fallback",
          imageSlot: "required_alternative",
          lookId: "look-public-alternative",
          servedCoverAssetId: "asset-public-alternative",
          servedDetailAssetIds: [],
        },
      ],
      withdrawalEvents: [],
    };
    store.seedDailyImageSetForTest(imageSet);

    const unpublished = await app.inject({
      method: "GET",
      url: `/api/v1/image-assets/${uploaded.result.asset.assetId}`,
    });
    expect(unpublished.statusCode).toBe(404);
    expect(unpublished.headers["cache-control"]).toBe("no-store");

    store.publishVersionForTest(submitted.result.contentVersion);

    const before = await app.inject({
      method: "GET",
      url: `/api/v1/image-assets/${uploaded.result.asset.assetId}`,
    });
    expect(before.statusCode).toBe(200);
    expect(before.headers["cache-control"]).toBe("public, max-age=0, s-maxage=60, must-revalidate");

    await expect(
      images.withdrawVersionAsset({
        actorId: "operator-public",
        assetId: uploaded.result.asset.assetId,
        contentVersion: submitted.result.contentVersion,
        expectedActiveContentVersion: submitted.result.contentVersion,
        expectedLifecycleRevision: 1,
        idempotencyKey: "withdraw-public-image-0001",
        reason: "图片权利材料失效。",
        requestId: "request-withdraw-public-image",
      }),
    ).resolves.toMatchObject({ kind: "withdrawn" });

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/image-assets/${uploaded.result.asset.assetId}`,
    });
    expect(after.statusCode).toBe(404);
    expect(after.headers["cache-control"]).toBe("no-store");
  });
});
