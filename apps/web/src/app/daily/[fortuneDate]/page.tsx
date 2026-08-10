import { headers } from "next/headers";

import { AttentionColorSection } from "../../../components/attention-color-section";
import { CiJiColorCard } from "../../../components/ci-ji-color-card";
import { DailyDateRegion } from "../../../components/daily-date-region";
import { DaJiColorCard } from "../../../components/da-ji-color-card";
import { OutfitPreviewSection } from "../../../components/outfit-preview-section";
import { PingColorCard } from "../../../components/ping-color-card";
import { TodayImagePreviewSection } from "../../../components/today-image-preview-section";
import { parsePublicChannelId } from "../../../lib/channel-links";
import { loadDailyResult, type LoadDailyResult } from "../../../lib/daily";
import { DailyAnalyticsReporter } from "./daily-analytics-reporter";

export const dynamic = "force-dynamic";

type SearchParamValue = string | string[] | undefined;

interface DailyPageProps {
  params: Promise<{
    fortuneDate: string;
  }>;
  searchParams: Promise<{
    channelId?: SearchParamValue;
    expectedContentVersion?: SearchParamValue;
    referralId?: SearchParamValue;
    referralKind?: SearchParamValue;
  }>;
}

const ANALYTICS_ID_PATTERN = /^[-A-Za-z0-9_:.]{16,128}$/u;

function analyticsReferralId(value: SearchParamValue): string | null {
  return typeof value === "string" && ANALYTICS_ID_PATTERN.test(value) ? value : null;
}

function DailyUnavailable() {
  return (
    <section className="today-unavailable daily-unavailable" role="status">
      <p>该日期内容暂时无法查看</p>
      <small>内容可能尚未公开或已不在公开保留期内。</small>
    </section>
  );
}

function DailyExpired() {
  return (
    <section className="today-unavailable daily-unavailable" role="status">
      <p>历史内容已下线</p>
      <small>这份分享已超过公开保留期，可以主动查看今日内容。</small>
      <a className="outfit-page__back outfit-page__back--button" href="/">
        回到今日参考
      </a>
    </section>
  );
}

function DailyLandingContent({
  channelId,
  landingEventName,
  referralId,
  result,
  sourceContentVersion,
}: {
  channelId: string;
  landingEventName: "poster_landing_view" | "share_link_landing_view";
  referralId: string | null;
  result: LoadDailyResult;
  sourceContentVersion: string | null;
}) {
  const daily = result.kind === "ready" ? result.daily : null;
  const contentVersion = daily?.basis?.contentVersion ?? daily?.daJiCard?.contentVersion ?? null;

  return (
    <main className="page-shell">
      <div className="today-page daily-page">
        <header className="today-masthead">
          <div className="today-masthead__identity">
            <p className="today-masthead__brand">今日穿衣</p>
            <p className="today-masthead__description">FIVE · 指定日期参考</p>
          </div>
          <div className="today-masthead__actions">
            <a aria-label="查看今日参考" className="today-share-link" href="/">
              <span>今日</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </header>

        {result.kind === "expired" ? (
          <DailyExpired />
        ) : daily === null ? (
          <DailyUnavailable />
        ) : (
          <>
            {contentVersion === null ? null : (
              <>
                <DailyAnalyticsReporter
                  channelId={channelId}
                  contentVersion={contentVersion}
                  eventName="view_daily_look"
                  fortuneDate={daily.content.fortuneDate}
                  referralId={null}
                  sourceContentVersion={null}
                />
                {referralId === null ? null : (
                  <DailyAnalyticsReporter
                    channelId={channelId}
                    contentVersion={contentVersion}
                    eventName={landingEventName}
                    fortuneDate={daily.content.fortuneDate}
                    referralId={referralId}
                    sourceContentVersion={sourceContentVersion}
                  />
                )}
              </>
            )}
            {daily.versionChanged ? (
              <aside className="daily-version-notice" role="status">
                <strong>这份日期内容已更新</strong>
                <span>以下展示该日期当前可公开版本。</span>
              </aside>
            ) : null}
            <DailyDateRegion daily={daily} />
            {daily.daJiCard === null ? null : (
              <>
                <DaJiColorCard tier={daily.daJiCard} />
                {daily.ciJiCard === null ? null : (
                  <>
                    <CiJiColorCard tier={daily.ciJiCard} />
                    {daily.pingCard === null ? null : (
                      <>
                        <PingColorCard tier={daily.pingCard} />
                        {daily.attentionSection === null ? null : (
                          <AttentionColorSection section={daily.attentionSection} />
                        )}
                        {daily.outfitPreviewSection === null ? null : (
                          <OutfitPreviewSection
                            dateLabel="当日"
                            interactive={false}
                            section={daily.outfitPreviewSection}
                          />
                        )}
                        {daily.imagePreviewSection === null ? null : (
                          <TodayImagePreviewSection
                            dateLabel="当日"
                            section={daily.imagePreviewSection}
                          />
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
            {daily.basis === null || daily.basis === undefined ? null : (
              <footer
                className="today-reference-statement"
                data-content-version={daily.basis.contentVersion}
              >
                <p>{daily.basis.disclaimer}</p>
              </footer>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default async function DailyPage({ params, searchParams }: DailyPageProps) {
  const [route, query, requestHeaders] = await Promise.all([params, searchParams, headers()]);
  const expectedContentVersion = query.expectedContentVersion;

  if (expectedContentVersion !== undefined && typeof expectedContentVersion !== "string") {
    return (
      <DailyLandingContent
        channelId="organic"
        landingEventName="share_link_landing_view"
        referralId={null}
        result={{ kind: "unavailable" }}
        sourceContentVersion={null}
      />
    );
  }

  const result = await loadDailyResult({
    expectedContentVersion: expectedContentVersion ?? null,
    fortuneDate: route.fortuneDate,
    requestId: requestHeaders.get("x-request-id"),
  });
  const channelId = parsePublicChannelId(query.channelId);
  const referralId = analyticsReferralId(query.referralId);
  const referralKind = query.referralKind;
  const hasValidReferralKind = referralKind === undefined || referralKind === "poster";
  const hasValidShareAttribution =
    channelId !== null && referralId !== null && hasValidReferralKind;

  return (
    <DailyLandingContent
      channelId={channelId ?? "organic"}
      landingEventName={
        referralKind === "poster" ? "poster_landing_view" : "share_link_landing_view"
      }
      referralId={hasValidShareAttribution ? referralId : null}
      result={result}
      sourceContentVersion={hasValidShareAttribution ? (expectedContentVersion ?? null) : null}
    />
  );
}
