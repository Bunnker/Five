import type { components } from "@five/api-contract";
import type { Pool, PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PostgresPublishedContentReader } from "./postgres-published-content.reader";

type AdminImageAsset = components["schemas"]["AdminImageAsset"];
type DraftModules = components["schemas"]["DraftModules"];

function result<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rowCount: rows.length,
    rows,
  };
}

function asset(assetId: string): AdminImageAsset {
  return {
    aiLabelStatus: "not_applicable",
    altText: `${assetId} 穿搭图`,
    assetId,
    declaredModel: null,
    fileUrl: `https://cdn.five.test/${assetId}.webp`,
    generatedAt: null,
    generationMethod: "licensed_upload",
    height: 1600,
    manualReview: {
      aiLabelCompliance: "passed",
      colorAndCopyConsistency: "passed",
      garmentAndPersonIntegrity: "passed",
      mobileAndWechatPreview: "passed",
      notes: "检查通过。",
      reviewId: `review-${assetId}`,
      reviewedAt: "2026-08-01T11:00:00+08:00",
      reviewerAccountId: "operator-one",
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
    sourceMaterialReferences: [`source-${assetId}`],
    sourceType: "licensed",
    width: 1200,
  };
}

const primary = asset("asset-reader-primary");
const primaryFallback = asset("asset-reader-primary-fallback");
const alternative = asset("asset-reader-alternative");
const alternativeFallback = asset("asset-reader-alternative-fallback");

function databaseSnapshot(): DraftModules {
  const scenario = { code: "daily", label: "日常" };
  const audience = { code: "all", label: "通用" };
  return {
    calendar_algorithm: {
      algorithmVersion: "reader-algorithm-v1",
      calendar: {
        branch: "申",
        dayElement: "metal",
        dayElementLabel: "金",
        ganzhiDay: "庚申日",
        lunarDateText: "六月廿五",
        weekdayText: "星期六",
      },
      calendarDataVersion: "reader-calendar-data-v1",
      calendarRuleVersion: "reader-calendar-rule-v1",
      tiers: [],
    },
    copy_and_formula: {
      balanceSuggestion: {
        accessoryExamples: ["包"],
        description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
        preferredTierCode: "da_ji",
        title: "已经穿了注意色",
      },
      basis: {
        disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
        steps: ["固定历法规则。"],
      },
      copyVersion: "reader-copy-v1",
      outfitFormulas: [],
      outfitVersion: "reader-outfit-v1",
      share: {
        copyText: "今日穿搭",
        posterJobEndpoint: "/api/v1/poster-jobs",
        posterTemplateVersion: "reader-poster-v1",
        summaryText: "今日颜色",
      },
    },
    poster_consistency: {
      posterTemplateVersion: "reader-poster-v1",
      sampleAssetId: primary.assetId,
      templateId: "reader-template-v1",
    },
    visual_and_rights: {
      assetManifestVersion: "reader-assets-v1",
      assets: [primary, primaryFallback, alternative, alternativeFallback],
      looks: [
        {
          alternatives: [],
          audience,
          coverAssetId: primary.assetId,
          detailAssetIds: [],
          fallbackAssetId: primaryFallback.assetId,
          formulaId: "formula-reader-primary",
          imageSlot: "required_primary",
          items: [
            {
              category: "top",
              categoryLabel: "上衣",
              colorCode: "reader-green",
              description: "绿色上衣",
            },
          ],
          lookId: "look-reader-primary",
          requiredForPublish: true,
          scenario,
          sortOrder: 1,
          title: "主要穿法",
        },
        {
          alternatives: [],
          audience,
          coverAssetId: alternative.assetId,
          detailAssetIds: [],
          fallbackAssetId: alternativeFallback.assetId,
          formulaId: "formula-reader-alternative",
          imageSlot: "required_alternative",
          items: [
            {
              category: "dress",
              categoryLabel: "连衣裙",
              colorCode: "reader-blue",
              description: "藏青连衣裙",
            },
          ],
          lookId: "look-reader-alternative",
          requiredForPublish: true,
          scenario,
          sortOrder: 2,
          title: "备选穿法",
        },
      ],
      rightsRecords: [primary, primaryFallback, alternative, alternativeFallback].map(
        (candidate) => ({
          kind: "internal_record" as const,
          recordedAt: "2026-08-01T09:00:00+08:00",
          reference: `rights-reference-${candidate.assetId}`,
          rightsRecordId: candidate.rightsRecordIds[0]!,
        }),
      ),
    },
  };
}

interface PublishedDatabaseOptions {
  expectedVersionState?: "superseded" | "withdrawn";
  releaseAction?: "publish" | "rollback" | "withdraw";
  releaseAfterActiveContentVersion?: string | null;
}

function publishedDatabase({
  expectedVersionState,
  releaseAction,
  releaseAfterActiveContentVersion = "content-reader-v1",
}: PublishedDatabaseOptions = {}) {
  const statements: string[] = [];
  const client = {
    query: vi.fn((statement: string) => {
      const normalized = statement.trim().replaceAll(/\s+/gu, " ");
      statements.push(normalized);
      if (normalized.includes("FROM content_lifecycle_days AS day")) {
        return Promise.resolve(
          result([
            {
              content_version: "content-reader-v1",
              created_at: new Date("2026-08-01T04:00:00.000Z"),
              draft_id: "draft-reader-v1",
              effective_from: new Date("2026-08-07T15:00:00.000Z"),
              effective_to: new Date("2026-08-08T15:00:00.000Z"),
              fortune_date: "2026-08-08",
              preflight_checks: [],
              snapshot: databaseSnapshot(),
              state: "published",
            },
          ]),
        );
      }
      if (normalized.includes("FROM daily_image_sets")) {
        return Promise.resolve(
          result([
            {
              assets_json: [primary, primaryFallback, alternative, alternativeFallback],
              content_version: "content-reader-v1",
              fortune_date: "2026-08-08",
              lifecycle_revision: 9,
              slots_json: [
                {
                  coverAssetId: primary.assetId,
                  deliveryStatus: "active",
                  detailAssetIds: [],
                  fallbackAssetId: primaryFallback.assetId,
                  imageSlot: "required_primary",
                  lookId: "look-reader-primary",
                  servedCoverAssetId: primary.assetId,
                  servedDetailAssetIds: [],
                },
                {
                  coverAssetId: alternative.assetId,
                  deliveryStatus: "active",
                  detailAssetIds: [],
                  fallbackAssetId: alternativeFallback.assetId,
                  imageSlot: "required_alternative",
                  lookId: "look-reader-alternative",
                  servedCoverAssetId: alternative.assetId,
                  servedDetailAssetIds: [],
                },
              ],
            },
          ]),
        );
      }
      if (normalized.includes("FROM image_asset_withdrawal_events")) {
        return Promise.resolve(
          result([
            {
              asset_id: primary.assetId,
              audit_event_id: "audit-reader-primary-withdrawn",
              reason: "权利记录失效。",
              withdrawal_event_id: "withdraw-reader-primary",
              withdrawn_at: new Date("2026-08-02T04:00:00.000Z"),
            },
          ]),
        );
      }
      if (normalized.includes("FROM content_versions AS expected_version")) {
        return Promise.resolve(
          expectedVersionState === undefined
            ? result([])
            : result([{ state: expectedVersionState }]),
        );
      }
      if (normalized.includes("FROM content_release_events")) {
        return Promise.resolve(
          releaseAction === undefined
            ? result([])
            : result([
                {
                  action: releaseAction,
                  after_active_content_version: releaseAfterActiveContentVersion,
                },
              ]),
        );
      }
      return Promise.resolve(result([]));
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: () => Promise.resolve(client as unknown as PoolClient),
  } as Pick<Pool, "connect">;

  return { client, pool, statements };
}

describe("PostgresPublishedContentReader", () => {
  it("returns null from one repeatable-read snapshot when the day has no published active version", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn((statement: string) => {
        statements.push(statement.trim().replaceAll(/\s+/gu, " "));
        return Promise.resolve(statement.startsWith("SELECT") ? result([]) : result([]));
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: () => Promise.resolve(client as unknown as PoolClient),
    } as Pick<Pool, "connect">;

    await expect(
      new PostgresPublishedContentReader(pool).findActiveByFortuneDate("2026-08-08"),
    ).resolves.toBeNull();
    expect(statements[0]).toBe("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("returns the published active version with the current global image withdrawal projection", async () => {
    const { pool, statements } = publishedDatabase();

    const reader = new PostgresPublishedContentReader(pool);
    const content = await reader.findActiveByFortuneDate("2026-08-08");

    expect(content).toMatchObject({
      effectiveFrom: "2026-08-07T15:00:00.000Z",
      effectiveTo: "2026-08-08T15:00:00.000Z",
      fortuneDate: "2026-08-08",
      looks: [
        {
          coverImage: { assetId: primaryFallback.assetId },
          lookId: "look-reader-primary",
        },
        {
          coverImage: { assetId: alternative.assetId },
          lookId: "look-reader-alternative",
        },
      ],
      versions: { contentVersion: "content-reader-v1" },
    });
    expect(
      statements.some((statement) => statement.includes("image_asset_withdrawal_events")),
    ).toBe(true);
    expect(statements.at(-1)).toBe("COMMIT");

    await expect(
      reader.resolve({ expectedContentVersion: null, fortuneDate: "2026-08-08" }),
    ).resolves.toMatchObject({
      kind: "ready",
      reason: "current",
    });
  });

  it.each([
    {
      expectedContentVersion: "content-reader-v1",
      expectedReason: "current",
      name: "the expected version is still active",
      options: {},
    },
    {
      expectedContentVersion: "content-reader-withdrawn",
      expectedReason: "withdrawn",
      name: "the expected version was withdrawn",
      options: {
        expectedVersionState: "withdrawn",
        releaseAction: "rollback",
      },
    },
    {
      expectedContentVersion: "content-reader-old",
      expectedReason: "rolled_back",
      name: "the active version was restored by rollback",
      options: {
        expectedVersionState: "superseded",
        releaseAction: "rollback",
      },
    },
    {
      expectedContentVersion: "content-reader-old",
      expectedReason: "rolled_back",
      name: "withdrawal restored the current active version",
      options: {
        expectedVersionState: "superseded",
        releaseAction: "withdraw",
      },
    },
    {
      expectedContentVersion: "content-reader-old",
      expectedReason: "replaced",
      name: "a normal publish replaced the expected version",
      options: {
        expectedVersionState: "superseded",
        releaseAction: "publish",
      },
    },
    {
      expectedContentVersion: "content-reader-old",
      expectedReason: "replaced",
      name: "withdrawal did not activate the served version",
      options: {
        expectedVersionState: "superseded",
        releaseAction: "withdraw",
        releaseAfterActiveContentVersion: "content-reader-other",
      },
    },
  ] as const)("resolves $expectedReason when $name", async (testCase) => {
    const { pool, statements } = publishedDatabase(testCase.options);

    await expect(
      new PostgresPublishedContentReader(pool).resolve({
        expectedContentVersion: testCase.expectedContentVersion,
        fortuneDate: "2026-08-08",
      }),
    ).resolves.toMatchObject({
      content: { versions: { contentVersion: "content-reader-v1" } },
      kind: "ready",
      reason: testCase.expectedReason,
    });

    expect(
      statements.filter((statement) => statement.includes("FROM content_lifecycle_days AS day")),
    ).toHaveLength(1);
    expect(statements[0]).toBe("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(statements.at(-1)).toBe("COMMIT");
  });
});
