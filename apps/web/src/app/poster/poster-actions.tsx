"use client";

import { useRef, useState } from "react";

import { FoundationAction, FoundationButton } from "../../components/visual-foundation";
import type { TodayShareData } from "../../lib/today";
import {
  buildDailyLandingPath,
  isPosterVersionChangedError,
  parsePosterJob,
  type PosterIntent,
  type PosterJobData,
} from "../../lib/poster-job";

interface PosterActionsProps extends Omit<PosterIntent, "expectedContentVersion"> {
  copyText: TodayShareData["copyText"];
  pollIntervalMs?: number;
  sourceContentVersion: PosterIntent["expectedContentVersion"];
}

type PosterViewState =
  | { kind: "idle" }
  | { kind: "processing" }
  | { job: PosterJobData; kind: "ready" }
  | { job: PosterJobData; kind: "delayed" }
  | { kind: "failed"; retryIntent: "replace" | "reuse" }
  | { kind: "version_changed" };

// The backend worker checks for work every 30 seconds by default. Keep polling long enough for
// a request created just after one worker cycle to be picked up by the next cycle.
const MAX_POLL_ATTEMPTS = 50;
const MAX_POSTER_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const POSTER_DOWNLOAD_MEDIA_TYPES = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

function createIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function responseRequestId(response: Response, allowedStatuses: readonly number[]): string | null {
  const contentType = response.headers.get("content-type");
  const requestId = response.headers.get("x-request-id");
  return allowedStatuses.includes(response.status) &&
    contentType !== null &&
    contentType.toLowerCase().includes("application/json") &&
    typeof requestId === "string" &&
    requestId.length >= 8 &&
    requestId.length <= 128 &&
    !/[\r\n]/u.test(requestId)
    ? requestId
    : null;
}

async function readPosterResponse(
  response: Response,
  intent: PosterIntent,
  allowedStatuses: readonly number[],
  expectedJobId?: string,
): Promise<PosterJobData | null> {
  if (responseRequestId(response, allowedStatuses) === null) {
    return null;
  }

  try {
    return parsePosterJob(await response.json(), intent, expectedJobId);
  } catch {
    return null;
  }
}

async function readVersionChangedResponse(
  response: Response,
  intent: PosterIntent,
): Promise<boolean> {
  const requestId = responseRequestId(response, [409]);
  if (requestId === null) {
    return false;
  }

  try {
    return isPosterVersionChangedError(await response.json(), intent, requestId);
  } catch {
    return false;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function posterDownloadName(assetUrl: string, fortuneDate: string): string {
  const extension = /\.(avif|jpe?g|png|svg|webp)$/iu.exec(new URL(assetUrl).pathname)?.[1];
  return extension === undefined ? `five-${fortuneDate}` : `five-${fortuneDate}.${extension}`;
}

async function readPosterDownloadBody(response: Response, mediaType: string): Promise<Blob> {
  if (response.body === null) {
    throw new Error("Poster download has no body");
  }

  const reader = response.body.getReader();
  const chunks: Array<Uint8Array<ArrayBuffer>> = [];
  let receivedBytes = 0;
  let streamCancelled = false;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      receivedBytes += result.value.byteLength;
      if (receivedBytes > MAX_POSTER_DOWNLOAD_BYTES) {
        streamCancelled = true;
        await reader.cancel("Poster download is too large");
        throw new Error("Poster download is too large");
      }
      const chunk = new Uint8Array(result.value.byteLength);
      chunk.set(result.value);
      chunks.push(chunk);
    }
  } catch (error) {
    if (!streamCancelled) {
      try {
        await reader.cancel(error);
      } catch {
        // Preserve the original read error; cancellation is only best-effort cleanup.
      }
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks, { type: mediaType });
}

export function PosterActions({
  channelId,
  copyText,
  fortuneDate,
  pollIntervalMs = 1_200,
  posterJobEndpoint,
  posterTemplateVersion,
  sourceContentVersion,
}: PosterActionsProps) {
  const intent: PosterIntent = {
    channelId,
    expectedContentVersion: sourceContentVersion,
    fortuneDate,
    posterJobEndpoint,
    posterTemplateVersion,
  };
  const dailyPath = buildDailyLandingPath(intent);
  const idempotencyKeyRef = useRef<{ fingerprint: string; value: string } | null>(null);
  const [manualValue, setManualValue] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [viewState, setViewState] = useState<PosterViewState>({ kind: "idle" });

  async function copyValue(value: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setManualValue(null);
      setStatusMessage(successMessage);
    } catch {
      setManualValue(value);
      setStatusMessage("自动复制失败，请长按下方内容手动复制。");
    }
  }

  function acceptJob(job: PosterJobData): boolean {
    if (job.status === "ready") {
      setViewState({ job, kind: "ready" });
      return true;
    }
    if (job.status === "failed") {
      setViewState({ kind: "failed", retryIntent: "replace" });
      return true;
    }
    if (job.status === "version_changed") {
      setViewState({ kind: "version_changed" });
      return true;
    }
    setViewState({ kind: "processing" });
    return false;
  }

  async function pollJob(initialJob: PosterJobData): Promise<void> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      await wait(pollIntervalMs);
      try {
        const response = await fetch(
          `${posterJobEndpoint}/${encodeURIComponent(initialJob.jobId)}`,
          {
            cache: "no-store",
            headers: { accept: "application/json" },
          },
        );
        const job = await readPosterResponse(response, intent, [200], initialJob.jobId);
        if (job === null) {
          setViewState({ kind: "failed", retryIntent: "reuse" });
          return;
        }
        if (acceptJob(job)) {
          return;
        }
      } catch {
        setViewState({ kind: "failed", retryIntent: "reuse" });
        return;
      }
    }
    setViewState({ job: initialJob, kind: "delayed" });
  }

  async function continuePolling(): Promise<void> {
    if (viewState.kind !== "delayed") {
      return;
    }
    const job = viewState.job;
    setViewState({ kind: "processing" });
    await pollJob(job);
  }

  async function downloadPoster(assetUrl: string): Promise<void> {
    if (isDownloading) {
      return;
    }
    setIsDownloading(true);
    setStatusMessage(null);
    try {
      const response = await fetch(assetUrl, {
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      const mediaType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      const declaredLength = Number(response.headers.get("content-length"));
      if (
        !response.ok ||
        mediaType === undefined ||
        !POSTER_DOWNLOAD_MEDIA_TYPES.has(mediaType) ||
        (Number.isFinite(declaredLength) && declaredLength > MAX_POSTER_DOWNLOAD_BYTES)
      ) {
        throw new Error("Unexpected poster download response");
      }

      const body = await readPosterDownloadBody(response, mediaType);
      const objectUrl = URL.createObjectURL(body);
      const download = document.createElement("a");
      download.download = posterDownloadName(assetUrl, fortuneDate);
      download.href = objectUrl;
      download.rel = "noopener";
      download.style.display = "none";
      document.body.append(download);
      try {
        download.click();
      } finally {
        download.remove();
        URL.revokeObjectURL(objectUrl);
      }
      setStatusMessage("海报下载已开始。");
    } catch {
      setStatusMessage("自动下载未成功，请长按上方海报保存。");
    } finally {
      setIsDownloading(false);
    }
  }

  async function createPoster(): Promise<void> {
    setManualValue(null);
    setStatusMessage(null);
    setViewState({ kind: "processing" });
    const intentFingerprint = JSON.stringify({
      channelId,
      expectedContentVersion: sourceContentVersion,
      fortuneDate,
    });
    if (viewState.kind === "failed" && viewState.retryIntent === "replace") {
      idempotencyKeyRef.current = null;
    }
    if (idempotencyKeyRef.current?.fingerprint !== intentFingerprint) {
      idempotencyKeyRef.current = {
        fingerprint: intentFingerprint,
        value: createIdempotencyKey(),
      };
    }

    try {
      const response = await fetch(posterJobEndpoint, {
        body: JSON.stringify({
          channelId,
          expectedContentVersion: sourceContentVersion,
          fortuneDate,
        }),
        cache: "no-store",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKeyRef.current.value,
        },
        method: "POST",
      });
      if (response.status === 409) {
        setViewState(
          (await readVersionChangedResponse(response, intent))
            ? { kind: "version_changed" }
            : { kind: "failed", retryIntent: "reuse" },
        );
        return;
      }
      const job = await readPosterResponse(response, intent, [200, 202]);
      if (job === null) {
        setViewState({ kind: "failed", retryIntent: "reuse" });
        return;
      }
      if (!acceptJob(job)) {
        await pollJob(job);
      }
    } catch {
      setViewState({ kind: "failed", retryIntent: "reuse" });
    }
  }

  const isBusy = viewState.kind === "processing";
  const isFallback =
    viewState.kind === "delayed" ||
    viewState.kind === "failed" ||
    viewState.kind === "version_changed";

  return (
    <section aria-labelledby="poster-action-title" className="poster-actions">
      <div className="poster-actions__heading">
        <p>日签制品</p>
        <h2 aria-atomic="true" aria-live="polite" id="poster-action-title">
          {viewState.kind === "ready" ? "海报已经准备好" : "生成这一日的分享海报"}
        </h2>
      </div>

      {viewState.kind === "ready" ? (
        <div className="poster-result">
          <img
            alt={`${fortuneDate} 日签海报`}
            decoding="async"
            referrerPolicy="no-referrer"
            src={viewState.job.assetUrl ?? ""}
          />
          <p aria-live="polite" role="status">
            海报已经准备好，也可以长按上方海报保存到手机。
          </p>
          <FoundationButton
            disabled={isDownloading}
            fullWidth
            indicator="↓"
            onClick={() => downloadPoster(viewState.job.assetUrl ?? "")}
          >
            {isDownloading ? "正在准备下载" : "下载海报"}
          </FoundationButton>
        </div>
      ) : (
        <>
          {isBusy ? (
            <div aria-live="polite" className="poster-progress" role="status">
              <span aria-hidden="true" />
              <p>正在排版日签…</p>
              <small>只会使用已经审核的图片和固定模板。</small>
            </div>
          ) : null}
          {viewState.kind === "failed" ? (
            <p className="poster-state" role="status">
              海报暂时没有生成成功，今日页面和分享文字仍可使用。
            </p>
          ) : null}
          {viewState.kind === "version_changed" ? (
            <p className="poster-state" role="status">
              当天内容已经更新，没有用新版本替换这张旧版海报请求。请返回当日内容查看。
            </p>
          ) : null}
          {viewState.kind === "delayed" ? (
            <p className="poster-state" role="status">
              海报仍在生成，可以继续查询进度；今日页面和分享文字仍可使用。
            </p>
          ) : null}
          {viewState.kind === "delayed" ? (
            <FoundationButton fullWidth indicator="↻" onClick={continuePolling}>
              继续查询生成进度
            </FoundationButton>
          ) : null}
          {!isBusy && viewState.kind !== "version_changed" ? (
            viewState.kind === "delayed" ? null : (
              <FoundationButton fullWidth indicator="↗" onClick={createPoster}>
                {viewState.kind === "failed" ? "重新尝试生成" : "生成日签海报"}
              </FoundationButton>
            )
          ) : null}
        </>
      )}

      {isFallback ? (
        <div className="poster-fallbacks">
          <FoundationButton
            fullWidth
            indicator="⧉"
            onClick={() => copyValue(copyText, "今日文字已复制。")}
            tone="secondary"
          >
            复制今日文字
          </FoundationButton>
          <FoundationButton
            fullWidth
            indicator="⧉"
            onClick={() =>
              copyValue(new URL(dailyPath, window.location.origin).toString(), "当日链接已复制。")
            }
            tone="secondary"
          >
            复制当日链接
          </FoundationButton>
        </div>
      ) : null}

      {manualValue === null ? null : (
        <label className="poster-manual-copy">
          <span>可手动复制的内容</span>
          <textarea
            aria-label="可手动复制的内容"
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            rows={4}
            value={manualValue}
          />
        </label>
      )}
      {statusMessage === null ? null : (
        <p aria-live="polite" className="poster-copy-status" role="status">
          {statusMessage}
        </p>
      )}
      <FoundationAction fullWidth href={dailyPath} indicator="←">
        返回当日内容
      </FoundationAction>
    </section>
  );
}
