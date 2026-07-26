import { headers } from "next/headers";
import type { CSSProperties } from "react";

import { loadToday } from "../../lib/today";
import {
  resolveTodayEntry,
  type TodayEntrySearchParams,
  type TodayEntryResolution,
} from "../../lib/today-entry";

export const dynamic = "force-dynamic";

interface SharePageProps {
  searchParams: Promise<TodayEntrySearchParams>;
}

const selectableTextStyle: CSSProperties = {
  background: "var(--paper)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-card)",
  boxSizing: "border-box",
  color: "var(--ink)",
  fontFamily: "var(--font-body)",
  lineHeight: 1.7,
  minHeight: "8rem",
  padding: "var(--space-3)",
  resize: "vertical",
  userSelect: "text",
  width: "100%",
};

function ShareNotice({ status }: { status: Exclude<TodayEntryResolution["status"], "ready"> }) {
  const notices = {
    invalid: {
      description: "链接信息不完整，请从首页重新进入。",
      title: "暂时找不到这份分享内容",
    },
    stale: {
      description: "当天内容已经更新，请返回首页查看当前版本。",
      title: "这份分享内容已经更新",
    },
    unavailable: {
      description: "当日分享文字还没有加载完整，请稍后再试。",
      title: "分享内容暂时无法打开",
    },
  } as const;
  const notice = notices[status];

  return (
    <main className="outfit-page">
      <section className="outfit-page__notice" role="status">
        <p className="outfit-page__eyebrow">分享今日参考</p>
        <h1>{notice.title}</h1>
        <p>{notice.description}</p>
        <a className="outfit-page__back outfit-page__back--button" href="/">
          返回今日首页
        </a>
      </section>
    </main>
  );
}

export default async function SharePage({ searchParams }: SharePageProps) {
  const [params, requestHeaders] = await Promise.all([searchParams, headers()]);
  const today = await loadToday({ requestId: requestHeaders.get("x-request-id") });
  const resolution = resolveTodayEntry(today, params, {
    contentVersion: today?.share?.contentVersion,
    requireChannelId: true,
  });

  if (resolution.status !== "ready") {
    return <ShareNotice status={resolution.status} />;
  }

  const share = resolution.today.share;
  if (share === null || share === undefined || resolution.channelId === null) {
    return <ShareNotice status="unavailable" />;
  }

  return (
    <main className="outfit-page">
      <article
        aria-labelledby="share-page-title"
        className="outfit-page__sheet"
        data-channel-id={resolution.channelId}
        data-content-version={resolution.contentVersion}
      >
        <a className="outfit-page__back" href="/">
          <span aria-hidden="true">←</span>
          返回今日首页
        </a>

        <header className="outfit-page__header">
          <p className="outfit-page__eyebrow">当天已发布的分享文字</p>
          <h1 id="share-page-title">分享今日参考</h1>
          <p>{resolution.fortuneDate}</p>
        </header>

        <section aria-labelledby="share-summary-title" className="selected-outfit">
          <div className="selected-outfit__heading">
            <span>今日摘要</span>
            <h2 id="share-summary-title">{share.summaryText}</h2>
          </div>
          <div className="selected-outfit__slots">
            <div className="selected-outfit-slot">
              <p>可以长按选择下面的文字。</p>
              <textarea
                aria-label="可选择的今日分享文字"
                readOnly
                rows={5}
                style={selectableTextStyle}
                value={share.copyText}
              />
            </div>
          </div>
        </section>
      </article>
    </main>
  );
}
