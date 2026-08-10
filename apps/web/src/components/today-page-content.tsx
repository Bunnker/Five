import { AttentionColorSection } from "./attention-color-section";
import { CiJiColorCard } from "./ci-ji-color-card";
import { DaJiColorCard } from "./da-ji-color-card";
import { OutfitPreviewSection } from "./outfit-preview-section";
import { PingColorCard } from "./ping-color-card";
import { TodayImagePreviewSection } from "./today-image-preview-section";
import { TodayDateRegion } from "./today-date-region";
import { TodayShareAction } from "./today-share-action";
import { FoundationAction } from "./visual-foundation";
import { parsePublicChannelId, withPublicChannelId } from "../lib/channel-links";
import type { CompleteTodayPageData } from "../lib/today";

export interface TodayPageContentProps {
  channelId?: string;
  interactiveShare?: boolean;
  today: CompleteTodayPageData;
}

export function TodayPageContent({
  channelId = "organic",
  interactiveShare = true,
  today,
}: TodayPageContentProps) {
  const safeChannelId = parsePublicChannelId(channelId) ?? "organic";
  const helpSearchParams = new URLSearchParams({
    fortuneDate: today.content.fortuneDate,
    expectedContentVersion: today.daJiCard.contentVersion,
  });
  const helpHref = withPublicChannelId(`/help?${helpSearchParams.toString()}`, safeChannelId);

  return (
    <main className="page-shell">
      <div className="today-page today-page--home">
        <header className="today-masthead">
          <a aria-label="使用说明与反馈" className="today-help-link" href={helpHref}>
            <span aria-hidden="true">?</span>
            <span>说明</span>
          </a>
          <div className="today-masthead__identity">
            <p className="today-masthead__brand">
              <span>Five</span>
              <span>五行穿衣</span>
            </p>
            <p className="today-masthead__description">每日五行搭配参考</p>
          </div>
          <div className="today-masthead__actions">
            <TodayShareAction
              channelId={safeChannelId}
              contentVersion={today.nextSteps.contentVersion}
              enabled={interactiveShare}
              fortuneDate={today.content.fortuneDate}
              shareOptionsHref={withPublicChannelId(today.nextSteps.shareHref, safeChannelId)}
            />
          </div>
        </header>

        <TodayDateRegion today={today} />
        <DaJiColorCard tier={today.daJiCard} />
        <CiJiColorCard tier={today.ciJiCard} />
        <PingColorCard tier={today.pingCard} />
        <AttentionColorSection section={today.attentionSection} />
        <OutfitPreviewSection channelId={safeChannelId} section={today.outfitPreviewSection} />
        <TodayImagePreviewSection section={today.imagePreviewSection} />
        <nav className="today-next-steps" aria-label="继续查看今日穿搭">
          <FoundationAction
            fullWidth
            href={withPublicChannelId(today.nextSteps.colorsHref, safeChannelId)}
            indicator="›"
          >
            查看今日颜色
          </FoundationAction>
          <div className="today-next-steps__secondary">
            <a href={withPublicChannelId(today.nextSteps.outfitsHref, safeChannelId)}>看看怎么搭</a>
            <a href={withPublicChannelId(today.nextSteps.basisHref, safeChannelId)}>为什么这样排</a>
          </div>
        </nav>
        <footer
          className="today-reference-statement"
          data-admin-selection-key="basis.disclaimer"
          data-content-version={today.basis.contentVersion}
        >
          <p>{today.basis.disclaimer}</p>
        </footer>
      </div>
    </main>
  );
}
