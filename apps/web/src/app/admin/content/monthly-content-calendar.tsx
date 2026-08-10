"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  adminApi,
  createIdempotencyKey,
  describeAdminContentApiError,
  type AdminContentVersion,
  type AdminDailyImageSet,
  type AdminSession,
  type ContentDraft,
  type ContentDraftList,
  type ContentVersionList,
  type DailyContentProduction,
} from "../admin-api";
import { DailyExperiencePreview, type AdminPreviewImage } from "./daily-experience-preview";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;

type DayLoadState =
  { kind: "idle" } | { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

type SelectedDay = {
  draft: ContentDraft | null;
  images: AdminPreviewImage[];
  version: AdminContentVersion | null;
  versions: ContentVersionList | null;
};

type Props = {
  drafts: ContentDraftList["items"];
  onProductionCreated: (production: DailyContentProduction) => void;
  onUnauthorized: () => void;
  productions: DailyContentProduction[];
  session: AdminSession;
};

function todayCivilDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).format(new Date());
}

function addMonths(monthKey: string, amount: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${monthKey}-01T00:00:00.000Z`));
}

function monthDays(monthKey: string): Array<{ date: string; inMonth: boolean }> {
  const first = new Date(`${monthKey}-01T00:00:00.000Z`);
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const fortuneDate = date.toISOString().slice(0, 10);
    return { date: fortuneDate, inMonth: fortuneDate.startsWith(`${monthKey}-`) };
  });
}

function dayStatus(
  production: DailyContentProduction | undefined,
  draft: ContentDraftList["items"][number] | undefined,
): string {
  if (production === undefined) return draft === undefined ? "未准备" : "草稿待完善";
  if (production.status === "failed") return "生成失败";
  if (production.status === "awaiting_review") return "内容已就绪";
  return production.completedImageSlots > 0 ? "图片生成中" : "文字已生成";
}

function versionImages(imageSet: AdminDailyImageSet | null): AdminPreviewImage[] {
  if (imageSet === null) return [];
  const assetsById = new Map(imageSet.assets.map((asset) => [asset.assetId, asset]));
  const slotOrder = ["required_primary", "required_alternative", "optional"];
  return [...imageSet.slots]
    .sort((left, right) => slotOrder.indexOf(left.imageSlot) - slotOrder.indexOf(right.imageSlot))
    .flatMap((slot) => {
      const assetId = slot.servedCoverAssetId ?? slot.coverAssetId;
      const asset = assetsById.get(assetId);
      return asset === undefined
        ? []
        : [
            {
              asset,
              imageSlot: slot.imageSlot,
              previewUrl: `/admin/api/v1/image-assets/${encodeURIComponent(asset.assetId)}/preview`,
              selectedForSlot: true,
            },
          ];
    })
    .slice(0, 3);
}

function preferredVersion(list: ContentVersionList): ContentVersionList["items"][number] | null {
  return (
    list.items.find((item) => item.contentVersion === list.activeContentVersion) ??
    list.items.find((item) => item.state === "scheduled") ??
    list.items[0] ??
    null
  );
}

export function MonthlyContentCalendar({
  drafts,
  onProductionCreated,
  onUnauthorized,
  productions,
  session,
}: Props) {
  // The calendar uses the civil date only to choose its initial visible month.
  // Content and fortune-date rules still come from server responses.
  const today = todayCivilDate();
  const [monthKey, setMonthKey] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedDay, setSelectedDay] = useState<SelectedDay | null>(null);
  const [loadState, setLoadState] = useState<DayLoadState>({ kind: "idle" });
  const [generateState, setGenerateState] = useState<DayLoadState>({ kind: "idle" });
  const days = useMemo(() => monthDays(monthKey), [monthKey]);
  const productionByDate = useMemo(
    () => new Map(productions.map((production) => [production.fortuneDate, production])),
    [productions],
  );
  const draftByDate = useMemo(
    () => new Map(drafts.map((draft) => [draft.fortuneDate, draft])),
    [drafts],
  );

  const loadDay = useCallback(
    async (fortuneDate: string) => {
      setLoadState({ kind: "loading" });
      setGenerateState({ kind: "idle" });
      setSelectedDay(null);
      const production = productionByDate.get(fortuneDate);
      const summary = draftByDate.get(fortuneDate);
      const draftId = production?.draftId ?? summary?.draftId ?? null;
      const versionsResult = await adminApi.listContentVersions(fortuneDate);
      if (!versionsResult.ok) {
        if (versionsResult.error.status === 401) {
          onUnauthorized();
          return;
        }
        setLoadState({
          kind: "error",
          message: describeAdminContentApiError(versionsResult.error),
        });
        return;
      }
      const versionSummary = preferredVersion(versionsResult.data);

      if (draftId !== null) {
        const [draftResult, imagesResult] = await Promise.all([
          adminApi.getDraft(draftId),
          adminApi.listDraftImages(draftId),
        ]);
        if (draftResult.ok && imagesResult.ok) {
          setSelectedDay({
            draft: draftResult.data,
            images: imagesResult.data.items,
            version: null,
            versions: versionsResult.data,
          });
          setLoadState({ kind: "ready" });
          return;
        }
        const failedResult = !draftResult.ok ? draftResult : !imagesResult.ok ? imagesResult : null;
        if (failedResult !== null && failedResult.error.status === 401) {
          onUnauthorized();
          return;
        }
        if (
          failedResult !== null &&
          (failedResult.error.status !== 404 || versionSummary === null)
        ) {
          setLoadState({
            kind: "error",
            message: describeAdminContentApiError(failedResult.error),
          });
          return;
        }
      }

      if (versionSummary === null) {
        setSelectedDay({ draft: null, images: [], version: null, versions: versionsResult.data });
        setLoadState({ kind: "ready" });
        return;
      }
      const [versionResult, imageSetResult] = await Promise.all([
        adminApi.getContentVersion(versionSummary.contentVersion),
        adminApi.getDailyImageSet(versionSummary.contentVersion),
      ]);
      if (!versionResult.ok) {
        if (versionResult.error.status === 401) {
          onUnauthorized();
          return;
        }
        setLoadState({
          kind: "error",
          message: describeAdminContentApiError(versionResult.error),
        });
        return;
      }
      setSelectedDay({
        draft: null,
        images: imageSetResult.ok ? versionImages(imageSetResult.data) : [],
        version: versionResult.data,
        versions: versionsResult.data,
      });
      setLoadState({ kind: "ready" });
    },
    [draftByDate, onUnauthorized, productionByDate],
  );

  useEffect(() => {
    void loadDay(selectedDate);
    // loadDay changes when production data refreshes; preserve the selected date and refresh its card.
  }, [loadDay, selectedDate]);

  async function generateSelectedDay() {
    if (generateState.kind === "loading") return;
    let idempotencyKey: string;
    try {
      idempotencyKey = createIdempotencyKey();
    } catch {
      setGenerateState({ kind: "error", message: "当前浏览器无法创建安全操作编号。" });
      return;
    }
    setGenerateState({ kind: "loading" });
    const result = await adminApi.generateDailyContent({
      csrfToken: session.csrfToken,
      fortuneDate: selectedDate,
      idempotencyKey,
    });
    if (!result.ok) {
      if (result.error.status === 401) {
        onUnauthorized();
        return;
      }
      setGenerateState({
        kind: "error",
        message: describeAdminContentApiError(result.error),
      });
      return;
    }
    onProductionCreated(result.data);
    setGenerateState({ kind: "ready" });
  }

  const selectedProduction = productionByDate.get(selectedDate);
  const selectedModules = selectedDay?.draft?.modules ?? selectedDay?.version?.snapshot ?? null;
  const selectedRevision =
    selectedDay?.draft === null || selectedDay?.draft === undefined
      ? (selectedDay?.version?.contentVersion ?? selectedDate)
      : `${selectedDay.draft.draftId}-${selectedDay.draft.draftRevision}`;

  return (
    <section className="admin-monthly-studio" aria-labelledby="monthly-content-title">
      <header className="admin-monthly-studio__heading">
        <div>
          <p className="admin-kicker">MONTHLY EDITORIAL CALENDAR</p>
          <h2 id="monthly-content-title">这个月每天会展示什么</h2>
          <p>点一天，直接看用户端效果；橙色标记表示图片还在生成。</p>
        </div>
        <div className="admin-month-switcher" aria-label="切换月份">
          <button
            aria-label="上个月"
            className="admin-month-switcher__button"
            onClick={() => setMonthKey((current) => addMonths(current, -1))}
            type="button"
          >
            ←
          </button>
          <strong>{monthLabel(monthKey)}</strong>
          <button
            aria-label="下个月"
            className="admin-month-switcher__button"
            onClick={() => setMonthKey((current) => addMonths(current, 1))}
            type="button"
          >
            →
          </button>
        </div>
      </header>

      <div className="admin-monthly-studio__layout">
        <div className="admin-month-calendar">
          <div className="admin-month-calendar__weekdays" aria-hidden="true">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday}>周{weekday}</span>
            ))}
          </div>
          <div className="admin-month-calendar__grid">
            {days.map(({ date, inMonth }) => {
              const production = productionByDate.get(date);
              const draft = draftByDate.get(date);
              const selected = date === selectedDate;
              return (
                <button
                  aria-label={`${date}，${dayStatus(production, draft)}`}
                  aria-pressed={selected}
                  className="admin-calendar-day"
                  data-complete={production?.completedImageSlots ?? 0}
                  data-current={date === today}
                  data-in-month={inMonth}
                  data-selected={selected}
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  type="button"
                >
                  <span>{Number(date.slice(-2))}</span>
                  <strong>{dayStatus(production, draft)}</strong>
                  <small>
                    {production === undefined ? "—" : `${production.completedImageSlots}/3 图`}
                  </small>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="admin-calendar-inspector" aria-live="polite">
          <header>
            <div>
              <p className="admin-kicker">SELECTED DAY</p>
              <h3>{selectedDate}</h3>
            </div>
            <span data-status={selectedProduction?.status ?? "missing"}>
              {dayStatus(selectedProduction, draftByDate.get(selectedDate))}
            </span>
          </header>
          {loadState.kind === "loading" ? <p role="status">正在拼装当天页面…</p> : null}
          {loadState.kind === "error" ? (
            <p className="admin-message admin-message--error" role="alert">
              {loadState.message}
            </p>
          ) : null}
          {loadState.kind === "ready" && selectedModules === null ? (
            <div className="admin-calendar-inspector__empty">
              <strong>这一天还没有内容</strong>
              <p>生成后系统会准备五档颜色、穿搭文案，并让 GPT Image 2 Worker 继续补齐模特图。</p>
              <button
                className="admin-button admin-button--primary"
                disabled={generateState.kind === "loading"}
                onClick={() => void generateSelectedDay()}
                type="button"
              >
                {generateState.kind === "loading" ? "正在创建…" : "生成这一天"}
              </button>
            </div>
          ) : null}
          {generateState.kind === "error" ? (
            <p className="admin-message admin-message--error" role="alert">
              {generateState.message}
            </p>
          ) : null}
          {selectedDay?.draft !== null && selectedDay?.draft !== undefined ? (
            <div className="admin-calendar-inspector__actions">
              <Link
                className="admin-button admin-button--primary"
                href={`/admin/content/drafts/${encodeURIComponent(selectedDay.draft.draftId)}#visual-correction`}
              >
                订正当天内容
              </Link>
              <Link
                className="admin-button admin-button--quiet"
                href={`/admin/content/drafts/${encodeURIComponent(selectedDay.draft.draftId)}#image-upload-title`}
              >
                缺图时手动上传
              </Link>
            </div>
          ) : null}
          {selectedDay?.versions !== null && selectedDay?.versions !== undefined ? (
            <ul className="admin-calendar-version-strip" aria-label="当天内容版本">
              {selectedDay.versions.items.slice(0, 3).map((item) => (
                <li key={item.contentVersion}>
                  <span>{item.state === "published" ? "在线" : item.state}</span>
                  <Link href={`/admin/content/versions/${encodeURIComponent(item.contentVersion)}`}>
                    {item.contentVersion.slice(0, 18)}…
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </aside>
      </div>

      {selectedModules === null ? null : (
        <DailyExperiencePreview
          fortuneDate={selectedDate}
          images={selectedDay?.images ?? []}
          mode={selectedDay?.draft === null ? "version" : "draft"}
          modules={selectedModules}
          revisionLabel={selectedRevision}
        />
      )}
    </section>
  );
}
