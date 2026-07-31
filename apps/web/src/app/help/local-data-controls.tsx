"use client";

import { useState } from "react";

import { clearTodaySnapshotCache, TODAY_PENDING_REFRESH_ANCHOR_KEY } from "../../lib/today-cache";

export function LocalDataControls() {
  const [status, setStatus] = useState<"idle" | "cleared" | "failed">("idle");

  function clearLocalData() {
    try {
      clearTodaySnapshotCache(window.localStorage);
      window.sessionStorage.removeItem(TODAY_PENDING_REFRESH_ANCHOR_KEY);
      setStatus("cleared");
    } catch {
      setStatus("failed");
    }
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
      {status === "idle" ? null : (
        <p role={status === "failed" ? "alert" : "status"}>
          {status === "cleared"
            ? "本机数据已清除；重新打开首页会再次获取当前公开内容。"
            : "浏览器未允许清除，请在浏览器的网站数据设置中操作。"}
        </p>
      )}
    </div>
  );
}
