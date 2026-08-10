import type { components } from "@five/api-contract";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { CalendarRuleEngine } from "../calendar/calendar-rule-engine";
import { DeterministicDraftGenerator } from "../content-production/deterministic-draft.generator";
import type { StoredDraftImageAsset } from "../daily-images/daily-image-asset.store";
import { PublicContentWindowResolver } from "../public-content/public-content-window-resolver";
import { RequestContextResolver, type Clock } from "../request-context/request-context-resolver";
import { AdminOperationsDateResolver } from "./admin-operations-date.resolver";
import {
  AdminOperationsService,
  type AdminOperationsStoredDay,
  type AdminOperationsStore,
} from "./admin-operations.service";

type DailyContent = components["schemas"]["DailyContent"];
type DailyImageSlot = "optional" | "required_alternative" | "required_primary";

class FixedClock implements Clock {
  constructor(private readonly instant: string) {}

  now(): Date {
    return new Date(this.instant);
  }
}

class MemoryOperationsStore implements AdminOperationsStore {
  constructor(private readonly days: ReadonlyMap<string, AdminOperationsStoredDay>) {}

  async readDays(fortuneDates: readonly string[]): Promise<AdminOperationsStoredDay[]> {
    return fortuneDates.flatMap((fortuneDate) => {
      const day = this.days.get(fortuneDate);
      return day === undefined ? [] : [structuredClone(day)];
    });
  }
}

function projectedContent(fortuneDate: string): DailyContent {
  const window = new PublicContentWindowResolver().resolve(fortuneDate);
  return {
    balanceSuggestion: {
      accessoryExamples: ["丝巾"],
      description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
      preferredTierCode: "da_ji",
      title: "已经穿了注意色",
    },
    basis: { disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。", steps: ["固定规则。"] },
    calendar: {
      branch: "申",
      dayElement: "metal",
      dayElementLabel: "金",
      ganzhiDay: "庚申",
      lunarDateText: "六月廿五",
      weekdayText: "星期四",
    },
    effectiveFrom: window.effectiveFrom,
    effectiveTo: window.effectiveTo,
    fortuneDate,
    looks: [],
    outfitFormulas: [{ formulaId: "formula-mono" }],
    share: {
      copyText: "今日五行穿衣建议",
      posterJobEndpoint: "/api/v1/poster-jobs",
      posterTemplateVersion: "poster-v1",
      summaryText: "今日穿衣配色",
    },
    tiers: [
      {
        algorithmLabel: "大吉",
        colors: [{ colorCode: "ivory", name: "乳白" }],
        displayLabel: "今日优先",
        displaySection: "primary",
        element: "wood",
        elementLabel: "木",
        explanation: "优先穿乳白色。",
        rank: 1,
        relationText: "相生",
        tierCode: "da_ji",
      },
    ],
    versions: {
      algorithmVersion: "algorithm-v1",
      assetManifestVersion: "asset-v1",
      calendarDataVersion: "calendar-v1",
      calendarRuleVersion: "fortune-date-23h-v1",
      contentVersion: `content-${fortuneDate}`,
      copyVersion: "copy-v1",
      outfitVersion: "outfit-v1",
      posterTemplateVersion: "poster-v1",
    },
  } as unknown as DailyContent;
}

function selectedDraftCandidate(
  fortuneDate: string,
  imageSlot: DailyImageSlot,
): StoredDraftImageAsset {
  const sha256 = createHash("sha256").update(`${fortuneDate}:${imageSlot}`).digest("hex");
  return {
    asset: {
      aiLabelStatus: "pending",
      altText: `${imageSlot} 真实自动生成穿搭图`,
      assetId: `asset-${fortuneDate}-${imageSlot}`,
      declaredModel: "gpt-image-2",
      fileUrl: `https://assets.example.test/${fortuneDate}/${imageSlot}.png`,
      generatedAt: "2026-08-06T10:00:00.000Z",
      generationMethod: "external_tool",
      height: 1600,
      manualReview: null,
      mediaType: "image/png",
      promptVersion: "five-look-v1",
      reproductionReference: `request-${fortuneDate}-${imageSlot}`,
      reviewStatus: "pending",
      rightsRecordIds: [`rights-${fortuneDate}-${imageSlot}`],
      rightsStatus: "pending",
      sha256,
      sourceMaterialReferences: [`source-${fortuneDate}-${imageSlot}`],
      sourceType: "ai_generated",
      width: 1200,
    },
    draftId: `draft-${fortuneDate}`,
    fortuneDate,
    imageSlot,
    reviewLocked: false,
    selectionSource: "automatic_generation",
    selectedForSlot: true,
    storageKey: `${sha256.slice(0, 2)}/${sha256}.png`,
    uploadedAt: "2026-08-06T10:00:00.000Z",
  };
}

function storedDay(
  fortuneDate: string,
  input: {
    active?: boolean;
    draftReady?: boolean;
    duplicateRequiredSelection?: boolean;
    effectiveFrom?: string;
    effectiveTo?: string;
    fallbackPrimary?: boolean;
    optionalJob?: "failed" | "queued" | "ready";
    productionStatus?: "awaiting_review" | "failed" | "generating";
    publicationFailure?: boolean;
    requiredJobFailure?: boolean;
    scheduled?: boolean;
  } = {},
): AdminOperationsStoredDay {
  const window = new PublicContentWindowResolver().resolve(fortuneDate);
  const imageSlots = [
    {
      deliveryStatus: input.fallbackPrimary ? ("fallback" as const) : ("active" as const),
      imageSlot: "required_primary" as const,
      servedCoverAssetId: "asset-primary",
    },
    {
      deliveryStatus: "active" as const,
      imageSlot: "required_alternative" as const,
      servedCoverAssetId: "asset-alternative",
    },
  ];
  const version = {
    contentVersion: `content-${fortuneDate}`,
    createdAt: window.effectiveFrom,
    effectiveFrom: input.effectiveFrom ?? window.effectiveFrom,
    effectiveTo: input.effectiveTo ?? window.effectiveTo,
    imageSlots,
    preview: projectedContent(fortuneDate),
    state: input.active ? ("published" as const) : ("scheduled" as const),
  };

  return {
    active: input.active ? version : null,
    approved: null,
    draft: input.draftReady
      ? {
          draftId: `draft-${fortuneDate}`,
          draftRevision: 3,
          imageCandidates: [
            selectedDraftCandidate(fortuneDate, "required_primary"),
            selectedDraftCandidate(fortuneDate, "required_alternative"),
          ],
          modules: new DeterministicDraftGenerator().generate(fortuneDate),
          updatedAt: "2026-08-06T10:00:00.000Z",
        }
      : null,
    fortuneDate,
    invariantBroken: false,
    lifecycleRevision: 4,
    publicationFailure: input.publicationFailure
      ? {
          occurredAt: `${fortuneDate}T18:01:00+08:00`,
          reason: "scheduled worker failed",
        }
      : null,
    production: {
      lastError: null,
      requiredJobs: input.requiredJobFailure
        ? [{ imageSlot: "required_primary", status: "failed" }]
        : input.duplicateRequiredSelection
          ? [
              { deliveryReady: true, imageSlot: "required_primary", status: "ready" },
              {
                deliveryReady: false,
                imageSlot: "required_alternative",
                lastError: "两张必备图片内容重复，请替换备选图。",
                status: "ready",
              },
            ]
          : [],
      optionalJobStatus: input.optionalJob ?? "not_requested",
      status: input.productionStatus ?? "awaiting_review",
      updatedAt: window.effectiveFrom,
    },
    scheduled: input.scheduled ? { ...version, state: "scheduled" } : null,
    scheduleSlotRevision: input.scheduled ? 2 : 0,
  };
}

function serviceAt(instant: string, days: readonly AdminOperationsStoredDay[]) {
  return new AdminOperationsService(
    new MemoryOperationsStore(new Map(days.map((day) => [day.fortuneDate, day]))),
    new AdminOperationsDateResolver(new RequestContextResolver(new FixedClock(instant))),
    new CalendarRuleEngine(),
  );
}

describe("AdminOperationsService", () => {
  it("keeps a frozen version without an optional slot authoritative over later production", async () => {
    const service = serviceAt("2026-08-06T04:00:00.000Z", [
      storedDay("2026-08-06", { active: true }),
      storedDay("2026-08-07", { optionalJob: "ready", scheduled: true }),
    ]);

    const overview = await service.overview();

    expect(overview.next.previewAvailable).toBe(true);
    expect(overview.next.optionalImageStatus).toBe("not_requested");
  });

  it("keeps an unfinished next day in preparation before the 13:00 preparation target", async () => {
    const service = serviceAt("2026-08-06T04:59:59.000Z", [
      storedDay("2026-08-06", { active: true }),
      storedDay("2026-08-07", { optionalJob: "failed" }),
    ]);

    const overview = await service.overview();

    expect(overview.current.operationalStatus).toBe("published_healthy");
    expect(overview.currentPreview?.fortuneDate).toBe("2026-08-06");
    expect(overview.currentPreviewRequestContext).toEqual(overview.requestContext);
    expect(overview.currentPreviewPublicContentContext).toEqual(overview.publicContentContext);
    expect(overview.current.requiredImages).toMatchObject({
      deliverySafeCount: 2,
      modelReadyCount: 2,
      requiredCount: 2,
    });
    expect(overview.next.operationalStatus).toBe("preparing");
    expect(overview.nextPreview).toBeNull();
    expect(overview.nextPreviewRequestContext).toMatchObject({
      civilDate: "2026-08-07",
      crossedDayBoundary: false,
      fortuneDate: "2026-08-07",
      shichen: "午",
    });
    expect(overview.nextPreviewPublicContentContext).toEqual({
      advancedFromCivilDate: false,
      servedFortuneDate: "2026-08-07",
      switchBoundary: "18:00",
    });
    expect(overview.next.optionalImageStatus).toBe("failed");
    expect(overview.issueCount).toBe(0);
    expect(overview.nextOperationalBoundaryAt).toBe("2026-08-06T13:00:00+08:00");
  });

  it("marks the next day overdue at 13:00 without turning an optional-image failure into an issue", async () => {
    const service = serviceAt("2026-08-06T05:00:00.000Z", [
      storedDay("2026-08-06", { active: true }),
      storedDay("2026-08-07", { optionalJob: "failed" }),
    ]);

    const overview = await service.overview();

    expect(overview.next.operationalStatus).toBe("overdue");
    expect(overview.next.issueCodes).toEqual(["NEXT_DAY_OVERDUE", "REQUIRED_IMAGE_MISSING"]);
    expect(overview.next.issueCodes).not.toContain("REQUIRED_IMAGE_GENERATION_FAILED");
    expect(overview.nextOperationalBoundaryAt).toBe("2026-08-06T18:00:00+08:00");
  });

  it("returns only human-actionable issues and never exposes the optional image failure", async () => {
    const service = serviceAt("2026-08-06T05:00:00.000Z", [
      storedDay("2026-08-06", { active: true }),
      storedDay("2026-08-07", { optionalJob: "failed" }),
    ]);

    const issues = await service.issues();

    expect(issues.items.map((issue) => issue.code)).toEqual([
      "NEXT_DAY_OVERDUE",
      "REQUIRED_IMAGE_MISSING",
    ]);
    expect(JSON.stringify(issues)).not.toContain("optional");
    expect(issues.items[0]).toMatchObject({
      actionHref: "/admin/calendar/2026-08-07",
      actionLabel: "立即处理下一期",
      fortuneDate: "2026-08-07",
      severity: "warning",
      title: "下一期内容尚未准备好",
    });
    expect(issues.nextOperationalBoundaryAt).toBe("2026-08-06T18:00:00+08:00");
  });

  it("reports unavailable health when publication failed without a safe active preview", async () => {
    const overview = await serviceAt("2026-08-06T09:30:00.000Z", [
      storedDay("2026-08-06", { publicationFailure: true }),
      storedDay("2026-08-07"),
    ]).overview();

    expect(overview.current.operationalStatus).toBe("publication_failed");
    expect(overview.currentPreview).toBeNull();
    expect(overview.health).toBe("unavailable");
  });

  it("returns the same projected daily content for the current-day admin preview", async () => {
    const currentDay = storedDay("2026-08-06", { active: true, fallbackPrimary: true });
    const service = serviceAt("2026-08-06T02:00:00.000Z", [currentDay]);

    const detail = await service.dayDetail("2026-08-06");

    expect(detail.preview).toEqual(currentDay.active?.preview);
    expect(detail.previewRequestContext).toEqual(detail.requestContext);
    expect(detail.previewSource).toBe("published");
    expect(detail.summary.operationalStatus).toBe("published_degraded");
    expect(detail.summary.requiredImages).toEqual({
      deliverySafeCount: 2,
      modelReadyCount: 1,
      requiredCount: 2,
    });
    expect(detail.nextOperationalBoundaryAt).toBe("2026-08-06T13:00:00+08:00");
    expect(detail.readonlySelectionKeys).toContain("calendar.summary");
  });

  it("fails closed when the current active version still uses the legacy 23:00 window", async () => {
    const legacyActive = storedDay("2026-08-07", {
      active: true,
      effectiveFrom: "2026-08-06T23:00:00+08:00",
      effectiveTo: "2026-08-07T23:00:00+08:00",
    });
    const service = serviceAt("2026-08-06T10:00:00.000Z", [legacyActive]);

    const overview = await service.overview();
    const detail = await service.dayDetail("2026-08-07");
    const issues = await service.issues();

    expect(overview.current.operationalStatus).toBe("invariant_broken");
    expect(overview.current.issueCodes).toEqual(["ACTIVE_VERSION_INCONSISTENT"]);
    expect(overview.currentPreview).toBeNull();
    expect(overview.health).toBe("unavailable");
    expect(detail.preview).toBeNull();
    expect(issues.items.map((issue) => issue.code)).toContain("ACTIVE_VERSION_INCONSISTENT");
  });

  it("accepts PostgreSQL UTC timestamps only when they represent the exact public window", async () => {
    const exactActive = storedDay("2026-08-07", {
      active: true,
      effectiveFrom: "2026-08-06T10:00:00.000Z",
      effectiveTo: "2026-08-07T10:00:00.000Z",
    });

    const overview = await serviceAt("2026-08-06T10:00:00.000Z", [exactActive]).overview();

    expect(overview.current.operationalStatus).toBe("published_healthy");
    expect(overview.currentPreview?.fortuneDate).toBe("2026-08-07");
    expect(overview.current.issueCodes).toEqual([]);
  });

  it("falls back to the real automatic production draft for an unfrozen future preview", async () => {
    const nextDay = storedDay("2026-08-07", { draftReady: true });
    const service = serviceAt("2026-08-06T09:00:00.000Z", [
      storedDay("2026-08-06", { active: true }),
      nextDay,
    ]);

    const overview = await service.overview();
    const detail = await service.dayDetail("2026-08-07");

    expect(overview.nextPreview).not.toBeNull();
    expect(overview.nextPreview?.fortuneDate).toBe("2026-08-07");
    expect(overview.nextPreview?.looks).toHaveLength(2);
    expect(overview.nextPreview?.looks.map((look) => look.coverImage.assetId)).toEqual([
      "asset-2026-08-07-required_primary",
      "asset-2026-08-07-required_alternative",
    ]);
    expect(overview.next.requiredImages).toEqual({
      deliverySafeCount: 2,
      modelReadyCount: 2,
      requiredCount: 2,
    });
    expect(detail.preview).toEqual(overview.nextPreview);
    expect(detail.previewSource).toBe("draft");
    expect(detail.editableSelectionKeys).toContain("tier.da_ji.explanation");
  });

  it("does not mask an invalid frozen version with a newer production draft", async () => {
    const nextDay = storedDay("2026-08-07", { draftReady: true, scheduled: true });
    const service = serviceAt("2026-08-06T09:00:00.000Z", [
      storedDay("2026-08-06", { active: true }),
      {
        ...nextDay,
        scheduled: nextDay.scheduled === null ? null : { ...nextDay.scheduled, preview: null },
      },
    ]);

    const overview = await service.overview();
    const detail = await service.dayDetail("2026-08-07");

    expect(overview.nextPreview).toBeNull();
    expect(detail.preview).toBeNull();
    expect(detail.previewSource).toBe("scheduled");
  });

  it("builds a 42-cell month from the server fortune date instead of browser time", async () => {
    const service = serviceAt("2026-08-05T15:00:00.000Z", [
      storedDay("2026-08-06", { active: true }),
      storedDay("2026-08-07", { scheduled: true }),
    ]);

    const month = await service.calendar("2026-08");

    expect(month.items).toHaveLength(42);
    expect(month.items[0]?.fortuneDate).toBe("2026-07-26");
    expect(month.items.at(-1)?.fortuneDate).toBe("2026-09-05");
    expect(month.items.find((day) => day.fortuneDate === "2026-08-06")?.relation).toBe("current");
    expect(month.items.find((day) => day.fortuneDate === "2026-08-07")?.relation).toBe("next");
  });

  it("builds a non-current day preview context on the server at Shanghai noon", async () => {
    const service = serviceAt("2026-08-06T02:00:00.000Z", [
      storedDay("2026-08-07", { scheduled: true }),
    ]);

    const detail = await service.dayDetail("2026-08-07");

    expect(detail.previewRequestContext).toMatchObject({
      civilDate: "2026-08-07",
      crossedDayBoundary: false,
      fortuneDate: "2026-08-07",
      responseGeneratedAt: "2026-08-07T12:00:00+08:00",
      shichen: "午",
    });
    expect(detail.previewPublicContentContext).toEqual({
      advancedFromCivilDate: false,
      servedFortuneDate: "2026-08-07",
      switchBoundary: "18:00",
    });
  });

  it("switches the operations current day exactly at 18:00 Asia/Shanghai", async () => {
    const before = await serviceAt("2026-08-06T09:59:59.000Z", [
      storedDay("2026-08-06", { active: true }),
    ]).overview();
    const after = await serviceAt("2026-08-06T10:00:00.000Z", [
      storedDay("2026-08-07", { active: true }),
    ]).overview();

    expect(before.requestContext.fortuneDate).toBe("2026-08-06");
    expect(after.requestContext.fortuneDate).toBe("2026-08-06");
    expect(before.publicContentContext.servedFortuneDate).toBe("2026-08-06");
    expect(after.publicContentContext.servedFortuneDate).toBe("2026-08-07");
    expect(after.current.fortuneDate).toBe("2026-08-07");
    expect(before.current.operationalStatus).toBe("published_healthy");
    expect(after.current.operationalStatus).toBe("published_healthy");
    expect(after.currentPreview?.fortuneDate).toBe("2026-08-07");
    expect(after.currentPreviewPublicContentContext).toEqual({
      advancedFromCivilDate: true,
      servedFortuneDate: "2026-08-07",
      switchBoundary: "18:00",
    });
    expect(after.nextOperationalBoundaryAt).toBe("2026-08-07T13:00:00+08:00");
  });

  it("does not advance the fortune date a second time at civil midnight", async () => {
    const beforeMidnight = await serviceAt("2026-08-06T15:59:59.000Z", [
      storedDay("2026-08-07", { active: true }),
    ]).overview();
    const afterMidnight = await serviceAt("2026-08-06T16:00:00.000Z", [
      storedDay("2026-08-07", { active: true }),
    ]).overview();

    expect(beforeMidnight.publicContentContext.servedFortuneDate).toBe("2026-08-07");
    expect(afterMidnight.publicContentContext.servedFortuneDate).toBe("2026-08-07");
  });

  it("reports a required-image failure before the aggregate production failure", async () => {
    const service = serviceAt("2026-08-06T09:00:00.000Z", [
      storedDay("2026-08-06", { active: true }),
      storedDay("2026-08-07", {
        productionStatus: "failed",
        requiredJobFailure: true,
      }),
    ]);

    const overview = await service.overview();
    const issues = await service.issues();

    expect(overview.next.issueCodes).toEqual(["REQUIRED_IMAGE_GENERATION_FAILED"]);
    expect(overview.next.issueCodes).not.toContain("CONTENT_GENERATION_FAILED");
    expect(issues.items[0]).toMatchObject({
      actionLabel: "重试必备图片",
      title: "必备模特图生成失败",
    });
  });

  it("clears an old required-image generation failure after safe manual images are scheduled", async () => {
    const service = serviceAt("2026-08-06T09:30:00.000Z", [
      storedDay("2026-08-06", { active: true }),
      storedDay("2026-08-07", {
        productionStatus: "failed",
        requiredJobFailure: true,
        scheduled: true,
      }),
    ]);

    const overview = await service.overview();
    const issues = await service.issues();

    expect(overview.next.operationalStatus).toBe("scheduled_ready");
    expect(overview.next.requiredImages).toEqual({
      deliverySafeCount: 2,
      modelReadyCount: 2,
      requiredCount: 2,
    });
    expect(overview.next.issueCodes).toEqual([]);
    expect(issues.items).toEqual([]);
  });

  it("does not report a scheduled version ready when only effectiveFrom matches the public window", async () => {
    const service = serviceAt("2026-08-06T09:30:00.000Z", [
      storedDay("2026-08-06", { active: true }),
      storedDay("2026-08-07", {
        effectiveTo: "2026-08-07T23:00:00+08:00",
        scheduled: true,
      }),
    ]);

    const overview = await service.overview();

    expect(overview.next.operationalStatus).toBe("overdue");
    expect(overview.next.issueCodes).toEqual(["NEXT_DAY_OVERDUE"]);
  });

  it("reports duplicate required selections as a missing deliverable image, not content failure", async () => {
    const service = serviceAt("2026-08-06T09:00:00.000Z", [
      storedDay("2026-08-06", { active: true }),
      storedDay("2026-08-07", {
        duplicateRequiredSelection: true,
        productionStatus: "failed",
      }),
    ]);

    const overview = await service.overview();

    expect(overview.next.requiredImages.modelReadyCount).toBe(0);
    expect(overview.next.issueCodes).toEqual(["REQUIRED_IMAGE_MISSING"]);
    expect(overview.next.issueCodes).not.toContain("CONTENT_GENERATION_FAILED");
  });

  it("surfaces the latest unresolved scheduled publication failure as an actionable issue", async () => {
    const service = serviceAt("2026-08-06T09:30:00.000Z", [
      storedDay("2026-08-06", { active: true }),
      storedDay("2026-08-07", { publicationFailure: true, scheduled: true }),
    ]);

    const overview = await service.overview();
    const issues = await service.issues();

    expect(overview.next.operationalStatus).toBe("publication_failed");
    expect(overview.next.issueCodes).toEqual(["AUTO_PUBLICATION_FAILED"]);
    expect(issues.items[0]).toMatchObject({
      actionLabel: "安全重试发布",
      severity: "critical",
      title: "自动发布失败",
    });
  });

  it("advertises every concrete editable public object but keeps algorithm fields readonly", async () => {
    const detail = await serviceAt("2026-08-06T02:00:00.000Z", [
      storedDay("2026-08-06", { active: true }),
    ]).dayDetail("2026-08-06");

    expect(detail.editableSelectionKeys).toEqual(
      expect.arrayContaining([
        "tier.da_ji.explanation",
        "formula.formula-mono.title",
        "formula.formula-mono.disclaimer",
        "balanceSuggestion.description",
        "basis.disclaimer",
        "share.copy",
        "image.required_primary",
        "image.required_alternative",
        "image.optional",
      ]),
    );
    expect(detail.editableSelectionKeys).not.toContain("tier.da_ji.algorithm");
    expect(detail.readonlySelectionKeys).toEqual(
      expect.arrayContaining(["calendar.summary", "tier.da_ji.algorithm"]),
    );
  });
});
