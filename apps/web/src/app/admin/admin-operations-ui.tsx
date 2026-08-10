"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { DailyExperienceView } from "../../components/daily-experience-view";
import { parseDailyExperienceViewData, type CompleteTodayPageData } from "../../lib/today";
import {
  adminDayImageAdapter,
  type AdminDayImageAdapter,
  type CorrectionSession,
} from "./admin-day-image-adapter";
import {
  adminApi,
  createIdempotencyKey,
  describeAdminApiError,
  type AdminActionableIssueList,
  type AdminAnalyticsOverview,
  type AdminCalendarMonth,
  type AdminDayDetail,
  type AdminOperationsOverview,
  type AdminSession,
  type DailyImageSlot,
  type DayCorrectionCommand,
  type DayCorrectionWorkingCopy,
  type ReusableDayCorrectionImage,
} from "./admin-api";
import {
  AdminCorrectionPhonePreview,
  buildAdminImageSection,
  type AdminPreviewImage,
} from "./content/daily-experience-preview";
import { AdminSessionGate } from "./admin-session-gate";
import { useAdminOperationsRefresh } from "./use-admin-operations-refresh";
import { useAdminUnauthorizedHandler } from "./use-admin-unauthorized-handler";

type DaySummary = AdminOperationsOverview["current"];
type LoadState<T> =
  { kind: "error"; message: string } | { kind: "loading" } | { data: T; kind: "ready" };
type DayLoadState =
  | { kind: "error"; message: string }
  | { kind: "loading" }
  | { data: AdminDayDetail; kind: "ready"; notice?: string };

type AppliedAuthorityExpectation = {
  activeContentVersion: string | null;
  contentVersion: string;
  lifecycleRevision: number;
  previousActiveContentVersion: string | null;
  previousContentVersion: string | null;
  previousLifecycleRevision: number;
};

const statusLabels: Record<DaySummary["operationalStatus"], string> = {
  generation_failed: "自动生成失败",
  invariant_broken: "版本状态异常",
  missing: "没有可展示内容",
  overdue: "尚未准备好",
  preparing: "准备中",
  publication_failed: "自动发布失败",
  published_degraded: "已发布 · 图片已降级",
  published_healthy: "已发布 · 正常",
  scheduled_ready: "已就绪",
};

const relationLabels: Record<DaySummary["relation"], string> = {
  current: "今天 · 用户正在看",
  future: "未来",
  next: "明天",
  past: "过去 · 只读",
};

function formatUpdatedAt(value: string | null): string {
  if (value === null) return "尚无更新时间";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "long",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function formatEffectiveAt(value: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "numeric",
    timeZone: "Asia/Shanghai",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("month")}月${part("day")}日 ${part("hour")}:${part("minute")}`;
}

function formatFortuneDateLabel(value: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/u.exec(value);
  return match === null ? value : `${Number(match[1])}月${Number(match[2])}日`;
}

function previewData(
  preview: AdminOperationsOverview["currentPreview"] | AdminDayDetail["preview"],
  requestContext: AdminOperationsOverview["requestContext"],
  publicContentContext: AdminOperationsOverview["publicContentContext"],
): CompleteTodayPageData | null {
  if (preview === null) return null;
  return parseDailyExperienceViewData(
    preview,
    requestContext,
    publicContentContext,
    preview.versions.contentVersion,
  );
}

function RequiredImageCount({ summary }: { summary: DaySummary }) {
  return (
    <div className="admin-readiness-counts">
      <strong>
        必备模特图 {summary.requiredImages.modelReadyCount}/{summary.requiredImages.requiredCount}
      </strong>
      <span>
        公开交付 {summary.requiredImages.deliverySafeCount}/{summary.requiredImages.requiredCount}
      </span>
    </div>
  );
}

function optionalImageCopy(status: DaySummary["optionalImageStatus"]): string {
  const labels: Record<DaySummary["optionalImageStatus"], string> = {
    failed: "生成未完成 · 不影响发布",
    not_requested: "未添加 · 不影响发布",
    omitted: "已省略 · 不影响发布",
    pending: "生成中 · 不影响发布",
    ready: "已添加",
  };
  return labels[status];
}

function DayStatusCard({
  heading,
  onPreview,
  selected,
  summary,
}: {
  heading: string;
  onPreview: () => void;
  selected: boolean;
  summary: DaySummary;
}) {
  return (
    <article className="admin-day-preview-card" data-selected={selected}>
      <header>
        <div>
          <p className="admin-kicker">{summary.fortuneDate}</p>
          <h2>{heading}</h2>
        </div>
        <span
          className={`admin-operation-status admin-operation-status--${summary.operationalStatus}`}
        >
          {statusLabels[summary.operationalStatus]}
        </span>
      </header>
      <RequiredImageCount summary={summary} />
      <dl className="admin-day-status-facts">
        <div>
          <dt>准备截止</dt>
          <dd>{formatEffectiveAt(summary.prepareBy)}</dd>
        </div>
        <div>
          <dt>公开生效</dt>
          <dd>{formatEffectiveAt(summary.effectiveFrom)}</dd>
        </div>
        <div>
          <dt>可选图</dt>
          <dd>{optionalImageCopy(summary.optionalImageStatus)}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{formatUpdatedAt(summary.updatedAt)}</dd>
        </div>
      </dl>
      <div className="admin-day-preview-card__actions">
        <button className="admin-button admin-button--quiet" type="button" onClick={onPreview}>
          {selected ? "正在预览" : "查看结果预览"}
        </button>
        <Link
          className="admin-button admin-button--quiet"
          href={`/admin/calendar/${summary.fortuneDate}`}
        >
          查看并修改
        </Link>
      </div>
    </article>
  );
}

function formatAnalyticsRate(
  rate: AdminAnalyticsOverview["outfitDetailRate"],
  label = "查看率",
): string {
  if (rate.ratio === null) return "暂无可计算样本";
  return `${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    style: "percent",
  }).format(rate.ratio)} ${label}`;
}

function TodayAnalyticsCard({ analytics }: { analytics: AdminAnalyticsOverview | null }) {
  return (
    <section className="admin-today-analytics" aria-labelledby="admin-today-analytics-title">
      <header>
        <div>
          <p className="admin-kicker">匿名使用统计</p>
          <h2 id="admin-today-analytics-title">今日使用情况</h2>
        </div>
        <div className="admin-today-analytics__actions">
          <span>按每个访问浏览器的随机标识去重</span>
          <Link href="/admin/analytics?days=7">查看完整数据报表</Link>
        </div>
      </header>
      {analytics === null ? (
        <p className="admin-today-analytics__unavailable">
          统计暂时没有读取成功，不影响内容发布、预览和修改。
        </p>
      ) : analytics.collectionStatus === "unavailable" ? (
        <p className="admin-today-analytics__unavailable">
          匿名统计采集当前不可用，已有数字可能不完整；不影响内容发布、预览和修改。
        </p>
      ) : (
        <dl className="admin-today-analytics__metrics">
          <div>
            <dt>打开页面</dt>
            <dd>{analytics.pageViews} 次浏览</dd>
            <span>{analytics.anonymousBrowsers} 个匿名浏览器</span>
          </div>
          <div>
            <dt>搭配互动</dt>
            <dd>{analytics.outfitHubVisitors} 个打开搭配</dd>
            <span>
              {analytics.outfitDetailVisitors} 个查看具体穿法 ·{" "}
              {formatAnalyticsRate(analytics.outfitDetailRate, "访问者深入率")}
            </span>
          </div>
          <div>
            <dt>分享意向</dt>
            <dd>{analytics.shareInitiations} 次分享发起</dd>
            <span>{formatAnalyticsRate(analytics.shareInitiationRate, "发起率")}</span>
          </div>
          <div>
            <dt>分享带回访问</dt>
            <dd>{analytics.referredBrowsers} 个分享回流</dd>
            <span>只计算打开了带回流标识的页面</span>
          </div>
          <div>
            <dt>保存海报</dt>
            <dd>{analytics.posterSaveRequests} 次保存请求</dd>
            <span>
              用户确认成功 {analytics.posterSaveSucceeded} · 已知失败 {analytics.posterSaveFailed}
            </span>
          </div>
        </dl>
      )}
    </section>
  );
}

export function AdminTodayView({
  analytics = null,
  issues,
  overview,
}: {
  analytics?: AdminAnalyticsOverview | null;
  issues: AdminActionableIssueList | null;
  overview: AdminOperationsOverview;
}) {
  const [previewTarget, setPreviewTarget] = useState<"current" | "next">("current");
  const nextContentReady = overview.next.operationalStatus === "scheduled_ready";
  const healthCopy =
    overview.health === "healthy"
      ? nextContentReady
        ? "今日内容正常，下一份内容已准备完成"
        : "今日内容正常，下一份内容正在准备"
      : overview.health === "attention"
        ? `有 ${overview.issueCount} 项需要处理`
        : "当前公开内容不可用";
  const currentHeading = `用户正在看到 · ${formatFortuneDateLabel(overview.current.fortuneDate)}${
    overview.publicContentContext.advancedFromCivilDate ? "（明日建议）" : ""
  }`;
  const nextHeading = `下一期 · ${formatFortuneDateLabel(overview.next.fortuneDate)}`;
  const selectedSummary = previewTarget === "current" ? overview.current : overview.next;
  const selectedPreview =
    previewTarget === "current" ? overview.currentPreview : overview.nextPreview;
  const selectedRequestContext =
    previewTarget === "current"
      ? overview.currentPreviewRequestContext
      : overview.nextPreviewRequestContext;
  const selectedPublicContentContext =
    previewTarget === "current"
      ? overview.currentPreviewPublicContentContext
      : overview.nextPreviewPublicContentContext;
  const today = useMemo(
    () => previewData(selectedPreview, selectedRequestContext, selectedPublicContentContext),
    [selectedPreview, selectedPublicContentContext, selectedRequestContext],
  );
  return (
    <div className="admin-operations admin-operations--today">
      <section className="admin-operations-hero">
        <div>
          <p className="admin-kicker">今日值守</p>
          <h1>{healthCopy}</h1>
          <p>用户端真实内容、下一期准备状态与待处理问题都在这一页。</p>
        </div>
        <span className={`admin-health-orb admin-health-orb--${overview.health}`}>
          {overview.health === "healthy"
            ? "正常"
            : overview.health === "attention"
              ? "注意"
              : "中断"}
        </span>
      </section>
      <section className="admin-today-grid" aria-label="当前和下一期">
        <DayStatusCard
          heading={currentHeading}
          onPreview={() => setPreviewTarget("current")}
          selected={previewTarget === "current"}
          summary={overview.current}
        />
        <DayStatusCard
          heading={nextHeading}
          onPreview={() => setPreviewTarget("next")}
          selected={previewTarget === "next"}
          summary={overview.next}
        />
      </section>
      <TodayAnalyticsCard analytics={analytics} />
      <section className="admin-today-workspace" aria-label="用户端预览与待处理问题">
        <aside className="admin-today-result-preview" aria-label="用户端结果预览">
          <header>
            <div>
              <p className="admin-kicker">用户端结果预览</p>
              <h2>
                {previewTarget === "current" ? "当前公开" : "下一份内容"} ·{" "}
                {selectedSummary.fortuneDate}
              </h2>
            </div>
            <span>{statusLabels[selectedSummary.operationalStatus]}</span>
          </header>
          {today === null ? (
            <div className="admin-preview-empty">
              <strong>还没有完整预览</strong>
              <span>系统会在真实内容可以形成用户页面后显示；这里不会补造演示数据。</span>
            </div>
          ) : (
            <div className="admin-phone-preview admin-phone-preview--compact">
              <DailyExperienceView mode="admin-preview" today={today} />
            </div>
          )}
        </aside>
        <section className="admin-today-issues" aria-labelledby="admin-today-issues-title">
          <div>
            <p className="admin-kicker">需要处理</p>
            <h2 id="admin-today-issues-title">当前需要处理</h2>
            {issues === null ? (
              <p>异常摘要暂时没有读取成功，请进入异常中心重新查看。</p>
            ) : issues.items.length === 0 ? (
              <div className="admin-today-issues__clear">
                <span aria-hidden="true">✓</span>
                <strong>当前没有需要人工处理的问题</strong>
              </div>
            ) : issues.publicContentContext.servedFortuneDate !==
              overview.publicContentContext.servedFortuneDate ? (
              <p>公开内容日期刚刚切换，请进入异常中心读取最新结果。</p>
            ) : (
              <ul>
                {issues.items.slice(0, 3).map((issue) => (
                  <li key={`${issue.code}-${issue.fortuneDate}`}>
                    <strong>{issue.title}</strong>
                    <span>{issue.impact}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link className="admin-button admin-button--quiet" href="/admin/issues">
            查看全部异常
          </Link>
        </section>
      </section>
    </div>
  );
}

function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (monthNumber ?? 1) - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function AdminCalendarView({
  month,
  notice,
  onMonthChange,
}: {
  month: AdminCalendarMonth;
  notice?: string;
  onMonthChange: (month: string) => void;
}) {
  const currentPublicMonth = month.publicContentContext.servedFortuneDate.slice(0, 7);
  return (
    <div className="admin-operations admin-operations--calendar">
      <section className="admin-calendar-toolbar">
        <div>
          <p className="admin-kicker">月日历</p>
          <h1>{month.month.replace("-", " 年 ")} 月</h1>
          <p>点开日期即可查看与用户端一致的页面。</p>
        </div>
        <div className="admin-calendar-toolbar__actions">
          <button type="button" onClick={() => onMonthChange(shiftMonth(month.month, -1))}>
            上个月
          </button>
          <button type="button" onClick={() => onMonthChange(shiftMonth(month.month, 1))}>
            下个月
          </button>
          <button type="button" onClick={() => onMonthChange(currentPublicMonth)}>
            回到当前月份
          </button>
        </div>
      </section>
      {notice === undefined ? null : (
        <p className="admin-calendar-notice" role="status">
          {notice}
        </p>
      )}
      <div className="admin-calendar-weekdays" aria-hidden="true">
        {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <section className="admin-calendar-grid" aria-label={`${month.month} 内容日历`}>
        {month.items.length === 0 ? (
          <div className="admin-calendar-empty">
            <strong>这个月还没有可显示的日期</strong>
            <span>系统没有返回任何真实日级数据，因此这里不会补造演示内容。</span>
          </div>
        ) : (
          month.items.map((day, index) => (
            <Link
              className={`admin-ops-calendar-day admin-ops-calendar-day--${day.operationalStatus}${
                day.fortuneDate.startsWith(month.month) ? "" : " admin-ops-calendar-day--outside"
              } admin-ops-calendar-day--${day.relation}`}
              data-testid="admin-calendar-day"
              href={`/admin/calendar/${day.fortuneDate}`}
              key={`${day.fortuneDate}-${index}`}
            >
              <span className="admin-ops-calendar-day__date">
                {Number(day.fortuneDate.slice(-2))}
              </span>
              <span className="admin-ops-calendar-day__relation">
                {relationLabels[day.relation]}
              </span>
              <span className="admin-ops-calendar-day__element">
                {day.dayElementLabel} ·{" "}
                {day.primaryColors.map((color) => color.name).join("、") || "待准备"}
              </span>
              <span className="admin-ops-calendar-day__status">
                {statusLabels[day.operationalStatus]}
              </span>
              <strong>{day.requiredImages.modelReadyCount}/2</strong>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}

export function AdminIssuesView({ issues }: { issues: AdminActionableIssueList }) {
  return (
    <div className="admin-operations admin-operations--issues">
      <section className="admin-operations-hero">
        <div>
          <p className="admin-kicker">异常中心</p>
          <h1>
            {issues.items.length === 0
              ? "现在没有需要处理的问题"
              : `${issues.items.length} 项需要处理`}
          </h1>
          <p>这里只出现会影响用户、且你现在可以处理的问题。</p>
        </div>
      </section>
      {issues.items.length === 0 ? (
        <section className="admin-issues-empty">
          <strong>系统运行平稳</strong>
          <span>当前和下一期的必要内容均可用。</span>
        </section>
      ) : (
        <section className="admin-issue-list" aria-label="待处理问题">
          {issues.items.map((issue) => (
            <article
              className={`admin-issue-card admin-issue-card--${issue.severity}`}
              key={`${issue.code}-${issue.fortuneDate}`}
            >
              <div>
                <p>{issue.fortuneDate}</p>
                <h2>{issue.title}</h2>
                <strong>影响：{issue.impact}</strong>
                {issue.mitigation === null ? null : <span>建议：{issue.mitigation}</span>}
              </div>
              <Link className="admin-button admin-button--primary" href={issue.actionHref}>
                {issue.actionLabel}
              </Link>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

type TierExplanationCommand = Extract<DayCorrectionCommand, { kind: "set_tier_explanation" }>;
type EditableTierCode = TierExplanationCommand["tierCode"];

type SelectionDescriptor =
  | { kind: "balance" }
  | { kind: "basis" }
  | { kind: "calendar" }
  | { field: "disclaimer" | "title"; formulaId: string; kind: "formula" }
  | { imageSlot: DailyImageSlot; kind: "image" }
  | { kind: "share" }
  | { kind: "tier_algorithm"; tierCode: EditableTierCode }
  | { kind: "tier_explanation"; tierCode: EditableTierCode }
  | { kind: "unknown" };

function selectionDescriptor(selectionKey: string): SelectionDescriptor {
  if (selectionKey === "calendar.summary") return { kind: "calendar" };
  if (selectionKey === "balanceSuggestion.description") return { kind: "balance" };
  if (selectionKey === "basis.disclaimer") return { kind: "basis" };
  if (selectionKey === "share.copy") return { kind: "share" };

  const tierMatch = /^tier\.(da_ji|ci_ji|ping|jiao_cha|bu_li)\.(algorithm|explanation)$/u.exec(
    selectionKey,
  );
  if (tierMatch?.[1] !== undefined) {
    const tierCode = tierMatch[1] as EditableTierCode;
    return tierMatch[2] === "algorithm"
      ? { kind: "tier_algorithm", tierCode }
      : { kind: "tier_explanation", tierCode };
  }

  const formulaMatch = /^formula\.(.+)\.(title|disclaimer)$/u.exec(selectionKey);
  if (
    formulaMatch?.[1] !== undefined &&
    (formulaMatch[2] === "title" || formulaMatch[2] === "disclaimer")
  ) {
    return { field: formulaMatch[2], formulaId: formulaMatch[1], kind: "formula" };
  }

  const imageMatch = /^image\.(required_primary|required_alternative|optional)$/u.exec(
    selectionKey,
  );
  if (imageMatch?.[1] !== undefined) {
    return { imageSlot: imageMatch[1] as DailyImageSlot, kind: "image" };
  }
  return { kind: "unknown" };
}

function selectionTitle(selection: SelectionDescriptor): string {
  if (selection.kind === "calendar") return "当日历法与五行结果";
  if (selection.kind === "balance") return "配饰补充建议";
  if (selection.kind === "basis") return "参考说明";
  if (selection.kind === "share") return "分享文案";
  if (selection.kind === "image") return "这张模特图";
  if (selection.kind === "formula") return "这套穿搭说明";
  if (selection.kind === "tier_explanation") return "这档颜色说明";
  if (selection.kind === "tier_algorithm") return "这档算法结果";
  return "当前选择";
}

type QuickEditOption = {
  group: "image" | "outfit" | "support" | "tier";
  label: string;
  selectionKey: string;
};

const tierQuickEditLabels: Record<EditableTierCode, string> = {
  bu_li: "不利颜色说明",
  ci_ji: "次吉颜色说明",
  da_ji: "大吉颜色说明",
  jiao_cha: "较差颜色说明",
  ping: "平档颜色说明",
};

function quickEditOption(
  selectionKey: string,
  today: CompleteTodayPageData | null,
): QuickEditOption | null {
  const selection = selectionDescriptor(selectionKey);
  if (selection.kind === "tier_explanation") {
    return {
      group: "tier",
      label: tierQuickEditLabels[selection.tierCode],
      selectionKey,
    };
  }
  if (selection.kind === "formula") {
    const formula = today?.outfitPreviewSection.cards.find(
      (candidate) => candidate.formulaId === selection.formulaId,
    );
    const title = formula?.title ?? "穿搭方案";
    return {
      group: "outfit",
      label: selection.field === "title" ? `“${title}”标题` : `“${title}”穿搭说明`,
      selectionKey,
    };
  }
  if (selection.kind === "balance") {
    return { group: "support", label: "配饰补充建议", selectionKey };
  }
  if (selection.kind === "basis") {
    return { group: "support", label: "页面底部参考说明", selectionKey };
  }
  if (selection.kind === "share") {
    return { group: "support", label: "分享文案", selectionKey };
  }
  if (selection.kind === "image") {
    const imageLabels: Record<DailyImageSlot, string> = {
      optional: "可选模特图",
      required_alternative: "备选模特图",
      required_primary: "主模特图",
    };
    return { group: "image", label: imageLabels[selection.imageSlot], selectionKey };
  }
  return null;
}

const imageSlots: readonly DailyImageSlot[] = [
  "required_primary",
  "required_alternative",
  "optional",
];

const imageSlotLabels: Record<
  DailyImageSlot,
  { description: string; eyebrow: string; title: string }
> = {
  optional: {
    description: "可留空；缺失或生成失败都不影响排期和发布。",
    eyebrow: "可选 · 不影响发布",
    title: "可选图",
  },
  required_alternative: {
    description: "大吉色与次吉色的备选搭配，属于发布必备图。",
    eyebrow: "必备 · 备选图",
    title: "备选方案",
  },
  required_primary: {
    description: "以当日大吉色为主的主搭配，属于发布必备图。",
    eyebrow: "必备 · 主图",
    title: "主方案",
  },
};

export type { AdminDayImageAdapter } from "./admin-day-image-adapter";

function selectedCopy(
  today: CompleteTodayPageData | null,
  selection: SelectionDescriptor | null,
): string {
  if (today === null || selection === null) return "";
  if (selection.kind === "tier_explanation") {
    const tierCode = selection.tierCode;
    const positive = [today.daJiCard, today.ciJiCard, today.pingCard].find(
      (card) => card.tierCode === tierCode,
    );
    return (
      positive?.explanation ??
      today.attentionSection.groups.find((group) => group.tierCode === tierCode)?.explanation ??
      ""
    );
  }
  if (selection.kind === "formula") {
    const card = today.outfitPreviewSection.cards.find(
      (candidate) => candidate.formulaId === selection.formulaId,
    );
    return selection.field === "title" ? (card?.title ?? "") : (card?.description ?? "");
  }
  if (selection.kind === "balance") {
    return today.attentionSection.balanceSuggestion.description;
  }
  if (selection.kind === "basis") return today.basis.disclaimer;
  if (selection.kind === "share") return today.share.copyText;
  return "";
}

function commandForSelection(
  selection: SelectionDescriptor,
  value: string,
): DayCorrectionCommand | null {
  if (selection.kind === "tier_explanation") {
    return {
      explanation: value,
      kind: "set_tier_explanation",
      tierCode: selection.tierCode,
    };
  }
  if (selection.kind === "formula") {
    return selection.field === "title"
      ? { formulaId: selection.formulaId, kind: "set_outfit_formula_title", title: value }
      : {
          disclaimer: value,
          formulaId: selection.formulaId,
          kind: "set_outfit_formula_disclaimer",
        };
  }
  if (selection.kind === "balance") {
    return { description: value, kind: "set_balance_suggestion_description" };
  }
  if (selection.kind === "basis") {
    return { disclaimer: value, kind: "set_basis_disclaimer" };
  }
  if (selection.kind === "share") return { copyText: value, kind: "set_share_copy" };
  return null;
}

function updatePreviewCopy(
  today: CompleteTodayPageData,
  selection: SelectionDescriptor,
  value: string,
): CompleteTodayPageData {
  if (selection.kind === "tier_explanation") {
    const tierCode = selection.tierCode;
    if (today.daJiCard.tierCode === tierCode) {
      return { ...today, daJiCard: { ...today.daJiCard, explanation: value } };
    }
    if (today.ciJiCard.tierCode === tierCode) {
      return { ...today, ciJiCard: { ...today.ciJiCard, explanation: value } };
    }
    if (today.pingCard.tierCode === tierCode) {
      return { ...today, pingCard: { ...today.pingCard, explanation: value } };
    }
    return {
      ...today,
      attentionSection: {
        ...today.attentionSection,
        groups: today.attentionSection.groups.map((group) =>
          group.tierCode === tierCode ? { ...group, explanation: value } : group,
        ) as CompleteTodayPageData["attentionSection"]["groups"],
      },
    };
  }
  if (selection.kind === "formula") {
    return {
      ...today,
      outfitPreviewSection: {
        ...today.outfitPreviewSection,
        cards: today.outfitPreviewSection.cards.map((card) =>
          card.formulaId !== selection.formulaId
            ? card
            : selection.field === "title"
              ? { ...card, title: value }
              : { ...card, description: value },
        ) as CompleteTodayPageData["outfitPreviewSection"]["cards"],
      },
    };
  }
  if (selection.kind === "balance") {
    return {
      ...today,
      attentionSection: {
        ...today.attentionSection,
        balanceSuggestion: {
          ...today.attentionSection.balanceSuggestion,
          description: value,
        } as CompleteTodayPageData["attentionSection"]["balanceSuggestion"],
      },
    };
  }
  if (selection.kind === "basis") {
    return { ...today, basis: { ...today.basis, disclaimer: value } };
  }
  return selection.kind === "share"
    ? { ...today, share: { ...today.share, copyText: value } }
    : today;
}

type CopyEditorState = {
  editValues: Record<string, string>;
  savedEditValues: Record<string, string>;
  today: CompleteTodayPageData | null;
};

function copyEditorStateFromDetail(detail: AdminDayDetail): CopyEditorState {
  const today = previewData(
    detail.preview,
    detail.previewRequestContext,
    detail.previewPublicContentContext,
  );
  const editValues = Object.fromEntries(
    detail.editableSelectionKeys
      .map((key) => [key, selectedCopy(today, selectionDescriptor(key))] as const)
      .filter(([key]) => quickEditOption(key, today)?.group !== "image"),
  );
  return {
    editValues,
    savedEditValues: editValues,
    today,
  };
}

function workingCopyValue(
  workingCopy: DayCorrectionWorkingCopy,
  selection: SelectionDescriptor,
): string | null {
  if (selection.kind === "tier_explanation") {
    return (
      workingCopy.modules.calendar_algorithm?.tiers.find(
        (tier) => tier.tierCode === selection.tierCode,
      )?.explanation ?? null
    );
  }
  const copy = workingCopy.modules.copy_and_formula;
  if (copy === null) return null;
  if (selection.kind === "formula") {
    const formula = copy.outfitFormulas.find(
      (candidate) => candidate.formulaId === selection.formulaId,
    );
    if (formula === undefined) return null;
    return selection.field === "title" ? formula.title : formula.disclaimer;
  }
  if (selection.kind === "balance") return copy.balanceSuggestion.description;
  if (selection.kind === "basis") return copy.basis.disclaimer;
  if (selection.kind === "share") return copy.share.copyText;
  return null;
}

function reconcileWorkingCopyCopy(
  state: CopyEditorState,
  baselineToday: CompleteTodayPageData | null,
  editableSelectionKeys: readonly string[],
  workingCopy: DayCorrectionWorkingCopy,
): { changedSelectionKeys: Set<string>; state: CopyEditorState } {
  const editValues = { ...state.editValues };
  const savedEditValues = { ...state.savedEditValues };
  const changedSelectionKeys = new Set<string>();
  let today = state.today;

  for (const selectionKey of editableSelectionKeys) {
    const selection = selectionDescriptor(selectionKey);
    const authoritativeValue = workingCopyValue(workingCopy, selection);
    if (authoritativeValue === null) continue;
    const localValue = editValues[selectionKey] ?? "";
    const localIsDirty = localValue !== (savedEditValues[selectionKey] ?? "");
    savedEditValues[selectionKey] = authoritativeValue;
    if (!localIsDirty) editValues[selectionKey] = authoritativeValue;
    if (today !== null) {
      today = updatePreviewCopy(today, selection, localIsDirty ? localValue : authoritativeValue);
    }
    if (authoritativeValue !== selectedCopy(baselineToday, selection)) {
      changedSelectionKeys.add(selectionKey);
    }
  }

  return {
    changedSelectionKeys,
    state: { editValues, savedEditValues, today },
  };
}

type ImagePlacement = CompleteTodayPageData["imagePreviewSection"]["cards"][number]["placement"];

function placementForImageSlot(imageSlot: DailyImageSlot): ImagePlacement {
  if (imageSlot === "required_primary") return "primary";
  return imageSlot === "required_alternative" ? "alternate" : "supplemental";
}

function selectedImagesFromWorkingCopy(workingCopy: DayCorrectionWorkingCopy): AdminPreviewImage[] {
  const visual = workingCopy.modules.visual_and_rights;
  if (visual === null) return [];
  return visual.looks.flatMap((look) => {
    const asset = visual.assets.find((candidate) => candidate.assetId === look.coverAssetId);
    if (asset === undefined) return [];
    return [
      {
        asset,
        imageSlot: look.imageSlot,
        previewUrl: `/admin/api/v1/image-assets/${encodeURIComponent(asset.assetId)}/preview`,
        selectedForSlot: true,
      },
    ];
  });
}

function changedImageSelectionKeys(
  baselineToday: CompleteTodayPageData | null,
  images: readonly AdminPreviewImage[],
): Set<string> {
  const changed = new Set<string>();
  for (const imageSlot of imageSlots) {
    const image = images.find((candidate) => candidate.imageSlot === imageSlot);
    const baselineAssetId = baselineToday?.imagePreviewSection.cards.find(
      (card) => card.placement === placementForImageSlot(imageSlot),
    )?.assetId;
    if (baselineAssetId !== image?.asset.assetId) changed.add(`image.${imageSlot}`);
  }
  return changed;
}

function reconcileWorkingCopyImages(
  today: CompleteTodayPageData,
  images: readonly AdminPreviewImage[],
  correction: CorrectionSession,
): CompleteTodayPageData {
  let next = today;
  for (const imageSlot of imageSlots) {
    const selected = images.find((image) => image.imageSlot === imageSlot);
    next =
      selected === undefined
        ? removePreviewImage(next, imageSlot)
        : updatePreviewImage(next, selected, correction);
  }
  return next;
}

function correctionSessionIsOlder(
  candidate: CorrectionSession,
  current: CorrectionSession,
): boolean {
  if (candidate.workingCopy.correctionId !== current.workingCopy.correctionId) return true;
  if (candidate.workingCopy.correctionRevision !== current.workingCopy.correctionRevision) {
    return candidate.workingCopy.correctionRevision < current.workingCopy.correctionRevision;
  }
  return candidate.workingCopy.draftRevision < current.workingCopy.draftRevision;
}

function detailConfirmsAppliedAuthority(
  detail: AdminDayDetail,
  expectation: AppliedAuthorityExpectation,
): boolean {
  const summaryLifecycleConfirmed =
    detail.summary.lifecycleRevision > expectation.previousLifecycleRevision &&
    detail.summary.lifecycleRevision >= expectation.lifecycleRevision;
  const concurrencyLifecycleConfirmed =
    detail.concurrency.lifecycleRevision > expectation.previousLifecycleRevision &&
    detail.concurrency.lifecycleRevision >= expectation.lifecycleRevision;
  const activeVersionConfirmed =
    expectation.activeContentVersion !== null &&
    expectation.activeContentVersion !== expectation.previousActiveContentVersion &&
    detail.concurrency.activeContentVersion === expectation.activeContentVersion;
  const previewContentVersion = detail.preview?.versions.contentVersion ?? null;
  const previewVersionConfirmed =
    expectation.contentVersion !== expectation.previousContentVersion &&
    previewContentVersion === expectation.contentVersion;
  return (
    summaryLifecycleConfirmed ||
    concurrencyLifecycleConfirmed ||
    activeVersionConfirmed ||
    previewVersionConfirmed
  );
}

function reconcileAuthoritativeDetail(
  current: CopyEditorState,
  authoritativeEditValues: Record<string, string>,
  authoritativeToday: CompleteTodayPageData | null,
  editableSelectionKeys: readonly string[],
  correction: CorrectionSession | null,
): CopyEditorState {
  const dirtyValues = new Map<string, string>();
  for (const selectionKey of editableSelectionKeys) {
    const localValue = current.editValues[selectionKey];
    if (localValue !== undefined && localValue !== (current.savedEditValues[selectionKey] ?? "")) {
      dirtyValues.set(selectionKey, localValue);
    }
  }

  let next: CopyEditorState = {
    editValues: { ...authoritativeEditValues },
    savedEditValues: { ...authoritativeEditValues },
    today: authoritativeToday,
  };
  if (correction !== null) {
    next = reconcileWorkingCopyCopy(
      next,
      authoritativeToday,
      editableSelectionKeys,
      correction.workingCopy,
    ).state;
    if (next.today !== null) {
      next = {
        ...next,
        today: reconcileWorkingCopyImages(
          next.today,
          selectedImagesFromWorkingCopy(correction.workingCopy),
          correction,
        ),
      };
    }
  }

  for (const [selectionKey, localValue] of dirtyValues) {
    if (!(selectionKey in next.editValues)) continue;
    next.editValues[selectionKey] = localValue;
    if (next.today !== null) {
      next.today = updatePreviewCopy(next.today, selectionDescriptor(selectionKey), localValue);
    }
  }
  return next;
}

function updatePreviewImage(
  today: CompleteTodayPageData,
  image: AdminPreviewImage,
  correction: CorrectionSession,
): CompleteTodayPageData {
  if (image.imageSlot === null) return today;
  const section = buildAdminImageSection(
    [image],
    correction.workingCopy.modules,
    today.imagePreviewSection.contentVersion,
  );
  const previewCard = section?.cards[0];
  if (previewCard === undefined) return today;
  const imageSlot = image.imageSlot;
  const placement = placementForImageSlot(imageSlot);
  const existing = today.imagePreviewSection.cards.findIndex(
    (card) => card.placement === placement,
  );
  const cards = [...today.imagePreviewSection.cards];
  if (existing >= 0) cards[existing] = previewCard;
  else cards.push(previewCard);
  cards.sort((left, right) => left.sortOrder - right.sortOrder);
  return {
    ...today,
    imagePreviewSection: { ...today.imagePreviewSection, cards },
  };
}

function removePreviewImage(
  today: CompleteTodayPageData,
  imageSlot: DailyImageSlot,
): CompleteTodayPageData {
  const placement = placementForImageSlot(imageSlot);
  return {
    ...today,
    imagePreviewSection: {
      ...today.imagePreviewSection,
      cards: today.imagePreviewSection.cards.filter((card) => card.placement !== placement),
    },
  };
}

function updatePublishedPreviewImage(
  today: CompleteTodayPageData,
  imageSlot: DailyImageSlot,
  image: AdminPreviewImage | null,
): CompleteTodayPageData {
  if (image === null) return removePreviewImage(today, imageSlot);
  const placement = placementForImageSlot(imageSlot);
  return {
    ...today,
    imagePreviewSection: {
      ...today.imagePreviewSection,
      cards: today.imagePreviewSection.cards
        .map((card) =>
          card.placement === placement
            ? {
                ...card,
                aiDisclosure:
                  image.asset.sourceType === "ai_generated" ? "AI 生成穿搭示意图" : null,
                altText: image.asset.altText,
                assetId: image.asset.assetId,
                height: image.asset.height,
                mediaType: image.asset.mediaType,
                url: image.previewUrl,
                width: image.asset.width,
              }
            : card,
        )
        .sort((left, right) => left.sortOrder - right.sortOrder),
    },
  };
}

function replaceSelectedPreviewImage(
  images: readonly AdminPreviewImage[],
  selectedImage: AdminPreviewImage,
): AdminPreviewImage[] {
  const next = images
    .map((image) =>
      image.imageSlot === selectedImage.imageSlot ? { ...image, selectedForSlot: false } : image,
    )
    .filter((image) => image.asset.assetId !== selectedImage.asset.assetId);
  next.push({ ...selectedImage, selectedForSlot: true });
  const order: Record<DailyImageSlot, number> = {
    optional: 2,
    required_alternative: 1,
    required_primary: 0,
  };
  return next.sort(
    (left, right) =>
      (left.imageSlot === null ? 3 : order[left.imageSlot]) -
      (right.imageSlot === null ? 3 : order[right.imageSlot]),
  );
}

function hasCompleteRequiredVisual(correction: CorrectionSession | null): boolean {
  const visual = correction?.workingCopy.modules.visual_and_rights;
  if (visual === null || visual === undefined) return false;
  const assets = new Set(visual.assets.map((asset) => asset.assetId));
  const requiredSlots: readonly DailyImageSlot[] = ["required_primary", "required_alternative"];
  const coverAssetIds: string[] = [];
  for (const imageSlot of requiredSlots) {
    const looks = visual.looks.filter((look) => look.imageSlot === imageSlot);
    const look = looks[0];
    if (
      looks.length !== 1 ||
      look === undefined ||
      !look.requiredForPublish ||
      !assets.has(look.coverAssetId)
    ) {
      return false;
    }
    coverAssetIds.push(look.coverAssetId);
  }
  return new Set(coverAssetIds).size === 2;
}

function correctionErrorMessage(status: number, phase: "apply" | "patch"): string {
  if (status === 412) return "内容刚被其他操作更新。已读取最新修订，请核对后再次保存。";
  if (status === 409) return "内容状态已经变化，请刷新本页后重新开始。";
  if (status === 503 && phase === "apply") {
    return "内容已安全保存，但发布暂不可用。请直接重试；系统会复用同一安全操作编号。";
  }
  return status === 503 ? "保存服务暂不可用，当前输入已保留，请稍后重试。" : "操作没有完成。";
}

function EmptyDayPhonePreview({
  detail,
  onSelectionChange,
}: {
  detail: AdminDayDetail;
  onSelectionChange: (selectionKey: string) => void;
}) {
  return (
    <div className="today-page today-page--home admin-preview-today-page admin-empty-day-preview">
      <header className="today-masthead admin-preview-masthead">
        <span className="today-help-link" aria-hidden="true">
          <span>?</span>
          <span>说明</span>
        </span>
        <div className="today-masthead__identity">
          <p className="today-masthead__brand">
            <span>Five</span>
            <span>五行穿衣</span>
          </p>
          <p className="today-masthead__description">每日五行搭配参考</p>
        </div>
      </header>
      <section className="admin-empty-day-preview__summary" aria-label="当日真实摘要">
        <p>{detail.summary.fortuneDate}</p>
        <h2>当日{detail.summary.dayElementLabel}日</h2>
        <span>
          主要颜色：{detail.summary.primaryColors.map((color) => color.name).join("、") || "待准备"}
        </span>
      </section>
      <section className="admin-correction-image-placeholders" aria-label="待补充模特图">
        <button
          data-admin-selection-key="image.required_primary"
          type="button"
          onClick={() => onSelectionChange("image.required_primary")}
        >
          <span>必备 · 主图</span>
          <strong>主模特图待补充</strong>
          <small>点击补充主图</small>
        </button>
        <button
          data-admin-selection-key="image.required_alternative"
          type="button"
          onClick={() => onSelectionChange("image.required_alternative")}
        >
          <span>必备 · 备选图</span>
          <strong>备选模特图待补充</strong>
          <small>点击补充备选图</small>
        </button>
      </section>
      <p className="admin-empty-day-preview__note">
        这里显示系统已经计算的真实日期与配色；补齐两张必备图后会恢复完整用户端预览。
      </p>
    </div>
  );
}

export function AdminDayDetailView({
  detail,
  imageAdapter,
  onAppliedAuthorityRefresh,
  refreshNotice,
  session,
}: {
  detail: AdminDayDetail;
  imageAdapter?: AdminDayImageAdapter;
  onAppliedAuthorityRefresh?: () => void;
  refreshNotice?: string;
  session: AdminSession;
}) {
  const [selectionKey, setSelectionKey] = useState<string | null>(null);
  const initialCopyEditor = useMemo(() => copyEditorStateFromDetail(detail), [detail]);
  const initialToday = initialCopyEditor.today;
  const initialEditValues = initialCopyEditor.editValues;
  const [copyEditor, setCopyEditor] = useState<CopyEditorState>(initialCopyEditor);
  const copyEditorRef = useRef(copyEditor);
  copyEditorRef.current = copyEditor;
  const { editValues, savedEditValues, today } = copyEditor;
  const [savedSelectionKeys, setSavedSelectionKeys] = useState<Set<string>>(() => new Set());
  const [previewOpen, setPreviewOpen] = useState(false);
  const editorRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const imageCardRefs = useRef<Record<DailyImageSlot, HTMLElement | null>>({
    optional: null,
    required_alternative: null,
    required_primary: null,
  });
  const correctionRef = useRef<CorrectionSession | null>(null);
  const imageCandidatesLoadedRef = useRef(false);
  const imagePickerRequestRef = useRef(0);
  const imagePickerPendingRef = useRef<number | null>(null);
  const activeImageSlotRef = useRef<DailyImageSlot | null>(null);
  const applyKeyRef = useRef<string | null>(null);
  const saveAndApplyPendingRef = useRef(false);
  const authoritativeDetailRef = useRef(detail);
  const appliedAuthorityRef = useRef<AppliedAuthorityExpectation | null>(null);
  const effectiveImageAdapter = imageAdapter ?? adminDayImageAdapter;
  const [correctionSnapshot, setCorrectionSnapshot] = useState<CorrectionSession | null>(null);
  const [previewImages, setPreviewImages] = useState<AdminPreviewImage[]>([]);
  const [imageChoices, setImageChoices] = useState<AdminPreviewImage[]>([]);
  const [libraryChoices, setLibraryChoices] = useState<ReusableDayCorrectionImage[]>([]);
  const [imagePickerMode, setImagePickerMode] = useState<
    "candidates" | "library" | "upload" | null
  >(null);
  const [activeImageSlot, setActiveImageSlot] = useState<DailyImageSlot | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadReason, setUploadReason] = useState("");
  const [uploadAltText, setUploadAltText] = useState("");
  const [hasSavedCorrection, setHasSavedCorrection] = useState(false);
  const [applied, setApplied] = useState(false);
  const [mutationState, setMutationState] = useState<
    { kind: "error" | "saved"; message: string } | { kind: "idle" | "saving" }
  >({ kind: "idle" });
  const [imageState, setImageState] = useState<string | null>(null);
  const pastDate = detail.summary.relation === "past";
  const selection = selectionDescriptor(selectionKey ?? "");
  const applyLabel =
    detail.summary.relation === "current"
      ? "保存并立即替换"
      : `保存并在 ${formatEffectiveAt(detail.summary.effectiveFrom)} 生效`;
  const quickEditOptions = detail.editableSelectionKeys
    .map((key) => quickEditOption(key, today))
    .filter((option): option is QuickEditOption => option !== null);
  const tierEditOptions = quickEditOptions.filter((option) => option.group === "tier");
  const outfitEditOptions = quickEditOptions.filter((option) => option.group === "outfit");
  const supportEditOptions = quickEditOptions.filter((option) => option.group === "support");
  function updateCopyEditor(updater: (current: CopyEditorState) => CopyEditorState): void {
    const next = updater(copyEditorRef.current);
    copyEditorRef.current = next;
    setCopyEditor(next);
  }
  function dirtyCopyKeysForState(state: CopyEditorState): string[] {
    return detail.editableSelectionKeys.filter((selectionKey) => {
      const option = quickEditOption(selectionKey, state.today);
      return (
        option !== null &&
        option.group !== "image" &&
        (state.editValues[selectionKey] ?? "") !== (state.savedEditValues[selectionKey] ?? "")
      );
    });
  }
  const dirtyCopyKeys = dirtyCopyKeysForState(copyEditor);
  const visibleChangeCount = new Set([...savedSelectionKeys, ...dirtyCopyKeys]).size;
  const requiredDeliveryReady =
    detail.summary.requiredImages.deliverySafeCount >= detail.summary.requiredImages.requiredCount;
  const requiredVisualReady =
    correctionSnapshot === null
      ? requiredDeliveryReady
      : hasCompleteRequiredVisual(correctionSnapshot);
  const canApplyCorrection =
    hasSavedCorrection && requiredVisualReady && dirtyCopyKeys.length === 0 && !applied;
  const canUsePrimaryAction =
    !applied &&
    requiredVisualReady &&
    visibleChangeCount > 0 &&
    (dirtyCopyKeys.length > 0 || canApplyCorrection);
  const primaryActionLabel = requiredVisualReady ? applyLabel : "先补齐必备图";

  function resetAfterAppliedAuthorityConfirmed(confirmedDetail: AdminDayDetail): void {
    const confirmedCopyEditor = copyEditorStateFromDetail(confirmedDetail);
    copyEditorRef.current = confirmedCopyEditor;
    setCopyEditor(confirmedCopyEditor);
    appliedAuthorityRef.current = null;
    correctionRef.current = null;
    imageCandidatesLoadedRef.current = false;
    imagePickerRequestRef.current += 1;
    imagePickerPendingRef.current = null;
    activeImageSlotRef.current = null;
    applyKeyRef.current = null;
    saveAndApplyPendingRef.current = false;
    setApplied(false);
    setMutationState({ kind: "idle" });
    setCorrectionSnapshot(null);
    setSavedSelectionKeys(new Set());
    setHasSavedCorrection(false);
    setPreviewImages([]);
    setImageChoices([]);
    setLibraryChoices([]);
    setImagePickerMode(null);
    setActiveImageSlot(null);
    setImageState(null);
    setSelectionKey(null);
  }

  useEffect(() => {
    const previousDetail = authoritativeDetailRef.current;
    authoritativeDetailRef.current = detail;
    if (
      previousDetail === detail ||
      previousDetail.summary.fortuneDate !== detail.summary.fortuneDate
    ) {
      return;
    }
    const appliedAuthority = appliedAuthorityRef.current;
    if (appliedAuthority !== null) {
      if (!detailConfirmsAppliedAuthority(detail, appliedAuthority)) return;
      resetAfterAppliedAuthorityConfirmed(detail);
      return;
    }
    const next = reconcileAuthoritativeDetail(
      copyEditorRef.current,
      initialEditValues,
      initialToday,
      detail.editableSelectionKeys,
      correctionRef.current,
    );
    copyEditorRef.current = next;
    setCopyEditor(next);
    if (correctionRef.current === null) {
      setPreviewImages([]);
      setSavedSelectionKeys(new Set());
      setHasSavedCorrection(false);
    }
  }, [detail, initialEditValues, initialToday]);

  function rememberCorrection(
    next: CorrectionSession,
    imageRequestRevision?: number,
  ): Set<string> | null {
    if (
      (imageRequestRevision !== undefined &&
        imageRequestRevision !== imagePickerRequestRef.current) ||
      (correctionRef.current !== null && correctionSessionIsOlder(next, correctionRef.current))
    ) {
      return null;
    }
    const selectedImages = selectedImagesFromWorkingCopy(next.workingCopy);
    const authoritativeCopy = reconcileWorkingCopyCopy(
      copyEditorRef.current,
      initialToday,
      detail.editableSelectionKeys,
      next.workingCopy,
    );
    const authoritativeChanges = new Set([
      ...authoritativeCopy.changedSelectionKeys,
      ...changedImageSelectionKeys(initialToday, selectedImages),
    ]);
    correctionRef.current = next;
    setCorrectionSnapshot(next);
    updateCopyEditor((current) => {
      const reconciled = reconcileWorkingCopyCopy(
        current,
        initialToday,
        detail.editableSelectionKeys,
        next.workingCopy,
      );
      const nextToday =
        reconciled.state.today === null
          ? null
          : reconcileWorkingCopyImages(reconciled.state.today, selectedImages, next);
      return { ...reconciled.state, today: nextToday };
    });
    setPreviewImages((current) =>
      selectedImages.reduce(
        (images, selectedImage) => replaceSelectedPreviewImage(images, selectedImage),
        current.filter((image) => !image.selectedForSlot),
      ),
    );
    const editableCopyKeys = new Set(
      detail.editableSelectionKeys.filter(
        (key) => workingCopyValue(next.workingCopy, selectionDescriptor(key)) !== null,
      ),
    );
    setSavedSelectionKeys((current) => {
      const reconciled = new Set(
        [...current].filter((key) => !editableCopyKeys.has(key) && !key.startsWith("image.")),
      );
      for (const key of authoritativeChanges) reconciled.add(key);
      return reconciled;
    });
    if (authoritativeChanges.size > 0) setHasSavedCorrection(true);
    return authoritativeChanges;
  }

  async function loadCorrectionImages(
    current: CorrectionSession,
    imageRequestRevision: number,
  ): Promise<CorrectionSession | null> {
    if (imageRequestRevision !== imagePickerRequestRef.current) return null;
    if (imageCandidatesLoadedRef.current) {
      const latest = correctionRef.current;
      return latest !== null && !correctionSessionIsOlder(latest, current) ? latest : current;
    }
    const loaded = await effectiveImageAdapter.listExisting({
      correction: current,
      csrfToken: session.csrfToken,
      imageSlot: "required_primary",
    });
    if (imageRequestRevision !== imagePickerRequestRef.current) return null;
    const alternative = await effectiveImageAdapter.listExisting({
      correction: loaded.correction,
      csrfToken: session.csrfToken,
      imageSlot: "required_alternative",
    });
    if (imageRequestRevision !== imagePickerRequestRef.current) return null;
    const optional = await effectiveImageAdapter.listExisting({
      correction: alternative.correction,
      csrfToken: session.csrfToken,
      imageSlot: "optional",
    });
    if (imageRequestRevision !== imagePickerRequestRef.current) return null;
    const correction = optional.correction;
    if (rememberCorrection(correction, imageRequestRevision) === null) return null;
    setPreviewImages([...loaded.choices, ...alternative.choices, ...optional.choices]);
    imageCandidatesLoadedRef.current = true;
    return correction;
  }

  async function ensureCorrection(
    loadImages = false,
    imageRequestRevision?: number,
  ): Promise<CorrectionSession | null> {
    if (applied) {
      setMutationState({
        kind: "error",
        message: "这次修改已经生效。请刷新页面读取新版本后再开始下一次修改。",
      });
      return null;
    }
    if (correctionRef.current !== null) {
      if (!loadImages) return correctionRef.current;
      if (imageRequestRevision === undefined) return null;
      try {
        return await loadCorrectionImages(correctionRef.current, imageRequestRevision);
      } catch {
        if (imageRequestRevision !== imagePickerRequestRef.current) return null;
        setMutationState({
          kind: "error",
          message: "暂时无法读取图片候选，文字内容仍可继续查看。",
        });
        return correctionRef.current;
      }
    }
    const result = await adminApi.openDayCorrection({
      csrfToken: session.csrfToken,
      fortuneDate: detail.summary.fortuneDate,
    });
    if (!result.ok) {
      setMutationState({
        kind: "error",
        message: describeAdminApiError(result.error, true),
      });
      return null;
    }
    const etag = result.response.headers.get("ETag");
    if (etag === null) {
      setMutationState({
        kind: "error",
        message: "服务端没有返回可确认的最新修订，请刷新后重试。",
      });
      return null;
    }
    const next = { etag, workingCopy: result.data };
    if (
      loadImages &&
      (imageRequestRevision === undefined || imageRequestRevision !== imagePickerRequestRef.current)
    ) {
      return null;
    }
    const existingChanges = rememberCorrection(next, loadImages ? imageRequestRevision : undefined);
    if (existingChanges === null) return null;
    if (existingChanges.size > 0 && !loadImages) {
      setMutationState({
        kind: "saved",
        message:
          "发现此前已保存的订正，已将服务端最新内容回填到表单和预览；你的未保存输入仍保留。请核对后再次使用底部主操作。",
      });
      return null;
    }
    if (!loadImages) return next;
    if (imageRequestRevision === undefined) return null;
    try {
      return await loadCorrectionImages(next, imageRequestRevision);
    } catch {
      if (imageRequestRevision !== imagePickerRequestRef.current) return null;
      setMutationState({
        kind: "error",
        message: "暂时无法读取图片候选，文字内容仍可继续查看。",
      });
      return next;
    }
  }

  async function refreshCorrectionAfterConflict(current: CorrectionSession): Promise<boolean> {
    const refreshed = await adminApi.getDayCorrection(current.workingCopy.correctionId);
    if (!refreshed.ok) return false;
    const etag = refreshed.response.headers.get("ETag");
    if (etag === null) return false;
    return rememberCorrection({ etag, workingCopy: refreshed.data }) !== null;
  }

  async function patchCorrection(command: DayCorrectionCommand): Promise<CorrectionSession | null> {
    const current = await ensureCorrection();
    if (current === null) return null;
    const result = await adminApi.patchDayCorrection({
      command,
      correctionId: current.workingCopy.correctionId,
      csrfToken: session.csrfToken,
      etag: current.etag,
    });
    if (!result.ok) {
      const refreshed =
        result.error.status === 412 ? await refreshCorrectionAfterConflict(current) : false;
      setMutationState({
        kind: "error",
        message:
          result.error.status === 412 && !refreshed
            ? "内容刚被其他操作更新，但暂时无法读取最新修订。请刷新页面后重试。"
            : result.error.status === 409 ||
                result.error.status === 412 ||
                result.error.status === 503
              ? correctionErrorMessage(result.error.status, "patch")
              : describeAdminApiError(result.error, true),
      });
      return null;
    }
    const refreshed = await adminApi.getDayCorrection(current.workingCopy.correctionId);
    if (!refreshed.ok) {
      setMutationState({
        kind: "error",
        message: "修改已经保存，但暂时无法读取最新内容。为避免覆盖新内容，请刷新后核对。",
      });
      return null;
    }
    const etag = refreshed.response.headers.get("ETag");
    if (etag === null) {
      setMutationState({ kind: "error", message: "服务端没有返回最新修订，当前预览未更新。" });
      return null;
    }
    const next = {
      etag,
      workingCopy: refreshed.data,
    };
    if (rememberCorrection(next) === null) {
      setMutationState({
        kind: "error",
        message: "服务端返回了较旧的修订，当前输入已保留；请刷新页面后重试。",
      });
      return null;
    }
    setHasSavedCorrection(true);
    return next;
  }

  async function saveCopyField(
    targetSelectionKey: string,
    requestedValue: string,
    allowWhileSaving = false,
  ): Promise<boolean> {
    if (mutationState.kind === "saving" && !allowWhileSaving) return false;
    const targetSelection = selectionDescriptor(targetSelectionKey);
    const value = requestedValue.trim();
    const command = commandForSelection(targetSelection, value);
    if (value === "" || command === null) {
      setMutationState({ kind: "error", message: "请输入要保存的文案。" });
      return false;
    }
    if (!allowWhileSaving) setMutationState({ kind: "saving" });
    const patched = await patchCorrection(command);
    if (patched === null) return false;
    const savedValue = workingCopyValue(patched.workingCopy, targetSelection) ?? value;
    updateCopyEditor((current) => {
      const currentValue = current.editValues[targetSelectionKey] ?? "";
      const valueToPreview = currentValue === requestedValue ? savedValue : currentValue;
      return {
        editValues: { ...current.editValues, [targetSelectionKey]: valueToPreview },
        savedEditValues: { ...current.savedEditValues, [targetSelectionKey]: savedValue },
        today:
          current.today === null
            ? null
            : updatePreviewCopy(current.today, targetSelection, valueToPreview),
      };
    });
    setSavedSelectionKeys((current) => new Set(current).add(targetSelectionKey));
    if (!allowWhileSaving) {
      setMutationState({ kind: "saved", message: "这项修改已保存，右侧结果预览已更新。" });
    }
    return true;
  }

  async function applyCorrection(afterBatchSave = false): Promise<void> {
    const current = correctionRef.current;
    if (
      current === null ||
      (!hasSavedCorrection && !afterBatchSave) ||
      (mutationState.kind === "saving" && !afterBatchSave)
    ) {
      return;
    }
    if (!hasCompleteRequiredVisual(current)) {
      setMutationState({
        kind: "error",
        message:
          "文案修改已安全保存在订正中，但主图和备选图还没有同时准备好，因此本次没有替换或排期。请先补齐两张必备图。",
      });
      return;
    }
    try {
      applyKeyRef.current ??= createIdempotencyKey();
    } catch {
      setMutationState({
        kind: "error",
        message: "当前浏览器无法创建安全操作编号，请刷新后重试。",
      });
      return;
    }
    setMutationState({ kind: "saving" });
    const result = await adminApi.applyDayCorrection({
      correctionId: current.workingCopy.correctionId,
      csrfToken: session.csrfToken,
      etag: current.etag,
      idempotencyKey: applyKeyRef.current,
      reason: `维护者通过可视化后台订正 ${detail.summary.fortuneDate} 的公开内容。`,
    });
    if (!result.ok) {
      const refreshed =
        result.error.status === 412 ? await refreshCorrectionAfterConflict(current) : false;
      setMutationState({
        kind: "error",
        message:
          result.error.status === 412 && !refreshed
            ? "内容刚被其他操作更新，但暂时无法读取最新修订。请刷新页面后重试。"
            : result.error.status === 409 ||
                result.error.status === 412 ||
                result.error.status === 503
              ? correctionErrorMessage(result.error.status, "apply")
              : describeAdminApiError(result.error, true),
      });
      return;
    }
    const appliedAuthority = {
      activeContentVersion: result.data.action.activeContentVersion,
      contentVersion: result.data.action.contentVersion,
      lifecycleRevision: result.data.action.lifecycleRevision,
      previousActiveContentVersion: detail.concurrency.activeContentVersion,
      previousContentVersion: detail.preview?.versions.contentVersion ?? null,
      previousLifecycleRevision: Math.max(
        detail.summary.lifecycleRevision,
        detail.concurrency.lifecycleRevision,
      ),
    };
    appliedAuthorityRef.current = appliedAuthority;
    setHasSavedCorrection(false);
    setSavedSelectionKeys(new Set());
    correctionRef.current = null;
    setCorrectionSnapshot(null);
    applyKeyRef.current = null;
    setApplied(true);
    setMutationState({
      kind: "saved",
      message:
        result.data.mode === "immediate"
          ? "新版本已立即替换，用户端会读取这次修改。"
          : `新版本已安排在北京时间 ${formatEffectiveAt(detail.summary.effectiveFrom)} 生效。`,
    });
    const authoritativeDetail = authoritativeDetailRef.current;
    if (detailConfirmsAppliedAuthority(authoritativeDetail, appliedAuthority)) {
      resetAfterAppliedAuthorityConfirmed(authoritativeDetail);
    } else {
      onAppliedAuthorityRefresh?.();
    }
  }

  async function saveAndApplyCorrection(): Promise<void> {
    if (saveAndApplyPendingRef.current || mutationState.kind === "saving" || applied) {
      return;
    }
    const startingState = copyEditorRef.current;
    const startingDirtyKeys = dirtyCopyKeysForState(startingState);
    const saveSnapshot = startingDirtyKeys.map((selectionKey) => ({
      selectionKey,
      value: startingState.editValues[selectionKey] ?? "",
    }));
    if (saveSnapshot.some(({ value }) => value.trim() === "")) {
      setMutationState({ kind: "error", message: "请补全所有已修改的文案后再保存。" });
      return;
    }
    saveAndApplyPendingRef.current = true;
    try {
      if (saveSnapshot.length === 0) {
        await applyCorrection();
        return;
      }
      setMutationState({ kind: "saving" });
      for (const { selectionKey, value } of saveSnapshot) {
        if (!(await saveCopyField(selectionKey, value, true))) return;
      }
      const latestDirtyKeys = dirtyCopyKeysForState(copyEditorRef.current);
      if (latestDirtyKeys.length > 0) {
        setMutationState({
          kind: "saved",
          message: "保存期间检测到新的输入，最新内容已保留但尚未生效。请核对预览后再次保存。",
        });
        return;
      }
      await applyCorrection(true);
    } finally {
      saveAndApplyPendingRef.current = false;
    }
  }

  async function showImagePicker(
    mode: "candidates" | "library" | "regenerate" | "upload",
    imageSlot: DailyImageSlot,
  ): Promise<void> {
    setSelectionKey(`image.${imageSlot}`);
    activateImageSlot(imageSlot, false);
    const requestRevision = ++imagePickerRequestRef.current;
    imagePickerPendingRef.current = requestRevision;
    if (mode === "upload") {
      imagePickerPendingRef.current = null;
      setImagePickerMode("upload");
      setImageChoices([]);
      setLibraryChoices([]);
      return;
    }
    setMutationState({ kind: "saving" });
    const current = await ensureCorrection(true, requestRevision);
    if (current === null || requestRevision !== imagePickerRequestRef.current) {
      if (requestRevision === imagePickerRequestRef.current) {
        imagePickerPendingRef.current = null;
        setMutationState({ kind: "idle" });
      }
      return;
    }
    const base = {
      correction: current,
      csrfToken: session.csrfToken,
      imageSlot,
    };
    try {
      if (mode === "library") {
        const choices = await effectiveImageAdapter.listLibrary(base);
        if (requestRevision !== imagePickerRequestRef.current) return;
        imagePickerPendingRef.current = null;
        setLibraryChoices(choices);
        setImageChoices([]);
        setImagePickerMode("library");
        setImageState(choices.length === 0 ? "搭配库暂时没有适合当天配色的图片。" : null);
      } else {
        const result =
          mode === "regenerate"
            ? await effectiveImageAdapter.regenerate(base)
            : await effectiveImageAdapter.listExisting(base);
        if (requestRevision !== imagePickerRequestRef.current) return;
        imagePickerPendingRef.current = null;
        if (rememberCorrection(result.correction, requestRevision) === null) {
          imagePickerPendingRef.current = null;
          setMutationState({
            kind: "error",
            message: "图片候选基于较旧修订，当前内容保持不变；请重新打开候选。",
          });
          return;
        }
        setImageChoices(result.choices);
        setLibraryChoices([]);
        setImagePickerMode("candidates");
        setImageState(
          result.choices.length === 0
            ? "这张图还没有候选。"
            : mode === "regenerate"
              ? "新候选已经生成，请查看后明确选择是否使用。"
              : "请选择一张候选图；当前页面不会自动替你选第一张。",
        );
      }
      setMutationState({ kind: "idle" });
    } catch {
      if (requestRevision !== imagePickerRequestRef.current) return;
      imagePickerPendingRef.current = null;
      setMutationState({ kind: "error", message: "图片候选没有读取成功，当前图片保持不变。" });
    }
  }

  function acceptImageSelection(result: {
    correction: CorrectionSession;
    selectedImage: AdminPreviewImage;
  }): boolean {
    if (rememberCorrection(result.correction) === null) {
      setMutationState({
        kind: "error",
        message: "图片操作返回了较旧修订，当前内容保持不变；请重新打开图片操作。",
      });
      return false;
    }
    setPreviewImages((current) => replaceSelectedPreviewImage(current, result.selectedImage));
    setHasSavedCorrection(true);
    updateCopyEditor((current) => ({
      ...current,
      today:
        current.today === null
          ? null
          : updatePreviewImage(current.today, result.selectedImage, result.correction),
    }));
    setImageChoices([]);
    setLibraryChoices([]);
    setImagePickerMode(null);
    setImageState("图片已保存，手机预览已按最新结果更新。");
    if (result.selectedImage.imageSlot !== null) {
      setSavedSelectionKeys((current) =>
        new Set(current).add(`image.${result.selectedImage.imageSlot}`),
      );
    }
    setMutationState({ kind: "saved", message: "图片修改已保存，等待统一生效。" });
    return true;
  }

  async function selectImageCandidate(assetId: string, imageSlot: DailyImageSlot): Promise<void> {
    const current = await ensureCorrection();
    if (current === null) return;
    setMutationState({ kind: "saving" });
    try {
      acceptImageSelection(
        await effectiveImageAdapter.selectCandidate({
          assetId,
          correction: current,
          csrfToken: session.csrfToken,
          imageSlot,
        }),
      );
    } catch {
      setMutationState({ kind: "error", message: "候选图没有保存，当前图片保持不变。" });
    }
  }

  async function selectLibraryImage(
    choice: ReusableDayCorrectionImage,
    imageSlot: DailyImageSlot,
  ): Promise<void> {
    const current = await ensureCorrection();
    if (current === null) return;
    setMutationState({ kind: "saving" });
    try {
      acceptImageSelection(
        await effectiveImageAdapter.selectLibrary({
          assetId: choice.assetId,
          correction: current,
          csrfToken: session.csrfToken,
          imageSlot,
          sourceContentVersion: choice.sourceContentVersion,
        }),
      );
    } catch {
      setMutationState({ kind: "error", message: "搭配库图片没有保存，当前图片保持不变。" });
    }
  }

  async function uploadCorrectionImage(): Promise<void> {
    if (activeImageSlot === null) return;
    if (uploadFile === null || uploadReason.trim() === "") {
      setMutationState({ kind: "error", message: "请选择图片，并简要说明这次替换原因。" });
      return;
    }
    const current = await ensureCorrection();
    if (current === null) return;
    setMutationState({ kind: "saving" });
    try {
      const accepted = acceptImageSelection(
        await effectiveImageAdapter.upload({
          altText: uploadAltText.trim() === "" ? undefined : uploadAltText.trim(),
          correction: current,
          csrfToken: session.csrfToken,
          file: uploadFile,
          imageSlot: activeImageSlot,
          reason: uploadReason.trim(),
        }),
      );
      if (accepted) {
        setUploadFile(null);
        setUploadReason("");
        setUploadAltText("");
      }
    } catch {
      setMutationState({ kind: "error", message: "图片没有上传成功，当前图片保持不变。" });
    }
  }

  async function withdrawPublishedImage(imageSlot: DailyImageSlot): Promise<void> {
    const activeContentVersion = detail.concurrency.activeContentVersion;
    if (activeContentVersion === null) return;
    const placement = placementForImageSlot(imageSlot);
    const currentCard = today?.imagePreviewSection.cards.find(
      (card) => card.placement === placement,
    );
    const assetId =
      currentCard?.assetId ??
      previewImages.find((image) => image.imageSlot === imageSlot && image.selectedForSlot)?.asset
        .assetId;
    if (assetId === undefined) {
      setMutationState({ kind: "error", message: "这张图没有可下线的已发布图片。" });
      return;
    }
    setMutationState({ kind: "saving" });
    try {
      const result = await effectiveImageAdapter.withdrawPublished({
        activeContentVersion,
        assetId,
        csrfToken: session.csrfToken,
        fortuneDate: detail.summary.fortuneDate,
        imageSlot,
      });
      setPreviewImages((current) => {
        const withoutSlot = current.filter((image) => image.imageSlot !== imageSlot);
        return result.previewImage === null
          ? withoutSlot
          : replaceSelectedPreviewImage(withoutSlot, result.previewImage);
      });
      updateCopyEditor((current) => ({
        ...current,
        today:
          current.today === null
            ? null
            : updatePublishedPreviewImage(current.today, imageSlot, result.previewImage),
      }));
      setImageState("当前单图已通过安全降级流程下线。");
      setMutationState({ kind: "saved", message: "线上图片状态已更新，请核对手机预览。" });
    } catch {
      setMutationState({ kind: "error", message: "单图下线没有完成，线上内容保持不变。" });
    }
  }

  function clearImagePickerState(): void {
    imagePickerRequestRef.current += 1;
    if (imagePickerPendingRef.current !== null) {
      imagePickerPendingRef.current = null;
      setMutationState({ kind: "idle" });
    }
    setImageChoices([]);
    setLibraryChoices([]);
    setImagePickerMode(null);
    setUploadFile(null);
    setUploadReason("");
    setUploadAltText("");
    setImageState(null);
  }

  function activateImageSlot(imageSlot: DailyImageSlot, focusCard = true): void {
    if (activeImageSlotRef.current !== imageSlot) clearImagePickerState();
    activeImageSlotRef.current = imageSlot;
    setActiveImageSlot(imageSlot);
    if (!focusCard) return;
    const card = imageCardRefs.current[imageSlot];
    if (card === null) return;
    card.focus();
    if (typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function handlePreviewSelection(nextSelectionKey: string): void {
    setSelectionKey(nextSelectionKey);
    if (previewOpen) setPreviewOpen(false);
    const nextSelection = selectionDescriptor(nextSelectionKey);
    if (nextSelection.kind === "image") {
      activateImageSlot(nextSelection.imageSlot);
      return;
    }
    const editor = editorRefs.current[nextSelectionKey];
    if (editor !== null && editor !== undefined) {
      editor.focus();
      if (typeof editor.scrollIntoView === "function") {
        editor.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }

  useEffect(() => {
    function closeDrawer(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      if (previewOpen) setPreviewOpen(false);
      else setSelectionKey(null);
    }
    window.addEventListener("keydown", closeDrawer);
    return () => window.removeEventListener("keydown", closeDrawer);
  }, [previewOpen]);

  const previewTiers =
    today === null
      ? []
      : [today.daJiCard, today.ciJiCard, today.pingCard, ...today.attentionSection.groups];

  function renderCopySection(
    sectionId: string,
    eyebrow: string,
    title: string,
    description: string,
    options: readonly QuickEditOption[],
  ) {
    return (
      <section className="admin-editor-section" aria-labelledby={sectionId}>
        <header className="admin-editor-section__header">
          <div>
            <p className="admin-kicker">{eyebrow}</p>
            <h2 id={sectionId}>{title}</h2>
            <p>{description}</p>
          </div>
          <span>{options.length} 项</span>
        </header>
        {options.length === 0 ? (
          <p className="admin-editor-empty">
            当前真实预览没有返回这一组可编辑文案；页面不会为了填满表单而补造内容。
          </p>
        ) : (
          <div className="admin-copy-field-list">
            {options.map((option) => {
              const fieldSelection = selectionDescriptor(option.selectionKey);
              const dirty =
                (editValues[option.selectionKey] ?? "") !==
                (savedEditValues[option.selectionKey] ?? "");
              const savedInWorkingCopy = savedSelectionKeys.has(option.selectionKey);
              return (
                <article
                  className="admin-copy-field"
                  data-active={selectionKey === option.selectionKey}
                  data-dirty={dirty}
                  key={option.selectionKey}
                >
                  <label htmlFor={`admin-copy-${option.selectionKey}`}>{option.label}</label>
                  <span className="admin-copy-field__scope">
                    {fieldSelection.kind === "tier_explanation"
                      ? "仅修改说明；档位、五行和颜色只读"
                      : fieldSelection.kind === "formula"
                        ? "仅修改展示文案；配色公式只读"
                        : "仅修改公开展示文案"}
                  </span>
                  <textarea
                    aria-label={option.label}
                    disabled={pastDate || applied || mutationState.kind === "saving"}
                    id={`admin-copy-${option.selectionKey}`}
                    ref={(node) => {
                      editorRefs.current[option.selectionKey] = node;
                    }}
                    rows={fieldSelection.kind === "share" ? 5 : 3}
                    value={editValues[option.selectionKey] ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      updateCopyEditor((current) => ({
                        editValues: {
                          ...current.editValues,
                          [option.selectionKey]: value,
                        },
                        savedEditValues: current.savedEditValues,
                        today:
                          current.today === null
                            ? null
                            : updatePreviewCopy(current.today, fieldSelection, value),
                      }));
                    }}
                    onFocus={() => setSelectionKey(option.selectionKey)}
                  />
                  <footer>
                    <span>
                      {pastDate
                        ? "过去日期只读"
                        : mutationState.kind === "saving"
                          ? "正在安全保存，暂时不能继续编辑"
                          : dirty
                            ? "将随底部主操作保存"
                            : savedInWorkingCopy
                              ? "已保存，等待统一生效"
                              : "尚未修改"}
                    </span>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="admin-operations admin-day-detail">
      <nav className="admin-breadcrumb" aria-label="面包屑">
        <Link href="/admin/calendar">日历</Link>
        <span aria-hidden="true">/</span>
        <strong>{detail.summary.fortuneDate}</strong>
      </nav>
      {refreshNotice === undefined ? null : (
        <p className="admin-calendar-notice" role="status">
          {refreshNotice}
        </p>
      )}
      <header className="admin-day-detail__header">
        <div>
          <p className="admin-kicker">日期详情</p>
          <h1>{detail.summary.fortuneDate}</h1>
          <p>
            {relationLabels[detail.summary.relation]} ·{" "}
            {statusLabels[detail.summary.operationalStatus]}
          </p>
        </div>
        <dl className="admin-day-detail__facts">
          <div>
            <dt>准备截止</dt>
            <dd>{formatEffectiveAt(detail.summary.prepareBy)}</dd>
          </div>
          <div>
            <dt>公开生效</dt>
            <dd>{formatEffectiveAt(detail.summary.effectiveFrom)}</dd>
          </div>
          <div>
            <dt>必备模特图</dt>
            <dd>
              {detail.summary.requiredImages.modelReadyCount}/
              {detail.summary.requiredImages.requiredCount}
            </dd>
          </div>
          <div>
            <dt>可选图</dt>
            <dd>{optionalImageCopy(detail.summary.optionalImageStatus)}</dd>
          </div>
        </dl>
        <div className="admin-day-detail__header-actions">
          <button
            className="admin-button admin-button--quiet admin-preview-toggle"
            type="button"
            onClick={() => setPreviewOpen(true)}
          >
            打开用户端预览
          </button>
          <Link href="/admin/calendar" className="admin-button admin-button--quiet">
            返回日历
          </Link>
        </div>
      </header>
      <div className="admin-day-detail__workspace">
        <section className="admin-structured-editor" aria-label="日期内容结构化编辑器">
          <section
            className="admin-editor-section admin-algorithm-readonly"
            aria-label="算法结果 · 只读"
          >
            <header className="admin-editor-section__header">
              <div>
                <p className="admin-kicker">01 · 只读</p>
                <h2>算法结果 · 只读</h2>
                <p>日期、时辰、日五行、五档顺序和颜色由服务端算法统一计算。</p>
              </div>
              <span>不可在单日覆盖</span>
            </header>
            <dl className="admin-algorithm-facts">
              <div>
                <dt>命理日</dt>
                <dd>{detail.summary.fortuneDate}</dd>
              </div>
              <div>
                <dt>当前时辰</dt>
                <dd>{detail.previewRequestContext.shichen}时</dd>
              </div>
              <div>
                <dt>当日五行</dt>
                <dd>{detail.summary.dayElementLabel}</dd>
              </div>
              <div>
                <dt>主色</dt>
                <dd>
                  {detail.summary.primaryColors.map((color) => color.name).join("、") || "待准备"}
                </dd>
              </div>
            </dl>
            {previewTiers.length === 0 ? null : (
              <ol className="admin-algorithm-tiers" aria-label="五档顺序与颜色">
                {previewTiers.map((tier, index) => (
                  <li key={tier.tierCode}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{tier.algorithmLabel}</strong>
                    <small>{tier.elementLabel}</small>
                    <em>{tier.colors.map((color) => color.name).join("、")}</em>
                  </li>
                ))}
              </ol>
            )}
            {selectionKey !== null && detail.readonlySelectionKeys.includes(selectionKey) ? (
              <p className="admin-readonly-selection" role="status">
                {selectionTitle(selection)}
                是算法生成结果，当前页面只读；如有错误请进入规则修正流程。
              </p>
            ) : null}
          </section>

          {today === null ? (
            <section
              className="admin-editor-section admin-editor-unavailable"
              aria-label="文案编辑暂不可用"
            >
              <p className="admin-kicker">文案编辑</p>
              <h2>等待真实展示内容</h2>
              <p>
                系统暂未提供可读取的展示文案，因此这里不会显示空白输入框或用演示文案代替。图片仍可在下方按需维护。
              </p>
            </section>
          ) : (
            <>
              {renderCopySection(
                "admin-tier-copy",
                "02 · 直接编辑",
                "五档说明",
                "五档名称、五行、顺序和颜色保持只读；五段用户说明同时展开，便于横向比较。",
                tierEditOptions,
              )}
              {renderCopySection(
                "admin-outfit-copy",
                "03 · 直接编辑",
                "穿搭内容",
                "单色、双色、三色方案的标题和说明直接编辑；公式档位和颜色代码保持不变。",
                outfitEditOptions,
              )}
              {renderCopySection(
                "admin-support-copy",
                "04 · 直接编辑",
                "配饰、参考说明与分享",
                "只维护用户会看到的展示文字，推导步骤和来源版本不在普通页面修改。",
                supportEditOptions,
              )}
            </>
          )}

          <section
            className="admin-editor-section admin-image-editor"
            aria-labelledby="admin-image-editor-title"
          >
            <header className="admin-editor-section__header">
              <div>
                <p className="admin-kicker">05 · 图片管理</p>
                <h2 id="admin-image-editor-title">三张图，各自维护</h2>
                <p>主方案和备选方案为必备；可选图单独计算，缺失永远不报错。</p>
              </div>
              <span>
                必备 {detail.summary.requiredImages.modelReadyCount}/
                {detail.summary.requiredImages.requiredCount}
              </span>
            </header>
            <div className="admin-image-slot-grid">
              {imageSlots.map((imageSlot) => {
                const copy = imageSlotLabels[imageSlot];
                const placement = placementForImageSlot(imageSlot);
                const selectedCandidate = previewImages.find(
                  (image) => image.imageSlot === imageSlot && image.selectedForSlot,
                );
                const previewCard = today?.imagePreviewSection.cards.find(
                  (card) => card.placement === placement,
                );
                const previewUrl = selectedCandidate?.previewUrl ?? previewCard?.url;
                const canEditSlot =
                  !pastDate && detail.editableSelectionKeys.includes(`image.${imageSlot}`);
                const panelActive = activeImageSlot === imageSlot;
                return (
                  <article
                    aria-label={copy.title}
                    className="admin-image-slot-card"
                    data-active={panelActive}
                    data-slot={imageSlot}
                    key={imageSlot}
                    ref={(node) => {
                      imageCardRefs.current[imageSlot] = node;
                    }}
                    tabIndex={-1}
                  >
                    <header>
                      <span>{copy.eyebrow}</span>
                      <strong>{copy.title}</strong>
                      <small>{copy.description}</small>
                    </header>
                    {previewUrl === undefined ? (
                      <div className="admin-image-slot-card__empty">
                        <span aria-hidden="true">图</span>
                        <strong>{imageSlot === "optional" ? "尚未添加" : "当前未显示图片"}</strong>
                      </div>
                    ) : (
                      <img
                        alt={selectedCandidate?.asset.altText ?? previewCard?.altText ?? copy.title}
                        src={previewUrl}
                      />
                    )}
                    <p>
                      {imageSlot === "optional"
                        ? optionalImageCopy(detail.summary.optionalImageStatus)
                        : previewUrl === undefined
                          ? "待补充"
                          : "当前已有图片"}
                    </p>
                    {canEditSlot && !applied ? (
                      <div className="admin-image-slot-card__actions">
                        <button
                          disabled={mutationState.kind === "saving"}
                          type="button"
                          onClick={() => void showImagePicker("regenerate", imageSlot)}
                        >
                          重新生成
                        </button>
                        <button
                          disabled={mutationState.kind === "saving"}
                          type="button"
                          onClick={() => void showImagePicker("library", imageSlot)}
                        >
                          从搭配库选择
                        </button>
                        <button
                          disabled={mutationState.kind === "saving"}
                          type="button"
                          onClick={() => void showImagePicker("candidates", imageSlot)}
                        >
                          选择已有候选
                        </button>
                        <button
                          disabled={mutationState.kind === "saving"}
                          type="button"
                          onClick={() => void showImagePicker("upload", imageSlot)}
                        >
                          手动上传
                        </button>
                        {detail.concurrency.activeContentVersion === null ? null : (
                          <button
                            disabled={mutationState.kind === "saving"}
                            type="button"
                            onClick={() => void withdrawPublishedImage(imageSlot)}
                          >
                            单图下线
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="admin-inline-note">
                        {pastDate ? "过去日期只读。" : "这张图暂不支持修改。"}
                      </p>
                    )}
                    {!panelActive ? null : imagePickerMode === "candidates" ? (
                      <div className="admin-correction-image-choices" aria-label="图片候选">
                        {imageChoices.map((choice) => (
                          <article key={choice.asset.assetId}>
                            <img
                              alt={choice.asset.altText}
                              height={choice.asset.height}
                              src={choice.previewUrl}
                              width={choice.asset.width}
                            />
                            <div>
                              <strong>{choice.selectedForSlot ? "当前正在使用" : "候选图"}</strong>
                              <span>{choice.asset.altText}</span>
                              <button
                                disabled={mutationState.kind === "saving"}
                                type="button"
                                onClick={() =>
                                  void selectImageCandidate(choice.asset.assetId, imageSlot)
                                }
                              >
                                使用这张候选图
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : imagePickerMode === "library" ? (
                      <div className="admin-correction-image-choices" aria-label="搭配库图片">
                        {libraryChoices.map((choice) => (
                          <article key={`${choice.sourceContentVersion}-${choice.assetId}`}>
                            <img alt="搭配库模特穿搭" src={choice.previewUrl} />
                            <div>
                              <strong>{choice.sourceFortuneDate} 的搭配</strong>
                              <span>{choice.colorCodes.join("、") || "与当天配色兼容"}</span>
                              <button
                                disabled={mutationState.kind === "saving"}
                                type="button"
                                onClick={() => void selectLibraryImage(choice, imageSlot)}
                              >
                                使用这张搭配图
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : imagePickerMode === "upload" ? (
                      <div className="admin-correction-upload-form">
                        <label>
                          选择图片
                          <input
                            accept="image/avif,image/webp,image/jpeg,image/png"
                            disabled={mutationState.kind === "saving"}
                            type="file"
                            onChange={(event) =>
                              setUploadFile(event.currentTarget.files?.[0] ?? null)
                            }
                          />
                        </label>
                        <label>
                          替换原因
                          <textarea
                            disabled={mutationState.kind === "saving"}
                            rows={3}
                            value={uploadReason}
                            onChange={(event) => setUploadReason(event.currentTarget.value)}
                          />
                        </label>
                        <label>
                          图片说明（可选）
                          <input
                            disabled={mutationState.kind === "saving"}
                            value={uploadAltText}
                            onChange={(event) => setUploadAltText(event.currentTarget.value)}
                          />
                        </label>
                        <button
                          disabled={mutationState.kind === "saving"}
                          type="button"
                          onClick={() => void uploadCorrectionImage()}
                        >
                          上传并使用
                        </button>
                      </div>
                    ) : null}
                    {!panelActive || imageState === null ? null : <p role="status">{imageState}</p>}
                  </article>
                );
              })}
            </div>
          </section>
        </section>

        <button
          aria-label="关闭用户端预览"
          className="admin-preview-backdrop"
          data-open={previewOpen}
          type="button"
          onClick={() => setPreviewOpen(false)}
        />
        <aside className="admin-preview-stage" data-open={previewOpen} aria-label="用户端结果预览">
          <header className="admin-preview-stage__header">
            <div>
              <p className="admin-kicker">真实用户端 · 375px</p>
              <h2>结果预览</h2>
              <span>点预览内容可定位左侧字段，不会清空其他输入。</span>
            </div>
            <div>
              <Link href={`/daily/${detail.summary.fortuneDate}`} target="_blank">
                打开完整页面
              </Link>
              <button type="button" onClick={() => setPreviewOpen(false)}>
                关闭
              </button>
            </div>
          </header>
          <div className="admin-phone-preview">
            {today !== null ? (
              <DailyExperienceView
                mode="admin-preview"
                onSelectionChange={pastDate ? undefined : handlePreviewSelection}
                today={today}
              />
            ) : correctionSnapshot !== null && !pastDate ? (
              <AdminCorrectionPhonePreview
                fortuneDate={detail.summary.fortuneDate}
                images={previewImages}
                modules={correctionSnapshot.workingCopy.modules}
                onSelectionChange={handlePreviewSelection}
                revisionLabel={`correction-${correctionSnapshot.workingCopy.correctionRevision}`}
              />
            ) : !pastDate ? (
              <EmptyDayPhonePreview detail={detail} onSelectionChange={handlePreviewSelection} />
            ) : (
              <div className="admin-preview-empty">
                <strong>该日没有可读取的历史预览</strong>
                <span>这里不会补造历史演示内容。</span>
              </div>
            )}
          </div>
        </aside>
      </div>
      <section className="admin-day-apply" aria-label="保存并生效">
        <div>
          <strong>
            {pastDate
              ? "过去日期只读"
              : visibleChangeCount === 0
                ? "当前没有修改"
                : `共 ${visibleChangeCount} 项修改 · 确认后生效`}
          </strong>
          <span>
            {pastDate
              ? "历史公开内容不会在这里被改写；当前页面只用于核对。"
              : detail.summary.relation === "current"
                ? "当前公开日期会创建新版本并立即替换"
                : `未来日期会创建新版本，并在 ${formatEffectiveAt(
                    detail.summary.effectiveFrom,
                  )} 生效`}
            {` · 必备图片 ${detail.summary.requiredImages.modelReadyCount}/${detail.summary.requiredImages.requiredCount}`}
          </span>
          {mutationState.kind === "error" || mutationState.kind === "saved" ? (
            <p role={mutationState.kind === "error" ? "alert" : "status"}>
              {mutationState.message}
            </p>
          ) : null}
          {!pastDate && !requiredDeliveryReady ? (
            <p className="admin-inline-note" role="status">
              {requiredVisualReady
                ? "必备图片已选好，公开交付仍需等待服务端最终校验。"
                : hasSavedCorrection
                  ? "已保存的订正仍缺主图或备选图；补齐后才能让新版本生效。"
                  : "先补齐主图和备选图；当前文案输入会保留，但不会提前生效。"}
            </p>
          ) : null}
        </div>
        {pastDate ? null : (
          <button
            className="admin-button admin-button--primary"
            disabled={!canUsePrimaryAction || mutationState.kind === "saving"}
            type="button"
            onClick={() => void saveAndApplyCorrection()}
          >
            {mutationState.kind === "saving" ? "正在安全保存…" : primaryActionLabel}
          </button>
        )}
      </section>
    </div>
  );
}

function LoadingCard({ message }: { message: string }) {
  return (
    <section className="admin-state-card" aria-live="polite">
      <span className="admin-state-card__mark" aria-hidden="true" />
      <h1>{message}</h1>
      <p>正在读取同一套真实发布数据。</p>
    </section>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <section className="admin-state-card">
      <p className="admin-kicker">暂时不可用</p>
      <h1>没有拿到可靠数据</h1>
      <p role="alert">{message}</p>
    </section>
  );
}

function OverviewLoader() {
  const handleUnauthorized = useAdminUnauthorizedHandler();
  const [state, setState] = useState<
    LoadState<{
      analytics: AdminAnalyticsOverview | null;
      issues: AdminActionableIssueList | null;
      overview: AdminOperationsOverview;
    }>
  >({ kind: "loading" });
  const refreshRevision = useAdminOperationsRefresh(
    state.kind === "ready" ? state.data.overview.nextOperationalBoundaryAt : null,
    state.kind === "ready" ? state.data.overview.requestContext.responseGeneratedAt : null,
  );
  useEffect(() => {
    let current = true;
    void (async () => {
      const overview = await adminApi.getOperationsOverview();
      if (!current) return;
      if (!overview.ok) {
        if (handleUnauthorized(overview.error.status)) return;
        setState({ kind: "error", message: describeAdminApiError(overview.error, true) });
        return;
      }
      const [issues, analytics] = await Promise.all([
        adminApi.getOperationsIssues(),
        adminApi.getAnalyticsOverview({
          from: overview.data.publicContentContext.servedFortuneDate,
          to: overview.data.publicContentContext.servedFortuneDate,
        }),
      ]);
      if (!current) return;
      if (!issues.ok && handleUnauthorized(issues.error.status)) return;
      if (!analytics.ok && handleUnauthorized(analytics.error.status)) return;
      setState({
        data: {
          analytics: analytics.ok ? analytics.data : null,
          issues: issues.ok ? issues.data : null,
          overview: overview.data,
        },
        kind: "ready",
      });
    })();
    return () => {
      current = false;
    };
  }, [handleUnauthorized, refreshRevision]);
  return state.kind === "ready" ? (
    <AdminTodayView
      analytics={state.data.analytics}
      issues={state.data.issues}
      overview={state.data.overview}
    />
  ) : state.kind === "error" ? (
    <ErrorCard message={state.message} />
  ) : (
    <LoadingCard message="正在查看当前内容" />
  );
}

export function AdminOperationsToday() {
  return <AdminSessionGate>{() => <OverviewLoader />}</AdminSessionGate>;
}

export function CalendarLoader() {
  const handleUnauthorized = useAdminUnauthorizedHandler();
  const [month, setMonth] = useState<string | null>(null);
  const [state, setState] = useState<LoadState<AdminCalendarMonth>>({ kind: "loading" });
  const [notice, setNotice] = useState<string | undefined>();
  const lastLoadedMonthRef = useRef<AdminCalendarMonth | null>(null);
  const refreshRevision = useAdminOperationsRefresh(
    state.kind === "ready" ? state.data.nextOperationalBoundaryAt : null,
    state.kind === "ready" ? state.data.requestContext.responseGeneratedAt : null,
  );
  useEffect(() => {
    let current = true;
    void adminApi.getOperationsOverview().then((result) => {
      if (!current) return;
      if (!result.ok) {
        if (handleUnauthorized(result.error.status)) return;
        setState({ kind: "error", message: describeAdminApiError(result.error, true) });
        return;
      }
      setMonth(result.data.publicContentContext.servedFortuneDate.slice(0, 7));
    });
    return () => {
      current = false;
    };
  }, [handleUnauthorized]);
  useEffect(() => {
    if (month === null) return;
    let current = true;
    setNotice(undefined);
    setState((previous) => (previous.kind === "ready" ? previous : { kind: "loading" }));
    void adminApi.getOperationsCalendar(month).then((result) => {
      if (!current) return;
      if (result.ok) {
        lastLoadedMonthRef.current = result.data;
        setState({ data: result.data, kind: "ready" });
        return;
      }
      if (handleUnauthorized(result.error.status)) return;
      const lastLoaded = lastLoadedMonthRef.current;
      if (lastLoaded !== null) {
        setNotice(`${month} 暂时没有读取成功，下面保留 ${lastLoaded.month} 已经加载的日期。`);
        setState({ data: lastLoaded, kind: "ready" });
        return;
      }
      setState({ kind: "error", message: describeAdminApiError(result.error, true) });
    });
    return () => {
      current = false;
    };
  }, [handleUnauthorized, month, refreshRevision]);
  return state.kind === "ready" ? (
    <AdminCalendarView month={state.data} notice={notice} onMonthChange={setMonth} />
  ) : state.kind === "error" ? (
    <ErrorCard message={state.message} />
  ) : (
    <LoadingCard message="正在打开日历" />
  );
}

export function AdminOperationsCalendar() {
  return <AdminSessionGate>{() => <CalendarLoader />}</AdminSessionGate>;
}

function IssuesLoader() {
  const handleUnauthorized = useAdminUnauthorizedHandler();
  const [state, setState] = useState<LoadState<AdminActionableIssueList>>({ kind: "loading" });
  const refreshRevision = useAdminOperationsRefresh(
    state.kind === "ready" ? state.data.nextOperationalBoundaryAt : null,
    state.kind === "ready" ? state.data.requestContext.responseGeneratedAt : null,
  );
  useEffect(() => {
    let current = true;
    void adminApi.getOperationsIssues().then((result) => {
      if (!current) return;
      if (!result.ok && handleUnauthorized(result.error.status)) return;
      setState(
        result.ok
          ? { data: result.data, kind: "ready" }
          : { kind: "error", message: describeAdminApiError(result.error, true) },
      );
    });
    return () => {
      current = false;
    };
  }, [handleUnauthorized, refreshRevision]);
  return state.kind === "ready" ? (
    <AdminIssuesView issues={state.data} />
  ) : state.kind === "error" ? (
    <ErrorCard message={state.message} />
  ) : (
    <LoadingCard message="正在检查异常" />
  );
}

export function AdminOperationsIssues() {
  return <AdminSessionGate>{() => <IssuesLoader />}</AdminSessionGate>;
}

function DayLoader({ fortuneDate, session }: { fortuneDate: string; session: AdminSession }) {
  const handleUnauthorized = useAdminUnauthorizedHandler();
  const [state, setState] = useState<DayLoadState>({ kind: "loading" });
  const [appliedAuthorityRefreshRevision, setAppliedAuthorityRefreshRevision] = useState(0);
  const refreshRevision = useAdminOperationsRefresh(
    state.kind === "ready" ? state.data.nextOperationalBoundaryAt : null,
    state.kind === "ready" ? state.data.requestContext.responseGeneratedAt : null,
  );
  useEffect(() => {
    let current = true;
    void adminApi.getOperationsDay(fortuneDate).then((result) => {
      if (!current) return;
      if (!result.ok && handleUnauthorized(result.error.status)) return;
      if (!result.ok) {
        setState((previous) =>
          previous.kind === "ready" && previous.data.summary.fortuneDate === fortuneDate
            ? {
                ...previous,
                notice:
                  "最新内容暂时没有刷新成功，当前已打开的内容和未保存输入仍保留。下次切回本页时会再次检查。",
              }
            : { kind: "error", message: describeAdminApiError(result.error, true) },
        );
        return;
      }
      setState((previous) => {
        if (
          previous.kind === "ready" &&
          previous.data.summary.fortuneDate === result.data.summary.fortuneDate &&
          previous.data.summary.lifecycleRevision > result.data.summary.lifecycleRevision
        ) {
          return { ...previous, notice: undefined };
        }
        return { data: result.data, kind: "ready" };
      });
    });
    return () => {
      current = false;
    };
  }, [appliedAuthorityRefreshRevision, fortuneDate, handleUnauthorized, refreshRevision]);
  return state.kind === "ready" && state.data.summary.fortuneDate === fortuneDate ? (
    <AdminDayDetailView
      detail={state.data}
      key={state.data.summary.fortuneDate}
      onAppliedAuthorityRefresh={() => setAppliedAuthorityRefreshRevision((current) => current + 1)}
      refreshNotice={state.notice}
      session={session}
    />
  ) : state.kind === "error" ? (
    <ErrorCard message={state.message} />
  ) : (
    <LoadingCard message="正在打开当日预览" />
  );
}

export function AdminOperationsDay({ fortuneDate }: { fortuneDate: string }) {
  return (
    <AdminSessionGate>
      {(session) => <DayLoader fortuneDate={fortuneDate} session={session} />}
    </AdminSessionGate>
  );
}
