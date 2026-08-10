"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  adminApi,
  createIdempotencyKey,
  describeAdminApiError,
  type AdminSession,
  type EmergencyControlStatus,
} from "../admin-api";
import { AdminSessionGate } from "../admin-session-gate";
import { useAdminSession } from "../admin-session-context";

type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

type ActionState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type EmergencyControlRequest = Parameters<(typeof adminApi)["setEmergencyStatus"]>[0];

type PendingEmergencyOperation = {
  originalPublicAccessEnabled: boolean;
  originalRevision: number;
  request: EmergencyControlRequest;
  targetPublicAccessEnabled: boolean;
};

const changedAtFormat = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  year: "numeric",
});

function EmergencyControlContent({ session }: { session: AdminSession }) {
  const { clearSession } = useAdminSession();
  const [status, setStatus] = useState<EmergencyControlStatus | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [actionState, setActionState] = useState<ActionState>({ kind: "idle" });
  const [reason, setReason] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [pendingOperation, setPendingOperation] = useState<PendingEmergencyOperation | null>(null);

  const loadStatus = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) setLoadState({ kind: "loading" });
      const result = await adminApi.getEmergencyStatus();
      if (!result.ok) {
        if (result.error.status === 401) {
          clearSession();
          return;
        }
        setLoadState({
          kind: "error",
          message: describeAdminApiError(result.error, true),
        });
        return;
      }

      const currentEtag = result.response.headers.get("ETag");
      if (currentEtag === null || currentEtag.length > 128) {
        setLoadState({ kind: "error", message: "后台未返回可核验的状态修订号，请勿执行操作。" });
        return;
      }
      setStatus(result.data);
      setEtag(currentEtag);
      setLoadState({ kind: "ready" });
    },
    [clearSession],
  );

  useEffect(() => {
    void loadStatus(true);
  }, [loadStatus]);

  useEffect(() => {
    const forgetConfirmation = () => {
      setConfirmationPhrase("");
      setReason("");
      setPendingOperation(null);
      setActionState({ kind: "idle" });
    };
    const forgetRestoredConfirmation = (event: PageTransitionEvent) => {
      if (event.persisted) forgetConfirmation();
    };
    window.addEventListener("pagehide", forgetConfirmation);
    window.addEventListener("pageshow", forgetRestoredConfirmation);
    return () => {
      window.removeEventListener("pagehide", forgetConfirmation);
      window.removeEventListener("pageshow", forgetRestoredConfirmation);
    };
  }, []);

  async function submitControl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === null || etag === null || actionState.kind === "submitting") return;
    const stopping = status.publicAccessEnabled;
    const requiredPhrase = stopping ? "停止全部公开内容" : "恢复全部公开内容";
    if (confirmationPhrase !== requiredPhrase) {
      setActionState({ kind: "error", message: `请完整输入“${requiredPhrase}”。` });
      return;
    }
    if (reason.trim().length === 0) {
      setActionState({ kind: "error", message: "请写明本次高风险操作的原因。" });
      return;
    }
    let idempotencyKey: string;
    try {
      idempotencyKey = createIdempotencyKey();
    } catch {
      setActionState({
        kind: "error",
        message: "当前浏览器无法生成安全操作编号，请升级浏览器后再执行紧急控制。",
      });
      return;
    }

    setActionState({ kind: "submitting" });
    const request: EmergencyControlRequest = {
      body: { confirmationPhrase: requiredPhrase, reason: reason.trim() },
      csrfToken: session.csrfToken,
      etag,
      idempotencyKey,
      operation: stopping ? "stop" : "resume",
    };
    const result = await adminApi.setEmergencyStatus(request);
    setConfirmationPhrase("");

    if (!result.ok) {
      if (result.error.status === 401) {
        clearSession();
        return;
      }
      if (result.error.status === 0 || result.error.status >= 500) {
        setPendingOperation({
          originalPublicAccessEnabled: status.publicAccessEnabled,
          originalRevision: status.revision,
          request,
          targetPublicAccessEnabled: !status.publicAccessEnabled,
        });
        setActionState({
          kind: "error",
          message: "操作结果暂时无法确认。请先读取最新状态，再安全地确认或重试同一次操作。",
        });
        return;
      }
      setActionState({
        kind: "error",
        message: describeAdminApiError(result.error, true),
      });
      if (result.error.status === 412 || result.error.status === 428) {
        await loadStatus(false);
      }
      return;
    }

    const newEtag = result.response.headers.get("ETag");
    if (newEtag === null || newEtag.length > 128) {
      setActionState({
        kind: "error",
        message: "操作已响应，但无法确认最新修订号。请刷新状态后再做后续操作。",
      });
      await loadStatus(false);
      return;
    }
    setStatus(result.data);
    setEtag(newEtag);
    setReason("");
    setPendingOperation(null);
    setActionState({ kind: "success", message: "紧急状态已更新，并已写入安全审计。" });
  }

  async function retryPendingOperation() {
    if (pendingOperation === null || actionState.kind === "submitting") return;

    setActionState({ kind: "submitting" });
    const latest = await adminApi.getEmergencyStatus();
    if (!latest.ok) {
      if (latest.error.status === 401) {
        clearSession();
        return;
      }
      setActionState({
        kind: "error",
        message: "操作结果仍无法确认。请保持本页打开，网络恢复后再次安全重试。",
      });
      return;
    }

    const latestEtag = latest.response.headers.get("ETag");
    if (latestEtag === null || latestEtag.length > 128) {
      setActionState({
        kind: "error",
        message: "后台未返回可核验的状态修订号，不能安全重试这次操作。",
      });
      return;
    }

    setStatus(latest.data);
    setEtag(latestEtag);
    setLoadState({ kind: "ready" });

    if (latest.data.publicAccessEnabled === pendingOperation.targetPublicAccessEnabled) {
      setPendingOperation(null);
      setReason("");
      setActionState({ kind: "success", message: "已确认紧急操作生效，并已读取最新安全状态。" });
      return;
    }

    const stateIsUnchanged =
      latest.data.publicAccessEnabled === pendingOperation.originalPublicAccessEnabled &&
      latest.data.revision === pendingOperation.originalRevision &&
      latestEtag === pendingOperation.request.etag;
    if (!stateIsUnchanged) {
      setPendingOperation(null);
      setReason("");
      setActionState({
        kind: "error",
        message: "全局状态已被其他操作改变。已显示最新状态，请重新填写确认信息。",
      });
      return;
    }

    const retried = await adminApi.setEmergencyStatus(pendingOperation.request);
    if (!retried.ok) {
      if (retried.error.status === 401) {
        clearSession();
        return;
      }
      setActionState({
        kind: "error",
        message:
          retried.error.status === 0
            ? "操作结果仍无法确认。请保持本页打开，网络恢复后再次安全重试。"
            : describeAdminApiError(retried.error, true),
      });
      return;
    }

    const retriedEtag = retried.response.headers.get("ETag");
    if (retriedEtag === null || retriedEtag.length > 128) {
      setActionState({
        kind: "error",
        message: "操作已响应，但无法确认最新修订号。请再次读取状态。",
      });
      return;
    }
    setStatus(retried.data);
    setEtag(retriedEtag);
    setReason("");
    setPendingOperation(null);
    setActionState({ kind: "success", message: "紧急状态已更新，并已写入安全审计。" });
  }

  if (loadState.kind === "loading") {
    return (
      <p className="admin-loading" role="status">
        正在读取全局公开状态…
      </p>
    );
  }

  if (loadState.kind === "error" || status === null || etag === null) {
    return (
      <section className="admin-state-card">
        <p className="admin-kicker">CONTROL UNAVAILABLE</p>
        <h1>不能确认紧急控制状态</h1>
        <p role="alert">
          {loadState.kind === "error" ? loadState.message : "后台状态不完整，请勿执行操作。"}
        </p>
        <button
          className="admin-button admin-button--quiet"
          onClick={() => void loadStatus(true)}
          type="button"
        >
          重新读取状态
        </button>
      </section>
    );
  }

  const stopping = status.publicAccessEnabled;
  const requiredPhrase = stopping ? "停止全部公开内容" : "恢复全部公开内容";

  return (
    <div className="admin-emergency-page">
      <header className="admin-page-heading">
        <div>
          <p className="admin-kicker">GLOBAL CIRCUIT · 全局开关</p>
          <h1>紧急控制</h1>
        </div>
        <p>这是影响全部匿名访问的高风险操作，每次都需要最新状态、精确短语和操作原因。</p>
      </header>

      <section
        className={`admin-emergency-status admin-emergency-status--${stopping ? "enabled" : "stopped"}`}
        aria-labelledby="emergency-status-title"
      >
        <div className="admin-emergency-status__signal" aria-hidden="true">
          <span />
        </div>
        <div>
          <p>{stopping ? "PUBLIC ACCESS · ON" : "PUBLIC ACCESS · STOPPED"}</p>
          <h2 id="emergency-status-title">{stopping ? "公开内容正常开放" : "公开内容已经停止"}</h2>
          <p>
            修订 {status.revision} ·{" "}
            <time dateTime={status.changedAt}>
              {changedAtFormat.format(new Date(status.changedAt))}
            </time>
          </p>
          {status.reason === null ? null : <blockquote>{status.reason}</blockquote>}
        </div>
      </section>

      <section className="admin-risk-note">
        <strong>{stopping ? "停止范围" : "恢复边界"}</strong>
        <p>
          {stopping
            ? "源站会立即拒绝公开内容、海报与源站素材读取；已经下载或外部转发的副本无法召回。"
            : "只解除全局开关；每份内容仍需独立满足已发布、审核与素材安全条件。"}
        </p>
      </section>

      <form className="admin-form admin-emergency-form" onSubmit={submitControl}>
        <label>
          <span>操作原因</span>
          <textarea
            disabled={pendingOperation !== null || actionState.kind === "submitting"}
            maxLength={2000}
            onChange={(event) => setReason(event.currentTarget.value)}
            placeholder={
              stopping ? "例如：发现未审核图片，需要立即排查" : "例如：问题素材已下线并完成复核"
            }
            required
            rows={4}
            value={reason}
          />
        </label>
        <label>
          <span>确认短语</span>
          <input
            aria-label="确认短语"
            autoComplete="off"
            disabled={pendingOperation !== null || actionState.kind === "submitting"}
            onChange={(event) => setConfirmationPhrase(event.currentTarget.value)}
            placeholder={requiredPhrase}
            required
            spellCheck={false}
            type="text"
            value={confirmationPhrase}
          />
          <small>请完整输入：{requiredPhrase}</small>
        </label>
        <button
          className={`admin-button ${stopping ? "admin-button--danger" : "admin-button--primary"}`}
          disabled={pendingOperation !== null || actionState.kind === "submitting"}
          type="submit"
        >
          {actionState.kind === "submitting"
            ? "正在执行并写入审计…"
            : stopping
              ? "立即停止全部公开内容"
              : "恢复全部公开内容"}
        </button>
      </form>

      {actionState.kind === "error" ? (
        <div className="admin-message admin-message--error" role="alert">
          <p>{actionState.message}</p>
          {pendingOperation === null ? null : (
            <button
              className="admin-button admin-button--quiet"
              onClick={() => void retryPendingOperation()}
              type="button"
            >
              确认结果并安全重试
            </button>
          )}
        </div>
      ) : null}
      {actionState.kind === "success" ? (
        <p className="admin-message admin-message--success" role="status">
          {actionState.message}
        </p>
      ) : null}
    </div>
  );
}

export function EmergencyControlPanel() {
  return (
    <AdminSessionGate>
      {(session) => <EmergencyControlContent session={session} />}
    </AdminSessionGate>
  );
}
