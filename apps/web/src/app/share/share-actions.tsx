"use client";

import { useState } from "react";

import { FoundationButton } from "../../components/visual-foundation";
import type { FiveApiPaths } from "../../lib/api-contract";
import type { TodayShareData } from "../../lib/today";

type PosterJobRequest =
  FiveApiPaths["/api/v1/poster-jobs"]["post"]["requestBody"]["content"]["application/json"];

type ShareActionsProps = Pick<PosterJobRequest, "channelId" | "fortuneDate"> & {
  contentVersion: PosterJobRequest["expectedContentVersion"];
  summaryText: TodayShareData["summaryText"];
};

function buildDailyLandingPath({
  channelId,
  contentVersion,
  fortuneDate,
}: Pick<ShareActionsProps, "channelId" | "contentVersion" | "fortuneDate">): string {
  const searchParams = new URLSearchParams({
    channelId,
    expectedContentVersion: contentVersion,
  });

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

export function ShareActions({
  channelId,
  contentVersion,
  fortuneDate,
  summaryText,
}: ShareActionsProps) {
  const landingPath = buildDailyLandingPath({ channelId, contentVersion, fortuneDate });
  const [manualLandingUrl, setManualLandingUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  function getLandingUrl(): string {
    return new URL(landingPath, window.location.origin).toString();
  }

  async function copyLandingUrl(message: string): Promise<void> {
    const landingUrl = getLandingUrl();
    let copied = false;

    if (typeof navigator.clipboard?.writeText === "function") {
      try {
        await navigator.clipboard.writeText(landingUrl);
        copied = true;
      } catch {
        copied = false;
      }
    }

    copied ||= copyWithSelectableControl(landingUrl);
    if (copied) {
      setManualLandingUrl(null);
      setStatusMessage(message);
      return;
    }

    setManualLandingUrl(landingUrl);
    setStatusMessage("自动复制失败，请长按下方链接手动复制。");
  }

  async function shareWithSystem(): Promise<void> {
    if (typeof navigator.share !== "function") {
      await copyLandingUrl("当前浏览器不支持系统分享，链接已复制。");
      return;
    }

    try {
      await navigator.share({
        text: summaryText,
        title: `Five · ${fortuneDate} 今日穿衣参考`,
        url: getLandingUrl(),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatusMessage("已取消系统分享，你仍可复制链接。");
        return;
      }

      await copyLandingUrl("系统分享未完成，链接已复制。");
    }
  }

  return (
    <section aria-labelledby="share-actions-title" className="share-actions">
      <div className="share-actions__intro">
        <p>分享方式</p>
        <h2 id="share-actions-title">把今天的参考发给朋友</h2>
        <span>链接会固定到这一天，不会包含个人信息。</span>
      </div>
      <div className="share-actions__buttons">
        <FoundationButton fullWidth indicator="↗" onClick={shareWithSystem}>
          系统分享
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
