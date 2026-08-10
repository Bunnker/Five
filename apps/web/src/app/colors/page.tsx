import { headers } from "next/headers";

import { AttentionColorSection } from "../../components/attention-color-section";
import { CiJiColorCard } from "../../components/ci-ji-color-card";
import { DaJiColorCard } from "../../components/da-ji-color-card";
import { PingColorCard } from "../../components/ping-color-card";
import { PublicContentBoundaryGuard } from "../../components/public-content-boundary-guard";
import { FoundationAction } from "../../components/visual-foundation";
import { toColorGuideData } from "../../lib/color-guide";
import { parsePublicChannelId, withPublicChannelId } from "../../lib/channel-links";
import { loadToday } from "../../lib/today";
import {
  resolveTodayEntry,
  type TodayEntrySearchParams,
  type TodayEntryResolution,
} from "../../lib/today-entry";

export const dynamic = "force-dynamic";

interface ColorsPageProps {
  searchParams: Promise<TodayEntrySearchParams>;
}

function ColorsNotice({
  channelId,
  status,
}: {
  channelId: string | null;
  status: Exclude<TodayEntryResolution["status"], "ready">;
}) {
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
        <a
          className="outfit-page__back outfit-page__back--button"
          href={withPublicChannelId("/", channelId)}
        >
          返回今日首页
        </a>
      </section>
    </main>
  );
}

export default async function ColorsPage({ searchParams }: ColorsPageProps) {
  const [params, requestHeaders] = await Promise.all([searchParams, headers()]);
  const entryChannelId = parsePublicChannelId(params.channelId);
  const today = await loadToday({ requestId: requestHeaders.get("x-request-id") });
  const colorGuide = toColorGuideData(today);
  const resolution = resolveTodayEntry(today, params, {
    contentVersion: colorGuide?.contentVersion ?? null,
  });

  if (resolution.status !== "ready") {
    return <ColorsNotice channelId={entryChannelId} status={resolution.status} />;
  }

  if (colorGuide === null) {
    return <ColorsNotice channelId={entryChannelId} status="unavailable" />;
  }

  return (
    <PublicContentBoundaryGuard
      effectiveTo={resolution.today.content.effectiveTo}
      responseGeneratedAt={resolution.today.requestContext.responseGeneratedAt}
    >
      <main className="outfit-page">
        <article
          aria-labelledby="colors-page-title"
          className="outfit-page__sheet"
          data-content-version={resolution.contentVersion}
        >
          <a className="outfit-page__back" href={withPublicChannelId("/", resolution.channelId)}>
            <span aria-hidden="true">←</span>
            返回今日首页
          </a>

          <header className="outfit-page__header">
            <p className="outfit-page__eyebrow">当天已核对的公开颜色</p>
            <h1 id="colors-page-title">完整颜色建议</h1>
            <p>{resolution.fortuneDate}</p>
          </header>

          <DaJiColorCard
            actionHref={withPublicChannelId(colorGuide.daJi.outfitHref, resolution.channelId)}
            tier={colorGuide.daJi.tier}
          />
          <CiJiColorCard
            actionHref={withPublicChannelId(colorGuide.ciJi.outfitHref, resolution.channelId)}
            tier={colorGuide.ciJi.tier}
          />
          <PingColorCard
            actionHref={withPublicChannelId(colorGuide.ping.outfitHref, resolution.channelId)}
            tier={colorGuide.ping.tier}
          />
          <AttentionColorSection section={colorGuide.attentionSection} />
          <div className="colors-page__next-step">
            <FoundationAction
              fullWidth
              href={withPublicChannelId(colorGuide.defaultOutfitHref, resolution.channelId)}
              indicator="›"
            >
              看看怎么搭
            </FoundationAction>
          </div>
        </article>
      </main>
    </PublicContentBoundaryGuard>
  );
}
