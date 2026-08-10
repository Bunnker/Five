import { headers } from "next/headers";

import { FoundationAction } from "../../components/visual-foundation";
import { PublicContentBoundaryGuard } from "../../components/public-content-boundary-guard";
import { parsePublicChannelId, withPublicChannelId } from "../../lib/channel-links";
import { buildPosterPagePath } from "../../lib/poster-job";
import { loadToday } from "../../lib/today";
import {
  resolveTodayEntry,
  type TodayEntrySearchParams,
  type TodayEntryResolution,
} from "../../lib/today-entry";
import { ShareActions } from "./share-actions";

export const dynamic = "force-dynamic";

interface SharePageProps {
  searchParams: Promise<TodayEntrySearchParams>;
}

function ShareNotice({
  channelId,
  status,
}: {
  channelId: string | null;
  status: Exclude<TodayEntryResolution["status"], "ready">;
}) {
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
      description: "当日页面还没有加载完整，请稍后再试。",
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

export default async function SharePage({ searchParams }: SharePageProps) {
  const [params, requestHeaders] = await Promise.all([searchParams, headers()]);
  const entryChannelId = parsePublicChannelId(params.channelId);
  const today = await loadToday({ requestId: requestHeaders.get("x-request-id") });
  const resolution = resolveTodayEntry(today, params, {
    contentVersion: today?.share?.contentVersion,
    requireChannelId: true,
  });

  if (resolution.status !== "ready") {
    return <ShareNotice channelId={entryChannelId} status={resolution.status} />;
  }

  const share = resolution.today.share;
  if (share === null || share === undefined || resolution.channelId === null) {
    return <ShareNotice channelId={entryChannelId} status="unavailable" />;
  }
  const posterHref = buildPosterPagePath({
    channelId: resolution.channelId,
    expectedContentVersion: resolution.contentVersion,
    fortuneDate: resolution.fortuneDate,
    posterJobEndpoint: share.posterJobEndpoint,
    posterTemplateVersion: share.posterTemplateVersion,
  });

  return (
    <PublicContentBoundaryGuard
      effectiveTo={resolution.today.content.effectiveTo}
      responseGeneratedAt={resolution.today.requestContext.responseGeneratedAt}
    >
      <main className="outfit-page">
        <article
          aria-labelledby="share-page-title"
          className="outfit-page__sheet"
          data-channel-id={resolution.channelId}
          data-content-version={resolution.contentVersion}
        >
          <a className="outfit-page__back" href={withPublicChannelId("/", resolution.channelId)}>
            <span aria-hidden="true">←</span>
            返回今日首页
          </a>

          <header className="outfit-page__header">
            <p className="outfit-page__eyebrow">分享这一天的完整页面</p>
            <h1 id="share-page-title">分享当天五行页面</h1>
            <p>{resolution.fortuneDate}</p>
          </header>

          <ShareActions
            channelId={resolution.channelId}
            contentVersion={resolution.contentVersion}
            fortuneDate={resolution.fortuneDate}
          />

          <aside className="share-poster-entry">
            <div>
              <p>也可以分享图片</p>
              <strong>生成适合保存和转发的日签海报</strong>
              <span>打开后会自动生成，可直接分享、保存或长按转发。</span>
            </div>
            <FoundationAction fullWidth href={posterHref} indicator="↗">
              生成并分享海报
            </FoundationAction>
          </aside>
        </article>
      </main>
    </PublicContentBoundaryGuard>
  );
}
