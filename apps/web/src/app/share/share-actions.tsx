"use client";

import { useState } from "react";

import { FoundationAction, FoundationButton } from "../../components/visual-foundation";
import { generateAnalyticsReferralId, trackAnalyticsEvent } from "../../lib/analytics";
import type { FiveApiPaths } from "../../lib/api-contract";

type PosterJobRequest =
  FiveApiPaths["/api/v1/poster-jobs"]["post"]["requestBody"]["content"]["application/json"];

type ShareActionsProps = Pick<PosterJobRequest, "channelId" | "fortuneDate"> & {
  contentVersion: PosterJobRequest["expectedContentVersion"];
};

function buildDailyLandingPath({
  channelId,
  contentVersion,
  fortuneDate,
  referralId,
}: Pick<ShareActionsProps, "contentVersion" | "fortuneDate"> & {
  channelId: string;
  referralId: string | null;
}): string {
  const searchParams = new URLSearchParams({
    channelId,
    expectedContentVersion: contentVersion,
  });
  if (referralId !== null) {
    searchParams.set("referralId", referralId);
  }

  return `/daily/${encodeURIComponent(fortuneDate)}?${searchParams.toString()}`;
}

function copyWithSelectableControl(value: string): boolean {
  if (typeof document.execCommand !== "function") {
    return false;
  }

  const control = document.createElement("textarea");
  control.value = value;
  control.readOnly = true;
  control.tabIndex = -1;
  control.setAttribute("aria-hidden", "true");
  control.style.position = "fixed";
  control.style.inset = "-9999px auto auto -9999px";
  document.body.append(control);
  control.select();
  control.setSelectionRange(0, value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    control.remove();
  }
}

async function copyToClipboard(value: string): Promise<boolean> {
  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Permission failures should still try the browser's legacy selection path.
    }
  }

  return copyWithSelectableControl(value);
}

function isWechatBrowser(): boolean {
  return /MicroMessenger/iu.test(navigator.userAgent);
}

export function ShareActions({ contentVersion, fortuneDate }: ShareActionsProps) {
  const [manualLandingUrl, setManualLandingUrl] = useState<string | null>(null);
  const [wechatDailyPath, setWechatDailyPath] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  function createShareIntent(): string {
    const referralId = generateAnalyticsReferralId();
    const landingPath = buildDailyLandingPath({
      channelId: "user_share",
      contentVersion,
      fortuneDate,
      referralId,
    });
    trackAnalyticsEvent({
      channelId: "user_share",
      contentVersion,
      eventName: "share_summary_initiated",
      fortuneDate,
      referralId,
    });
    return landingPath;
  }

  function getLandingUrl(landingPath: string): string {
    return new URL(landingPath, window.location.origin).toString();
  }

  async function copyLandingUrl(message: string, landingPath = createShareIntent()): Promise<void> {
    const landingUrl = getLandingUrl(landingPath);
    if (await copyToClipboard(landingUrl)) {
      setManualLandingUrl(null);
      setWechatDailyPath(null);
      setStatusMessage(message);
      return;
    }

    setManualLandingUrl(landingUrl);
    setStatusMessage("自动复制失败，请长按下方链接手动复制。");
  }

  async function shareDailyPage(): Promise<void> {
    const landingPath = createShareIntent();
    if (isWechatBrowser()) {
      setManualLandingUrl(null);
      setWechatDailyPath(landingPath);
      setStatusMessage(
        "微信右上角会分享当前引导页。要让好友直接看到完整五行内容，请先打开当日页面，再使用右上角分享。",
      );
      return;
    }
    setWechatDailyPath(null);

    if (typeof navigator.share !== "function") {
      await copyLandingUrl("当前浏览器无法直接分享，页面链接已复制。", landingPath);
      return;
    }

    try {
      const shareResult = navigator.share({
        title: `Five · ${fortuneDate} 五行穿衣`,
        url: getLandingUrl(landingPath),
      });
      await shareResult;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatusMessage("已取消分享，你仍可复制页面链接。");
        return;
      }

      await copyLandingUrl("页面分享未完成，链接已复制。", landingPath);
    }
  }

  return (
    <section aria-labelledby="share-actions-title" className="share-actions">
      <div className="share-actions__intro">
        <p>转发完整页面</p>
        <h2 id="share-actions-title">发给微信好友或更多应用</h2>
        <span>对方打开后会看到这一天完整的五档颜色、穿搭和模特图。</span>
      </div>
      <div className="share-actions__buttons">
        <FoundationButton fullWidth indicator="↗" onClick={shareDailyPage}>
          分享到微信或更多应用
        </FoundationButton>
        <FoundationButton
          fullWidth
          indicator="⧉"
          onClick={() => copyLandingUrl("指定日期链接已复制。")}
          tone="secondary"
        >
          复制链接
        </FoundationButton>
      </div>
      {wechatDailyPath === null ? null : (
        <FoundationAction fullWidth href={wechatDailyPath} indicator="→">
          打开完整当日页面
        </FoundationAction>
      )}
      {manualLandingUrl === null ? null : (
        <label className="share-actions__manual-link">
          <span>指定日期分享链接</span>
          <input
            aria-label="指定日期分享链接"
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            type="text"
            value={manualLandingUrl}
          />
        </label>
      )}
      {statusMessage === null ? null : (
        <p aria-atomic="true" aria-live="polite" className="share-actions__status" role="status">
          {statusMessage}
        </p>
      )}
    </section>
  );
}
