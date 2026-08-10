import { randomUUID } from "node:crypto";

import type { components } from "@five/api-contract";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import { PostgresContentLifecycleStore } from "../content-lifecycle/postgres-content-lifecycle.store";
import { DayCorrectionImageJobService } from "./day-correction-image-job.service";
import { DayCorrectionWorkflow, type DayCorrectionContentPort } from "./day-correction.workflow";
import { PostgresCorrectionImageLibrary } from "./postgres-correction-image-library";
import { PostgresDayCorrectionImageActionIdempotencyStore } from "./postgres-day-correction-image-action-idempotency.store";
import { PostgresDayCorrectionImageJobStore } from "./postgres-day-correction-image-job.store";
import { PostgresDayCorrectionStore } from "./postgres-day-correction.store";

const databaseUrl = process.env.FIVE_CONTENT_LIFECYCLE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

type AdminImageAsset = components["schemas"]["AdminImageAsset"];
type DraftModules = components["schemas"]["DraftModules"];

function opaque(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function modules(assetId: string = "asset-old-target"): DraftModules {
  const tier = (
    rank: number,
    tierCode: "bu_li" | "ci_ji" | "da_ji" | "jiao_cha" | "ping",
    algorithmLabel: "不利" | "次吉" | "大吉" | "较差" | "平",
    colorCode: string,
  ) => ({
    algorithmLabel,
    colors: [{ colorCode, name: colorCode }],
    displayLabel:
      rank === 1
        ? ("今日优先" as const)
        : rank === 2
          ? ("稳妥选择" as const)
          : rank === 3
            ? ("日常可穿" as const)
            : ("注意" as const),
    displaySection: rank <= 3 ? ("primary" as const) : ("attention" as const),
    element: "metal" as const,
    elementLabel: "金" as const,
    explanation: `${algorithmLabel}说明`,
    rank,
    relationText: "集成测试关系",
    tierCode,
  });
  return {
    calendar_algorithm: {
      algorithmVersion: "integration-algorithm-v1",
      calendar: {
        branch: "申",
        dayElement: "metal",
        dayElementLabel: "金",
        ganzhiDay: "戊申",
        lunarDateText: "冬月初一",
        weekdayText: "星期一",
      },
      calendarDataVersion: "integration-calendar-v1",
      calendarRuleVersion: "fortune-date-23h-v1",
      tiers: [
        tier(1, "da_ji", "大吉", "white"),
        tier(2, "ci_ji", "次吉", "silver"),
        tier(3, "ping", "平", "blue"),
        tier(4, "jiao_cha", "较差", "red"),
        tier(5, "bu_li", "不利", "green"),
      ],
    },
    copy_and_formula: null,
    poster_consistency: null,
    visual_and_rights: {
      assetManifestVersion: "integration-assets-v1",
      assets: [],
      looks: [
        {
          alternatives: [],
          audience: { code: "all", label: "通用" },
          coverAssetId: assetId,
          detailAssetIds: [],
          fallbackAssetId: "asset-fallback-target",
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
  };
}

function safeAsset(assetId: string): AdminImageAsset {
  return {
    aiLabelStatus: "not_applicable",
    altText: "白色通勤模特穿搭",
    assetId,
    declaredModel: null,
    fileUrl: `https://assets.example.test/${assetId}.png`,
    generatedAt: null,
    generationMethod: "licensed_upload",
    height: 1200,
    manualReview: {
      aiLabelCompliance: "passed",
      colorAndCopyConsistency: "passed",
      garmentAndPersonIntegrity: "passed",
      mobileAndWechatPreview: "passed",
      notes: "集成测试检查通过。",
      reviewId: opaque("review"),
      reviewedAt: "2026-12-20T08:00:00.000Z",
      reviewerAccountId: "operator-integration",
      rightsAndIdentityRisk: "passed",
      scenarioAndImitability: "passed",
    },
    mediaType: "image/png",
    promptVersion: null,
    reproductionReference: null,
    reviewStatus: "approved",
    rightsRecordIds: [opaque("rights")],
    rightsStatus: "cleared",
    sha256: "a".repeat(64),
    sourceMaterialReferences: [opaque("source")],
    sourceType: "licensed",
    width: 900,
  };
}

describeDatabase("day correction PostgreSQL ownership and image actions", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 8 });
  });

  afterAll(async () => pool.end());

  it("recovers an open intent, atomically reuses a safe asset, and audits regeneration", async () => {
    const suffix = randomUUID().slice(0, 8);
    const targetDate = new Date(
      Date.UTC(2030, 0, 2 + (Number.parseInt(suffix.slice(0, 6), 16) % 20_000)),
    );
    const sourceDate = new Date(targetDate.valueOf() - 24 * 60 * 60 * 1_000);
    const fortuneDate = targetDate.toISOString().slice(0, 10);
    const sourceFortuneDate = sourceDate.toISOString().slice(0, 10);
    const correctionId = `correction-pg-${suffix}`;
    const baselineDraftId = `draft-baseline-pg-${suffix}`;
    const targetDraftId = `draft-correction-pg-${suffix}`;
    const sourceDraftId = `draft-source-pg-${suffix}`;
    const sourceContentVersion = `content-source-pg-${suffix}`;
    const assetId = `asset-source-pg-${suffix}`;
    const now = "2026-12-20T08:00:00.000Z";
    const lifecycle = new ContentLifecycleService(new PostgresContentLifecycleStore(pool));
    const correctionStore = new PostgresDayCorrectionStore(pool);

    await expect(
      lifecycle.createDraft({
        actorId: "operator-integration",
        copyFromContentVersion: null,
        draftId: baselineDraftId,
        fortuneDate,
        requestId: opaque("request-create-baseline-target"),
      }),
    ).resolves.toMatchObject({ draft: { draftId: baselineDraftId }, kind: "created" });

    const intent = await correctionStore.reserveOrGetOpenIntent({
      baselineActiveContentVersion: null,
      baselineLifecycleRevision: 0,
      correctionId,
      createdAt: now,
      draftId: targetDraftId,
      fortuneDate,
      sourceContentVersion: null,
      sourceDraftId: baselineDraftId,
    });
    await expect(correctionStore.hasOpenOwnership(fortuneDate, new Date(now))).resolves.toBe(true);
    await expect(
      correctionStore.hasOpenOwnership(fortuneDate, new Date(Date.parse(now) + 15 * 60 * 1_000)),
    ).resolves.toBe(false);
    await expect(
      lifecycle.createDraft({
        actorId: "operator-integration",
        copyFromContentVersion: null,
        copyFromDraftId: baselineDraftId,
        draftId: intent.draftId,
        fortuneDate,
        requestId: opaque("request-create-target"),
      }),
    ).resolves.toMatchObject({ draft: { draftId: targetDraftId }, kind: "created" });

    const content = {
      createDraft: (input: Parameters<ContentLifecycleService["createDraft"]>[0]) =>
        lifecycle.createDraft(input),
      readDraft: (draftId: string) => lifecycle.getDraft(draftId),
      resolveBaseline: async () => ({
        activeContentVersion: null,
        copySourceContentVersion: null,
        copySourceDraftId: baselineDraftId,
        lifecycleRevision: 0,
      }),
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      correctionStore,
      content,
      { resolve: () => undefined as never },
      { now: () => new Date(now) },
      {
        nextCorrectionId: () => `unused-correction-${suffix}`,
        nextDraftId: () => `unused-draft-${suffix}`,
      },
    );
    await expect(
      workflow.openWorkingCopy({
        actorId: "operator-integration",
        fortuneDate,
        requestId: opaque("request-recover-target"),
      }),
    ).resolves.toMatchObject({
      correction: { correctionId, draftId: targetDraftId, status: "open" },
      draft: { draftId: targetDraftId },
      kind: "ready",
    });
    await expect(
      correctionStore.hasOpenOwnership(
        fortuneDate,
        new Date(Date.parse(now) + 15 * 60 * 1_000 - 1),
      ),
    ).resolves.toBe(true);
    await expect(
      correctionStore.hasOpenOwnership(fortuneDate, new Date(Date.parse(now) + 15 * 60 * 1_000)),
    ).resolves.toBe(false);
    const targetDraftCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM content_drafts WHERE draft_id = $1",
      [targetDraftId],
    );
    expect(targetDraftCount.rows[0]?.count).toBe("1");

    const targetModules = modules();
    await pool.query("UPDATE content_drafts SET modules = $2::jsonb WHERE draft_id = $1", [
      targetDraftId,
      JSON.stringify(targetModules),
    ]);
    const asset = safeAsset(assetId);
    const fixtureClient = await pool.connect();
    try {
      await fixtureClient.query("BEGIN");
      await fixtureClient.query(
        `INSERT INTO content_lifecycle_days (fortune_date, lifecycle_revision)
         VALUES ($1::date, 1)`,
        [sourceFortuneDate],
      );
      await fixtureClient.query(
        `INSERT INTO content_drafts (
           draft_id, fortune_date, draft_revision, modules, submitted_content_version,
           created_at, updated_at, submitted_at
         ) VALUES ($1, $2::date, 1, $3::jsonb, NULL, $4::timestamptz,
                   $4::timestamptz, NULL)`,
        [sourceDraftId, sourceFortuneDate, JSON.stringify(modules(assetId)), now],
      );
      await fixtureClient.query(
        `INSERT INTO content_versions (
           content_version, draft_id, fortune_date, state, snapshot,
           preflight_checks, created_at, effective_from, effective_to
         ) VALUES ($1, $2, $3::date, 'published', $4::jsonb, '[]'::jsonb,
                   $5::timestamptz, $6::timestamptz, $7::timestamptz)`,
        [
          sourceContentVersion,
          sourceDraftId,
          sourceFortuneDate,
          JSON.stringify(modules(assetId)),
          now,
          `${sourceFortuneDate}T00:00:00.000Z`,
          `${fortuneDate}T00:00:00.000Z`,
        ],
      );
      await fixtureClient.query(
        `UPDATE content_drafts
            SET submitted_content_version = $2, submitted_at = $3::timestamptz
          WHERE draft_id = $1`,
        [sourceDraftId, sourceContentVersion, now],
      );
      await fixtureClient.query(
        `INSERT INTO daily_image_assets (
           asset_id, storage_key, sha256, asset_json, uploaded_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)`,
        [assetId, `aa/${"a".repeat(64)}.png`, asset.sha256, JSON.stringify(asset), now],
      );
      await fixtureClient.query(
        `INSERT INTO daily_image_sets (
           content_version, fortune_date, lifecycle_revision, assets_json,
           slots_json, created_at
         ) VALUES ($1, $2::date, 1, $3::jsonb, $4::jsonb, $5::timestamptz)`,
        [
          sourceContentVersion,
          sourceFortuneDate,
          JSON.stringify([asset]),
          JSON.stringify([
            {
              coverAssetId: assetId,
              deliveryStatus: "active",
              imageSlot: "required_primary",
              servedCoverAssetId: assetId,
            },
          ]),
          now,
        ],
      );
      await fixtureClient.query("COMMIT");
    } catch (error) {
      await fixtureClient.query("ROLLBACK");
      throw error;
    } finally {
      fixtureClient.release();
    }

    const library = new PostgresCorrectionImageLibrary(pool, () => new Date(now));
    const reuseInput = {
      actorId: "operator-integration",
      assetId,
      correctionId,
      expectedRevision: { correctionRevision: 1, draftRevision: 1 },
      idempotencyKey: `correction-reuse-${suffix}`,
      imageSlot: "required_primary" as const,
      reason: "复用经过检查的搭配图。",
      requestId: `request-reuse-${suffix}`,
      sourceContentVersion,
    };
    await expect(library.copyEligibleToDraft(reuseInput)).resolves.toMatchObject({
      correctionRevision: 1,
      kind: "copied",
      result: { asset: { assetId }, draftRevision: 2, selectedForSlot: true },
    });
    await expect(library.copyEligibleToDraft(reuseInput)).resolves.toMatchObject({
      kind: "existing",
      result: { draftRevision: 2 },
    });
    const selected = await pool.query<{
      asset_id: string;
      cover_asset_id: string;
      selection_source: string;
    }>(
      `SELECT selection.asset_id, selection.selection_source,
              draft.modules #>> '{visual_and_rights,looks,0,coverAssetId}' AS cover_asset_id
         FROM draft_image_slot_selections AS selection
         JOIN content_drafts AS draft ON draft.draft_id = selection.draft_id
        WHERE selection.draft_id = $1 AND selection.image_slot = 'required_primary'`,
      [targetDraftId],
    );
    expect(selected.rows[0]).toEqual({
      asset_id: assetId,
      cover_asset_id: assetId,
      selection_source: "correction_library",
    });
    const reuseEvidence = await pool.query<{
      actor_id: string;
      reason: string;
      request_id: string;
    }>(
      `SELECT actor_id, reason, request_id
         FROM day_correction_image_reuse_events
        WHERE correction_id = $1`,
      [correctionId],
    );
    expect(reuseEvidence.rows[0]).toEqual({
      actor_id: "operator-integration",
      reason: reuseInput.reason,
      request_id: reuseInput.requestId,
    });

    const actionIdempotency = new PostgresDayCorrectionImageActionIdempotencyStore(pool);
    const candidateAction = {
      correctionId,
      idempotencyKey: `correction-candidate-${suffix}`,
      operation: "candidate_select" as const,
      requestHash: "b".repeat(64),
      result: {
        assetId,
        correctionRevision: 1,
        draftRevision: 2,
        kind: "replaced" as const,
        previewUrl: `/admin/api/v1/image-assets/${assetId}/preview`,
      },
    };
    await expect(actionIdempotency.record(candidateAction)).resolves.toEqual({
      kind: "recorded",
      result: candidateAction.result,
    });
    await expect(actionIdempotency.find(candidateAction)).resolves.toEqual({
      kind: "existing",
      result: candidateAction.result,
    });
    await expect(
      actionIdempotency.find({ ...candidateAction, requestHash: "c".repeat(64) }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });

    const uploadAction = {
      ...candidateAction,
      operation: "upload" as const,
      requestHash: "d".repeat(64),
      result: { ...candidateAction.result, kind: "existing" as const },
    };
    await expect(actionIdempotency.record(uploadAction)).resolves.toEqual({
      kind: "recorded",
      result: uploadAction.result,
    });
    await expect(actionIdempotency.find(uploadAction)).resolves.toEqual({
      kind: "existing",
      result: uploadAction.result,
    });

    const imageJobs = new DayCorrectionImageJobService(
      new PostgresDayCorrectionImageJobStore(pool),
      { now: () => new Date(now) },
      { nextJobId: () => `correction-image-job-${suffix}` },
    );
    const regenerationInput = {
      actorId: "operator-integration",
      correctionId,
      expectedRevision: { correctionRevision: 1, draftRevision: 2 },
      idempotencyKey: `correction-regenerate-${suffix}`,
      imageSlot: "required_primary",
      reason: "重新生成主图。",
      requestId: `request-regenerate-${suffix}`,
    } as const;
    await expect(imageJobs.requestGeneration(regenerationInput)).resolves.toMatchObject({
      kind: "requested",
      view: {
        job: {
          actorId: "operator-integration",
          reason: regenerationInput.reason,
          requestId: regenerationInput.requestId,
          requestedAt: now,
        },
      },
    });
    await pool.query("UPDATE content_drafts SET draft_revision = 3 WHERE draft_id = $1", [
      targetDraftId,
    ]);
    await expect(imageJobs.requestGeneration(regenerationInput)).resolves.toMatchObject({
      kind: "existing",
      view: { revision: { correctionRevision: 1, draftRevision: 2 } },
    });
    const requestEvidence = await pool.query<{
      actor_id: string;
      reason: string;
      request_id: string;
    }>(
      `SELECT actor_id, reason, request_id
         FROM day_correction_image_request_events
        WHERE correction_id = $1`,
      [correctionId],
    );
    expect(requestEvidence.rows[0]).toEqual({
      actor_id: "operator-integration",
      reason: regenerationInput.reason,
      request_id: regenerationInput.requestId,
    });
    await expect(
      pool.query(
        `UPDATE day_correction_image_request_events
            SET reason = '不允许改写'
          WHERE correction_id = $1`,
        [correctionId],
      ),
    ).rejects.toThrow(/append-only/u);

    await expect(
      pool.query(
        `INSERT INTO day_correction_image_jobs (
           job_id, correction_id, draft_id, fortune_date, image_slot,
           generation_revision, prompt_version, status, attempts, attempt_limit,
           available_at, actor_id, reason, request_id, requested_at, created_at
         ) VALUES ($1, $2, $3, $4::date, 'optional', 99, 'prompt-v1',
                   'queued', 0, 3, $5::timestamptz, 'operator-integration',
                   '伪造所有权。', $6, $5::timestamptz, $5::timestamptz)`,
        [
          `forged-job-${suffix}`,
          correctionId,
          sourceDraftId,
          fortuneDate,
          now,
          `request-forged-${suffix}`,
        ],
      ),
    ).rejects.toMatchObject({ constraint: "day_correction_image_jobs_owner_fk" });
    const ownerConstraints = await pool.query<{ conname: string }>(
      `SELECT conname
         FROM pg_constraint
        WHERE conname IN (
          'day_correction_image_jobs_owner_fk',
          'day_correction_image_slot_currents_owner_fk'
        )
        ORDER BY conname`,
    );
    expect(ownerConstraints.rows.map((row) => row.conname)).toEqual([
      "day_correction_image_jobs_owner_fk",
      "day_correction_image_slot_currents_owner_fk",
    ]);
  });
});
