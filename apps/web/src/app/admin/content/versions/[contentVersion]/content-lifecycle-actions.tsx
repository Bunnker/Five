"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  adminApi,
  createIdempotencyKey,
  describeAdminContentApiError,
  type AdminApiError,
  type AdminContentVersion,
  type ContentVersionList,
  type LifecycleActionResult,
} from "../../../admin-api";
import { formatAdminDateTimeWithYear } from "../../../admin-date-time";

type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

type ActionState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      action: "cancel" | "publish" | "rollback" | "schedule" | "withdraw";
      kind: "uncertain";
      message: string;
    }
  | { kind: "success"; result: LifecycleActionResult };

type ScheduleIntent = {
  body: {
    effectiveFrom: string;
    expectedActiveContentVersion: string | null;
    reason: string;
  };
  etag: string;
  idempotencyKey: string;
  previousLifecycleRevision: number;
  previousState: AdminContentVersion["state"];
};

type PublishIntent = {
  body: { expectedActiveContentVersion: string | null; reason: string };
  etag: string;
  idempotencyKey: string;
  previousLifecycleRevision: number;
  previousState: AdminContentVersion["state"];
};

type CancelIntent = {
  body: { expectedActiveContentVersion: string | null; reason: string };
  etag: string;
  idempotencyKey: string;
  previousLifecycleRevision: number;
  previousState: AdminContentVersion["state"];
};

type WithdrawIntent = {
  body: {
    expectedActiveContentVersion: string | null;
    reason: string;
    replacementContentVersion: string | null;
  };
  etag: string;
  idempotencyKey: string;
  previousLifecycleRevision: number;
  previousState: AdminContentVersion["state"];
};

type RollbackIntent = {
  body: {
    expectedActiveContentVersion: string | null;
    reason: string;
    targetContentVersion: string;
  };
  etag: string;
  idempotencyKey: string;
  previousLifecycleRevision: number;
  previousState: AdminContentVersion["state"];
};

const stateLabels: Record<string, string> = {
  approved: "可以发布",
  changes_requested: "需要修改",
  draft: "草稿",
  in_review: "待大师核对",
  published: "已上线",
  scheduled: "已安排上线",
  superseded: "已被新版本替换",
  withdrawn: "已下线",
};

function isImmediateLifecycleResult(
  item: ContentVersionList["items"][number] | undefined,
  previousLifecycleRevision: number,
) {
  return item?.lifecycleRevision === previousLifecycleRevision + 1;
}

export function ContentLifecycleActions({
  csrfToken: _csrfToken,
  etag: _etag,
  onLifecycleChange: _onLifecycleChange,
  onUnauthorized,
  onVersionRefresh,
  version,
}: {
  csrfToken: string;
  etag: string;
  onLifecycleChange: (input: { etag: string; result: LifecycleActionResult }) => void;
  onUnauthorized: () => void;
  onVersionRefresh?: () => Promise<boolean>;
  version: AdminContentVersion;
}) {
  const [versionList, setVersionList] = useState<ContentVersionList | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [publishReason, setPublishReason] = useState("");
  const [publishConfirmation, setPublishConfirmation] = useState("");
  const [scheduleReason, setScheduleReason] = useState("");
  const [scheduleConfirmation, setScheduleConfirmation] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelConfirmation, setCancelConfirmation] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");
  const [withdrawConfirmation, setWithdrawConfirmation] = useState("");
  const [replacementVersion, setReplacementVersion] = useState("");
  const [rollbackReason, setRollbackReason] = useState("");
  const [rollbackConfirmation, setRollbackConfirmation] = useState("");
  const [actionState, setActionState] = useState<ActionState>({ kind: "idle" });
  const [conflictFenced, setConflictFenced] = useState(false);
  const pendingScheduleRef = useRef<ScheduleIntent | null>(null);
  const pendingPublishRef = useRef<PublishIntent | null>(null);
  const pendingCancelRef = useRef<CancelIntent | null>(null);
  const pendingWithdrawRef = useRef<WithdrawIntent | null>(null);
  const pendingRollbackRef = useRef<RollbackIntent | null>(null);

  const loadVersions = useCallback(async (): Promise<boolean> => {
    setLoadState({ kind: "loading" });
    const result = await adminApi.listContentVersions(version.fortuneDate);
    if (!result.ok) {
      if (result.error.status === 401) {
        onUnauthorized();
        return false;
      }
      setLoadState({ kind: "error", message: describeAdminContentApiError(result.error) });
      return false;
    }
    setVersionList(result.data);
    setLoadState({ kind: "ready" });
    return true;
  }, [onUnauthorized, version.fortuneDate]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const currentSummary = versionList?.items.find(
    (item) => item.contentVersion === version.contentVersion,
  );
  const safeReplacementVersions =
    versionList?.items.filter((item) => item.state === "superseded") ?? [];
  const controlsBlocked =
    actionState.kind === "loading" || actionState.kind === "uncertain" || conflictFenced;

  function acceptLifecycleResult(result: LifecycleActionResult, latestEtag: string) {
    setVersionList((current) =>
      current === null
        ? current
        : {
            ...current,
            activeContentVersion: result.activeContentVersion,
            items: current.items.map((item) => {
              const transition = result.transitions.find(
                (candidate) => candidate.contentVersion === item.contentVersion,
              );
              return transition === undefined
                ? item
                : {
                    ...item,
                    lifecycleRevision: result.lifecycleRevision,
                    state: transition.toState,
                  };
            }),
          },
    );
    setActionState({ kind: "success", result });
    _onLifecycleChange({ etag: latestEtag, result });
  }

  async function showLifecycleActionError(error: AdminApiError) {
    if (error.status === 401) {
      onUnauthorized();
      return;
    }
    if (error.status === 409 || error.status === 412 || error.status === 428) {
      setConflictFenced(true);
      const ledgerRefreshed = await loadVersions();
      const versionRefreshed = (await onVersionRefresh?.()) ?? false;
      if (ledgerRefreshed && versionRefreshed) setConflictFenced(false);
    }
    setActionState({ kind: "error", message: describeAdminContentApiError(error) });
  }

  async function submitScheduleIntent(intent: ScheduleIntent) {
    setActionState({ kind: "loading" });
    const result = await adminApi.scheduleContentVersion({
      body: intent.body,
      contentVersion: version.contentVersion,
      csrfToken: _csrfToken,
      etag: intent.etag,
      idempotencyKey: intent.idempotencyKey,
    });
    if (!result.ok) {
      if (result.error.status === 0 || result.error.status >= 500) {
        setActionState({
          action: "schedule",
          kind: "uncertain",
          message: "排期结果暂时无法确认。完整请求与操作编号已冻结，请先核对同日账本。",
        });
        return;
      }
      pendingScheduleRef.current = null;
      await showLifecycleActionError(result.error);
      return;
    }
    const latestEtag = result.response.headers.get("ETag");
    if (latestEtag === null) {
      setActionState({ kind: "error", message: "排期已响应，但无法确认最新修订号。" });
      return;
    }
    pendingScheduleRef.current = null;
    acceptLifecycleResult(result.data, latestEtag);
  }

  async function scheduleVersion() {
    const effectiveFrom = currentSummary?.effectiveFrom ?? null;
    if (
      versionList === null ||
      effectiveFrom === null ||
      scheduleReason.trim().length === 0 ||
      scheduleConfirmation !== version.contentVersion ||
      controlsBlocked
    ) {
      return;
    }
    let idempotencyKey: string;
    try {
      idempotencyKey = createIdempotencyKey();
    } catch {
      setActionState({
        kind: "error",
        message: "当前浏览器无法生成安全操作编号，不能执行排期。",
      });
      return;
    }
    const intent: ScheduleIntent = {
      body: {
        effectiveFrom,
        expectedActiveContentVersion: versionList.activeContentVersion,
        reason: scheduleReason.trim(),
      },
      etag: _etag,
      idempotencyKey,
      previousLifecycleRevision: version.lifecycleRevision,
      previousState: version.state,
    };
    pendingScheduleRef.current = intent;
    await submitScheduleIntent(intent);
  }

  async function retrySchedule() {
    const intent = pendingScheduleRef.current;
    if (intent === null || actionState.kind !== "uncertain") return;
    setActionState({ kind: "loading" });
    const latest = await adminApi.listContentVersions(version.fortuneDate);
    if (!latest.ok) {
      if (latest.error.status === 401) {
        onUnauthorized();
        return;
      }
      setActionState({
        action: "schedule",
        kind: "uncertain",
        message: "仍无法核对同日账本。请保持本页打开，网络恢复后再次安全重试。",
      });
      return;
    }
    setVersionList(latest.data);
    const latestTarget = latest.data.items.find(
      (item) => item.contentVersion === version.contentVersion,
    );
    const intentApplied =
      latestTarget?.state === "scheduled" &&
      isImmediateLifecycleResult(latestTarget, intent.previousLifecycleRevision) &&
      latest.data.activeContentVersion === intent.body.expectedActiveContentVersion;
    const intentNotApplied =
      latestTarget?.state === intent.previousState &&
      latestTarget.lifecycleRevision === intent.previousLifecycleRevision &&
      latest.data.activeContentVersion === intent.body.expectedActiveContentVersion;
    if (!intentApplied && !intentNotApplied) {
      pendingScheduleRef.current = null;
      setConflictFenced(true);
      setActionState({
        kind: "error",
        message: "同日状态已被其他操作改变，已停止重试并要求重新读取版本。",
      });
      await onVersionRefresh?.();
      return;
    }
    await submitScheduleIntent(intent);
  }

  async function submitCancelIntent(intent: CancelIntent) {
    setActionState({ kind: "loading" });
    const result = await adminApi.cancelContentSchedule({
      body: intent.body,
      contentVersion: version.contentVersion,
      csrfToken: _csrfToken,
      etag: intent.etag,
      idempotencyKey: intent.idempotencyKey,
    });
    if (!result.ok) {
      if (result.error.status === 0 || result.error.status >= 500) {
        setActionState({
          action: "cancel",
          kind: "uncertain",
          message: "取消排期结果暂时无法确认。完整请求与操作编号已冻结，请先核对同日账本。",
        });
        return;
      }
      pendingCancelRef.current = null;
      await showLifecycleActionError(result.error);
      return;
    }
    const latestEtag = result.response.headers.get("ETag");
    if (latestEtag === null) {
      setActionState({ kind: "error", message: "取消排期已响应，但无法确认最新修订号。" });
      return;
    }
    pendingCancelRef.current = null;
    acceptLifecycleResult(result.data, latestEtag);
  }

  async function cancelSchedule() {
    if (
      versionList === null ||
      cancelReason.trim().length === 0 ||
      cancelConfirmation !== version.contentVersion ||
      controlsBlocked
    ) {
      return;
    }
    let idempotencyKey: string;
    try {
      idempotencyKey = createIdempotencyKey();
    } catch {
      setActionState({
        kind: "error",
        message: "当前浏览器无法生成安全操作编号，不能取消排期。",
      });
      return;
    }
    const intent: CancelIntent = {
      body: {
        expectedActiveContentVersion: versionList.activeContentVersion,
        reason: cancelReason.trim(),
      },
      etag: _etag,
      idempotencyKey,
      previousLifecycleRevision: version.lifecycleRevision,
      previousState: version.state,
    };
    pendingCancelRef.current = intent;
    await submitCancelIntent(intent);
  }

  async function retryCancel() {
    const intent = pendingCancelRef.current;
    if (intent === null || actionState.kind !== "uncertain") return;
    setActionState({ kind: "loading" });
    const latest = await adminApi.listContentVersions(version.fortuneDate);
    if (!latest.ok) {
      if (latest.error.status === 401) {
        onUnauthorized();
        return;
      }
      setActionState({
        action: "cancel",
        kind: "uncertain",
        message: "仍无法核对同日账本。请保持本页打开，网络恢复后再次安全重试。",
      });
      return;
    }
    setVersionList(latest.data);
    const latestTarget = latest.data.items.find(
      (item) => item.contentVersion === version.contentVersion,
    );
    const intentApplied =
      latestTarget?.state === "approved" &&
      isImmediateLifecycleResult(latestTarget, intent.previousLifecycleRevision) &&
      latest.data.activeContentVersion === intent.body.expectedActiveContentVersion;
    const intentNotApplied =
      latestTarget?.state === intent.previousState &&
      latestTarget.lifecycleRevision === intent.previousLifecycleRevision &&
      latest.data.activeContentVersion === intent.body.expectedActiveContentVersion;
    if (!intentApplied && !intentNotApplied) {
      pendingCancelRef.current = null;
      setConflictFenced(true);
      setActionState({
        kind: "error",
        message: "同日状态已被其他操作改变，已停止重试并要求重新读取版本。",
      });
      await onVersionRefresh?.();
      return;
    }
    await submitCancelIntent(intent);
  }

  async function submitWithdrawIntent(intent: WithdrawIntent) {
    setActionState({ kind: "loading" });
    const result = await adminApi.withdrawContentVersion({
      body: intent.body,
      contentVersion: version.contentVersion,
      csrfToken: _csrfToken,
      etag: intent.etag,
      idempotencyKey: intent.idempotencyKey,
    });
    if (!result.ok) {
      if (result.error.status === 0 || result.error.status >= 500) {
        setActionState({
          action: "withdraw",
          kind: "uncertain",
          message: "下线结果暂时无法确认。完整请求与操作编号已冻结，请先核对同日账本。",
        });
        return;
      }
      pendingWithdrawRef.current = null;
      await showLifecycleActionError(result.error);
      return;
    }
    const latestEtag = result.response.headers.get("ETag");
    if (latestEtag === null) {
      setActionState({ kind: "error", message: "下线已响应，但无法确认最新修订号。" });
      return;
    }
    pendingWithdrawRef.current = null;
    acceptLifecycleResult(result.data, latestEtag);
  }

  async function withdrawVersion() {
    if (
      versionList === null ||
      versionList.activeContentVersion !== version.contentVersion ||
      withdrawReason.trim().length === 0 ||
      withdrawConfirmation !== version.contentVersion ||
      controlsBlocked
    ) {
      return;
    }
    let idempotencyKey: string;
    try {
      idempotencyKey = createIdempotencyKey();
    } catch {
      setActionState({
        kind: "error",
        message: "当前浏览器无法生成安全操作编号，不能执行整版下线。",
      });
      return;
    }
    const intent: WithdrawIntent = {
      body: {
        expectedActiveContentVersion: versionList.activeContentVersion,
        reason: withdrawReason.trim(),
        replacementContentVersion: replacementVersion || null,
      },
      etag: _etag,
      idempotencyKey,
      previousLifecycleRevision: version.lifecycleRevision,
      previousState: version.state,
    };
    pendingWithdrawRef.current = intent;
    await submitWithdrawIntent(intent);
  }

  async function retryWithdraw() {
    const intent = pendingWithdrawRef.current;
    if (intent === null || actionState.kind !== "uncertain") return;
    setActionState({ kind: "loading" });
    const latest = await adminApi.listContentVersions(version.fortuneDate);
    if (!latest.ok) {
      if (latest.error.status === 401) {
        onUnauthorized();
        return;
      }
      setActionState({
        action: "withdraw",
        kind: "uncertain",
        message: "仍无法核对同日账本。请保持本页打开，网络恢复后再次安全重试。",
      });
      return;
    }
    setVersionList(latest.data);
    const latestTarget = latest.data.items.find(
      (item) => item.contentVersion === version.contentVersion,
    );
    const intentApplied =
      latestTarget?.state === "withdrawn" &&
      isImmediateLifecycleResult(latestTarget, intent.previousLifecycleRevision) &&
      latest.data.activeContentVersion === intent.body.replacementContentVersion;
    const intentNotApplied =
      latestTarget?.state === intent.previousState &&
      latestTarget.lifecycleRevision === intent.previousLifecycleRevision &&
      latest.data.activeContentVersion === intent.body.expectedActiveContentVersion;
    if (!intentApplied && !intentNotApplied) {
      pendingWithdrawRef.current = null;
      setConflictFenced(true);
      setActionState({
        kind: "error",
        message: "同日状态已被其他操作改变，已停止重试并要求重新读取版本。",
      });
      await onVersionRefresh?.();
      return;
    }
    await submitWithdrawIntent(intent);
  }

  async function submitRollbackIntent(intent: RollbackIntent) {
    setActionState({ kind: "loading" });
    const result = await adminApi.rollbackContentDay({
      body: intent.body,
      contentVersion: version.contentVersion,
      csrfToken: _csrfToken,
      etag: intent.etag,
      fortuneDate: version.fortuneDate,
      idempotencyKey: intent.idempotencyKey,
    });
    if (!result.ok) {
      if (result.error.status === 0 || result.error.status >= 500) {
        setActionState({
          action: "rollback",
          kind: "uncertain",
          message: "恢复结果暂时无法确认。完整请求与操作编号已冻结，请先核对同日账本。",
        });
        return;
      }
      pendingRollbackRef.current = null;
      await showLifecycleActionError(result.error);
      return;
    }
    const latestEtag = result.response.headers.get("ETag");
    if (latestEtag === null) {
      setActionState({ kind: "error", message: "恢复已响应，但无法确认最新修订号。" });
      return;
    }
    pendingRollbackRef.current = null;
    acceptLifecycleResult(result.data, latestEtag);
  }

  async function rollbackVersion() {
    if (
      versionList === null ||
      currentSummary?.state !== "superseded" ||
      rollbackReason.trim().length === 0 ||
      rollbackConfirmation !== version.contentVersion ||
      controlsBlocked
    ) {
      return;
    }
    let idempotencyKey: string;
    try {
      idempotencyKey = createIdempotencyKey();
    } catch {
      setActionState({
        kind: "error",
        message: "当前浏览器无法生成安全操作编号，不能恢复历史版本。",
      });
      return;
    }
    const intent: RollbackIntent = {
      body: {
        expectedActiveContentVersion: versionList.activeContentVersion,
        reason: rollbackReason.trim(),
        targetContentVersion: version.contentVersion,
      },
      etag: _etag,
      idempotencyKey,
      previousLifecycleRevision: version.lifecycleRevision,
      previousState: version.state,
    };
    pendingRollbackRef.current = intent;
    await submitRollbackIntent(intent);
  }

  async function retryRollback() {
    const intent = pendingRollbackRef.current;
    if (intent === null || actionState.kind !== "uncertain") return;
    setActionState({ kind: "loading" });
    const latest = await adminApi.listContentVersions(version.fortuneDate);
    if (!latest.ok) {
      if (latest.error.status === 401) {
        onUnauthorized();
        return;
      }
      setActionState({
        action: "rollback",
        kind: "uncertain",
        message: "仍无法核对同日账本。请保持本页打开，网络恢复后再次安全重试。",
      });
      return;
    }
    setVersionList(latest.data);
    const latestTarget = latest.data.items.find(
      (item) => item.contentVersion === version.contentVersion,
    );
    const intentApplied =
      latestTarget?.state === "published" &&
      isImmediateLifecycleResult(latestTarget, intent.previousLifecycleRevision) &&
      latest.data.activeContentVersion === intent.body.targetContentVersion;
    const intentNotApplied =
      latestTarget?.state === intent.previousState &&
      latestTarget.lifecycleRevision === intent.previousLifecycleRevision &&
      latest.data.activeContentVersion === intent.body.expectedActiveContentVersion;
    if (!intentApplied && !intentNotApplied) {
      pendingRollbackRef.current = null;
      setConflictFenced(true);
      setActionState({
        kind: "error",
        message: "同日状态已被其他操作改变，已停止重试并要求重新读取版本。",
      });
      await onVersionRefresh?.();
      return;
    }
    await submitRollbackIntent(intent);
  }

  async function submitPublishIntent(intent: PublishIntent) {
    setActionState({ kind: "loading" });
    const result = await adminApi.publishContentVersion({
      body: intent.body,
      contentVersion: version.contentVersion,
      csrfToken: _csrfToken,
      etag: intent.etag,
      idempotencyKey: intent.idempotencyKey,
    });
    if (!result.ok) {
      if (result.error.status === 0 || result.error.status >= 500) {
        setActionState({
          action: "publish",
          kind: "uncertain",
          message: "发布结果暂时无法确认。原因与操作编号已冻结，请先核对同日账本。",
        });
        return;
      }
      pendingPublishRef.current = null;
      await showLifecycleActionError(result.error);
      return;
    }
    const latestEtag = result.response.headers.get("ETag");
    if (latestEtag === null) {
      setActionState({ kind: "error", message: "发布已响应，但无法确认最新修订号。" });
      return;
    }
    pendingPublishRef.current = null;
    acceptLifecycleResult(result.data, latestEtag);
  }

  async function publishNow() {
    if (
      versionList === null ||
      publishReason.trim().length === 0 ||
      publishConfirmation !== version.contentVersion ||
      controlsBlocked
    ) {
      return;
    }
    let idempotencyKey: string;
    try {
      idempotencyKey = createIdempotencyKey();
    } catch {
      setActionState({
        kind: "error",
        message: "当前浏览器无法生成安全操作编号，不能执行发布。",
      });
      return;
    }
    const intent: PublishIntent = {
      body: {
        expectedActiveContentVersion: versionList.activeContentVersion,
        reason: publishReason.trim(),
      },
      etag: _etag,
      idempotencyKey,
      previousLifecycleRevision: version.lifecycleRevision,
      previousState: version.state,
    };
    pendingPublishRef.current = intent;
    await submitPublishIntent(intent);
  }

  async function retryPublish() {
    const intent = pendingPublishRef.current;
    if (intent === null || actionState.kind !== "uncertain") return;
    setActionState({ kind: "loading" });
    const latest = await adminApi.listContentVersions(version.fortuneDate);
    if (!latest.ok) {
      if (latest.error.status === 401) {
        onUnauthorized();
        return;
      }
      setActionState({
        action: "publish",
        kind: "uncertain",
        message: "仍无法核对同日账本。请保持本页打开，网络恢复后再次安全重试。",
      });
      return;
    }
    setVersionList(latest.data);
    const latestTarget = latest.data.items.find(
      (item) => item.contentVersion === version.contentVersion,
    );
    const intentApplied =
      latestTarget?.state === "published" &&
      isImmediateLifecycleResult(latestTarget, intent.previousLifecycleRevision) &&
      latest.data.activeContentVersion === version.contentVersion;
    const intentNotApplied =
      latestTarget?.state === intent.previousState &&
      latestTarget.lifecycleRevision === intent.previousLifecycleRevision &&
      latest.data.activeContentVersion === intent.body.expectedActiveContentVersion;
    if (!intentApplied && !intentNotApplied) {
      pendingPublishRef.current = null;
      setConflictFenced(true);
      setActionState({
        kind: "error",
        message: "同日状态已被其他操作改变，已停止重试并要求重新读取版本。",
      });
      await onVersionRefresh?.();
      return;
    }
    await submitPublishIntent(intent);
  }

  return (
    <section
      className="admin-content-panel admin-lifecycle-panel"
      aria-labelledby="lifecycle-title"
    >
      <div className="admin-section-heading">
        <p className="admin-kicker">05 · RELEASE CONTROL</p>
        <h2 id="lifecycle-title">上线控制</h2>
      </div>
      {loadState.kind === "loading" ? (
        <p className="admin-content-empty" role="status">
          正在读取同日版本与在线状态…
        </p>
      ) : null}
      {loadState.kind === "error" ? (
        <div className="admin-message admin-message--error" role="alert">
          <p>{loadState.message}</p>
          <button className="admin-button admin-button--quiet" onClick={() => void loadVersions()}>
            重新读取同日版本
          </button>
        </div>
      ) : null}
      {loadState.kind === "ready" && versionList !== null ? (
        <div className="admin-lifecycle-actions">
          <p className="admin-inline-note">
            当前在线版本：{versionList.activeContentVersion ?? "暂无公开版本"}
          </p>
          {version.state === "approved" || version.state === "scheduled" ? (
            <div className="admin-lifecycle-action-grid">
              {version.state === "approved" ? (
                <article className="admin-lifecycle-action-card">
                  <h3>定时上线</h3>
                  {currentSummary?.effectiveFrom === null || currentSummary === undefined ? (
                    <p className="admin-message admin-message--error" role="alert">
                      服务端尚未返回这份版本的规范生效时间，已阻止浏览器自行推算。
                    </p>
                  ) : (
                    <p className="admin-lifecycle-effective-time">
                      服务端生效时间
                      <strong>{formatAdminDateTimeWithYear(currentSummary.effectiveFrom)}</strong>
                    </p>
                  )}
                  <label>
                    <span>排期原因</span>
                    <textarea
                      aria-label="排期原因"
                      disabled={controlsBlocked}
                      maxLength={2000}
                      onChange={(event) => setScheduleReason(event.currentTarget.value)}
                      value={scheduleReason}
                    />
                  </label>
                  <label>
                    <span>输入内容版本以确认排期</span>
                    <input
                      aria-label="输入内容版本以确认排期"
                      autoComplete="off"
                      disabled={controlsBlocked}
                      onChange={(event) => setScheduleConfirmation(event.currentTarget.value)}
                      spellCheck={false}
                      value={scheduleConfirmation}
                    />
                    <small>请完整输入 {version.contentVersion}</small>
                  </label>
                  <button
                    className="admin-button admin-button--quiet"
                    disabled={
                      controlsBlocked ||
                      currentSummary?.effectiveFrom == null ||
                      scheduleReason.trim().length === 0 ||
                      scheduleConfirmation !== version.contentVersion
                    }
                    onClick={() => void scheduleVersion()}
                    type="button"
                  >
                    {actionState.kind === "loading" ? "正在排期…" : "安排定时上线"}
                  </button>
                </article>
              ) : (
                <article className="admin-lifecycle-action-card">
                  <h3>取消排期</h3>
                  <p>取消后回到“可以发布”，不会删除不可变版本。</p>
                  <label>
                    <span>取消排期原因</span>
                    <textarea
                      aria-label="取消排期原因"
                      disabled={controlsBlocked}
                      maxLength={2000}
                      onChange={(event) => setCancelReason(event.currentTarget.value)}
                      value={cancelReason}
                    />
                  </label>
                  <label>
                    <span>输入内容版本以确认取消排期</span>
                    <input
                      aria-label="输入内容版本以确认取消排期"
                      autoComplete="off"
                      disabled={controlsBlocked}
                      onChange={(event) => setCancelConfirmation(event.currentTarget.value)}
                      spellCheck={false}
                      value={cancelConfirmation}
                    />
                    <small>请完整输入 {version.contentVersion}</small>
                  </label>
                  <button
                    className="admin-button admin-button--quiet"
                    disabled={
                      controlsBlocked ||
                      cancelReason.trim().length === 0 ||
                      cancelConfirmation !== version.contentVersion
                    }
                    onClick={() => void cancelSchedule()}
                    type="button"
                  >
                    {actionState.kind === "loading" ? "正在取消…" : "取消排期"}
                  </button>
                </article>
              )}
              <article className="admin-lifecycle-action-card admin-lifecycle-action-card--primary">
                <h3>立即发布</h3>
                <label>
                  <span>发布原因</span>
                  <textarea
                    aria-label="发布原因"
                    disabled={controlsBlocked}
                    maxLength={2000}
                    onChange={(event) => setPublishReason(event.currentTarget.value)}
                    value={publishReason}
                  />
                </label>
                <label>
                  <span>输入内容版本以确认发布</span>
                  <input
                    aria-label="输入内容版本以确认发布"
                    autoComplete="off"
                    disabled={controlsBlocked}
                    onChange={(event) => setPublishConfirmation(event.currentTarget.value)}
                    spellCheck={false}
                    value={publishConfirmation}
                  />
                  <small>请完整输入 {version.contentVersion}</small>
                </label>
                <button
                  className="admin-button admin-button--primary"
                  disabled={
                    controlsBlocked ||
                    publishReason.trim().length === 0 ||
                    publishConfirmation !== version.contentVersion
                  }
                  onClick={() => void publishNow()}
                  type="button"
                >
                  {actionState.kind === "loading" ? "正在发布…" : "立即发布"}
                </button>
              </article>
            </div>
          ) : null}
          {version.state === "published" ? (
            versionList.activeContentVersion === version.contentVersion ? (
              <article className="admin-lifecycle-action-card admin-lifecycle-action-card--danger">
                <h3>整版下线</h3>
                <p>不选择替代版本时，公开端进入内容校验中；只能选择服务端返回的同日历史版本。</p>
                <label>
                  <span>下线后恢复的安全旧版本（可选）</span>
                  <select
                    aria-label="下线后恢复的安全旧版本（可选）"
                    disabled={controlsBlocked}
                    onChange={(event) => setReplacementVersion(event.currentTarget.value)}
                    value={replacementVersion}
                  >
                    <option value="">不恢复旧版本</option>
                    {safeReplacementVersions.map((item) => (
                      <option key={item.contentVersion} value={item.contentVersion}>
                        {item.contentVersion}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>下线原因</span>
                  <textarea
                    aria-label="下线原因"
                    disabled={controlsBlocked}
                    maxLength={2000}
                    onChange={(event) => setWithdrawReason(event.currentTarget.value)}
                    value={withdrawReason}
                  />
                </label>
                <label>
                  <span>输入内容版本以确认下线</span>
                  <input
                    aria-label="输入内容版本以确认下线"
                    autoComplete="off"
                    disabled={controlsBlocked}
                    onChange={(event) => setWithdrawConfirmation(event.currentTarget.value)}
                    spellCheck={false}
                    value={withdrawConfirmation}
                  />
                  <small>请完整输入 {version.contentVersion}</small>
                </label>
                <button
                  className="admin-button admin-button--danger"
                  disabled={
                    controlsBlocked ||
                    withdrawReason.trim().length === 0 ||
                    withdrawConfirmation !== version.contentVersion
                  }
                  onClick={() => void withdrawVersion()}
                  type="button"
                >
                  {actionState.kind === "loading" ? "正在下线…" : "下线当前版本"}
                </button>
              </article>
            ) : (
              <p className="admin-message admin-message--error" role="alert">
                服务端显示这份版本已不再是当前在线版本，已阻止下线操作。
              </p>
            )
          ) : null}
          {version.state === "superseded" ? (
            currentSummary?.state === "superseded" ? (
              <article className="admin-lifecycle-action-card admin-lifecycle-action-card--restore">
                <h3>恢复历史版本</h3>
                <p>服务端会再次检查图片、权利、入口和全部发布门槛，再原子切换在线版本。</p>
                <label>
                  <span>恢复原因</span>
                  <textarea
                    aria-label="恢复原因"
                    disabled={controlsBlocked}
                    maxLength={2000}
                    onChange={(event) => setRollbackReason(event.currentTarget.value)}
                    value={rollbackReason}
                  />
                </label>
                <label>
                  <span>输入内容版本以确认恢复</span>
                  <input
                    aria-label="输入内容版本以确认恢复"
                    autoComplete="off"
                    disabled={controlsBlocked}
                    onChange={(event) => setRollbackConfirmation(event.currentTarget.value)}
                    spellCheck={false}
                    value={rollbackConfirmation}
                  />
                  <small>请完整输入 {version.contentVersion}</small>
                </label>
                <button
                  className="admin-button admin-button--primary"
                  disabled={
                    controlsBlocked ||
                    rollbackReason.trim().length === 0 ||
                    rollbackConfirmation !== version.contentVersion
                  }
                  onClick={() => void rollbackVersion()}
                  type="button"
                >
                  {actionState.kind === "loading" ? "正在恢复…" : "恢复这个历史版本"}
                </button>
              </article>
            ) : (
              <p className="admin-message admin-message--error" role="alert">
                同日版本账本不再把这份版本标记为可恢复历史，已阻止操作。
              </p>
            )
          ) : null}
          {version.state === "withdrawn" ? (
            <div className="admin-lifecycle-terminal">
              <strong>已下线版本不能直接恢复或重新发布。</strong>
              <p>如需重新使用其中内容，请复制为新草稿并重新完成全部核对。</p>
            </div>
          ) : null}
          {actionState.kind === "error" ? (
            <p className="admin-message admin-message--error" role="alert">
              {actionState.message}
            </p>
          ) : null}
          {actionState.kind === "uncertain" ? (
            <div className="admin-message admin-message--error" role="alert">
              <p>{actionState.message}</p>
              <button
                className="admin-button admin-button--quiet"
                onClick={() => {
                  if (actionState.action === "publish") void retryPublish();
                  else if (actionState.action === "schedule") void retrySchedule();
                  else if (actionState.action === "cancel") void retryCancel();
                  else if (actionState.action === "withdraw") void retryWithdraw();
                  else void retryRollback();
                }}
                type="button"
              >
                确认状态并安全重试
                {actionState.action === "publish"
                  ? "发布"
                  : actionState.action === "schedule"
                    ? "排期"
                    : actionState.action === "cancel"
                      ? "取消排期"
                      : actionState.action === "withdraw"
                        ? "下线"
                        : "恢复"}
              </button>
            </div>
          ) : null}
          {actionState.kind === "success" ? (
            <div className="admin-lifecycle-result" role="status">
              <strong>操作已完成</strong>
              <code>{actionState.result.auditEventId}</code>
              <ul>
                {actionState.result.transitions.map((transition) => (
                  <li
                    key={`${transition.contentVersion}-${transition.fromState}-${transition.toState}`}
                  >
                    {transition.contentVersion} · {stateLabels[transition.fromState]} →{" "}
                    {stateLabels[transition.toState]}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
