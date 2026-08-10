"use client";

import { useEffect, useState } from "react";

import {
  analyticsOptedOut,
  clearAnalyticsAnonymousId,
  setAnalyticsOptOut,
} from "../../lib/analytics";
import { clearTodaySnapshotCache, TODAY_PENDING_REFRESH_ANCHOR_KEY } from "../../lib/today-cache";

export function LocalDataControls() {
  const [status, setStatus] = useState<"idle" | "cleared" | "failed">("idle");
  const [analyticsState, setAnalyticsState] = useState<"checking" | "enabled" | "disabled">(
    "checking",
  );
  const [analyticsNotice, setAnalyticsNotice] = useState<string | null>(null);

  useEffect(() => {
    setAnalyticsState(analyticsOptedOut() ? "disabled" : "enabled");
  }, []);

  function clearLocalData() {
    try {
      clearTodaySnapshotCache(window.localStorage);
      window.sessionStorage.removeItem(TODAY_PENDING_REFRESH_ANCHOR_KEY);
      if (!clearAnalyticsAnonymousId()) {
        throw new Error("analytics storage unavailable");
      }
      setStatus("cleared");
    } catch {
      setStatus("failed");
    }
  }

  function toggleAnonymousAnalytics() {
    const optOut = analyticsState === "enabled";
    if (!setAnalyticsOptOut(optOut)) {
      setAnalyticsNotice("浏览器未允许修改，请在浏览器的网站数据设置中操作。");
      return;
    }
    setAnalyticsState(optOut ? "disabled" : "enabled");
    setAnalyticsNotice(
      optOut
        ? "这台浏览器已退出匿名使用统计，原匿名标识已清除。"
        : "这台浏览器已重新启用匿名使用统计；下次使用时才会生成新的随机标识。",
    );
  }

  return (
    <div className="help-local-data">
      <button
        className="foundation-action foundation-action--button foundation-action--secondary"
        onClick={clearLocalData}
        type="button"
      >
        <span>清除本机 Five 数据</span>
        <span aria-hidden="true">×</span>
      </button>
      {analyticsState === "checking" ? null : (
        <button
          className="foundation-action foundation-action--button foundation-action--secondary"
          onClick={toggleAnonymousAnalytics}
          type="button"
        >
          <span>{analyticsState === "enabled" ? "退出匿名使用统计" : "重新启用匿名使用统计"}</span>
          <span aria-hidden="true">{analyticsState === "enabled" ? "−" : "+"}</span>
        </button>
      )}
      {status === "idle" ? null : (
        <p role={status === "failed" ? "alert" : "status"}>
          {status === "cleared"
            ? "本机数据已清除；重新打开首页会再次获取当前公开内容。"
            : "浏览器未允许清除，请在浏览器的网站数据设置中操作。"}
        </p>
      )}
      {analyticsNotice === null ? null : <p role="status">{analyticsNotice}</p>}
    </div>
  );
}
