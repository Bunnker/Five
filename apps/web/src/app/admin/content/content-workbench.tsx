"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  adminApi,
  describeAdminContentApiError,
  type AdminSession,
  type ContentDraft,
  type ContentDraftList,
  type ContentVersionList,
} from "../admin-api";
import { formatAdminDateTime } from "../admin-date-time";
import { AdminSessionGate } from "../admin-session-gate";
import { useAdminSession } from "../admin-session-context";

type RequestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const versionStateLabels: Record<string, string> = {
  approved: "可以发布",
  changes_requested: "需要修改",
  draft: "草稿",
  in_review: "待大师核对",
  published: "已上线",
  scheduled: "已安排上线",
  superseded: "已被新版本替换",
  withdrawn: "已下线",
};

function ContentWorkbenchContent({ session }: { session: AdminSession }) {
  const { clearSession } = useAdminSession();
  const [createDate, setCreateDate] = useState("");
  const [copyFromVersion, setCopyFromVersion] = useState("");
  const [createdDraft, setCreatedDraft] = useState<ContentDraft | null>(null);
  const [createState, setCreateState] = useState<RequestState>({ kind: "idle" });
  const [draftFilter, setDraftFilter] = useState("");
  const [drafts, setDrafts] = useState<ContentDraftList["items"]>([]);
  const [draftsState, setDraftsState] = useState<RequestState>({ kind: "loading" });
  const [versionDate, setVersionDate] = useState("");
  const [versions, setVersions] = useState<ContentVersionList | null>(null);
  const [versionsState, setVersionsState] = useState<RequestState>({ kind: "idle" });

  const loadDrafts = useCallback(
    async (fortuneDate: string | null) => {
      setDraftsState({ kind: "loading" });
      const result = await adminApi.listDrafts(fortuneDate);
      if (!result.ok) {
        if (result.error.status === 401) {
          clearSession();
          return;
        }
        setDraftsState({
          kind: "error",
          message: describeAdminContentApiError(result.error),
        });
        return;
      }
      setDrafts(result.data.items);
      setDraftsState({ kind: "idle" });
    },
    [clearSession],
  );

  useEffect(() => {
    void loadDrafts(null);
  }, [loadDrafts]);

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createState.kind === "loading") return;
    setCreateState({ kind: "loading" });
    const result = await adminApi.createDraft({
      csrfToken: session.csrfToken,
      input: {
        copyFromContentVersion: copyFromVersion.trim() || null,
        fortuneDate: createDate,
      },
    });
    if (!result.ok) {
      if (result.error.status === 401) {
        clearSession();
        return;
      }
      setCreateState({ kind: "error", message: describeAdminContentApiError(result.error) });
      return;
    }
    setCreatedDraft(result.data);
    setDrafts((current) => [
      result.data,
      ...current.filter((item) => item.draftId !== result.data.draftId),
    ]);
    setCreateState({ kind: "success", message: "草稿已创建，可立即进入四模块编辑。" });
  }

  async function filterDrafts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadDrafts(draftFilter || null);
  }

  async function listVersions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (versionsState.kind === "loading") return;
    setVersionsState({ kind: "loading" });
    const result = await adminApi.listContentVersions(versionDate);
    if (!result.ok) {
      if (result.error.status === 401) {
        clearSession();
        return;
      }
      setVersionsState({
        kind: "error",
        message: describeAdminContentApiError(result.error),
      });
      return;
    }
    setVersions(result.data);
    setVersionsState({ kind: "idle" });
  }

  return (
    <div className="admin-content-page">
      <header className="admin-page-heading">
        <div>
          <p className="admin-kicker">CONTENT DESK · 单人内容台</p>
          <h1>每日内容工作台</h1>
        </div>
        <p>草稿可继续修改；一旦提交，内容快照会冻结，后续改动必须复制成新草稿。</p>
      </header>

      <div className="admin-content-intake-grid">
        <section
          className="admin-content-panel admin-content-panel--accent"
          aria-labelledby="create-draft-title"
        >
          <div className="admin-section-heading">
            <p className="admin-kicker">01 · NEW DRAFT</p>
            <h2 id="create-draft-title">创建草稿</h2>
          </div>
          <form className="admin-form" onSubmit={createDraft}>
            <label>
              <span>命理日</span>
              <input
                aria-label="命理日"
                onChange={(event) => setCreateDate(event.currentTarget.value)}
                required
                type="date"
                value={createDate}
              />
            </label>
            <label>
              <span>复制来源内容版本（可选）</span>
              <input
                aria-label="复制来源内容版本（可选）"
                maxLength={128}
                onChange={(event) => setCopyFromVersion(event.currentTarget.value)}
                placeholder="例如 fd-20260731-r2"
                type="text"
                value={copyFromVersion}
              />
              <small>退回内容必须通过复制创建新草稿，原快照不会被覆盖。</small>
            </label>
            <button
              className="admin-button admin-button--primary"
              disabled={createState.kind === "loading"}
              type="submit"
            >
              {createState.kind === "loading" ? "正在创建…" : "创建草稿"}
            </button>
          </form>
          {createState.kind === "error" ? (
            <p className="admin-message admin-message--error" role="alert">
              {createState.message}
            </p>
          ) : null}
          {createdDraft === null ? null : (
            <div className="admin-message admin-message--success" role="status">
              <p>{createState.kind === "success" ? createState.message : "草稿已创建。"}</p>
              <Link
                className="admin-button admin-button--quiet"
                href={`/admin/content/drafts/${encodeURIComponent(createdDraft.draftId)}`}
              >
                编辑新草稿
              </Link>
            </div>
          )}
        </section>

        <section className="admin-content-panel" aria-labelledby="draft-queue-title">
          <div className="admin-section-heading">
            <p className="admin-kicker">02 · DRAFT QUEUE</p>
            <h2 id="draft-queue-title">未完成草稿</h2>
          </div>
          <form className="admin-inline-form" onSubmit={filterDrafts}>
            <label>
              <span>筛选草稿命理日（可选）</span>
              <input
                aria-label="筛选草稿命理日（可选）"
                onChange={(event) => setDraftFilter(event.currentTarget.value)}
                type="date"
                value={draftFilter}
              />
            </label>
            <button className="admin-button admin-button--quiet" type="submit">
              筛选草稿
            </button>
          </form>
          {draftsState.kind === "loading" ? (
            <p className="admin-content-empty" role="status">
              正在读取草稿队列…
            </p>
          ) : null}
          {draftsState.kind === "error" ? (
            <p className="admin-message admin-message--error" role="alert">
              {draftsState.message}
            </p>
          ) : null}
          {draftsState.kind !== "loading" && drafts.length === 0 ? (
            <p className="admin-content-empty">没有可继续编辑的草稿。</p>
          ) : null}
          {drafts.length > 0 ? (
            <ul className="admin-draft-queue" aria-label="可编辑草稿">
              {drafts.map((draft) => (
                <li key={draft.draftId}>
                  <div>
                    <strong>{draft.fortuneDate}</strong>
                    <small>
                      修订 {draft.draftRevision} · 更新于 {formatAdminDateTime(draft.updatedAt)}
                    </small>
                  </div>
                  <Link href={`/admin/content/drafts/${encodeURIComponent(draft.draftId)}`}>
                    继续编辑 {draft.draftId}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <section
        className="admin-content-panel admin-version-index"
        aria-labelledby="version-index-title"
      >
        <div className="admin-section-heading">
          <p className="admin-kicker">03 · IMMUTABLE LEDGER</p>
          <h2 id="version-index-title">按命理日查看版本</h2>
        </div>
        <form className="admin-inline-form" onSubmit={listVersions}>
          <label>
            <span>查询命理日</span>
            <input
              aria-label="查询命理日"
              onChange={(event) => setVersionDate(event.currentTarget.value)}
              required
              type="date"
              value={versionDate}
            />
          </label>
          <button
            className="admin-button admin-button--primary"
            disabled={versionsState.kind === "loading"}
            type="submit"
          >
            {versionsState.kind === "loading" ? "正在查询…" : "查询版本"}
          </button>
        </form>
        {versionsState.kind === "error" ? (
          <p className="admin-message admin-message--error" role="alert">
            {versionsState.message}
          </p>
        ) : null}
        {versions !== null && versions.items.length === 0 ? (
          <p className="admin-content-empty">这个命理日还没有不可变版本。</p>
        ) : null}
        {versions !== null && versions.items.length > 0 ? (
          <ol className="admin-version-list" aria-label={`${versions.fortuneDate} 的内容版本`}>
            {versions.items.map((item) => (
              <li key={item.contentVersion}>
                <span className={`admin-status-badge admin-status-badge--content-${item.state}`}>
                  {versionStateLabels[item.state] ?? item.state}
                </span>
                <div>
                  <Link href={`/admin/content/versions/${encodeURIComponent(item.contentVersion)}`}>
                    {item.contentVersion}
                  </Link>
                  <small>
                    生命周期修订 {item.lifecycleRevision} · {formatAdminDateTime(item.createdAt)}
                  </small>
                </div>
                {versions.activeContentVersion === item.contentVersion ? (
                  <strong>当前在线</strong>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </div>
  );
}

export function ContentWorkbench() {
  return (
    <AdminSessionGate>
      {(session) => <ContentWorkbenchContent session={session} />}
    </AdminSessionGate>
  );
}
