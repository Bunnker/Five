import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import { PostgresContentLifecycleStore } from "../content-lifecycle/postgres-content-lifecycle.store";
import { ContentReleaseService } from "../content-release/content-release.service";
import { ContentReleaseWorker } from "../content-release/content-release.worker";
import { PostgresContentReleaseStore } from "../content-release/postgres-content-release.store";
import { DailyImageAssetService } from "../daily-images/daily-image-asset.service";
import { PostgresDayCorrectionStore } from "../day-correction/postgres-day-correction.store";
import { ContentAutoPublicationWorker } from "./content-auto-publication.worker";
import { AutomaticContentProductionService } from "./content-production.service";
import { PostgresContentProductionStore } from "./postgres-content-production.store";

const databaseUrl = process.env.FIVE_CONTENT_LIFECYCLE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

const migrationOptions = {
  databaseUrl: databaseUrl!,
  dir: resolve(process.cwd(), "migrations"),
  log: () => undefined,
  migrationsTable: "pgmigrations",
} as const;

async function insertAsset(pool: Pool, assetId: string, digit: string): Promise<void> {
  const sha256 = digit.repeat(64);
  await pool.query(
    `INSERT INTO daily_image_assets (
       asset_id, storage_key, sha256, asset_json, uploaded_at
     ) VALUES (
       $1::varchar, $2::varchar, $3::char(64),
       jsonb_build_object(
         'aiLabelStatus', 'pending',
         'altText', concat('测试穿搭 ', $1::varchar),
         'assetId', $1::varchar,
         'declaredModel', 'test-image-generator',
         'fileUrl', NULL,
         'generatedAt', '2026-08-02T10:00:00.000Z',
         'generationMethod', 'external_tool',
         'height', 1600,
         'manualReview', NULL,
         'mediaType', 'image/png',
         'promptVersion', 'five-look-v1',
         'reproductionReference', concat('test-request-', $1::varchar),
         'reviewStatus', 'pending',
         'rightsRecordIds', jsonb_build_array(concat('rights-', $1::varchar)),
         'rightsStatus', 'pending',
         'sha256', $3::char(64),
         'sourceMaterialReferences', jsonb_build_array(concat('source-', $1::varchar)),
         'sourceType', 'ai_generated',
         'width', 1200
       ),
       clock_timestamp()
     )`,
    [assetId, `${digit.repeat(2)}/${sha256}.png`, sha256],
  );
}

async function simulateUploadedCandidate(
  pool: Pool,
  input: {
    readonly assetId: string;
    readonly digit: string;
    readonly draftId: string;
    readonly draftRevision: number;
    readonly fortuneDate: string;
    readonly imageSlot: "optional" | "required_alternative" | "required_primary";
    readonly uploadedAt: string;
  },
): Promise<number> {
  await insertAsset(pool, input.assetId, input.digit);
  await pool.query(
    `INSERT INTO draft_image_candidates (
       draft_id, asset_id, fortune_date, image_slot, review_locked, uploaded_at
     ) VALUES ($1, $2, $3, $4, false, $5)`,
    [input.draftId, input.assetId, input.fortuneDate, input.imageSlot, input.uploadedAt],
  );
  const nextRevision = input.draftRevision + 1;
  const revised = await pool.query(
    `UPDATE content_drafts
        SET draft_revision = $2, updated_at = $3
      WHERE draft_id = $1 AND draft_revision = $4
  RETURNING draft_revision`,
    [input.draftId, nextRevision, input.uploadedAt, input.draftRevision],
  );
  expect(revised.rowCount).toBe(1);
  return nextRevision;
}

function serviceFor(store: PostgresContentProductionStore, prefix: string) {
  let imageJob = 0;
  return new AutomaticContentProductionService(
    store,
    { now: () => new Date("2026-08-02T10:00:00.000Z") },
    {
      nextDraftId: () => `draft-${prefix}`,
      nextImageJobId: (imageSlot) => `job-${prefix}-${imageSlot}-${++imageJob}`,
    },
  );
}

function imageServiceFor(pool: Pool, now: string): DailyImageAssetService {
  return new DailyImageAssetService(
    new PostgresContentLifecycleStore(pool),
    {
      put: () => Promise.reject(new Error("binary writes are not used by selection tests")),
      read: () => Promise.resolve(null),
    },
    { now: () => new Date(now) },
  );
}

describeDatabase("current image generation and terminal failure", () => {
  let pool: Pool;

  beforeAll(async () => {
    const { runner } = await import("node-pg-migrate");
    await runner({ ...migrationOptions, count: 15, direction: "up" });
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
  });

  afterAll(async () => pool.end());

  it("projects only the explicit current generation and keeps optional pending or failed nonblocking", async () => {
    const store = new PostgresContentProductionStore(pool);
    const service = serviceFor(store, "current-generation");
    await service.ensureDay({
      actorId: "production-test",
      fortuneDate: "2026-08-10",
      idempotencyKey: "ensure-current-generation-0001",
      requestId: "request-current-generation",
    });
    for (const [assetId, digit, token] of [
      ["asset-current-primary-v1", "a", "attempt-current-primary-v1"],
      ["asset-current-alternative-v1", "b", "attempt-current-alternative-v1"],
    ] as const) {
      const claimed = await store.claimNextImageJob({
        attemptToken: token,
        claimedAt: "2026-08-02T10:01:00.000Z",
        leaseExpiresAt: "2026-08-02T10:11:00.000Z",
        workerId: "worker-current-generation",
      });
      expect(claimed).not.toBeNull();
      if (claimed === null) return;
      const uploadedRevision = await simulateUploadedCandidate(pool, {
        assetId,
        digit,
        draftId: claimed.draftId,
        draftRevision: claimed.draftRevision,
        fortuneDate: claimed.fortuneDate,
        imageSlot: claimed.imageSlot,
        uploadedAt: "2026-08-02T10:01:30.000Z",
      });
      await store.completeImageJob({
        assetId,
        attemptToken: token,
        completedAt: "2026-08-02T10:02:00.000Z",
        draftRevision: uploadedRevision,
        jobId: claimed.jobId,
        sha256: digit.repeat(64),
        workerId: "worker-current-generation",
      });
      const afterSelection = await pool.query<{ draft_revision: number }>(
        `SELECT draft_revision::integer AS draft_revision
           FROM content_drafts
          WHERE draft_id = $1`,
        [claimed.draftId],
      );
      expect(afterSelection.rows).toEqual([{ draft_revision: uploadedRevision + 1 }]);
    }

    await pool.query(
      `INSERT INTO daily_content_image_jobs (
         job_id, fortune_date, image_slot, prompt_version, status, attempts,
         attempt_limit, generation_revision, available_at
       ) VALUES (
         'job-current-primary-v2', '2026-08-10', 'required_primary',
         'five-look-v0', 'queued', 0, 3, 2, '2026-08-02T10:03:00.000Z'
       );
       UPDATE daily_content_image_slot_currents
          SET current_job_id = 'job-current-primary-v2', generation_revision = 2,
              updated_at = '2026-08-02T10:03:00.000Z'
        WHERE fortune_date = '2026-08-10' AND image_slot = 'required_primary'`,
    );

    await expect(service.list()).resolves.toMatchObject({
      items: [
        {
          completedImageSlots: 1,
          fortuneDate: "2026-08-10",
          imageSlots: [
            { imageSlot: "required_primary", status: "pending" },
            { imageSlot: "required_alternative", status: "ready" },
            { imageSlot: "optional", status: "not_requested" },
          ],
          pendingImageSlots: 1,
          requiredGenerationComplete: false,
          requiredImagesReady: true,
          status: "awaiting_review",
        },
      ],
    });

    const claimed = await store.claimNextImageJob({
      attemptToken: "attempt-current-primary-v2",
      claimedAt: "2026-08-02T10:04:00.000Z",
      leaseExpiresAt: "2026-08-02T10:14:00.000Z",
      workerId: "worker-current-generation",
    });
    expect(claimed?.jobId).toBe("job-current-primary-v2");
    if (claimed !== null) {
      const uploadedRevision = await simulateUploadedCandidate(pool, {
        assetId: "asset-current-primary-v2",
        digit: "c",
        draftId: claimed.draftId,
        draftRevision: claimed.draftRevision,
        fortuneDate: claimed.fortuneDate,
        imageSlot: claimed.imageSlot,
        uploadedAt: "2026-08-02T10:04:30.000Z",
      });
      await store.completeImageJob({
        assetId: "asset-current-primary-v2",
        attemptToken: "attempt-current-primary-v2",
        completedAt: "2026-08-02T10:05:00.000Z",
        draftRevision: uploadedRevision,
        jobId: claimed.jobId,
        sha256: "c".repeat(64),
        workerId: "worker-current-generation",
      });
    }
    await pool.query(
      `INSERT INTO daily_content_image_jobs (
         job_id, fortune_date, image_slot, prompt_version, status, attempts,
         attempt_limit, generation_revision, available_at
       ) VALUES (
         'job-current-optional-v1', '2026-08-10', 'optional',
         'five-look-v1', 'queued', 0, 3, 1, '2026-08-02T10:06:00.000Z'
       );
       UPDATE daily_content_image_slot_currents
          SET current_job_id = 'job-current-optional-v1', generation_revision = 1,
              updated_at = '2026-08-02T10:06:00.000Z'
        WHERE fortune_date = '2026-08-10' AND image_slot = 'optional'`,
    );
    await expect(service.list()).resolves.toMatchObject({
      items: [
        {
          completedImageSlots: 2,
          optionalImageStatus: "pending",
          pendingImageSlots: 0,
          requiredGenerationComplete: true,
          requiredImagesReady: true,
          status: "awaiting_review",
        },
      ],
    });
    await pool.query(
      `UPDATE daily_content_image_jobs
          SET status = 'failed', attempts = 3, last_error = 'optional generation failed'
        WHERE job_id = 'job-current-optional-v1'`,
    );
    await expect(service.list()).resolves.toMatchObject({
      items: [
        {
          lastError: null,
          optionalImageStatus: "failed",
          requiredGenerationComplete: true,
          status: "awaiting_review",
          imageSlots: [
            expect.anything(),
            expect.anything(),
            expect.objectContaining({
              canRetry: true,
              imageSlot: "optional",
              lastError: "optional generation failed",
              status: "failed",
            }),
          ],
        },
      ],
    });
  });

  it("marks duplicate required-image bytes as 1/2 delivery readiness instead of silently waiting", async () => {
    const store = new PostgresContentProductionStore(pool);
    const service = serviceFor(store, "duplicate-required-sha");
    await service.ensureDay({
      actorId: "production-test",
      fortuneDate: "2026-08-16",
      idempotencyKey: "ensure-duplicate-required-sha-0001",
      requestId: "request-duplicate-required-sha",
    });
    for (const [assetId, token] of [
      ["asset-duplicate-primary", "attempt-duplicate-primary"],
      ["asset-duplicate-alternative", "attempt-duplicate-alternative"],
    ] as const) {
      const claimed = await store.claimNextImageJob({
        attemptToken: token,
        claimedAt: "2026-08-02T11:00:00.000Z",
        leaseExpiresAt: "2026-08-02T11:10:00.000Z",
        workerId: "worker-duplicate-required-sha",
      });
      expect(claimed?.fortuneDate).toBe("2026-08-16");
      if (claimed === null) return;
      const uploadedRevision = await simulateUploadedCandidate(pool, {
        assetId,
        digit: "9",
        draftId: claimed.draftId,
        draftRevision: claimed.draftRevision,
        fortuneDate: claimed.fortuneDate,
        imageSlot: claimed.imageSlot,
        uploadedAt: "2026-08-02T11:00:30.000Z",
      });
      await store.completeImageJob({
        assetId,
        attemptToken: token,
        completedAt: "2026-08-02T11:01:00.000Z",
        draftRevision: uploadedRevision,
        jobId: claimed.jobId,
        sha256: "9".repeat(64),
        workerId: "worker-duplicate-required-sha",
      });
    }

    await expect(service.list()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          completedImageSlots: 2,
          fortuneDate: "2026-08-16",
          lastError: "两张必备图片内容重复，请替换备选图。",
          requiredGenerationComplete: true,
          requiredImagesReady: false,
          status: "failed",
          imageSlots: [
            expect.objectContaining({
              deliveryReady: true,
              imageSlot: "required_primary",
            }),
            expect.objectContaining({
              deliveryReady: false,
              imageSlot: "required_alternative",
              lastError: "两张必备图片内容重复，请替换备选图。",
            }),
            expect.anything(),
          ],
        }),
      ]),
    });
  });

  it("atomically reaches failed after the third attempt and supports an idempotent manual retry cycle", async () => {
    const store = new PostgresContentProductionStore(pool);
    const service = serviceFor(store, "terminal-failure");
    await service.ensureDay({
      actorId: "production-test",
      fortuneDate: "2026-08-11",
      idempotencyKey: "ensure-terminal-failure-0001",
      requestId: "request-terminal-failure",
    });
    await pool.query(
      `UPDATE daily_content_image_jobs
          SET status = 'completed'
        WHERE fortune_date = '2026-08-11' AND image_slot = 'required_alternative'`,
    );
    const expected = ["retry_scheduled", "retry_scheduled", "exhausted"] as const;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const minute = attempt * 2;
      const token = `attempt-terminal-failure-${attempt}`;
      const claimed = await store.claimNextImageJob({
        attemptToken: token,
        claimedAt: `2026-08-02T10:0${minute}:00.000Z`,
        leaseExpiresAt: `2026-08-02T10:1${minute}:00.000Z`,
        workerId: "worker-terminal-failure",
      });
      expect(claimed?.imageSlot).toBe("required_primary");
      await expect(
        store.recordImageJobFailure({
          attemptToken: token,
          error: `failure ${attempt}`,
          failedAt: `2026-08-02T10:0${minute}:30.000Z`,
          jobId: claimed?.jobId ?? "missing-job",
          retryAt: `2026-08-02T10:0${minute + 1}:00.000Z`,
          workerId: "worker-terminal-failure",
        }),
      ).resolves.toBe(expected[attempt - 1]);
    }
    await expect(service.list()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          completedImageSlots: 1,
          fortuneDate: "2026-08-11",
          lastError: "failure 3",
          pendingImageSlots: 0,
          requiredGenerationComplete: false,
          status: "failed",
          imageSlots: expect.arrayContaining([
            expect.objectContaining({
              attemptLimit: 3,
              attempts: 3,
              canRetry: true,
              imageSlot: "required_primary",
              status: "failed",
            }),
          ]),
        }),
      ]),
    });

    const retried = await service.requestImageSlotGeneration({
      actorId: "operator-1",
      draftId: "draft-terminal-failure",
      expectedDraftRevision: 1,
      fortuneDate: "2026-08-11",
      idempotencyKey: "manual-image-retry-terminal-0001",
      imageSlot: "required_primary",
      reason: "确认配额恢复后人工重试。",
      requestId: "request-manual-image-retry",
    });
    expect(retried).toMatchObject({
      kind: "accepted",
      production: {
        requiredGenerationComplete: false,
        status: "generating",
        imageSlots: expect.arrayContaining([
          expect.objectContaining({
            attemptLimit: 3,
            attempts: 0,
            canRetry: false,
            imageSlot: "required_primary",
            status: "pending",
          }),
        ]),
      },
    });
    await expect(
      service.requestImageSlotGeneration({
        actorId: "operator-1",
        draftId: "draft-terminal-failure",
        expectedDraftRevision: 1,
        fortuneDate: "2026-08-11",
        idempotencyKey: "manual-image-retry-terminal-0001",
        imageSlot: "required_primary",
        reason: "确认配额恢复后人工重试。",
        requestId: "request-manual-image-retry-replay",
      }),
    ).resolves.toMatchObject({ kind: "existing" });
    await expect(
      service.requestImageSlotGeneration({
        actorId: "operator-1",
        draftId: "draft-terminal-failure",
        expectedDraftRevision: 1,
        fortuneDate: "2026-08-11",
        idempotencyKey: "manual-image-retry-terminal-0001",
        imageSlot: "required_primary",
        reason: "改变后的原因不能重用同一个幂等键。",
        requestId: "request-manual-image-retry-conflict",
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    await pool.query(
      `UPDATE daily_content_image_jobs
          SET status = 'failed', last_error = 'test cleanup'
        WHERE fortune_date = '2026-08-11' AND status IN ('queued', 'retryable', 'claimed')`,
    );
  });

  it("advances the draft ETag for automatic selection and never lets a late worker replace a manual choice", async () => {
    const store = new PostgresContentProductionStore(pool);
    const production = serviceFor(store, "selection-etag");
    await production.ensureDay({
      actorId: "production-test",
      fortuneDate: "2026-08-13",
      idempotencyKey: "ensure-selection-etag-0001",
      requestId: "request-selection-etag",
    });
    const claimed = await store.claimNextImageJob({
      attemptToken: "attempt-selection-etag-primary",
      claimedAt: "2026-08-02T12:00:00.000Z",
      leaseExpiresAt: "2026-08-02T12:10:00.000Z",
      workerId: "worker-selection-etag",
    });
    expect(claimed).toMatchObject({
      fortuneDate: "2026-08-13",
      imageSlot: "required_primary",
    });
    if (claimed === null) return;
    const workerUploadRevision = await simulateUploadedCandidate(pool, {
      assetId: "asset-selection-etag-worker",
      digit: "d",
      draftId: claimed.draftId,
      draftRevision: claimed.draftRevision,
      fortuneDate: claimed.fortuneDate,
      imageSlot: claimed.imageSlot,
      uploadedAt: "2026-08-02T12:01:00.000Z",
    });
    const manualUploadRevision = await simulateUploadedCandidate(pool, {
      assetId: "asset-selection-etag-manual",
      digit: "e",
      draftId: claimed.draftId,
      draftRevision: workerUploadRevision,
      fortuneDate: claimed.fortuneDate,
      imageSlot: claimed.imageSlot,
      uploadedAt: "2026-08-02T12:02:00.000Z",
    });
    const selected = await imageServiceFor(
      pool,
      "2026-08-02T12:03:00.000Z",
    ).selectDraftAssetForSlot({
      actorId: "operator-1",
      assetId: "asset-selection-etag-manual",
      draftId: claimed.draftId,
      expectedDraftRevision: manualUploadRevision,
      idempotencyKey: "select-manual-over-worker-0001",
      imageSlot: claimed.imageSlot,
      reason: "人工选择优先于仍在运行的旧 generation。",
      requestId: "request-select-manual-over-worker",
    });
    expect(selected).toMatchObject({
      kind: "selected",
      result: { draftRevision: manualUploadRevision + 1, selectedForSlot: true },
    });
    if (selected.kind !== "selected") return;

    await store.completeImageJob({
      assetId: "asset-selection-etag-worker",
      attemptToken: "attempt-selection-etag-primary",
      completedAt: "2026-08-02T12:04:00.000Z",
      draftRevision: workerUploadRevision,
      jobId: claimed.jobId,
      sha256: "d".repeat(64),
      workerId: "worker-selection-etag",
    });
    const persisted = await pool.query<{
      asset_id: string;
      draft_revision: number | string;
      selection_source: string;
      status: string;
    }>(
      `SELECT selection.asset_id, selection.selection_source,
              draft.draft_revision::integer AS draft_revision, job.status
         FROM draft_image_slot_selections AS selection
         JOIN content_drafts AS draft ON draft.draft_id = selection.draft_id
         JOIN daily_content_productions AS production ON production.draft_id = draft.draft_id
         JOIN daily_content_image_slot_currents AS current
           ON current.fortune_date = production.fortune_date
          AND current.image_slot = selection.image_slot
         JOIN daily_content_image_jobs AS job ON job.job_id = current.current_job_id
        WHERE selection.draft_id = $1 AND selection.image_slot = $2`,
      [claimed.draftId, claimed.imageSlot],
    );
    expect(persisted.rows).toEqual([
      {
        asset_id: "asset-selection-etag-manual",
        draft_revision: selected.result.draftRevision,
        selection_source: "manual_selection",
        status: "completed",
      },
    ]);
    const lifecycle = new ContentLifecycleService(new PostgresContentLifecycleStore(pool));
    await expect(
      lifecycle.submitDraft({
        actorId: "operator-1",
        draftId: claimed.draftId,
        expectedDraftRevision: workerUploadRevision,
        idempotencyKey: "submit-with-unobserved-selection-0001",
        requestId: "request-submit-with-unobserved-selection",
      }),
    ).resolves.toEqual({
      currentRevision: selected.result.draftRevision,
      kind: "revision_mismatch",
    });
    await pool.query(
      `UPDATE daily_content_image_jobs
          SET status = 'failed', last_error = 'test cleanup'
        WHERE fortune_date = '2026-08-13' AND status IN ('queued', 'retryable', 'claimed')`,
    );
  });

  it("completes an uploaded candidate after an unrelated draft revision advances", async () => {
    const store = new PostgresContentProductionStore(pool);
    const production = serviceFor(store, "selection-revision-race");
    await production.ensureDay({
      actorId: "production-test",
      fortuneDate: "2026-08-15",
      idempotencyKey: "ensure-selection-revision-race-0001",
      requestId: "request-selection-revision-race",
    });
    const claimed = await store.claimNextImageJob({
      attemptToken: "attempt-selection-revision-race-primary",
      claimedAt: "2026-08-02T12:10:00.000Z",
      leaseExpiresAt: "2026-08-02T12:20:00.000Z",
      workerId: "worker-selection-revision-race",
    });
    expect(claimed).toMatchObject({
      fortuneDate: "2026-08-15",
      imageSlot: "required_primary",
    });
    if (claimed === null) return;
    const uploadedRevision = await simulateUploadedCandidate(pool, {
      assetId: "asset-selection-revision-race-worker",
      digit: "f",
      draftId: claimed.draftId,
      draftRevision: claimed.draftRevision,
      fortuneDate: claimed.fortuneDate,
      imageSlot: claimed.imageSlot,
      uploadedAt: "2026-08-02T12:11:00.000Z",
    });
    await pool.query(
      `UPDATE content_drafts
          SET draft_revision = draft_revision + 1,
              updated_at = '2026-08-02T12:12:00.000Z'
        WHERE draft_id = $1`,
      [claimed.draftId],
    );

    await store.completeImageJob({
      assetId: "asset-selection-revision-race-worker",
      attemptToken: "attempt-selection-revision-race-primary",
      completedAt: "2026-08-02T12:13:00.000Z",
      draftRevision: uploadedRevision,
      jobId: claimed.jobId,
      sha256: "f".repeat(64),
      workerId: "worker-selection-revision-race",
    });

    const persisted = await pool.query<{
      asset_id: string | null;
      draft_revision: number | string;
      selection_source: string | null;
      status: string;
    }>(
      `SELECT selection.asset_id, selection.selection_source,
              draft.draft_revision::integer AS draft_revision, job.status
         FROM daily_content_productions AS production
         JOIN content_drafts AS draft ON draft.draft_id = production.draft_id
         JOIN daily_content_image_slot_currents AS current
           ON current.fortune_date = production.fortune_date
          AND current.image_slot = 'required_primary'
         JOIN daily_content_image_jobs AS job ON job.job_id = current.current_job_id
         LEFT JOIN draft_image_slot_selections AS selection
           ON selection.draft_id = draft.draft_id
          AND selection.image_slot = current.image_slot
        WHERE production.fortune_date = '2026-08-15'`,
    );
    expect(persisted.rows).toEqual([
      {
        asset_id: "asset-selection-revision-race-worker",
        draft_revision: uploadedRevision + 2,
        selection_source: "automatic_generation",
        status: "completed",
      },
    ]);
    await pool.query(
      `UPDATE daily_content_image_jobs
          SET status = 'failed', last_error = 'test cleanup'
        WHERE fortune_date = '2026-08-15' AND status IN ('queued', 'retryable', 'claimed')`,
    );
  });

  it("uses manual selections to recover required delivery readiness after generation failure", async () => {
    const store = new PostgresContentProductionStore(pool);
    const production = serviceFor(store, "manual-recovery");
    await production.ensureDay({
      actorId: "production-test",
      fortuneDate: "2026-08-14",
      idempotencyKey: "ensure-manual-recovery-0001",
      requestId: "request-manual-recovery",
    });
    await pool.query(
      `UPDATE daily_content_image_jobs
          SET status = CASE image_slot
                WHEN 'required_primary' THEN 'failed'
                ELSE 'completed'
              END,
              attempts = CASE image_slot WHEN 'required_primary' THEN 3 ELSE attempts END,
              last_error = CASE image_slot
                WHEN 'required_primary' THEN 'automatic generation exhausted'
                ELSE NULL
              END
        WHERE fortune_date = '2026-08-14'`,
    );
    const images = imageServiceFor(pool, "2026-08-02T13:00:00.000Z");
    let draftRevision = 1;
    for (const [imageSlot, assetId, digit] of [
      ["required_primary", "asset-manual-recovery-primary", "f"],
      ["required_alternative", "asset-manual-recovery-alternative", "1"],
    ] as const) {
      draftRevision = await simulateUploadedCandidate(pool, {
        assetId,
        digit,
        draftId: "draft-manual-recovery",
        draftRevision,
        fortuneDate: "2026-08-14",
        imageSlot,
        uploadedAt: "2026-08-02T13:00:00.000Z",
      });
      const selected = await images.selectDraftAssetForSlot({
        actorId: "operator-1",
        assetId,
        draftId: "draft-manual-recovery",
        expectedDraftRevision: draftRevision,
        idempotencyKey: `select-manual-recovery-${imageSlot}-0001`,
        imageSlot,
        reason: "自动生成失败后使用人工确认图片恢复发布。",
        requestId: `request-select-manual-recovery-${imageSlot}`,
      });
      expect(selected.kind).toBe("selected");
      if (selected.kind !== "selected") return;
      draftRevision = selected.result.draftRevision;
    }

    await expect(production.list()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          fortuneDate: "2026-08-14",
          lastError: null,
          requiredGenerationComplete: false,
          requiredImagesReady: true,
          status: "awaiting_review",
          imageSlots: expect.arrayContaining([
            expect.objectContaining({
              canRetry: true,
              deliveryReady: true,
              imageSlot: "required_primary",
              lastError: "automatic generation exhausted",
              status: "failed",
            }),
            expect.objectContaining({
              deliveryReady: true,
              imageSlot: "required_alternative",
              status: "ready",
            }),
          ]),
        }),
      ]),
    });
    await expect(
      production.requestImageSlotGeneration({
        actorId: "operator-1",
        draftId: "draft-manual-recovery",
        expectedDraftRevision: draftRevision,
        fortuneDate: "2026-08-14",
        idempotencyKey: "optional-before-manual-recovery-submit-0001",
        imageSlot: "optional",
        reason: "发布前补充可选图。",
        requestId: "request-optional-before-manual-recovery-submit",
      }),
    ).resolves.toMatchObject({ kind: "accepted" });
    const submitted = await new ContentLifecycleService(
      new PostgresContentLifecycleStore(pool),
    ).submitAutomaticProductionDraft({
      actorId: "system:auto-publication-worker",
      draftId: "draft-manual-recovery",
      expectedDraftRevision: draftRevision,
      idempotencyKey: "submit-manual-recovery-0001",
      requestId: "request-submit-manual-recovery",
    });
    expect(submitted).toMatchObject({ kind: "submitted", result: { state: "approved" } });
    await expect(
      production.requestImageSlotGeneration({
        actorId: "operator-1",
        draftId: "draft-manual-recovery",
        expectedDraftRevision: draftRevision,
        fortuneDate: "2026-08-14",
        idempotencyKey: "regenerate-after-manual-recovery-submit-0001",
        imageSlot: "required_primary",
        reason: "已提交版本不能再从原 production 草稿生图。",
        requestId: "request-regenerate-after-manual-recovery-submit",
      }),
    ).resolves.toEqual({ kind: "invalid_state" });
    await expect(
      store.claimNextImageJob({
        attemptToken: "attempt-after-manual-recovery-submit",
        claimedAt: "2026-08-02T13:01:00.000Z",
        leaseExpiresAt: "2026-08-02T13:11:00.000Z",
        workerId: "worker-after-manual-recovery-submit",
      }),
    ).resolves.toBeNull();
  });

  it("runs the real PostgreSQL two-image automatic freeze, schedule, and publish chain", async () => {
    const fortuneDate = "2026-08-18";
    const effectiveFrom = "2026-08-17T10:00:00.000Z";
    const productionStore = new PostgresContentProductionStore(pool);
    const production = serviceFor(productionStore, "automatic-release-chain");
    const ensured = await production.ensureDay({
      actorId: "system:content-production-worker",
      fortuneDate,
      idempotencyKey: "ensure-automatic-release-chain-0001",
      requestId: "request-automatic-release-chain",
    });
    expect(ensured).toMatchObject({ production: { fortuneDate } });
    expect(["accepted", "existing"]).toContain(ensured.kind);

    for (const [assetId, digit, attemptToken] of [
      ["asset-automatic-release-primary", "6", "attempt-automatic-release-primary"],
      ["asset-automatic-release-alternative", "7", "attempt-automatic-release-alternative"],
    ] as const) {
      const claimed = await productionStore.claimNextImageJob({
        attemptToken,
        claimedAt: "2026-08-02T14:00:00.000Z",
        leaseExpiresAt: "2026-08-02T14:10:00.000Z",
        workerId: "worker-automatic-release-chain",
      });
      expect(claimed).toMatchObject({ fortuneDate });
      if (claimed === null) return;
      const uploadedRevision = await simulateUploadedCandidate(pool, {
        assetId,
        digit,
        draftId: claimed.draftId,
        draftRevision: claimed.draftRevision,
        fortuneDate: claimed.fortuneDate,
        imageSlot: claimed.imageSlot,
        uploadedAt: "2026-08-02T14:01:00.000Z",
      });
      await productionStore.completeImageJob({
        assetId,
        attemptToken,
        completedAt: "2026-08-02T14:02:00.000Z",
        draftRevision: uploadedRevision,
        jobId: claimed.jobId,
        sha256: digit.repeat(64),
        workerId: "worker-automatic-release-chain",
      });
    }

    const lifecycleStore = new PostgresContentLifecycleStore(pool);
    const lifecycle = new ContentLifecycleService(lifecycleStore);
    const releaseStore = new PostgresContentReleaseStore(pool);
    const release = new ContentReleaseService(releaseStore, {
      now: () => new Date("2026-08-17T09:59:00.000Z"),
    });
    const autoPublication = new ContentAutoPublicationWorker(
      lifecycleStore,
      lifecycle,
      release,
      releaseStore,
      production,
      { now: () => new Date("2026-08-17T09:59:00.000Z") },
      new PostgresDayCorrectionStore(pool),
    );

    await expect(autoPublication.runWindow()).resolves.toEqual({
      failed: 0,
      published: 0,
      scheduled: 1,
      waiting: 0,
    });
    const scheduled = await releaseStore.readProjection(fortuneDate);
    expect(scheduled).toMatchObject({
      activeContentVersion: null,
      scheduledContentVersion: expect.any(String),
      scheduledEffectiveFrom: effectiveFrom,
    });
    if (scheduled?.scheduledContentVersion === null || scheduled === null) return;
    await expect(lifecycle.getVersion(scheduled.scheduledContentVersion)).resolves.toMatchObject({
      snapshot: {
        visual_and_rights: {
          looks: expect.arrayContaining([
            expect.objectContaining({ imageSlot: "required_primary" }),
            expect.objectContaining({ imageSlot: "required_alternative" }),
          ]),
        },
      },
      state: "scheduled",
    });

    const scheduledPublisher = new ContentReleaseService(releaseStore, {
      now: () => new Date(effectiveFrom),
    });
    const scheduleWorker = new ContentReleaseWorker(
      releaseStore,
      scheduledPublisher,
      { now: () => new Date(effectiveFrom) },
      {
        nextAttemptToken: () => "attempt-publish-automatic-release-chain",
        workerId: "worker-publish-automatic-release-chain",
      },
    );
    await expect(scheduleWorker.runOne()).resolves.toBe("published");
    await expect(releaseStore.readProjection(fortuneDate)).resolves.toMatchObject({
      activeContentVersion: scheduled.scheduledContentVersion,
      scheduledContentVersion: null,
    });
  });

  it("turns an expired third claimed attempt into failed before another worker can claim it", async () => {
    const store = new PostgresContentProductionStore(pool);
    const service = serviceFor(store, "expired-terminal");
    await service.ensureDay({
      actorId: "production-test",
      fortuneDate: "2026-08-12",
      idempotencyKey: "ensure-expired-terminal-0001",
      requestId: "request-expired-terminal",
    });
    await pool.query(
      `UPDATE daily_content_image_jobs AS job
          SET status = CASE
                WHEN job.fortune_date = '2026-08-12' AND job.image_slot = 'required_primary'
                  THEN 'queued'
                ELSE 'completed'
              END,
              attempts = CASE
                WHEN job.fortune_date = '2026-08-12' AND job.image_slot = 'required_primary'
                  THEN 2
                ELSE attempts
              END
        FROM daily_content_image_slot_currents AS current
       WHERE current.current_job_id = job.job_id`,
    );
    const claimed = await store.claimNextImageJob({
      attemptToken: "attempt-expired-terminal-third",
      claimedAt: "2026-08-02T11:00:00.000Z",
      leaseExpiresAt: "2026-08-02T11:10:00.000Z",
      workerId: "worker-expired-terminal",
    });
    expect(claimed).toMatchObject({ attempts: 3, fortuneDate: "2026-08-12" });
    await expect(
      store.claimNextImageJob({
        attemptToken: "attempt-expired-terminal-fourth",
        claimedAt: "2026-08-02T11:11:00.000Z",
        leaseExpiresAt: "2026-08-02T11:21:00.000Z",
        workerId: "worker-expired-terminal-second",
      }),
    ).resolves.toBeNull();
    await expect(service.list()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ fortuneDate: "2026-08-12", status: "failed" }),
      ]),
    });
  });
});
