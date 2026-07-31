"use client";

import { useLayoutEffect, useRef, useState } from "react";

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
  const posterIntentFingerprint = JSON.stringify(intent);
  const activeIntentFingerprintRef = useRef(posterIntentFingerprint);
  const idempotencyKeyRef = useRef<{ fingerprint: string; value: string } | null>(null);
  const operationControllersRef = useRef(new Set<AbortController>());
  const stateIntentFingerprintRef = useRef(posterIntentFingerprint);
  const [showDownloadFallback, setShowDownloadFallback] = useState(false);
  const [manualValue, setManualValue] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [viewState, setViewState] = useState<PosterViewState>({ kind: "idle" });
  const intentStateIsCurrent = stateIntentFingerprintRef.current === posterIntentFingerprint;

  function beginOperation(): AbortController {
    const controller = new AbortController();
    operationControllersRef.current.add(controller);
    return controller;
  }

  function finishOperation(controller: AbortController): void {
    operationControllersRef.current.delete(controller);
  }

  function operationIsCurrent(fingerprint: string, controller?: AbortController): boolean {
    return (
      activeIntentFingerprintRef.current === fingerprint &&
      (controller === undefined || !controller.signal.aborted)
    );
  }

  useLayoutEffect(() => {
    // Refs are shared between current and work-in-progress fibers, so switch the active intent
    // only after React commits it. A render that gets discarded must not cancel valid work.
    if (activeIntentFingerprintRef.current !== posterIntentFingerprint) {
      activeIntentFingerprintRef.current = posterIntentFingerprint;
      stateIntentFingerprintRef.current = posterIntentFingerprint;
      idempotencyKeyRef.current = null;
      setShowDownloadFallback(false);
      setIsDownloading(false);
      setManualValue(null);
      setPreviewFailed(false);
      setStatusMessage(null);
      setViewState({ kind: "idle" });
    }

    return () => {
      for (const controller of operationControllersRef.current) {
        controller.abort();
      }
      operationControllersRef.current.clear();
    };
  }, [posterIntentFingerprint]);

  async function copyValue(value: string, successMessage: string): Promise<void> {
    const operationFingerprint = posterIntentFingerprint;
    try {
      await navigator.clipboard.writeText(value);
      if (!operationIsCurrent(operationFingerprint)) {
        return;
      }
      setManualValue(null);
      setStatusMessage(successMessage);
    } catch {
      if (!operationIsCurrent(operationFingerprint)) {
        return;
      }
      setManualValue(value);
      setStatusMessage("自动复制失败，请长按下方内容手动复制。");
    }
  }

  function acceptJob(job: PosterJobData, operationFingerprint: string): boolean {
    if (!operationIsCurrent(operationFingerprint)) {
      return true;
    }
    if (job.status === "ready") {
      setShowDownloadFallback(false);
      setPreviewFailed(false);
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

  async function pollJob(
    initialJob: PosterJobData,
    operationFingerprint: string,
    controller: AbortController,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      await wait(pollIntervalMs);
      if (!operationIsCurrent(operationFingerprint, controller)) {
        return;
      }
      try {
        const response = await fetch(
          `${posterJobEndpoint}/${encodeURIComponent(initialJob.jobId)}`,
          {
            cache: "no-store",
            headers: { accept: "application/json" },
            signal: controller.signal,
          },
        );
        const job = await readPosterResponse(response, intent, [200], initialJob.jobId);
        if (!operationIsCurrent(operationFingerprint, controller)) {
          return;
        }
        if (job === null) {
          setViewState({ kind: "failed", retryIntent: "reuse" });
          return;
        }
        if (acceptJob(job, operationFingerprint)) {
          return;
        }
      } catch {
        if (!operationIsCurrent(operationFingerprint, controller)) {
          return;
        }
        setViewState({ kind: "failed", retryIntent: "reuse" });
        return;
      }
    }
    if (!operationIsCurrent(operationFingerprint, controller)) {
      return;
    }
    setViewState({ job: initialJob, kind: "delayed" });
  }

  async function continuePolling(): Promise<void> {
    if (viewState.kind !== "delayed") {
      return;
    }
    const job = viewState.job;
    const operationFingerprint = posterIntentFingerprint;
    const controller = beginOperation();
    setViewState({ kind: "processing" });
    try {
      await pollJob(job, operationFingerprint, controller);
    } finally {
      finishOperation(controller);
    }
  }

  async function downloadPoster(assetUrl: string): Promise<void> {
    if (isDownloading) {
      return;
    }
    const operationFingerprint = posterIntentFingerprint;
    const controller = beginOperation();
    setIsDownloading(true);
    setShowDownloadFallback(false);
    setStatusMessage(null);
    try {
      const response = await fetch(assetUrl, {
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
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
      if (!operationIsCurrent(operationFingerprint, controller)) {
        return;
      }
      if (!("download" in HTMLAnchorElement.prototype)) {
        throw new Error("Browser download is unavailable");
      }
      const objectUrl = URL.createObjectURL(body);
      const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
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
        window.setTimeout(() => revokeObjectUrl(objectUrl), 1_000);
      }
      // Browsers do not expose whether a programmatic download was accepted. Keep the copy
      // fallbacks available even after click() so a silently ignored download never traps users.
      setShowDownloadFallback(true);
      setStatusMessage("已尝试开始下载；如果浏览器没有响应，也可以复制今日文字或当日链接。");
    } catch {
      if (!operationIsCurrent(operationFingerprint, controller)) {
        return;
      }
      setShowDownloadFallback(true);
      setStatusMessage("自动下载未成功，请长按上方海报保存。");
    } finally {
      finishOperation(controller);
      if (operationIsCurrent(operationFingerprint)) {
        setIsDownloading(false);
      }
    }
  }

  async function createPoster(): Promise<void> {
    const operationFingerprint = posterIntentFingerprint;
    const controller = beginOperation();
    setShowDownloadFallback(false);
    setManualValue(null);
    setPreviewFailed(false);
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
        signal: controller.signal,
      });
      if (response.status === 409) {
        const versionChanged = await readVersionChangedResponse(response, intent);
        if (operationIsCurrent(operationFingerprint, controller)) {
          setViewState(
            versionChanged ? { kind: "version_changed" } : { kind: "failed", retryIntent: "reuse" },
          );
        }
        return;
      }
      const job = await readPosterResponse(response, intent, [200, 202]);
      if (!operationIsCurrent(operationFingerprint, controller)) {
        return;
      }
      if (job === null) {
        setViewState({ kind: "failed", retryIntent: "reuse" });
        return;
      }
      if (!acceptJob(job, operationFingerprint)) {
        await pollJob(job, operationFingerprint, controller);
      }
    } catch {
      if (!operationIsCurrent(operationFingerprint, controller)) {
        return;
      }
      setViewState({ kind: "failed", retryIntent: "reuse" });
    } finally {
      finishOperation(controller);
    }
  }

  const displayedViewState: PosterViewState = intentStateIsCurrent ? viewState : { kind: "idle" };
  const displayedDownloadFallback = intentStateIsCurrent && showDownloadFallback;
  const displayedIsDownloading = intentStateIsCurrent && isDownloading;
  const displayedManualValue = intentStateIsCurrent ? manualValue : null;
  const displayedPreviewFailed = intentStateIsCurrent && previewFailed;
  const displayedStatusMessage = intentStateIsCurrent ? statusMessage : null;
  const isBusy = displayedViewState.kind === "processing";
  const isFallback =
    displayedDownloadFallback ||
    displayedPreviewFailed ||
    displayedViewState.kind === "delayed" ||
    displayedViewState.kind === "failed";

  return (
    <section aria-labelledby="poster-action-title" className="poster-actions">
      <div className="poster-actions__heading">
        <p>日签制品</p>
        <h2 aria-atomic="true" aria-live="polite" id="poster-action-title">
          {displayedViewState.kind === "ready" ? "海报已经准备好" : "生成这一日的分享海报"}
        </h2>
      </div>

      {displayedViewState.kind === "ready" ? (
        <div className="poster-result">
          {displayedPreviewFailed ? (
            <>
              <p aria-live="polite" className="poster-state" role="status">
                海报预览加载失败，今日文字和当日链接仍可使用。
              </p>
              <FoundationButton
                fullWidth
                indicator="↻"
                onClick={() => {
                  if (intentStateIsCurrent) {
                    setPreviewFailed(false);
                  }
                }}
                tone="secondary"
              >
                重新加载海报预览
              </FoundationButton>
            </>
          ) : (
            <>
              <img
                alt={`${fortuneDate} 日签海报`}
                decoding="async"
                onError={() => {
                  if (operationIsCurrent(posterIntentFingerprint)) {
                    setPreviewFailed(true);
                  }
                }}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (typeof image.decode === "function") {
                    const operationFingerprint = posterIntentFingerprint;
                    void image.decode().catch(() => {
                      if (operationIsCurrent(operationFingerprint)) {
                        setPreviewFailed(true);
                      }
                    });
                  }
                }}
                referrerPolicy="no-referrer"
                src={displayedViewState.job.assetUrl ?? ""}
              />
              <p aria-live="polite" role="status">
                海报已经准备好，也可以长按上方海报保存到手机。
              </p>
              <FoundationButton
                disabled={displayedIsDownloading}
                fullWidth
                indicator="↓"
                onClick={() => downloadPoster(displayedViewState.job.assetUrl ?? "")}
              >
                {displayedIsDownloading ? "正在准备下载" : "下载海报"}
              </FoundationButton>
            </>
          )}
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
          {displayedViewState.kind === "failed" ? (
            <p className="poster-state" role="status">
              海报暂时没有生成成功，今日页面和分享文字仍可使用。
            </p>
          ) : null}
          {displayedViewState.kind === "version_changed" ? (
            <p className="poster-state" role="status">
              当天内容已经更新，没有用新版本替换这张旧版海报请求。请返回当日内容查看。
            </p>
          ) : null}
          {displayedViewState.kind === "delayed" ? (
            <p className="poster-state" role="status">
              海报仍在生成，可以继续查询进度；今日页面和分享文字仍可使用。
            </p>
          ) : null}
          {displayedViewState.kind === "delayed" ? (
            <FoundationButton fullWidth indicator="↻" onClick={continuePolling}>
              继续查询生成进度
            </FoundationButton>
          ) : null}
          {!isBusy && displayedViewState.kind !== "version_changed" ? (
            displayedViewState.kind === "delayed" ? null : (
              <FoundationButton fullWidth indicator="↗" onClick={createPoster}>
                {displayedViewState.kind === "failed" ? "重新尝试生成" : "生成日签海报"}
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

      {displayedManualValue === null ? null : (
        <label className="poster-manual-copy">
          <span>可手动复制的内容</span>
          <textarea
            aria-label="可手动复制的内容"
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            rows={4}
            value={displayedManualValue}
          />
        </label>
      )}
      {displayedStatusMessage === null ? null : (
        <p aria-live="polite" className="poster-copy-status" role="status">
          {displayedStatusMessage}
        </p>
      )}
      <FoundationAction fullWidth href={dailyPath} indicator="←">
        返回当日内容
      </FoundationAction>
    </section>
  );
}
