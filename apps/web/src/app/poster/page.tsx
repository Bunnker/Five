import { headers } from "next/headers";

import { buildSharePagePath } from "../../lib/poster-job";
import { PublicContentBoundaryGuard } from "../../components/public-content-boundary-guard";
import { loadToday } from "../../lib/today";
import {
  resolveTodayEntry,
  type TodayEntryResolution,
  type TodayEntrySearchParams,
} from "../../lib/today-entry";
import { PosterActions } from "./poster-actions";

export const dynamic = "force-dynamic";

interface PosterPageProps {
  searchParams: Promise<TodayEntrySearchParams>;
}

function PosterNotice({
  status,
}: {
  status: Exclude<TodayEntryResolution["status"], "ready"> | "template_changed";
}) {
  const notices = {
    invalid: ["暂时找不到这份海报内容", "链接信息不完整，请从分享页重新进入。"],
    stale: ["这份海报内容已经更新", "请返回首页查看当天当前版本。"],
    template_changed: ["这份海报配置已经更新", "模板和当天内容已变化，请从分享页重新进入。"],
    unavailable: ["海报功能暂时无法打开", "当天已发布内容还没有加载完整。"],
  } as const;
  const [title, description] = notices[status];

  return (
    <main className="outfit-page poster-page">
      <section className="outfit-page__notice" role="status">
        <p className="outfit-page__eyebrow">日签海报</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <a className="outfit-page__back outfit-page__back--button" href="/">
          返回今日首页
        </a>
      </section>
    </main>
  );
}

export default async function PosterPage({ searchParams }: PosterPageProps) {
  const [params, requestHeaders] = await Promise.all([searchParams, headers()]);
  const today = await loadToday({ requestId: requestHeaders.get("x-request-id") });
  const resolution = resolveTodayEntry(today, params, {
    contentVersion: today?.share?.contentVersion,
    requireChannelId: true,
  });

  if (resolution.status !== "ready") {
    return <PosterNotice status={resolution.status} />;
  }

  const requestedTemplateVersion = params.posterTemplateVersion;
  const share = resolution.today.share;
  const basis = resolution.today.basis;
  if (
    share === null ||
    share === undefined ||
    basis === null ||
    basis === undefined ||
    resolution.channelId === null
  ) {
    return <PosterNotice status="unavailable" />;
  }
  if (
    typeof requestedTemplateVersion !== "string" ||
    requestedTemplateVersion !== share.posterTemplateVersion
  ) {
    return <PosterNotice status="template_changed" />;
  }
  const shareHref = buildSharePagePath({
    channelId: resolution.channelId,
    expectedContentVersion: resolution.contentVersion,
    fortuneDate: resolution.fortuneDate,
  });
  const aiDisclosures = [
    ...new Set(
      (resolution.today.imagePreviewSection?.cards ?? []).flatMap((card) =>
        card.aiDisclosure === null ? [] : [card.aiDisclosure],
      ),
    ),
  ];

  return (
    <PublicContentBoundaryGuard
      effectiveTo={resolution.today.content.effectiveTo}
      responseGeneratedAt={resolution.today.requestContext.responseGeneratedAt}
    >
      <main className="outfit-page poster-page">
        <article
          aria-labelledby="poster-page-title"
          className="outfit-page__sheet poster-page__sheet"
          data-channel-id={resolution.channelId}
          data-content-version={resolution.contentVersion}
          data-poster-template-version={share.posterTemplateVersion}
        >
          <a className="outfit-page__back" href={shareHref}>
            <span aria-hidden="true">←</span>
            返回分享页
          </a>
          <header className="outfit-page__header poster-page__header">
            <p className="outfit-page__eyebrow">微信好友与朋友圈</p>
            <h1 id="poster-page-title">分享日签海报</h1>
            <p>{resolution.fortuneDate}</p>
          </header>

          <aside className="poster-safety-note">
            <p>{basis.disclaimer}</p>
            <p>海报使用当天已发布的穿搭图片，不会在访问时额外调用 AI 生图。</p>
            {aiDisclosures.map((disclosure) => (
              <p key={disclosure}>图片标识：{disclosure}</p>
            ))}
          </aside>

          <PosterActions
            autoStart
            channelId="user_share"
            fortuneDate={resolution.fortuneDate}
            posterJobEndpoint={share.posterJobEndpoint}
            posterTemplateVersion={share.posterTemplateVersion}
            sourceContentVersion={resolution.contentVersion}
          />
        </article>
      </main>
    </PublicContentBoundaryGuard>
  );
}
