"use client";

import { useState, type MouseEvent } from "react";

import { generateAnalyticsReferralId, trackAnalyticsEvent } from "../lib/analytics";
import { buildDailyLandingPath } from "../lib/poster-job";

interface TodayShareActionProps {
  channelId: string;
  contentVersion: string;
  enabled?: boolean;
  fortuneDate: string;
  shareOptionsHref: string;
}

function isWechatBrowser(): boolean {
  return /MicroMessenger/iu.test(navigator.userAgent);
}

export function TodayShareAction({
  contentVersion,
  enabled = true,
  fortuneDate,
  shareOptionsHref,
}: TodayShareActionProps) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  function createShareIntent(): string {
    const referralId = generateAnalyticsReferralId();
    const dailyPath = buildDailyLandingPath({
      channelId: "user_share",
      expectedContentVersion: contentVersion,
      fortuneDate,
    });
    const referralDailyPath =
      referralId === null ? dailyPath : `${dailyPath}&referralId=${encodeURIComponent(referralId)}`;
    trackAnalyticsEvent({
      channelId: "user_share",
      contentVersion,
      eventName: "share_summary_initiated",
      fortuneDate,
      referralId,
    });
    return referralDailyPath;
  }

  async function handleShare(event: MouseEvent<HTMLAnchorElement>): Promise<void> {
    if (!enabled) {
      return;
    }
    if (isWechatBrowser()) {
      event.preventDefault();
      const referralDailyPath = createShareIntent();
      window.history.pushState(null, "", referralDailyPath);
      setStatusMessage("分享地址已准备好。点击微信右上角 ···，选择发送给朋友或分享到朋友圈。");
      return;
    }
    if (typeof navigator.share !== "function") {
      return;
    }

    event.preventDefault();
    const referralDailyPath = createShareIntent();
    try {
      // Call before the first await so mobile browsers retain the click's user activation.
      const shareResult = navigator.share({
        title: `Five · ${fortuneDate} 五行穿衣`,
        url: new URL(referralDailyPath, window.location.origin).toString(),
      });
      await shareResult;
      setStatusMessage("系统分享已结束；如未完成，可以再次点击分享。");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatusMessage("已取消分享。");
        return;
      }
      setStatusMessage("系统分享暂时不可用，可打开更多分享方式重试。");
    }
  }

  return (
    <>
      <a
        aria-label="分享今天"
        className="today-share-link"
        data-admin-selection-key="share.copy"
        href={shareOptionsHref}
        onClick={handleShare}
      >
        <span>分享</span>
        <span aria-hidden="true">↗</span>
      </a>
      {statusMessage === null ? null : (
        <p aria-live="polite" className="today-share-feedback" role="status">
          {statusMessage}
        </p>
      )}
    </>
  );
}
