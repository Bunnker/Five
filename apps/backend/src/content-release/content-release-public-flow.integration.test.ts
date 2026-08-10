import type { components } from "@five/api-contract";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DraftModules } from "../content-lifecycle/content-lifecycle.store";
import {
  CURRENT_CALENDAR_ALGORITHM_VERSION,
  CURRENT_CALENDAR_DATA_VERSION,
} from "../content-lifecycle/content-preflight";
import {
  CALENDAR_RULE_VERSION,
  CalendarRuleEngine,
  type FiveElement,
} from "../calendar/calendar-rule-engine";
import type { StoredDailyImageSet } from "../daily-images/daily-image-asset.store";
import { PostgresPublishedContentReader } from "../today/postgres-published-content.reader";
import { ContentReleaseService } from "./content-release.service";
import { PostgresContentReleaseStore } from "./postgres-content-release.store";

const databaseUrl = process.env.FIVE_CONTENT_RELEASE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const fortuneDate = "2026-08-08";

type AdminImageAsset = components["schemas"]["AdminImageAsset"];
type CalendarTier = NonNullable<DraftModules["calendar_algorithm"]>["tiers"][number];

const CALENDAR_ENGINE = new CalendarRuleEngine();
const ELEMENT_LABEL: Readonly<Record<FiveElement, CalendarTier["elementLabel"]>> = {
  earth: "土",
  fire: "火",
  metal: "金",
  water: "水",
  wood: "木",
};
const ELEMENT_COLORS: Readonly<Record<FiveElement, CalendarTier["colors"]>> = {
  earth: [
    { colorCode: "yellow", name: "黄色" },
    { colorCode: "coffee", name: "咖色" },
    { colorCode: "brown", name: "棕色" },
    { colorCode: "khaki", name: "卡其" },
    { colorCode: "dark_brown_family", name: "褐色系" },
  ],
  fire: [
    { colorCode: "red", name: "红色" },
    { colorCode: "orange", name: "橙色" },
    { colorCode: "purple", name: "紫色" },
    { colorCode: "pink_family", name: "粉色系" },
  ],
  metal: [
    { colorCode: "white", name: "白色" },
    { colorCode: "ivory", name: "乳白" },
    { colorCode: "silver", name: "银色" },
    { colorCode: "gold", name: "金色" },
    { colorCode: "light_family", name: "浅色系" },
  ],
  water: [
    { colorCode: "black", name: "黑色" },
    { colorCode: "navy", name: "藏青" },
    { colorCode: "royal_blue", name: "宝蓝" },
    { colorCode: "dark_green", name: "墨绿" },
    { colorCode: "dark_gray_family", name: "深灰系" },
  ],
  wood: [
    { colorCode: "green", name: "绿色" },
    { colorCode: "cyan", name: "青色" },
    { colorCode: "emerald", name: "翠色" },
    { colorCode: "lake_blue", name: "湖蓝" },
    { colorCode: "light_green_family", name: "浅绿系" },
  ],
};
const TIER_METADATA = [
  {
    algorithmLabel: "大吉",
    displayLabel: "今日优先",
    displaySection: "primary",
  },
  {
    algorithmLabel: "次吉",
    displayLabel: "稳妥选择",
    displaySection: "primary",
  },
  {
    algorithmLabel: "平",
    displayLabel: "日常可穿",
    displaySection: "primary",
  },
  {
    algorithmLabel: "较差",
    displayLabel: "注意",
    displaySection: "attention",
  },
  {
    algorithmLabel: "不利",
    displayLabel: "注意",
    displaySection: "attention",
  },
] as const;

function reviewedAsset(assetId: string): AdminImageAsset {
  return {
    aiLabelStatus: "not_applicable",
    altText: `${assetId} 已审核穿搭图`,
    assetId,
    declaredModel: null,
    fileUrl: `https://assets.example.test/${assetId}.webp`,
    generatedAt: null,
    generationMethod: "licensed_upload",
    height: 1600,
    manualReview: {
      aiLabelCompliance: "passed",
      colorAndCopyConsistency: "passed",
      garmentAndPersonIntegrity: "passed",
      mobileAndWechatPreview: "passed",
      notes: "公开链路集成检查通过。",
      reviewId: `review-${assetId}`,
      reviewedAt: "2026-08-07T14:00:00.000Z",
      reviewerAccountId: "operator-public-flow",
      rightsAndIdentityRisk: "passed",
      scenarioAndImitability: "passed",
    },
    mediaType: "image/webp",
    promptVersion: null,
    reproductionReference: null,
    reviewStatus: "approved",
    rightsRecordIds: [`rights-${assetId}`],
    rightsStatus: "cleared",
    sha256: "a".repeat(64),
    sourceMaterialReferences: [`license-${assetId}`],
    sourceType: "licensed",
    width: 1200,
  };
}

function fixture(contentVersion: string): {
  readonly imageSet: StoredDailyImageSet;
  readonly snapshot: DraftModules;
} {
  const calendarAnswer = CALENDAR_ENGINE.evaluate(fortuneDate);
  const tiers: CalendarTier[] = calendarAnswer.tiers.map((tier, index) => {
    const metadata = TIER_METADATA[index]!;
    return {
      ...metadata,
      colors: ELEMENT_COLORS[tier.element],
      element: tier.element,
      elementLabel: ELEMENT_LABEL[tier.element],
      explanation: `${metadata.algorithmLabel}档使用固定五行配色。`,
      rank: tier.rank,
      relationText: "按当日五行关系排序",
      tierCode: tier.tierCode,
    };
  });
  const primaryColor = tiers[0]!.colors[0]!.colorCode;
  const secondaryColor = tiers[1]!.colors[0]!.colorCode;
  const accentColor = tiers[2]!.colors[0]!.colorCode;
  const primaryCover = reviewedAsset(`${contentVersion}-primary`);
  const primaryFallback = reviewedAsset(`${contentVersion}-primary-fallback`);
  const alternativeCover = reviewedAsset(`${contentVersion}-alternative`);
  const alternativeFallback = reviewedAsset(`${contentVersion}-alternative-fallback`);
  const optionalCover = reviewedAsset(`${contentVersion}-optional`);
  const audience = { code: "all", label: "通用" };
  const scenario = { code: "daily", label: "日常" };
  const looks: NonNullable<DraftModules["visual_and_rights"]>["looks"] = [
    {
      alternatives: [],
      audience,
      coverAssetId: primaryCover.assetId,
      detailAssetIds: [],
      fallbackAssetId: primaryFallback.assetId,
      formulaId: "formula-primary",
      imageSlot: "required_primary",
      items: [
        {
          category: "top",
          categoryLabel: "上衣",
          colorCode: primaryColor,
          description: "大吉色上衣",
        },
      ],
      lookId: "look-primary",
      requiredForPublish: true,
      scenario,
      sortOrder: 1,
      title: "常可穿",
    },
    {
      alternatives: [],
      audience,
      coverAssetId: alternativeCover.assetId,
      detailAssetIds: [],
      fallbackAssetId: alternativeFallback.assetId,
      formulaId: "formula-alternative",
      imageSlot: "required_alternative",
      items: [
        {
          category: "top",
          categoryLabel: "上衣",
          colorCode: primaryColor,
          description: "大吉色上衣",
        },
        {
          category: "bottom",
          categoryLabel: "下装",
          colorCode: secondaryColor,
          description: "次吉色下装",
        },
      ],
      lookId: "look-alternative",
      requiredForPublish: true,
      scenario,
      sortOrder: 2,
      title: "换一种穿法",
    },
    {
      alternatives: [],
      audience,
      coverAssetId: optionalCover.assetId,
      detailAssetIds: [],
      fallbackAssetId: null,
      formulaId: "formula-optional",
      imageSlot: "optional",
      items: [
        {
          category: "top",
          categoryLabel: "上衣",
          colorCode: primaryColor,
          description: "大吉色上衣",
        },
        {
          category: "bottom",
          categoryLabel: "下装",
          colorCode: secondaryColor,
          description: "次吉色下装",
        },
        {
          category: "accessory",
          categoryLabel: "配饰",
          colorCode: accentColor,
          description: "平色配饰",
        },
      ],
      lookId: "look-optional",
      requiredForPublish: false,
      scenario,
      sortOrder: 3,
      title: "三色层次穿法",
    },
  ];
  const assets = [
    primaryCover,
    primaryFallback,
    alternativeCover,
    alternativeFallback,
    optionalCover,
  ];
  const snapshot: DraftModules = {
    calendar_algorithm: {
      algorithmVersion: CURRENT_CALENDAR_ALGORITHM_VERSION,
      calendar: {
        branch: calendarAnswer.dayBranch,
        dayElement: calendarAnswer.dayElement,
        dayElementLabel: ELEMENT_LABEL[calendarAnswer.dayElement],
        ganzhiDay: calendarAnswer.ganzhiDay,
        lunarDateText: "六月廿六",
        weekdayText: "星期六",
      },
      calendarDataVersion: CURRENT_CALENDAR_DATA_VERSION,
      calendarRuleVersion: CALENDAR_RULE_VERSION,
      tiers,
    },
    copy_and_formula: {
      balanceSuggestion: {
        accessoryExamples: ["丝巾", "包"],
        description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
        preferredTierCode: "da_ji",
        title: "已经穿了注意色",
      },
      basis: {
        disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
        steps: ["日期干支按固定历法规则计算。"],
      },
      copyVersion: "copy-v1",
      outfitFormulas: [
        {
          audience,
          disclaimer: "普通穿搭建议。",
          formulaId: "formula-primary",
          kind: "mono",
          lookIds: ["look-primary"],
          scenario,
          slots: [
            {
              colorCodes: [primaryColor],
              garmentParts: ["上衣"],
              ratioPercent: 100,
              role: "primary",
              roleLabel: "主色",
              tierCode: "da_ji",
            },
          ],
          title: "常可穿",
        },
        {
          audience,
          disclaimer: "普通穿搭建议。",
          formulaId: "formula-alternative",
          kind: "dual",
          lookIds: ["look-alternative"],
          scenario,
          slots: [
            {
              colorCodes: [primaryColor],
              garmentParts: ["上衣"],
              ratioPercent: 70,
              role: "primary",
              roleLabel: "主色",
              tierCode: "da_ji",
            },
            {
              colorCodes: [secondaryColor],
              garmentParts: ["下装"],
              ratioPercent: 30,
              role: "secondary",
              roleLabel: "辅助色",
              tierCode: "ci_ji",
            },
          ],
          title: "换一种穿法",
        },
        {
          audience,
          disclaimer: "普通穿搭建议。",
          formulaId: "formula-optional",
          kind: "triple",
          lookIds: ["look-optional"],
          scenario,
          slots: [
            {
              colorCodes: [primaryColor],
              garmentParts: ["上衣"],
              ratioPercent: 60,
              role: "primary",
              roleLabel: "主色",
              tierCode: "da_ji",
            },
            {
              colorCodes: [secondaryColor],
              garmentParts: ["下装"],
              ratioPercent: 30,
              role: "secondary",
              roleLabel: "辅助色",
              tierCode: "ci_ji",
            },
            {
              colorCodes: [accentColor],
              garmentParts: ["配饰"],
              ratioPercent: 10,
              role: "accent",
              roleLabel: "点缀色",
              tierCode: "ping",
            },
          ],
          title: "三色层次穿法",
        },
      ],
      outfitVersion: "outfit-v1",
      share: {
        copyText: "今日五行穿衣建议",
        posterJobEndpoint: "/api/v1/poster-jobs",
        posterTemplateVersion: "poster-v1",
        summaryText: "今日穿衣配色",
      },
    },
    poster_consistency: {
      posterTemplateVersion: "poster-v1",
      sampleAssetId: primaryCover.assetId,
      templateId: "poster-template-one",
    },
    visual_and_rights: {
      assetManifestVersion: "assets-v1",
      assets,
      looks,
      rightsRecords: assets.map((asset) => ({
        kind: "internal_record",
        recordedAt: "2026-08-07T13:00:00.000Z",
        reference: `rights-reference-${asset.assetId}`,
        rightsRecordId: asset.rightsRecordIds[0]!,
      })),
    },
  };
  return {
    imageSet: {
      assets,
      contentVersion,
      fortuneDate,
      lifecycleRevision: 1,
      slots: [
        {
          coverAssetId: primaryCover.assetId,
          deliveryStatus: "active",
          detailAssetIds: [],
          fallbackAssetId: primaryFallback.assetId,
          imageSlot: "required_primary",
          lookId: "look-primary",
          servedCoverAssetId: primaryCover.assetId,
          servedDetailAssetIds: [],
        },
        {
          coverAssetId: alternativeCover.assetId,
          deliveryStatus: "active",
          detailAssetIds: [],
          fallbackAssetId: alternativeFallback.assetId,
          imageSlot: "required_alternative",
          lookId: "look-alternative",
          servedCoverAssetId: alternativeCover.assetId,
          servedDetailAssetIds: [],
        },
        {
          coverAssetId: optionalCover.assetId,
          deliveryStatus: "active",
          detailAssetIds: [],
          fallbackAssetId: null,
          imageSlot: "optional",
          lookId: "look-optional",
          servedCoverAssetId: optionalCover.assetId,
          servedDetailAssetIds: [],
        },
      ],
      withdrawalEvents: [],
    },
    snapshot,
  };
}

async function seedApprovedVersion(pool: Pool, contentVersion: string): Promise<void> {
  const { imageSet, snapshot } = fixture(contentVersion);
  const draftId = `draft-${contentVersion}`;
  await pool.query(
    `INSERT INTO content_drafts (
       draft_id, fortune_date, draft_revision, modules, submitted_content_version,
       created_at, updated_at, submitted_at
     ) VALUES (
       $1, $2::date, 1, $3::jsonb, NULL,
       '2026-08-07T12:00:00.000Z'::timestamptz,
       '2026-08-07T12:00:00.000Z'::timestamptz, NULL
     )`,
    [draftId, fortuneDate, JSON.stringify(snapshot)],
  );
  await pool.query(
    `INSERT INTO content_versions (
       content_version, draft_id, fortune_date, state, snapshot, preflight_checks,
       created_at, effective_from, effective_to
     ) VALUES (
       $1, $2, $3::date, 'approved', $4::jsonb, '[]'::jsonb,
       '2026-08-07T12:00:00.000Z'::timestamptz,
       '2026-08-07T10:00:00.000Z'::timestamptz,
       '2026-08-08T10:00:00.000Z'::timestamptz
     )`,
    [contentVersion, draftId, fortuneDate, JSON.stringify(snapshot)],
  );
  await pool.query(
    `INSERT INTO daily_image_sets (
       content_version, fortune_date, lifecycle_revision, assets_json, slots_json, created_at
     ) VALUES ($1, $2::date, 1, $3::jsonb, $4::jsonb, '2026-08-07T14:00:00.000Z')`,
    [contentVersion, fortuneDate, JSON.stringify(imageSet.assets), JSON.stringify(imageSet.slots)],
  );
  await pool.query(
    `INSERT INTO master_review_evidence (
       evidence_id, content_version, reviewer_display_name, reviewed_at,
       conclusion, notes, references_json, recorded_at, recorded_revision
     ) VALUES (
       $1, $2, '林老师', '2026-08-07T14:30:00.000Z'::timestamptz,
       'confirmed', '已核对当前内容版本、完整五档与穿搭公式。', $3::jsonb,
       '2026-08-07T14:35:00.000Z'::timestamptz, 1
     )`,
    [
      `evidence-${contentVersion}`,
      contentVersion,
      JSON.stringify([{ kind: "note", reference: `master-confirmed-${contentVersion}` }]),
    ],
  );
}

describeDatabase("content release to public PostgreSQL flow", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
  });

  afterAll(async () => pool.end());

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE poster_jobs, content_drafts, content_lifecycle_days CASCADE");
    await pool.query(
      "DELETE FROM content_lifecycle_idempotency WHERE operation IN ('schedule', 'cancel_schedule', 'publish', 'withdraw', 'rollback')",
    );
  });

  it("publishes, replaces and safely withdraws while anonymous reads follow the active pointer", async () => {
    const firstVersion = "content-public-flow-v1";
    const secondVersion = "content-public-flow-v2";
    await pool.query(
      `INSERT INTO content_lifecycle_days (
         fortune_date, lifecycle_revision, active_content_version,
         schedule_slot_revision, scheduled_content_version, scheduled_effective_from
       ) VALUES ($1::date, 3, NULL, 0, NULL, NULL)`,
      [fortuneDate],
    );
    await seedApprovedVersion(pool, firstVersion);
    await seedApprovedVersion(pool, secondVersion);

    let identifier = 0;
    const store = new PostgresContentReleaseStore(pool);
    const release = new ContentReleaseService(
      store,
      { now: () => new Date("2026-08-07T16:00:00.000Z") },
      {
        nextAuditEventId: () => `audit-public-flow-${++identifier}`,
        nextPurgeIntentId: () => `purge-public-flow-${++identifier}`,
        nextReleaseEventId: () => `release-public-flow-${++identifier}`,
        nextScheduleTaskId: () => `schedule-public-flow-${++identifier}`,
      },
    );
    const reader = new PostgresPublishedContentReader(pool);

    await expect(
      release.publish({
        actorId: "operator-public-flow",
        contentVersion: firstVersion,
        expectedActiveContentVersion: null,
        expectedLifecycleRevision: 3,
        idempotencyKey: "publish-public-flow-v1",
        reason: "发布第一份已核对内容。",
        requestId: "request-public-flow-v1",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
    await expect(reader.findActiveByFortuneDate(fortuneDate)).resolves.toMatchObject({
      looks: [
        { lookId: "look-primary" },
        { lookId: "look-alternative" },
        { lookId: "look-optional" },
      ],
      versions: { contentVersion: firstVersion },
    });

    await expect(
      release.publish({
        actorId: "operator-public-flow",
        contentVersion: secondVersion,
        expectedActiveContentVersion: firstVersion,
        expectedLifecycleRevision: 4,
        idempotencyKey: "publish-public-flow-v2",
        reason: "用第二份已核对内容替换第一份。",
        requestId: "request-public-flow-v2",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
    await expect(
      reader.resolve({ expectedContentVersion: firstVersion, fortuneDate }),
    ).resolves.toMatchObject({
      content: { versions: { contentVersion: secondVersion } },
      kind: "ready",
      reason: "replaced",
    });

    await expect(
      release.withdraw({
        actorId: "operator-public-flow",
        contentVersion: secondVersion,
        expectedActiveContentVersion: secondVersion,
        expectedLifecycleRevision: 5,
        idempotencyKey: "withdraw-public-flow-v2",
        reason: "第二份内容需要紧急下线，恢复安全旧版本。",
        replacementContentVersion: firstVersion,
        requestId: "request-public-withdraw-v2",
      }),
    ).resolves.toMatchObject({
      action: { activeContentVersion: firstVersion },
      kind: "applied",
    });
    await expect(
      reader.resolve({ expectedContentVersion: secondVersion, fortuneDate }),
    ).resolves.toMatchObject({
      content: { versions: { contentVersion: firstVersion } },
      kind: "ready",
      reason: "withdrawn",
    });
    await expect(store.listPublicCachePurgeIntents(fortuneDate)).resolves.toHaveLength(3);
  });
});
