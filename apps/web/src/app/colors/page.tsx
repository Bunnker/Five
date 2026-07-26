import { headers } from "next/headers";

import { AttentionColorSection } from "../../components/attention-color-section";
import { CiJiColorCard } from "../../components/ci-ji-color-card";
import { DaJiColorCard } from "../../components/da-ji-color-card";
import { PingColorCard } from "../../components/ping-color-card";
import { loadToday, type TodayPageData } from "../../lib/today";
import {
  resolveTodayEntry,
  type TodayEntrySearchParams,
  type TodayEntryResolution,
} from "../../lib/today-entry";

export const dynamic = "force-dynamic";

interface ColorsPageProps {
  searchParams: Promise<TodayEntrySearchParams>;
}

function getColorsContentVersion(today: TodayPageData | null): string | null {
  if (
    today?.daJiCard === null ||
    today?.daJiCard === undefined ||
    today.ciJiCard === null ||
    today.pingCard === null ||
    today.attentionSection === null
  ) {
    return null;
  }

  const versions = [
    today.daJiCard.contentVersion,
    today.ciJiCard.contentVersion,
    today.pingCard.contentVersion,
    today.attentionSection.contentVersion,
  ];
  return versions.every((version) => version === versions[0]) ? versions[0] : null;
}

function ColorsNotice({ status }: { status: Exclude<TodayEntryResolution["status"], "ready"> }) {
  const notices = {
    invalid: {
      description: "链接信息不完整，请从首页重新进入。",
      title: "暂时找不到这份颜色建议",
    },
    stale: {
      description: "当天内容已经更新，请返回首页查看当前版本。",
      title: "这份颜色建议已经更新",
    },
    unavailable: {
      description: "今日内容还没有加载成功，请稍后再试。",
      title: "今日颜色暂时无法打开",
    },
  } as const;
  const notice = notices[status];

  return (
    <main className="outfit-page">
      <section className="outfit-page__notice" role="status">
        <p className="outfit-page__eyebrow">完整颜色建议</p>
        <h1>{notice.title}</h1>
        <p>{notice.description}</p>
        <a className="outfit-page__back outfit-page__back--button" href="/">
          返回今日首页
        </a>
      </section>
    </main>
  );
}

export default async function ColorsPage({ searchParams }: ColorsPageProps) {
  const [params, requestHeaders] = await Promise.all([searchParams, headers()]);
  const today = await loadToday({ requestId: requestHeaders.get("x-request-id") });
  const resolution = resolveTodayEntry(today, params, {
    contentVersion: getColorsContentVersion(today),
  });

  if (resolution.status !== "ready") {
    return <ColorsNotice status={resolution.status} />;
  }

  const { attentionSection, ciJiCard, daJiCard, pingCard } = resolution.today;
  if (daJiCard === null || ciJiCard === null || pingCard === null || attentionSection === null) {
    return <ColorsNotice status="unavailable" />;
  }

  return (
    <main className="outfit-page">
      <article
        aria-labelledby="colors-page-title"
        className="outfit-page__sheet"
        data-content-version={resolution.contentVersion}
      >
        <a className="outfit-page__back" href="/">
          <span aria-hidden="true">←</span>
          返回今日首页
        </a>

        <header className="outfit-page__header">
          <p className="outfit-page__eyebrow">当天已核对的公开颜色</p>
          <h1 id="colors-page-title">完整颜色建议</h1>
          <p>{resolution.fortuneDate}</p>
        </header>

        <DaJiColorCard tier={daJiCard} />
        <CiJiColorCard tier={ciJiCard} />
        <PingColorCard tier={pingCard} />
        <AttentionColorSection section={attentionSection} />
      </article>
    </main>
  );
}
