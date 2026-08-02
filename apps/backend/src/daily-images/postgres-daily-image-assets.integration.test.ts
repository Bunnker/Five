import { randomUUID } from "node:crypto";

import type { components } from "@five/api-contract";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import { PostgresContentLifecycleStore } from "../content-lifecycle/postgres-content-lifecycle.store";
import { DailyImageAssetService } from "./daily-image-asset.service";
import type { StoredDailyImageSet } from "./daily-image-asset.store";
import type { BinaryImageAssetStore } from "./local-binary-image-asset.store";

const databaseUrl = process.env.FIVE_CONTENT_LIFECYCLE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function opaque(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

class MemoryBinaryImageStore implements BinaryImageAssetStore {
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

async function waitForLock(pool: Pool, applicationName: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND application_name = $1
            AND wait_event_type = 'Lock'
       ) AS waiting`,
      [applicationName],
    );
    if (result.rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for PostgreSQL lock: ${applicationName}`);
}

const metadata: components["schemas"]["ImageAssetUploadMetadata"] = {
  aiLabelStatus: "not_applicable",
  altText: "PostgreSQL 图片素材",
  declaredModel: null,
  generatedAt: null,
  generationMethod: "licensed_upload",
  promptVersion: null,
  reproductionReference: null,
  rightsRecordIds: ["rights-postgres-image"],
  sourceMaterialReferences: ["license:postgres-image"],
  sourceType: "licensed",
};

const passedReview: components["schemas"]["ImageAssetReviewRequest"] = {
  aiLabelCompliance: "passed",
  aiLabelStatus: "not_applicable",
  colorAndCopyConsistency: "passed",
  decision: "approved",
  garmentAndPersonIntegrity: "passed",
  mobileAndWechatPreview: "passed",
  notes: "PostgreSQL 集成检查通过。",
  rightsAndIdentityRisk: "passed",
  rightsStatus: "cleared",
  scenarioAndImitability: "passed",
};

describeDatabase("Postgres daily image assets", () => {
  let pool: Pool;
  let store: PostgresContentLifecycleStore;
  let lifecycle: ContentLifecycleService;
  let images: DailyImageAssetService;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 10 });
    store = new PostgresContentLifecycleStore(pool);
    lifecycle = new ContentLifecycleService(
      store,
      { now: () => new Date("2026-08-02T05:00:00.000Z") },
      {
        nextAuditEventId: () => opaque("audit-pg-image-lifecycle"),
        nextContentVersion: () => opaque("content-pg-image"),
        nextDraftId: () => opaque("draft-pg-image"),
        nextEvidenceId: () => opaque("evidence-pg-image"),
      },
    );
    images = new DailyImageAssetService(
      store,
      new MemoryBinaryImageStore(),
      { now: () => new Date("2026-08-02T05:05:00.000Z") },
      {
        nextAssetId: () => opaque("asset-pg-image"),
        nextAuditEventId: () => opaque("audit-pg-image"),
        nextCachePurgeIntentId: () => opaque("purge-pg-image"),
        nextReviewId: () => opaque("review-pg-image"),
        nextWithdrawalEventId: () => opaque("withdraw-pg-image"),
      },
      "https://assets.example.test/daily-images/",
    );
  });

  afterAll(async () => pool.end());

  it("persists candidates, locks copied review state, withdraws atomically, and enforces snapshot triggers", async () => {
    const draft = await lifecycle.createDraft({
      actorId: "operator-integration",
      copyFromContentVersion: null,
      fortuneDate: "2026-10-02",
      requestId: opaque("request-create-pg-image"),
    });
    expect(draft.kind).toBe("created");
    if (draft.kind !== "created") return;

    let draftRevision = 1;
    const approvedAssets: components["schemas"]["AdminImageAsset"][] = [];
    for (let index = 0; index < 5; index += 1) {
      const uploaded = await images.uploadDraftAsset({
        actorId: "operator-integration",
        bytes: PNG,
        declaredMediaType: "image/png",
        draftId: draft.draft.draftId,
        expectedDraftRevision: draftRevision,
        idempotencyKey: opaque(`upload-pg-image-${index}`),
        metadata: { ...metadata, altText: `PostgreSQL 图片素材 ${index + 1}` },
        requestId: opaque(`request-upload-pg-image-${index}`),
      });
      expect(uploaded).toMatchObject({ kind: "uploaded", result: { reviewLocked: false } });
      if (uploaded.kind !== "uploaded") return;
      draftRevision = uploaded.result.draftRevision;
      const reviewed = await images.reviewDraftAsset({
        actorId: "operator-integration",
        assetId: uploaded.result.asset.assetId,
        draftId: draft.draft.draftId,
        expectedDraftRevision: draftRevision,
        idempotencyKey: opaque(`review-pg-image-${index}`),
        requestId: opaque(`request-review-pg-image-${index}`),
        review: passedReview,
      });
      expect(reviewed).toMatchObject({ kind: "reviewed", result: { reviewLocked: false } });
      if (reviewed.kind !== "reviewed") return;
      draftRevision = reviewed.result.draftRevision;
      approvedAssets.push(reviewed.result.asset);
    }

    const submitted = await lifecycle.submitDraft({
      actorId: "operator-integration",
      draftId: draft.draft.draftId,
      expectedDraftRevision: draftRevision,
      idempotencyKey: opaque("submit-pg-image"),
      requestId: opaque("request-submit-pg-image"),
    });
    expect(submitted.kind).toBe("submitted");
    if (submitted.kind !== "submitted") return;
    const assetIds = approvedAssets.map((asset) => asset.assetId);
    const imageSet: StoredDailyImageSet = {
      assets: approvedAssets.slice(0, 4),
      contentVersion: submitted.result.contentVersion,
      fortuneDate: "2026-10-02",
      lifecycleRevision: 1,
      slots: [
        {
          coverAssetId: assetIds[0]!,
          deliveryStatus: "active",
          detailAssetIds: [],
          fallbackAssetId: assetIds[2]!,
          imageSlot: "required_primary",
          lookId: "look-pg-primary",
          servedCoverAssetId: assetIds[0]!,
          servedDetailAssetIds: [],
        },
        {
          coverAssetId: assetIds[1]!,
          deliveryStatus: "active",
          detailAssetIds: [],
          fallbackAssetId: assetIds[3]!,
          imageSlot: "required_alternative",
          lookId: "look-pg-alternative",
          servedCoverAssetId: assetIds[1]!,
          servedDetailAssetIds: [],
        },
      ],
      withdrawalEvents: [],
    };
    await store.transaction((transaction) => transaction.insertDailyImageSet(imageSet));

    const withdrawalInput = {
      actorId: "operator-integration",
      assetId: assetIds[0]!,
      contentVersion: submitted.result.contentVersion,
      expectedActiveContentVersion: null,
      expectedLifecycleRevision: 1,
      idempotencyKey: opaque("withdraw-pg-image"),
      reason: "PostgreSQL 集成测试撤销授权。",
      requestId: opaque("request-withdraw-pg-image"),
    } as const;
    const concurrent = await Promise.all([
      images.withdrawVersionAsset(withdrawalInput),
      images.withdrawVersionAsset({
        ...withdrawalInput,
        requestId: opaque("request-withdraw-pg-image-retry"),
      }),
    ]);
    expect(concurrent.map((result) => result.kind).sort()).toEqual(["existing", "withdrawn"]);
    const applied = concurrent.find((result) => result.kind === "withdrawn");
    expect(applied).toMatchObject({
      kind: "withdrawn",
      result: {
        deliveryAction: "no_public_change",
        lifecycleRevision: 2,
        dailyImageSet: {
          slots: expect.arrayContaining([
            expect.objectContaining({ servedCoverAssetId: assetIds[2] }),
          ]),
        },
      },
    });
    if (applied?.kind !== "withdrawn") return;

    const persisted = await images.getDailyImageSet(submitted.result.contentVersion);
    expect(persisted).toMatchObject({
      lifecycleRevision: 2,
      withdrawalEvents: [{ assetId: assetIds[0] }],
    });
    const persistedRows = await pool.query<{ audits: string; purges: string; withdrawals: string }>(
      `SELECT
         (SELECT count(*)::text FROM image_asset_withdrawal_events WHERE content_version = $1) AS withdrawals,
         (SELECT count(*)::text FROM content_lifecycle_audit_events WHERE content_version = $1 AND action = 'image_asset_withdrawn') AS audits,
         (SELECT count(*)::text FROM image_cache_purge_intents WHERE content_version = $1) AS purges`,
      [submitted.result.contentVersion],
    );
    expect(persistedRows.rows[0]).toEqual({ audits: "1", purges: "1", withdrawals: "1" });

    const claimedPurge = await store.claimNextImageCachePurgeIntent({
      attemptToken: opaque("attempt-pg-image-first"),
      claimedAt: "2026-08-02T05:05:00.000Z",
      leaseExpiresAt: "2026-08-02T05:10:00.000Z",
      workerId: "image-cache-worker-pg-a",
    });
    expect(claimedPurge).toMatchObject({
      assetId: assetIds[0],
      attempts: 1,
      contentVersion: submitted.result.contentVersion,
      status: "processing",
    });
    if (claimedPurge === null) return;
    await expect(
      store.recordImageCachePurgeFailure({
        attemptToken: claimedPurge.attemptToken!,
        error: "provider unavailable",
        failedAt: "2026-08-02T05:05:01.000Z",
        purgeIntentId: claimedPurge.purgeIntentId,
        retryAt: "2026-08-02T05:05:31.000Z",
        workerId: "image-cache-worker-pg-a",
      }),
    ).resolves.toMatchObject({ lastError: "provider unavailable", status: "pending" });
    const retriedPurge = await store.claimNextImageCachePurgeIntent({
      attemptToken: opaque("attempt-pg-image-second"),
      claimedAt: "2026-08-02T05:05:31.000Z",
      leaseExpiresAt: "2026-08-02T05:10:31.000Z",
      workerId: "image-cache-worker-pg-b",
    });
    expect(retriedPurge).toMatchObject({ attempts: 2, status: "processing" });
    if (retriedPurge === null) return;
    await expect(
      store.completeImageCachePurgeIntent({
        attemptToken: claimedPurge.attemptToken!,
        completedAt: "2026-08-02T05:05:32.000Z",
        purgeIntentId: claimedPurge.purgeIntentId,
        workerId: "image-cache-worker-pg-a",
      }),
    ).resolves.toBeNull();
    await expect(
      store.completeImageCachePurgeIntent({
        attemptToken: retriedPurge.attemptToken!,
        completedAt: "2026-08-02T05:05:32.000Z",
        purgeIntentId: retriedPurge.purgeIntentId,
        workerId: "image-cache-worker-pg-b",
      }),
    ).resolves.toMatchObject({ status: "completed" });

    const globalProjectionDraft = await lifecycle.createDraft({
      actorId: "operator-integration",
      copyFromContentVersion: null,
      fortuneDate: "2026-10-03",
      requestId: opaque("request-create-global-image-projection"),
    });
    if (globalProjectionDraft.kind !== "created") return;
    const globalProjectionVersion = await lifecycle.submitDraft({
      actorId: "operator-integration",
      draftId: globalProjectionDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: opaque("submit-global-image-projection"),
      requestId: opaque("request-submit-global-image-projection"),
    });
    if (globalProjectionVersion.kind !== "submitted") return;
    await store.transaction((transaction) =>
      transaction.insertDailyImageSet({
        ...imageSet,
        contentVersion: globalProjectionVersion.result.contentVersion,
        fortuneDate: "2026-10-03",
        lifecycleRevision: 1,
        withdrawalEvents: [],
      }),
    );
    await expect(
      images.getDailyImageSet(globalProjectionVersion.result.contentVersion),
    ).resolves.toMatchObject({
      slots: expect.arrayContaining([
        expect.objectContaining({
          deliveryStatus: "fallback",
          servedCoverAssetId: assetIds[2],
        }),
      ]),
      withdrawalEvents: [expect.objectContaining({ assetId: assetIds[0] })],
    });

    const firstCopy = await lifecycle.createDraft({
      actorId: "operator-integration",
      copyFromContentVersion: submitted.result.contentVersion,
      fortuneDate: "2026-10-02",
      requestId: opaque("request-copy-pg-image-1"),
    });
    const secondCopy = await lifecycle.createDraft({
      actorId: "operator-integration",
      copyFromContentVersion: submitted.result.contentVersion,
      fortuneDate: "2026-10-02",
      requestId: opaque("request-copy-pg-image-2"),
    });
    expect(firstCopy.kind).toBe("created");
    expect(secondCopy.kind).toBe("created");
    if (firstCopy.kind !== "created" || secondCopy.kind !== "created") return;
    expect(await images.listDraftAssets(firstCopy.draft.draftId)).toMatchObject({
      draftRevision: 1,
      items: approvedAssets.map(() => expect.objectContaining({ reviewLocked: true })),
    });
    const secondBefore = await images.listDraftAssets(secondCopy.draft.draftId);
    await expect(
      images.reviewDraftAsset({
        actorId: "operator-integration",
        assetId: assetIds[1]!,
        draftId: firstCopy.draft.draftId,
        expectedDraftRevision: 1,
        idempotencyKey: opaque("review-locked-pg-image"),
        requestId: opaque("request-review-locked-pg-image"),
        review: { ...passedReview, decision: "rejected" },
      }),
    ).resolves.toEqual({ kind: "review_locked" });
    expect(await images.listDraftAssets(secondCopy.draft.draftId)).toEqual(secondBefore);
    expect((await lifecycle.getDraft(firstCopy.draft.draftId))?.draftRevision).toBe(1);

    await expect(
      pool.query(
        `UPDATE daily_image_assets
            SET asset_json = jsonb_set(asset_json, '{altText}', to_jsonb($2::text))
          WHERE asset_id = $1`,
        [assetIds[0], "tampered"],
      ),
    ).rejects.toThrow("daily image asset server fields are immutable");
    await expect(
      pool.query(
        `UPDATE daily_image_sets
            SET slots_json = jsonb_set(slots_json, '{0,coverAssetId}', to_jsonb($2::text))
          WHERE content_version = $1`,
        [submitted.result.contentVersion, assetIds[1]],
      ),
    ).rejects.toThrow("daily image set snapshot is immutable");
    await expect(
      pool.query(
        "UPDATE draft_image_candidates SET review_locked = false WHERE draft_id = $1 AND asset_id = $2",
        [firstCopy.draft.draftId, assetIds[0]],
      ),
    ).rejects.toThrow("draft_image_candidates is append-only");

    const projectionProbe = await pool.connect();
    try {
      await projectionProbe.query("BEGIN");
      await expect(
        projectionProbe.query(
          `UPDATE daily_image_assets
              SET asset_json = jsonb_set(asset_json, '{reviewStatus}', '"pending"'::jsonb)
            WHERE asset_id = $1`,
          [assetIds[1]],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        projectionProbe.query(
          `UPDATE daily_image_sets
              SET lifecycle_revision = lifecycle_revision + 1,
                  slots_json = jsonb_set(slots_json, '{0,servedDetailAssetIds}', '[]'::jsonb)
            WHERE content_version = $1`,
          [submitted.result.contentVersion],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await projectionProbe.query("ROLLBACK");
      projectionProbe.release();
    }

    const duplicateProbe = await pool.connect();
    try {
      const duplicateAuditId = opaque("audit-pg-image-duplicate");
      await duplicateProbe.query("BEGIN");
      await duplicateProbe.query(
        `INSERT INTO content_lifecycle_audit_events (
           audit_event_id, action, occurred_at, request_id, fortune_date, content_version,
           actor_id, reason, from_state, to_state, idempotency_key, retain_until
         ) VALUES (
           $1, 'image_asset_withdrawn', clock_timestamp(), $2, '2026-10-03', $3,
           'operator-integration', 'duplicate constraint probe', 'in_review', 'in_review',
           $4, clock_timestamp() + interval '365 days'
         )`,
        [
          duplicateAuditId,
          opaque("request-duplicate-withdrawal"),
          globalProjectionVersion.result.contentVersion,
          opaque("idempotency-duplicate-withdrawal"),
        ],
      );
      await expect(
        duplicateProbe.query(
          `INSERT INTO image_asset_withdrawal_events (
             withdrawal_event_id, content_version, asset_id, reason, withdrawn_at, audit_event_id
           ) VALUES ($1, $2, $3, 'duplicate', clock_timestamp(), $4)`,
          [
            opaque("withdraw-pg-image-duplicate"),
            globalProjectionVersion.result.contentVersion,
            assetIds[0],
            duplicateAuditId,
          ],
        ),
      ).rejects.toThrow(/unique/u);
    } finally {
      await duplicateProbe.query("ROLLBACK");
      duplicateProbe.release();
    }

    const membershipProbe = await pool.connect();
    try {
      const membershipAuditId = opaque("audit-pg-image-membership");
      await membershipProbe.query("BEGIN");
      await membershipProbe.query(
        `INSERT INTO content_lifecycle_audit_events (
           audit_event_id, action, occurred_at, request_id, fortune_date, content_version,
           actor_id, reason, from_state, to_state, idempotency_key, retain_until
         ) VALUES (
           $1, 'image_asset_withdrawn', clock_timestamp(), $2, '2026-10-02', $3,
           'operator-integration', 'membership constraint probe', 'in_review', 'in_review',
           $4, clock_timestamp() + interval '365 days'
         )`,
        [
          membershipAuditId,
          opaque("request-membership-withdrawal"),
          submitted.result.contentVersion,
          opaque("idempotency-membership-withdrawal"),
        ],
      );
      await expect(
        membershipProbe.query(
          `INSERT INTO image_asset_withdrawal_events (
             withdrawal_event_id, content_version, asset_id, reason, withdrawn_at, audit_event_id
           ) VALUES ($1, $2, $3, 'not a member', clock_timestamp(), $4)`,
          [
            opaque("withdraw-pg-image-membership"),
            submitted.result.contentVersion,
            assetIds[4],
            membershipAuditId,
          ],
        ),
      ).rejects.toThrow("withdrawal asset does not belong to daily image set");
    } finally {
      await membershipProbe.query("ROLLBACK");
      membershipProbe.release();
    }

    const readerApplication = opaque("pg-image-consistent-reader");
    const writerApplication = opaque("pg-image-consistent-writer");
    const readerPool = new Pool({
      application_name: readerApplication,
      connectionString: databaseUrl,
      max: 2,
    });
    const readerImages = new DailyImageAssetService(
      new PostgresContentLifecycleStore(readerPool),
      new MemoryBinaryImageStore(),
      { now: () => new Date("2026-08-02T05:05:00.000Z") },
    );
    const blocker = await pool.connect();
    const writer = await pool.connect();
    let mutation: Promise<void> | null = null;
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE content_lifecycle_days IN ACCESS SHARE MODE");
      await writer.query("BEGIN");
      await writer.query("SELECT set_config('application_name', $1, false)", [writerApplication]);
      await writer.query(
        `UPDATE daily_image_sets
            SET lifecycle_revision = 3,
                slots_json = jsonb_set(
                  jsonb_set(slots_json, '{0,deliveryStatus}', '"active"'::jsonb),
                  '{0,servedCoverAssetId}', to_jsonb($2::text)
                )
          WHERE content_version = $1`,
        [submitted.result.contentVersion, assetIds[0]],
      );
      mutation = (async () => {
        await writer.query("LOCK TABLE content_lifecycle_days IN ACCESS EXCLUSIVE MODE");
        await writer.query(
          `UPDATE content_lifecycle_days
              SET lifecycle_revision = 3
            WHERE fortune_date = '2026-10-02'::date AND lifecycle_revision = 2`,
        );
        await writer.query("COMMIT");
      })();
      await waitForLock(pool, writerApplication);

      const read = readerImages.getDailyImageSet(submitted.result.contentVersion);
      await waitForLock(pool, readerApplication);
      await blocker.query("COMMIT");
      const view = await read;
      await mutation;
      expect(view).toMatchObject({
        lifecycleRevision: 2,
        slots: expect.arrayContaining([
          expect.objectContaining({
            deliveryStatus: "fallback",
            servedCoverAssetId: assetIds[2],
          }),
        ]),
      });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await mutation?.catch(() => undefined);
      await writer.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      writer.release();
      await readerPool.end();
    }

    const concurrentGlobalDenies = await Promise.all([
      images.withdrawVersionAsset({
        actorId: "operator-integration",
        assetId: assetIds[1]!,
        contentVersion: submitted.result.contentVersion,
        expectedActiveContentVersion: null,
        expectedLifecycleRevision: 3,
        idempotencyKey: opaque("withdraw-concurrent-global-source"),
        reason: "跨版本并发全局下线。",
        requestId: opaque("request-withdraw-concurrent-global-source"),
      }),
      images.withdrawVersionAsset({
        actorId: "operator-integration",
        assetId: assetIds[1]!,
        contentVersion: globalProjectionVersion.result.contentVersion,
        expectedActiveContentVersion: null,
        expectedLifecycleRevision: 1,
        idempotencyKey: opaque("withdraw-concurrent-global-target"),
        reason: "跨版本并发全局下线。",
        requestId: opaque("request-withdraw-concurrent-global-target"),
      }),
    ]);
    expect(concurrentGlobalDenies.map((result) => result.kind).sort()).toEqual([
      "invalid_state",
      "withdrawn",
    ]);
    const globalRows = await pool.query<{ purges: string; withdrawals: string }>(
      `SELECT
         (SELECT count(*)::text FROM image_asset_withdrawal_events WHERE asset_id = $1) AS withdrawals,
         (SELECT count(*)::text FROM image_cache_purge_intents WHERE asset_id = $1) AS purges`,
      [assetIds[1]],
    );
    expect(globalRows.rows[0]).toEqual({ purges: "1", withdrawals: "1" });
  });
});
