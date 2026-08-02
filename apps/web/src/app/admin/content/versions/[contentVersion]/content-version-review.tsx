"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  adminApi,
  createIdempotencyKey,
  describeAdminContentApiError,
  type AdminContentVersion,
  type AdminSession,
} from "../../../admin-api";
import { formatAdminDateTimeWithYear, shanghaiLocalDateTimeToIso } from "../../../admin-date-time";
import { AdminSessionGate } from "../../../admin-session-gate";
import { useAdminSession } from "../../../admin-session-context";
import { AdminDailyImageSetPanel } from "./admin-daily-image-set";

type UiState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

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

const checkLabels: Record<string, string> = {
  ai_label: "AI 标识",
  calendar_algorithm: "日历与算法",
  calendar_golden_data: "日历标准答案",
  copy_and_formula: "文案与穿法",
  master_review_evidence: "大师核对凭证",
  poster_consistency: "海报一致性",
  reference_integrity: "引用完整性",
  required_images: "必备图片",
  visual_and_rights: "视觉与权利",
};

const moduleLabels = {
  calendar_algorithm: "日历与算法",
  copy_and_formula: "文案与穿法",
  poster_consistency: "海报一致性",
  visual_and_rights: "视觉与权利",
} as const;

function ContentVersionReviewContent({
  contentVersion,
  session,
}: {
  contentVersion: string;
  session: AdminSession;
}) {
  const { clearSession } = useAdminSession();
  const [version, setVersion] = useState<AdminContentVersion | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<UiState>({ kind: "loading" });
  const [evidenceState, setEvidenceState] = useState<UiState>({ kind: "idle" });
  const [decisionState, setDecisionState] = useState<UiState>({ kind: "idle" });
  const [copyState, setCopyState] = useState<UiState>({ kind: "idle" });
  const [reviewerDisplayName, setReviewerDisplayName] = useState("");
  const [reviewedAt, setReviewedAt] = useState("");
  const [conclusion, setConclusion] = useState<"confirmed" | "changes_requested">("confirmed");
  const [notes, setNotes] = useState("");
  const [referenceKind, setReferenceKind] = useState<
    "attachment" | "message_link" | "document" | "note"
  >("message_link");
  const [reference, setReference] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [copiedDraftId, setCopiedDraftId] = useState<string | null>(null);
  const [copyOutcomeUncertain, setCopyOutcomeUncertain] = useState(false);
  const [evidenceRetryPending, setEvidenceRetryPending] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<"approved" | "changes_requested" | null>(
    null,
  );
  const pendingEvidenceKeyRef = useRef<string | null>(null);
  const pendingDecisionKeyRef = useRef<string | null>(null);

  const loadVersion = useCallback(async () => {
    setLoadState({ kind: "loading" });
    const result = await adminApi.getContentVersion(contentVersion);
    if (!result.ok) {
      if (result.error.status === 401) {
        clearSession();
        return;
      }
      setLoadState({ kind: "error", message: describeAdminContentApiError(result.error) });
      return;
    }
    const latestEtag = result.response.headers.get("ETag");
    if (latestEtag === null) {
      setLoadState({ kind: "error", message: "后台没有返回生命周期修订凭据，已阻止核对操作。" });
      return;
    }
    setVersion(result.data);
    setEtag(latestEtag);
    setLoadState({ kind: "idle" });
  }, [clearSession, contentVersion]);

  useEffect(() => {
    void loadVersion();
  }, [loadVersion]);

  const synchronizeImageLifecycle = useCallback(
    (input: { etag: string; lifecycleRevision: number }) => {
      setEtag(input.etag);
      setVersion((current) =>
        current === null ? current : { ...current, lifecycleRevision: input.lifecycleRevision },
      );
      void loadVersion();
    },
    [loadVersion],
  );

  async function addEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (version === null || etag === null || evidenceState.kind === "loading") return;
    if (reviewerDisplayName.trim().length === 0) {
      setEvidenceState({ kind: "error", message: "请填写大师称呼。" });
      return;
    }
    if (reference.trim().length === 0) {
      setEvidenceState({ kind: "error", message: "至少填写一个凭证引用。" });
      return;
    }
    const reviewedAtIso = shanghaiLocalDateTimeToIso(reviewedAt);
    if (reviewedAtIso === null) {
      setEvidenceState({ kind: "error", message: "请填写有效的核对时间。" });
      return;
    }
    if (pendingEvidenceKeyRef.current === null) {
      try {
        pendingEvidenceKeyRef.current = createIdempotencyKey();
      } catch {
        setEvidenceState({
          kind: "error",
          message: "当前浏览器无法生成安全操作编号，不能登记凭证。",
        });
        return;
      }
    }
    const idempotencyKey = pendingEvidenceKeyRef.current;
    setEvidenceState({ kind: "loading" });
    const result = await adminApi.addMasterReviewEvidence({
      body: {
        conclusion,
        notes: notes.trim(),
        references: [{ kind: referenceKind, reference: reference.trim() }],
        reviewedAt: reviewedAtIso,
        reviewerDisplayName: reviewerDisplayName.trim(),
      },
      contentVersion: version.contentVersion,
      csrfToken: session.csrfToken,
      etag,
      idempotencyKey,
    });
    if (!result.ok) {
      if (result.error.status === 401) {
        clearSession();
        return;
      }
      const outcomeUncertain = result.error.status === 0 || result.error.status >= 500;
      if (!outcomeUncertain) pendingEvidenceKeyRef.current = null;
      setEvidenceRetryPending(outcomeUncertain);
      if (result.error.status === 412) await loadVersion();
      setEvidenceState({
        kind: "error",
        message: outcomeUncertain
          ? "登记结果暂时无法确认。请保持内容不变并再次登记，系统会复用同一操作编号。"
          : describeAdminContentApiError(result.error),
      });
      return;
    }
    const latestEtag = result.response.headers.get("ETag");
    if (latestEtag === null) {
      setEvidenceState({
        kind: "error",
        message: "凭证已响应，但无法确认最新修订号，请重新读取。",
      });
      return;
    }
    pendingEvidenceKeyRef.current = null;
    setEvidenceRetryPending(false);
    setVersion(result.data);
    setEtag(latestEtag);
    setReviewerDisplayName("");
    setReviewedAt("");
    setNotes("");
    setReference("");
    setEvidenceState({ kind: "success", message: "大师核对凭证已登记并写入不可变审计。" });
  }

  async function decideReview(decision: "approved" | "changes_requested") {
    if (version === null || etag === null || decisionState.kind === "loading") return;
    if (pendingDecision !== null && pendingDecision !== decision) return;
    if (decision === "changes_requested" && returnReason.trim().length === 0) {
      setDecisionState({ kind: "error", message: "请填写退回原因，原版本会保持不可修改。" });
      return;
    }
    if (pendingDecisionKeyRef.current === null) {
      try {
        pendingDecisionKeyRef.current = createIdempotencyKey();
      } catch {
        setDecisionState({
          kind: "error",
          message: "当前浏览器无法生成安全操作编号，不能提交结论。",
        });
        return;
      }
    }
    const idempotencyKey = pendingDecisionKeyRef.current;
    setDecisionState({ kind: "loading" });
    const result = await adminApi.decideContentReview({
      body: { decision, reason: decision === "changes_requested" ? returnReason.trim() : null },
      contentVersion: version.contentVersion,
      csrfToken: session.csrfToken,
      etag,
      idempotencyKey,
    });
    if (!result.ok) {
      if (result.error.status === 401) {
        clearSession();
        return;
      }
      const outcomeUncertain = result.error.status === 0 || result.error.status >= 500;
      if (outcomeUncertain) {
        setPendingDecision(decision);
      } else {
        pendingDecisionKeyRef.current = null;
        setPendingDecision(null);
      }
      if (result.error.status === 412) await loadVersion();
      setDecisionState({
        kind: "error",
        message: outcomeUncertain
          ? "核对结论的结果暂时无法确认。再次执行同一结论会复用原操作编号。"
          : describeAdminContentApiError(result.error),
      });
      return;
    }
    const latestEtag = result.response.headers.get("ETag");
    if (latestEtag === null) {
      setDecisionState({
        kind: "error",
        message: "结论已响应，但无法确认最新修订号，请重新读取。",
      });
      return;
    }
    pendingDecisionKeyRef.current = null;
    setPendingDecision(null);
    setEtag(latestEtag);
    setVersion((current) =>
      current === null
        ? current
        : {
            ...current,
            activeContentVersion: result.data.activeContentVersion,
            lifecycleRevision: result.data.lifecycleRevision,
            state: result.data.state,
          },
    );
    setReturnReason("");
    setDecisionState({
      kind: "success",
      message:
        decision === "approved" ? "内容已批准，可以进入发布流程。" : "版本已退回，必须复制后修改。",
    });
  }

  async function copyToDraft() {
    if (version === null || copyState.kind === "loading" || copyOutcomeUncertain) return;
    setCopyState({ kind: "loading" });
    const result = await adminApi.createDraft({
      csrfToken: session.csrfToken,
      input: {
        copyFromContentVersion: version.contentVersion,
        fortuneDate: version.fortuneDate,
      },
    });
    if (!result.ok) {
      if (result.error.status === 401) {
        clearSession();
        return;
      }
      const outcomeUncertain = result.error.status === 0 || result.error.status >= 500;
      setCopyOutcomeUncertain(outcomeUncertain);
      setCopyState({
        kind: "error",
        message: outcomeUncertain
          ? "复制结果暂时无法确认。请先检查草稿队列，不要重复复制。"
          : describeAdminContentApiError(result.error),
      });
      return;
    }
    setCopyOutcomeUncertain(false);
    setCopiedDraftId(result.data.draftId);
    setCopyState({ kind: "success", message: "已从不可变版本复制出一份独立新草稿。" });
  }

  if (loadState.kind === "loading") {
    return (
      <p className="admin-loading" role="status">
        正在读取不可变版本…
      </p>
    );
  }

  if (loadState.kind === "error" || version === null || etag === null) {
    return (
      <section className="admin-state-card">
        <p className="admin-kicker">VERSION UNAVAILABLE</p>
        <h1>无法读取内容版本</h1>
        <p role="alert">
          {loadState.kind === "error" ? loadState.message : "版本响应不完整，已阻止核对操作。"}
        </p>
        <button
          className="admin-button admin-button--quiet"
          onClick={() => void loadVersion()}
          type="button"
        >
          重新读取
        </button>
      </section>
    );
  }

  return (
    <div className="admin-content-page admin-version-review">
      <header className="admin-page-heading">
        <div>
          <p className="admin-kicker">IMMUTABLE VERSION · {version.fortuneDate}</p>
          <h1>核对内容版本</h1>
        </div>
        <div className="admin-version-heading-status">
          <span className={`admin-status-badge admin-status-badge--content-${version.state}`}>
            {stateLabels[version.state] ?? version.state}
          </span>
          <code>{version.contentVersion}</code>
          <small>
            生命周期修订 {version.lifecycleRevision} · {etag}
          </small>
        </div>
      </header>

      <section className="admin-content-panel" aria-labelledby="snapshot-title">
        <div className="admin-section-heading">
          <p className="admin-kicker">01 · FROZEN SNAPSHOT</p>
          <h2 id="snapshot-title">不可变快照</h2>
        </div>
        <p className="admin-inline-note">
          以下内容只读；任何修改都必须通过新草稿产生新的内容版本。
        </p>
        <div className="admin-snapshot-grid">
          {Object.entries(moduleLabels).map(([code, label]) => {
            const module = version.snapshot[code as keyof typeof moduleLabels];
            return (
              <details key={code}>
                <summary>
                  <span>{label}</span>
                  <strong>{module === null ? "未提供" : "已冻结"}</strong>
                </summary>
                <pre>{module === null ? "null" : JSON.stringify(module, null, 2)}</pre>
              </details>
            );
          })}
        </div>
      </section>

      <AdminDailyImageSetPanel
        activeContentVersion={version.activeContentVersion}
        contentVersion={version.contentVersion}
        csrfToken={session.csrfToken}
        enabled={version.snapshot.visual_and_rights !== null}
        onLifecycleChange={synchronizeImageLifecycle}
        onUnauthorized={clearSession}
        versionState={version.state}
      />

      <section className="admin-content-panel" aria-labelledby="preflight-title">
        <div className="admin-section-heading">
          <p className="admin-kicker">03 · PREFLIGHT</p>
          <h2 id="preflight-title">必审检查</h2>
        </div>
        {version.preflightChecks.length === 0 ? (
          <p className="admin-content-empty">还没有检查结果。</p>
        ) : (
          <ul className="admin-preflight-list">
            {version.preflightChecks.map((check) => (
              <li key={check.code}>
                <span
                  className={`admin-check-mark admin-check-mark--${check.status}`}
                  aria-hidden="true"
                />
                <div>
                  <strong>{checkLabels[check.code] ?? check.code}</strong>
                  <p>{check.message}</p>
                </div>
                <small>
                  {check.status === "passed"
                    ? "通过"
                    : check.status === "failed"
                      ? "未通过"
                      : "等待"}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-content-panel" aria-labelledby="evidence-title">
        <div className="admin-section-heading">
          <p className="admin-kicker">04 · MASTER EVIDENCE</p>
          <h2 id="evidence-title">大师外部核对凭证</h2>
        </div>
        {version.masterReviewEvidence.length === 0 ? (
          <p className="admin-content-empty">尚未登记凭证；没有凭证不能批准。</p>
        ) : (
          <ol className="admin-evidence-list">
            {version.masterReviewEvidence.map((evidence) => (
              <li key={evidence.evidenceId}>
                <header>
                  <strong>{evidence.reviewerDisplayName}</strong>
                  <span>{evidence.conclusion === "confirmed" ? "确认无误" : "要求修改"}</span>
                </header>
                <time dateTime={evidence.reviewedAt}>
                  {formatAdminDateTimeWithYear(evidence.reviewedAt)}
                </time>
                {evidence.notes.length > 0 ? <p>{evidence.notes}</p> : null}
                <ul>
                  {evidence.references.map((item, index) => (
                    <li key={`${item.kind}-${index}`}>
                      <code>{item.kind}</code> {item.reference}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}

        {version.state === "in_review" ? (
          <form className="admin-form admin-evidence-form" onSubmit={addEvidence}>
            <div className="admin-form-row">
              <label>
                <span>大师称呼</span>
                <input
                  aria-label="大师称呼"
                  disabled={evidenceRetryPending}
                  maxLength={80}
                  onChange={(event) => setReviewerDisplayName(event.currentTarget.value)}
                  required
                  value={reviewerDisplayName}
                />
              </label>
              <label>
                <span>核对时间</span>
                <input
                  aria-label="核对时间"
                  disabled={evidenceRetryPending}
                  onChange={(event) => setReviewedAt(event.currentTarget.value)}
                  required
                  type="datetime-local"
                  value={reviewedAt}
                />
              </label>
            </div>
            <div className="admin-form-row">
              <label>
                <span>结论</span>
                <select
                  aria-label="结论"
                  disabled={evidenceRetryPending}
                  onChange={(event) =>
                    setConclusion(event.currentTarget.value as "confirmed" | "changes_requested")
                  }
                  value={conclusion}
                >
                  <option value="confirmed">确认无误</option>
                  <option value="changes_requested">要求修改</option>
                </select>
              </label>
              <label>
                <span>凭证类型</span>
                <select
                  aria-label="凭证类型"
                  disabled={evidenceRetryPending}
                  onChange={(event) =>
                    setReferenceKind(
                      event.currentTarget.value as
                        "attachment" | "message_link" | "document" | "note",
                    )
                  }
                  value={referenceKind}
                >
                  <option value="message_link">消息链接</option>
                  <option value="document">文档</option>
                  <option value="attachment">附件引用</option>
                  <option value="note">备注编号</option>
                </select>
              </label>
            </div>
            <label>
              <span>凭证引用</span>
              <input
                aria-label="凭证引用"
                disabled={evidenceRetryPending}
                maxLength={500}
                onChange={(event) => setReference(event.currentTarget.value)}
                placeholder="至少一个消息链接、文档、附件或备注引用"
                required
                value={reference}
              />
            </label>
            <label>
              <span>备注</span>
              <textarea
                aria-label="备注"
                disabled={evidenceRetryPending}
                maxLength={2000}
                onChange={(event) => setNotes(event.currentTarget.value)}
                rows={4}
                value={notes}
              />
            </label>
            <button
              className="admin-button admin-button--quiet"
              disabled={evidenceState.kind === "loading"}
              type="submit"
            >
              {evidenceState.kind === "loading" ? "正在登记…" : "登记核对凭证"}
            </button>
          </form>
        ) : null}
        {evidenceState.kind === "error" ? (
          <p className="admin-message admin-message--error" role="alert">
            {evidenceState.message}
          </p>
        ) : null}
        {evidenceState.kind === "success" ? (
          <p className="admin-message admin-message--success" role="status">
            {evidenceState.message}
          </p>
        ) : null}
      </section>

      {version.state === "in_review" ? (
        <section className="admin-review-decision" aria-labelledby="decision-title">
          <div>
            <p className="admin-kicker">05 · DECISION</p>
            <h2 id="decision-title">批准或退回</h2>
            <p>服务端会重新运行全部必审检查；批准缺少凭证时会稳定拒绝。</p>
          </div>
          <label>
            <span>退回原因</span>
            <textarea
              aria-label="退回原因"
              disabled={pendingDecision !== null}
              maxLength={2000}
              onChange={(event) => setReturnReason(event.currentTarget.value)}
              placeholder="退回修改时必填；不会改写当前快照"
              rows={3}
              value={returnReason}
            />
          </label>
          <div className="admin-form__actions">
            <button
              className="admin-button admin-button--primary"
              disabled={
                decisionState.kind === "loading" ||
                (pendingDecision !== null && pendingDecision !== "approved")
              }
              onClick={() => void decideReview("approved")}
              type="button"
            >
              批准内容
            </button>
            <button
              className="admin-button admin-button--danger-outline"
              disabled={
                decisionState.kind === "loading" ||
                (pendingDecision !== null && pendingDecision !== "changes_requested")
              }
              onClick={() => void decideReview("changes_requested")}
              type="button"
            >
              退回修改
            </button>
          </div>
        </section>
      ) : null}

      {decisionState.kind === "error" ? (
        <p className="admin-message admin-message--error" role="alert">
          {decisionState.message}
        </p>
      ) : null}
      {decisionState.kind === "success" ? (
        <p className="admin-message admin-message--success" role="status">
          {decisionState.message}
        </p>
      ) : null}

      {version.state === "changes_requested" ? (
        <section className="admin-copy-draft" aria-labelledby="copy-draft-title">
          <div>
            <p className="admin-kicker">COPY, NEVER OVERWRITE</p>
            <h2 id="copy-draft-title">复制后修改</h2>
            <p>当前版本继续作为审计快照保留；新草稿拥有独立编号与修订历史。</p>
          </div>
          <button
            className="admin-button admin-button--primary"
            disabled={
              copyState.kind === "loading" || copiedDraftId !== null || copyOutcomeUncertain
            }
            onClick={() => void copyToDraft()}
            type="button"
          >
            {copyState.kind === "loading" ? "正在复制…" : "复制为新草稿"}
          </button>
          {copyState.kind === "error" ? (
            <div className="admin-message admin-message--error" role="alert">
              <p>{copyState.message}</p>
              {copyOutcomeUncertain ? (
                <Link className="admin-button admin-button--quiet" href="/admin/content">
                  检查草稿队列
                </Link>
              ) : null}
            </div>
          ) : null}
          {copiedDraftId === null ? null : (
            <div className="admin-message admin-message--success" role="status">
              <p>{copyState.kind === "success" ? copyState.message : "新草稿已创建。"}</p>
              <Link
                className="admin-button admin-button--quiet"
                href={`/admin/content/drafts/${encodeURIComponent(copiedDraftId)}`}
              >
                编辑复制的草稿
              </Link>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

export function ContentVersionReview({ contentVersion }: { contentVersion: string }) {
  return (
    <AdminSessionGate>
      {(session) => (
        <ContentVersionReviewContent contentVersion={contentVersion} session={session} />
      )}
    </AdminSessionGate>
  );
}
