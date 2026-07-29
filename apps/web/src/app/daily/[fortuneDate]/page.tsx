import { headers } from "next/headers";

import { AttentionColorSection } from "../../../components/attention-color-section";
import { CiJiColorCard } from "../../../components/ci-ji-color-card";
import { DailyDateRegion } from "../../../components/daily-date-region";
import { DaJiColorCard } from "../../../components/da-ji-color-card";
import { OutfitPreviewSection } from "../../../components/outfit-preview-section";
import { PingColorCard } from "../../../components/ping-color-card";
import { TodayImagePreviewSection } from "../../../components/today-image-preview-section";
import { loadDaily, type DailyLandingData } from "../../../lib/daily";

export const dynamic = "force-dynamic";

type SearchParamValue = string | string[] | undefined;

interface DailyPageProps {
  params: Promise<{
    fortuneDate: string;
  }>;
  searchParams: Promise<{
    channelId?: SearchParamValue;
    expectedContentVersion?: SearchParamValue;
  }>;
}

function DailyUnavailable() {
  return (
    <section className="today-unavailable daily-unavailable" role="status">
      <p>该日期内容暂时无法查看</p>
      <small>内容可能尚未公开或已不在公开保留期内。</small>
    </section>
  );
}

function DailyLandingContent({ daily }: { daily: DailyLandingData | null }) {
  return (
    <main className="page-shell">
      <div className="today-page daily-page">
        <header className="today-masthead">
          <div>
            <p className="today-masthead__brand">Five</p>
            <p className="today-masthead__description">指定日期穿衣参考</p>
          </div>
          <div className="today-masthead__actions">
            <a className="today-share-link" href="/">
              查看今日参考
            </a>
            <span className="foundation-seal" aria-hidden="true">
              五
            </span>
          </div>
        </header>

        {daily === null ? (
          <DailyUnavailable />
        ) : (
          <>
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
    return <DailyLandingContent daily={null} />;
  }

  const daily = await loadDaily({
    expectedContentVersion: expectedContentVersion ?? null,
    fortuneDate: route.fortuneDate,
    requestId: requestHeaders.get("x-request-id"),
  });

  return <DailyLandingContent daily={daily} />;
}
