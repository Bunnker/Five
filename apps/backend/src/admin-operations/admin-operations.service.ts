import type { components } from "@five/api-contract";
import { isAdminDailyImageSet } from "@five/api-contract/runtime";

import { CalendarRuleEngine } from "../calendar/calendar-rule-engine";
import { prepareImmediatePublicationModules } from "../content-lifecycle/immediate-publication-modules";
import type {
  DraftModules,
  StoredContentVersion,
} from "../content-lifecycle/content-lifecycle.store";
import type { StoredDraftImageAsset } from "../daily-images/daily-image-asset.store";
import type { PublicContentContext } from "../public-content/public-content-context-resolver";
import { PublicContentWindowResolver } from "../public-content/public-content-window-resolver";
import type { RequestContext } from "../request-context/request-context-resolver";
import { projectAdminDailyContentSnapshot } from "../today/published-content-projector";
import { AdminOperationsDateResolver } from "./admin-operations-date.resolver";

type DailyContent = components["schemas"]["DailyContent"];
export type AdminDayRelation = components["schemas"]["AdminDayRelation"];
export type AdminOperationalStatus = components["schemas"]["AdminOperationalStatus"];
export type AdminIssueCode = components["schemas"]["AdminIssueCode"];
export type OptionalImageStatus = components["schemas"]["OptionalImageStatus"];
export type RequiredImageReadiness = components["schemas"]["RequiredImageReadiness"];
export type AdminDaySummary = components["schemas"]["AdminDaySummary"];
export type AdminActionableIssue = components["schemas"]["AdminActionableIssue"];
export type AdminOperationsOverview = components["schemas"]["AdminOperationsOverview"];
export type AdminActionableIssueList = components["schemas"]["AdminActionableIssueList"];
export type AdminDayDetail = components["schemas"]["AdminDayDetail"];
export type AdminCalendarMonth = components["schemas"]["AdminCalendarMonth"];

export interface AdminOperationsStoredImageSlot {
  readonly deliveryStatus: "active" | "fallback" | "omitted" | "unavailable";
  readonly imageSlot: "optional" | "required_alternative" | "required_primary";
  readonly servedCoverAssetId: string | null;
}

export interface AdminOperationsStoredVersion {
  readonly contentVersion: string;
  readonly createdAt: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly imageSlots: readonly AdminOperationsStoredImageSlot[];
  readonly preview: DailyContent | null;
  readonly state: "approved" | "published" | "scheduled";
}

export interface AdminOperationsStoredProduction {
  readonly lastError: string | null;
  readonly optionalJobStatus: "failed" | "not_requested" | "queued" | "ready";
  readonly requiredJobs: readonly {
    readonly deliveryReady?: boolean;
    readonly imageSlot: "required_alternative" | "required_primary";
    readonly lastError?: string | null;
    readonly status: "failed" | "pending" | "ready";
  }[];
  readonly status: "awaiting_review" | "failed" | "generating";
  readonly updatedAt: string;
}

export interface AdminOperationsStoredDay {
  readonly active: AdminOperationsStoredVersion | null;
  readonly approved: AdminOperationsStoredVersion | null;
  readonly draft: {
    readonly draftId: string;
    readonly draftRevision: number;
    readonly imageCandidates: readonly StoredDraftImageAsset[];
    readonly modules: DraftModules;
    readonly updatedAt: string;
  } | null;
  readonly fortuneDate: string;
  readonly invariantBroken: boolean;
  readonly lifecycleRevision: number;
  readonly publicationFailure: {
    readonly occurredAt: string;
    readonly reason: string;
  } | null;
  readonly production: AdminOperationsStoredProduction | null;
  readonly scheduled: AdminOperationsStoredVersion | null;
  readonly scheduleSlotRevision: number;
}

export interface AdminOperationsStore {
  readDays(fortuneDates: readonly string[]): Promise<AdminOperationsStoredDay[]>;
}

const REQUIRED_IMAGE_SLOTS = new Set(["required_primary", "required_alternative"]);
const ELEMENT_LABELS: Readonly<
  Record<components["schemas"]["ElementCode"], AdminDaySummary["dayElementLabel"]>
> = {
  earth: "土",
  fire: "火",
  metal: "金",
  water: "水",
  wood: "木",
};

function relationFor(fortuneDate: string, current: string, next: string): AdminDayRelation {
  if (fortuneDate === current) return "current";
  if (fortuneDate === next) return "next";
  return fortuneDate < current ? "past" : "future";
}

function imageReadiness(
  imageSlots: readonly AdminOperationsStoredImageSlot[],
): RequiredImageReadiness {
  const required = imageSlots.filter((slot) => REQUIRED_IMAGE_SLOTS.has(slot.imageSlot));
  const uniqueModelAssets = new Set(
    required
      .filter((slot) => slot.deliveryStatus === "active" && slot.servedCoverAssetId !== null)
      .map((slot) => slot.servedCoverAssetId),
  );
  const uniqueDeliveryAssets = new Set(
    required
      .filter(
        (slot) =>
          (slot.deliveryStatus === "active" || slot.deliveryStatus === "fallback") &&
          slot.servedCoverAssetId !== null,
      )
      .map((slot) => slot.servedCoverAssetId),
  );
  return {
    deliverySafeCount: Math.min(2, uniqueDeliveryAssets.size),
    modelReadyCount: Math.min(2, uniqueModelAssets.size),
    requiredCount: 2,
  };
}

interface AdminOperationsSelectedProjection {
  readonly imageSlots: readonly AdminOperationsStoredImageSlot[];
  readonly preview: DailyContent | null;
  readonly source: AdminDayDetail["previewSource"];
}

interface PublicContentWindowBounds {
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
}

function sameInstant(left: string, right: string): boolean {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function isCurrentActiveWindow(
  version: AdminOperationsStoredVersion,
  publicWindow: PublicContentWindowBounds,
  observedAt: string,
): boolean {
  const observedAtMs = Date.parse(observedAt);
  const effectiveFromMs = Date.parse(publicWindow.effectiveFrom);
  const effectiveToMs = Date.parse(publicWindow.effectiveTo);
  return (
    sameInstant(version.effectiveFrom, publicWindow.effectiveFrom) &&
    sameInstant(version.effectiveTo, publicWindow.effectiveTo) &&
    Number.isFinite(observedAtMs) &&
    observedAtMs >= effectiveFromMs &&
    observedAtMs < effectiveToMs
  );
}

function projectDraft(
  draft: NonNullable<AdminOperationsStoredDay["draft"]>,
  effectiveFrom: string,
  effectiveTo: string,
  fortuneDate: string,
): AdminOperationsSelectedProjection | null {
  const snapshot = prepareImmediatePublicationModules(draft.modules, draft.imageCandidates);
  const visual = snapshot?.visual_and_rights;
  if (snapshot === null || visual === null || visual === undefined) return null;
  const contentVersion = `working-copy-${fortuneDate}-r${draft.draftRevision}`;
  const slots = visual.looks.map((look) => ({
    coverAssetId: look.coverAssetId,
    deliveryStatus: "active" as const,
    detailAssetIds: structuredClone(look.detailAssetIds),
    fallbackAssetId: look.fallbackAssetId,
    imageSlot: look.imageSlot,
    lookId: look.lookId,
    servedCoverAssetId: look.coverAssetId,
    servedDetailAssetIds: structuredClone(look.detailAssetIds),
  }));
  const version: StoredContentVersion = {
    contentVersion,
    createdAt: draft.updatedAt,
    draftId: draft.draftId,
    effectiveFrom,
    effectiveTo,
    fortuneDate,
    preflightChecks: [],
    snapshot,
    state: "approved",
  };
  const dailyImageSet = {
    assets: structuredClone(visual.assets),
    contentVersion,
    fortuneDate,
    lifecycleRevision: 1,
    slots,
    withdrawalEvents: [],
  };
  if (!isAdminDailyImageSet(dailyImageSet)) return null;
  const preview = projectAdminDailyContentSnapshot(version, dailyImageSet, new Set(["approved"]));
  if (preview === null) return null;
  return {
    imageSlots: dailyImageSet.slots.map((slot) => ({
      deliveryStatus: slot.deliveryStatus,
      imageSlot: slot.imageSlot,
      servedCoverAssetId: slot.servedCoverAssetId,
    })),
    preview,
    source: "draft",
  };
}

function selectedVersion(
  day: AdminOperationsStoredDay,
  relation: AdminDayRelation,
): AdminOperationsStoredVersion | null {
  if (relation === "current" || relation === "past") return day.active;
  return day.scheduled ?? day.approved;
}

function selectedProjection(
  day: AdminOperationsStoredDay,
  relation: AdminDayRelation,
  calendar: { readonly effectiveFrom: string; readonly effectiveTo: string },
  observedAt: string,
): AdminOperationsSelectedProjection {
  const version = selectedVersion(day, relation);
  if (
    relation === "current" &&
    version !== null &&
    !isCurrentActiveWindow(version, calendar, observedAt)
  ) {
    return {
      imageSlots: [],
      preview: null,
      source: version.state,
    };
  }
  if (version?.preview !== null && version?.preview !== undefined) {
    return {
      imageSlots: version.imageSlots,
      preview: version.preview,
      source: version.state,
    };
  }
  if (version === null && (relation === "next" || relation === "future") && day.draft !== null) {
    const draft = projectDraft(
      day.draft,
      calendar.effectiveFrom,
      calendar.effectiveTo,
      day.fortuneDate,
    );
    if (draft !== null) return draft;
  }
  return {
    imageSlots: version?.imageSlots ?? [],
    preview: null,
    source: version?.state ?? (day.draft === null ? "none" : "draft"),
  };
}

function optionalStatus(
  imageSlots: readonly AdminOperationsStoredImageSlot[],
  production: AdminOperationsStoredProduction | null,
  source: AdminOperationsSelectedProjection["source"],
): OptionalImageStatus {
  const slot = imageSlots.find((candidate) => candidate.imageSlot === "optional");
  if (slot?.deliveryStatus === "active") return "ready";
  if (slot?.deliveryStatus === "omitted") return "omitted";
  if (source === "approved" || source === "published" || source === "scheduled") {
    return "not_requested";
  }
  if (production?.optionalJobStatus === "failed") return "failed";
  if (production?.optionalJobStatus === "queued") return "pending";
  if (production?.optionalJobStatus === "ready") return "ready";
  return "not_requested";
}

function primaryColors(preview: DailyContent | null) {
  return (
    preview?.tiers
      .find((tier) => tier.tierCode === "da_ji")
      ?.colors.map((color) => ({
        ...color,
      })) ?? []
  );
}

function latestUpdatedAt(
  day: AdminOperationsStoredDay,
  version: AdminOperationsStoredVersion | null,
): string | null {
  const candidates = [
    version?.createdAt,
    day.draft?.updatedAt,
    day.production?.updatedAt,
    day.publicationFailure?.occurredAt,
  ].filter((value): value is string => value !== undefined);
  return candidates.sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1) ?? null;
}

export class AdminOperationsService {
  constructor(
    private readonly store: AdminOperationsStore,
    private readonly dateResolver: AdminOperationsDateResolver,
    private readonly calendarRuleEngine: CalendarRuleEngine,
    private readonly publicContentWindowResolver = new PublicContentWindowResolver(),
  ) {}

  async overview(): Promise<AdminOperationsOverview> {
    const requestContext = this.dateResolver.resolveCurrent();
    const publicContentContext = this.dateResolver.resolvePublicContentContext(requestContext);
    const currentFortuneDate = publicContentContext.servedFortuneDate;
    const nextFortuneDate = this.dateResolver.shiftFortuneDate(currentFortuneDate, 1);
    const storedDays = await this.store.readDays([currentFortuneDate, nextFortuneDate]);
    const byDate = new Map(storedDays.map((day) => [day.fortuneDate, day]));
    const currentStored = byDate.get(currentFortuneDate);
    const nextStored = byDate.get(nextFortuneDate);
    const current = this.summarize(
      currentStored,
      currentFortuneDate,
      requestContext,
      currentFortuneDate,
    );
    const next = this.summarize(nextStored, nextFortuneDate, requestContext, currentFortuneDate);
    const nextWindow = this.publicContentWindowResolver.resolve(nextFortuneDate);
    const currentWindow = this.publicContentWindowResolver.resolve(currentFortuneDate);
    const currentProjection =
      currentStored === undefined
        ? null
        : selectedProjection(
            currentStored,
            "current",
            currentWindow,
            requestContext.responseGeneratedAt,
          );
    const nextProjection =
      nextStored === undefined
        ? null
        : selectedProjection(nextStored, "next", nextWindow, requestContext.responseGeneratedAt);
    const nextPreviewRequestContext = this.dateResolver.resolveForFortuneDate(nextFortuneDate);
    const issues = [...current.issueCodes, ...next.issueCodes];

    return {
      current,
      currentPreview: currentProjection?.preview ?? null,
      currentPreviewPublicContentContext: publicContentContext,
      currentPreviewRequestContext: requestContext,
      health:
        currentProjection?.preview === null ||
        currentProjection?.preview === undefined ||
        current.operationalStatus === "missing" ||
        current.operationalStatus === "invariant_broken"
          ? "unavailable"
          : issues.length > 0
            ? "attention"
            : "healthy",
      issueCount: issues.length,
      next,
      nextPreview: nextProjection?.preview ?? null,
      nextPreviewPublicContentContext:
        this.dateResolver.resolvePublicContentContext(nextPreviewRequestContext),
      nextPreviewRequestContext,
      nextOperationalBoundaryAt: this.nextOperationalBoundary(requestContext, next),
      publicContentContext,
      requestContext,
    };
  }

  async issues(): Promise<AdminActionableIssueList> {
    const requestContext = this.dateResolver.resolveCurrent();
    const publicContentContext = this.dateResolver.resolvePublicContentContext(requestContext);
    const currentFortuneDate = publicContentContext.servedFortuneDate;
    const nextFortuneDate = this.dateResolver.shiftFortuneDate(currentFortuneDate, 1);
    const storedDays = await this.store.readDays([currentFortuneDate, nextFortuneDate]);
    const byDate = new Map(storedDays.map((day) => [day.fortuneDate, day]));
    const summaries = [
      this.summarize(
        byDate.get(currentFortuneDate),
        currentFortuneDate,
        requestContext,
        currentFortuneDate,
      ),
      this.summarize(
        byDate.get(nextFortuneDate),
        nextFortuneDate,
        requestContext,
        currentFortuneDate,
      ),
    ];

    return {
      items: summaries.flatMap((summary) =>
        summary.issueCodes.map((code) => this.issueFor(summary, code, requestContext)),
      ),
      nextOperationalBoundaryAt: this.nextOperationalBoundary(requestContext, summaries[1]!),
      publicContentContext,
      requestContext,
    };
  }

  async dayDetail(fortuneDate: string): Promise<AdminDayDetail> {
    const requestContext = this.dateResolver.resolveCurrent();
    const publicContentContext = this.dateResolver.resolvePublicContentContext(requestContext);
    const currentFortuneDate = publicContentContext.servedFortuneDate;
    const stored = (await this.store.readDays([fortuneDate]))[0];
    const summary = this.summarize(stored, fortuneDate, requestContext, currentFortuneDate);
    const nextFortuneDate = this.dateResolver.shiftFortuneDate(currentFortuneDate, 1);
    const relation = relationFor(fortuneDate, currentFortuneDate, nextFortuneDate);
    const publicWindow = this.publicContentWindowResolver.resolve(fortuneDate);
    const projection =
      stored === undefined
        ? { imageSlots: [], preview: null, source: "none" as const }
        : selectedProjection(stored, relation, publicWindow, requestContext.responseGeneratedAt);

    const editableSelectionKeys = [
      ...(projection.preview?.tiers.map((tier) => `tier.${tier.tierCode}.explanation`) ?? []),
      ...(projection.preview?.outfitFormulas.flatMap((formula) => [
        `formula.${formula.formulaId}.title`,
        `formula.${formula.formulaId}.disclaimer`,
      ]) ?? []),
      "balanceSuggestion.description",
      "basis.disclaimer",
      "share.copy",
      "image.required_primary",
      "image.required_alternative",
      "image.optional",
    ];
    const readonlySelectionKeys = [
      "calendar.summary",
      ...(projection.preview?.tiers.map((tier) => `tier.${tier.tierCode}.algorithm`) ?? []),
    ];
    const previewRequestContext =
      fortuneDate === currentFortuneDate
        ? requestContext
        : this.dateResolver.resolveForFortuneDate(fortuneDate);

    return {
      concurrency: {
        activeContentVersion: stored?.active?.contentVersion ?? null,
        lifecycleRevision: stored?.lifecycleRevision ?? 0,
        scheduleSlotRevision: stored?.scheduleSlotRevision ?? 0,
      },
      editableSelectionKeys,
      nextOperationalBoundaryAt: this.nextOperationalBoundary(
        requestContext,
        this.publicContentWindowResolver.resolve(nextFortuneDate),
      ),
      preview: projection.preview,
      previewPublicContentContext:
        this.dateResolver.resolvePublicContentContext(previewRequestContext),
      previewRequestContext,
      previewSource: projection.source,
      publicContentContext,
      readonlySelectionKeys,
      requestContext,
      summary,
    };
  }

  async calendar(month: string): Promise<AdminCalendarMonth> {
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month)) {
      throw new RangeError(`Invalid calendar month: ${month}`);
    }
    const requestContext = this.dateResolver.resolveCurrent();
    const publicContentContext = this.dateResolver.resolvePublicContentContext(requestContext);
    const currentFortuneDate = publicContentContext.servedFortuneDate;
    const firstDay = `${month}-01`;
    const leadingDays = this.dateResolver.weekdayIndex(firstDay);
    const windowStart = this.dateResolver.shiftFortuneDate(firstDay, -leadingDays);
    const fortuneDates = Array.from({ length: 42 }, (_, index) =>
      this.dateResolver.shiftFortuneDate(windowStart, index),
    );
    const storedDays = await this.store.readDays(fortuneDates);
    const byDate = new Map(storedDays.map((day) => [day.fortuneDate, day]));
    const items = fortuneDates.map((fortuneDate) =>
      this.summarize(byDate.get(fortuneDate), fortuneDate, requestContext, currentFortuneDate),
    );
    const nextFortuneDate = this.dateResolver.shiftFortuneDate(currentFortuneDate, 1);
    const next = this.summarize(
      byDate.get(nextFortuneDate),
      nextFortuneDate,
      requestContext,
      currentFortuneDate,
    );

    return {
      items,
      month,
      nextOperationalBoundaryAt: this.nextOperationalBoundary(requestContext, next),
      publicContentContext,
      requestContext,
    };
  }

  private issueFor(
    summary: AdminDaySummary,
    code: AdminIssueCode,
    requestContext: RequestContext,
  ): AdminActionableIssue {
    const updatedAt = summary.updatedAt ?? requestContext.responseGeneratedAt;
    const common = {
      actionHref: `/admin/calendar/${summary.fortuneDate}`,
      code,
      firstDetectedAt: updatedAt,
      fortuneDate: summary.fortuneDate,
      updatedAt,
    };
    switch (code) {
      case "NEXT_DAY_OVERDUE":
        return {
          ...common,
          actionLabel: "立即处理下一期",
          impact: "当前公开内容暂不受影响，但下一期内容在 18:00 正常切换存在风险。",
          mitigation: "18:00 到达后，公开接口不会继续返回已过期内容。",
          severity: "warning",
          title: "下一期内容尚未准备好",
        };
      case "REQUIRED_IMAGE_MISSING":
        return {
          ...common,
          actionLabel: "补齐必备图片",
          impact: "该日期还缺少必备模特图，暂时不能视为已就绪。",
          mitigation: null,
          severity: "warning",
          title: "必备模特图不足两张",
        };
      case "REQUIRED_IMAGE_DEGRADED":
        return {
          ...common,
          actionLabel: "更换问题图片",
          impact: "用户仍能看到完整文字和安全替代图，但模特图并不完整。",
          mitigation: "系统正在使用已冻结的安全配色卡。",
          severity: "warning",
          title: "一张必备模特图正在降级",
        };
      case "CURRENT_CONTENT_UNAVAILABLE":
        return {
          ...common,
          actionLabel: "发布当前日期",
          impact: "用户现在看不到当前公开日期的五行穿衣建议。",
          mitigation: null,
          severity: "critical",
          title: "当前公开内容不可用",
        };
      case "SAFE_FALLBACK_EXHAUSTED":
        return {
          ...common,
          actionLabel: "上传安全替代图",
          impact: "必备图片既没有可用原图，也没有安全降级内容。",
          mitigation: null,
          severity: "critical",
          title: "必备图片没有安全替代内容",
        };
      case "ACTIVE_VERSION_INCONSISTENT":
        return {
          ...common,
          actionLabel: "查看日期状态",
          impact: "当前活跃版本或排期指针不一致，公开内容可能不可预测。",
          mitigation: "普通订正已暂停，避免扩大不一致。",
          severity: "critical",
          title: "内容版本状态异常",
        };
      case "CONTENT_GENERATION_FAILED":
        return {
          ...common,
          actionLabel: "重新生成内容",
          impact: "文字或结构化内容生成失败，该日期无法继续准备。",
          mitigation: null,
          severity: "warning",
          title: "每日内容自动生成失败",
        };
      case "REQUIRED_IMAGE_GENERATION_FAILED":
        return {
          ...common,
          actionLabel: "重试必备图片",
          impact: "至少一张必备模特图生成失败。",
          mitigation: "用户访问不会触发付费生图。",
          severity: "warning",
          title: "必备模特图生成失败",
        };
      case "AUTO_PUBLICATION_FAILED":
        return {
          ...common,
          actionLabel: "安全重试发布",
          impact: "新内容没有按生效时间成为用户正在看到的版本。",
          mitigation: "公开接口不会继续返回已过期内容，请立即安全重试发布。",
          severity: "critical",
          title: "自动发布失败",
        };
    }
  }

  private nextOperationalBoundary(
    requestContext: RequestContext,
    next: Pick<AdminDaySummary, "effectiveFrom" | "prepareBy">,
  ): string {
    const observedAt = Date.parse(requestContext.responseGeneratedAt);
    const prepareBy = Date.parse(next.prepareBy);
    return observedAt < prepareBy ? next.prepareBy : next.effectiveFrom;
  }

  private summarize(
    stored: AdminOperationsStoredDay | undefined,
    fortuneDate: string,
    requestContext: RequestContext,
    currentFortuneDate: PublicContentContext["servedFortuneDate"],
  ): AdminDaySummary {
    const calendar = this.calendarRuleEngine.evaluate(fortuneDate);
    const publicWindow = this.publicContentWindowResolver.resolve(fortuneDate);
    const nextFortuneDate = this.dateResolver.shiftFortuneDate(currentFortuneDate, 1);
    const relation = relationFor(fortuneDate, currentFortuneDate, nextFortuneDate);
    const day: AdminOperationsStoredDay = stored ?? {
      active: null,
      approved: null,
      draft: null,
      fortuneDate,
      invariantBroken: false,
      lifecycleRevision: 0,
      publicationFailure: null,
      production: null,
      scheduled: null,
      scheduleSlotRevision: 0,
    };
    const version = selectedVersion(day, relation);
    const selected = selectedProjection(
      day,
      relation,
      publicWindow,
      requestContext.responseGeneratedAt,
    );
    const requiredImages = imageReadiness(selected.imageSlots);
    const prepareBy = publicWindow.prepareBy;
    const issueCodes: AdminIssueCode[] = [];
    let operationalStatus: AdminOperationalStatus;

    if (day.invariantBroken) {
      operationalStatus = "invariant_broken";
      issueCodes.push("ACTIVE_VERSION_INCONSISTENT");
    } else if (day.publicationFailure !== null) {
      operationalStatus = "publication_failed";
      issueCodes.push("AUTO_PUBLICATION_FAILED");
    } else if (relation === "current") {
      if (day.active === null || day.active.preview === null) {
        operationalStatus = "missing";
        issueCodes.push("CURRENT_CONTENT_UNAVAILABLE");
      } else if (
        !isCurrentActiveWindow(day.active, publicWindow, requestContext.responseGeneratedAt)
      ) {
        operationalStatus = "invariant_broken";
        issueCodes.push("ACTIVE_VERSION_INCONSISTENT");
      } else if (requiredImages.deliverySafeCount < 2) {
        operationalStatus = "invariant_broken";
        issueCodes.push("SAFE_FALLBACK_EXHAUSTED");
      } else if (requiredImages.modelReadyCount < 2) {
        operationalStatus = "published_degraded";
        issueCodes.push("REQUIRED_IMAGE_DEGRADED");
      } else {
        operationalStatus = "published_healthy";
      }
    } else if (relation === "past") {
      if (day.active === null || day.active.preview === null) {
        operationalStatus = "missing";
      } else if (requiredImages.deliverySafeCount < 2) {
        operationalStatus = "invariant_broken";
      } else if (requiredImages.modelReadyCount < 2) {
        operationalStatus = "published_degraded";
      } else {
        operationalStatus = "published_healthy";
      }
    } else {
      const requiredGenerationFailed =
        day.production?.requiredJobs.some((job) => job.status === "failed") ?? false;
      const requiredDeliveryBlocked =
        day.production?.requiredJobs.some(
          (job) => job.status === "ready" && job.deliveryReady === false,
        ) ?? false;
      const scheduledReady =
        day.scheduled !== null &&
        day.scheduled.state === "scheduled" &&
        sameInstant(day.scheduled.effectiveFrom, publicWindow.effectiveFrom) &&
        sameInstant(day.scheduled.effectiveTo, publicWindow.effectiveTo) &&
        day.scheduled.preview !== null &&
        requiredImages.modelReadyCount === 2 &&
        requiredImages.deliverySafeCount === 2;
      // A real scheduled snapshot with both safe model images is authoritative.
      // Production jobs are historical attempts and may still record a failure
      // after an operator safely replaced the candidate and scheduled a version.
      if (scheduledReady) {
        operationalStatus = "scheduled_ready";
      } else if (requiredDeliveryBlocked) {
        operationalStatus = "generation_failed";
        issueCodes.push("REQUIRED_IMAGE_MISSING");
      } else if (requiredGenerationFailed) {
        operationalStatus = "generation_failed";
        issueCodes.push("REQUIRED_IMAGE_GENERATION_FAILED");
      } else if (day.production?.status === "failed") {
        operationalStatus = "generation_failed";
        issueCodes.push("CONTENT_GENERATION_FAILED");
      } else if (Date.parse(requestContext.responseGeneratedAt) >= Date.parse(prepareBy)) {
        operationalStatus = "overdue";
        if (relation === "next") issueCodes.push("NEXT_DAY_OVERDUE");
        if (requiredImages.modelReadyCount < 2) issueCodes.push("REQUIRED_IMAGE_MISSING");
      } else {
        operationalStatus = "preparing";
      }
    }

    return {
      dayElement: calendar.dayElement,
      dayElementLabel: ELEMENT_LABELS[calendar.dayElement],
      effectiveFrom: publicWindow.effectiveFrom,
      effectiveTo: publicWindow.effectiveTo,
      fortuneDate,
      issueCodes,
      lifecycleRevision: day.lifecycleRevision,
      operationalStatus,
      optionalImageStatus: optionalStatus(selected.imageSlots, day.production, selected.source),
      prepareBy,
      previewAvailable: selected.preview !== null,
      primaryColors: primaryColors(selected.preview),
      relation,
      requiredImages,
      scheduleSlotRevision: day.scheduleSlotRevision,
      updatedAt: latestUpdatedAt(day, version),
    };
  }
}
