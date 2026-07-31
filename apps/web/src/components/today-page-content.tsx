import { AttentionColorSection } from "./attention-color-section";
import { CiJiColorCard } from "./ci-ji-color-card";
import { DaJiColorCard } from "./da-ji-color-card";
import { OutfitPreviewSection } from "./outfit-preview-section";
import { PingColorCard } from "./ping-color-card";
import { TodayImagePreviewSection } from "./today-image-preview-section";
import { TodayDateRegion } from "./today-date-region";
import { FoundationAction } from "./visual-foundation";
import type { CompleteTodayPageData } from "../lib/today";

export interface TodayPageContentProps {
  today: CompleteTodayPageData;
}

export function TodayPageContent({ today }: TodayPageContentProps) {
  return (
    <main className="page-shell">
      <div className="today-page today-page--home">
        <header className="today-masthead">
          <div className="today-masthead__identity">
            <p className="today-masthead__brand">
              <span>Five</span>
              <span>五行穿衣</span>
            </p>
            <p className="today-masthead__description">每日五行搭配参考</p>
          </div>
          <div className="today-masthead__actions">
            <a aria-label="分享今天" className="today-share-link" href={today.nextSteps.shareHref}>
              <span>分享</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </header>

        <TodayDateRegion today={today} />
        <DaJiColorCard tier={today.daJiCard} />
        <CiJiColorCard tier={today.ciJiCard} />
        <PingColorCard tier={today.pingCard} />
        <AttentionColorSection section={today.attentionSection} />
        <OutfitPreviewSection section={today.outfitPreviewSection} />
        <TodayImagePreviewSection section={today.imagePreviewSection} />
        <nav className="today-next-steps" aria-label="继续查看今日穿搭">
          <FoundationAction fullWidth href={today.nextSteps.colorsHref} indicator="›">
            查看今日颜色
          </FoundationAction>
          <div className="today-next-steps__secondary">
            <a href={today.nextSteps.outfitsHref}>看看怎么搭</a>
            <a href={today.nextSteps.basisHref}>为什么这样排</a>
          </div>
        </nav>
        <footer
          className="today-reference-statement"
          data-content-version={today.basis.contentVersion}
        >
          <p>{today.basis.disclaimer}</p>
        </footer>
      </div>
    </main>
  );
}
