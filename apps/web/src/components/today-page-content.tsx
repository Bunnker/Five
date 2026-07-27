import { AttentionColorSection } from "./attention-color-section";
import { CiJiColorCard } from "./ci-ji-color-card";
import { DaJiColorCard } from "./da-ji-color-card";
import { OutfitPreviewSection } from "./outfit-preview-section";
import { PingColorCard } from "./ping-color-card";
import { TodayImagePreviewSection } from "./today-image-preview-section";
import { TodayDateRegion } from "./today-date-region";
import { FoundationAction } from "./visual-foundation";
import type { TodayPageData } from "../lib/today";

export interface TodayPageContentProps {
  today: TodayPageData | null;
}

export function TodayPageContent({ today }: TodayPageContentProps) {
  const nextSteps =
    today?.basis !== null &&
    today?.basis !== undefined &&
    today.nextSteps !== null &&
    today.nextSteps !== undefined &&
    today.share !== null &&
    today.share !== undefined &&
    today.basis.contentVersion === today.nextSteps.contentVersion &&
    today.share.contentVersion === today.nextSteps.contentVersion
      ? today.nextSteps
      : null;

  return (
    <main className="page-shell">
      <div className="today-page">
        <header className="today-masthead">
          <div>
            <p className="today-masthead__brand">Five</p>
            <p className="today-masthead__description">每日五行穿衣参考</p>
          </div>
          <div className="today-masthead__actions">
            {nextSteps === null ? null : (
              <a className="today-share-link" href={nextSteps.shareHref}>
                分享今天
              </a>
            )}
            <span className="foundation-seal" aria-hidden="true">
              五
            </span>
          </div>
        </header>

        {today === null ? (
          <section className="today-unavailable" role="status">
            <p>今日内容正在校验中</p>
            <small>请稍后刷新页面。</small>
          </section>
        ) : (
          <>
            <TodayDateRegion today={today} />
            {today.daJiCard === null ? null : (
              <>
                <DaJiColorCard tier={today.daJiCard} />
                {today.ciJiCard === null ? null : (
                  <>
                    <CiJiColorCard tier={today.ciJiCard} />
                    {today.pingCard === null ? null : (
                      <>
                        <PingColorCard tier={today.pingCard} />
                        {today.attentionSection === null ? null : (
                          <AttentionColorSection section={today.attentionSection} />
                        )}
                        {today.outfitPreviewSection === null ? null : (
                          <OutfitPreviewSection section={today.outfitPreviewSection} />
                        )}
                        {today.imagePreviewSection === null ? null : (
                          <TodayImagePreviewSection section={today.imagePreviewSection} />
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
            {nextSteps === null ? null : (
              <nav className="today-next-steps" aria-label="继续查看今日穿搭">
                <FoundationAction fullWidth href={nextSteps.colorsHref} indicator="›">
                  查看今日颜色
                </FoundationAction>
                <div className="today-next-steps__secondary">
                  <a href={nextSteps.outfitsHref}>看看怎么搭</a>
                  <a href={nextSteps.basisHref}>为什么这样排</a>
                </div>
              </nav>
            )}
            {today.basis === null || today.basis === undefined ? null : (
              <footer
                className="today-reference-statement"
                data-content-version={today.basis.contentVersion}
              >
                <p>{today.basis.disclaimer}</p>
              </footer>
            )}
          </>
        )}
      </div>
    </main>
  );
}
