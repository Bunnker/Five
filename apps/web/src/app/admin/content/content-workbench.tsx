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
  type DailyContentProduction,
} from "../admin-api";
import { formatAdminDateTime } from "../admin-date-time";
import { AdminSessionGate } from "../admin-session-gate";
import { useAdminSession } from "../admin-session-context";
import { MonthlyContentCalendar } from "./monthly-content-calendar";

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
  const [productions, setProductions] = useState<DailyContentProduction[]>([]);
  const [productionsState, setProductionsState] = useState<RequestState>({ kind: "loading" });

  const loadProductions = useCallback(async () => {
    setProductionsState({ kind: "loading" });
    const result = await adminApi.listProductions();
    if (!result.ok) {
      if (result.error.status === 401) {
        clearSession();
        return;
      }
      setProductionsState({
        kind: "error",
        message: describeAdminContentApiError(result.error),
      });
      return;
    }
    setProductions(result.data.items);
    setProductionsState({ kind: "idle" });
  }, [clearSession]);

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
    void loadProductions();
  }, [loadProductions]);

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
    setCreateState({ kind: "success", message: "内容草稿已创建，可以继续填写文字和图片。" });
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
          <p className="admin-kicker">系统自动生产，你只负责检查</p>
          <h1>每日内容检查</h1>
        </div>
        <p>
          系统会提前生成文字、穿搭和模特图候选，并直接发布；你只需查看每天的用户端效果，有问题再修改替换。
        </p>
      </header>

      <MonthlyContentCalendar
        drafts={drafts}
        onProductionCreated={(production) => {
          setProductions((current) => [
            production,
            ...current.filter((item) => item.fortuneDate !== production.fortuneDate),
          ]);
        }}
        onUnauthorized={clearSession}
        productions={productions}
        session={session}
      />

      <section
        className="admin-content-panel admin-content-panel--quiet"
        aria-labelledby="automatic-production-title"
      >
        <div className="admin-section-heading">
          <p className="admin-kicker">PRODUCTION DETAILS</p>
          <h2 id="automatic-production-title">自动生产明细</h2>
        </div>
        {productionsState.kind === "loading" ? (
          <p className="admin-content-empty" role="status">
            正在读取自动生成进度…
          </p>
        ) : null}
        {productionsState.kind === "error" ? (
          <p className="admin-message admin-message--error" role="alert">
            {productionsState.message}
          </p>
        ) : null}
        {productionsState.kind !== "loading" && productions.length === 0 ? (
          <p className="admin-content-empty">Worker 正在准备未来 30 天内容，请稍后刷新。</p>
        ) : null}
        {productions.length > 0 ? (
          <ul className="admin-draft-queue" aria-label="自动生成的待检查内容">
            {productions.map((production) => (
              <li key={production.fortuneDate}>
                <div>
                  <strong>{production.fortuneDate}</strong>
                  <small>
                    {production.status === "awaiting_review"
                      ? "文字和模特图已生成，可以检查"
                      : production.status === "failed"
                        ? `生成失败：${production.lastError ?? "等待重试"}`
                        : "正在生成模特图"}
                  </small>
                </div>
                <Link href={`/admin/content/drafts/${encodeURIComponent(production.draftId)}`}>
                  检查 {production.fortuneDate}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="admin-content-intake-grid">
        <section
          className="admin-content-panel admin-content-panel--accent"
          aria-labelledby="create-draft-title"
        >
          <div className="admin-section-heading">
            <p className="admin-kicker">备用操作</p>
            <h2 id="create-draft-title">特殊情况手动新建</h2>
          </div>
          <form className="admin-form" onSubmit={createDraft}>
            <label>
              <span>内容日期</span>
              <input
                aria-label="内容日期"
                onChange={(event) => setCreateDate(event.currentTarget.value)}
                required
                type="date"
                value={createDate}
              />
              <small>公开内容在北京时间 18:00 切换；命理日仍按 23:00 规则计算。</small>
            </label>
            <label>
              <span>从已有版本复制（可选）</span>
              <input
                aria-label="从已有版本复制（可选）"
                maxLength={128}
                onChange={(event) => setCopyFromVersion(event.currentTarget.value)}
                placeholder="例如 fd-20260731-r2"
                type="text"
                value={copyFromVersion}
              />
              <small>只有修改已提交内容时才需要填写；第一次创建可留空。</small>
            </label>
            <button
              className="admin-button admin-button--primary"
              disabled={createState.kind === "loading"}
              type="submit"
            >
              {createState.kind === "loading" ? "正在创建…" : "创建当天内容"}
            </button>
          </form>
          {createState.kind === "error" ? (
            <p className="admin-message admin-message--error" role="alert">
              {createState.message}
            </p>
          ) : null}
          {createdDraft === null ? null : (
            <div className="admin-message admin-message--success" role="status">
              <p>{createState.kind === "success" ? createState.message : "内容草稿已创建。"}</p>
              <Link
                className="admin-button admin-button--quiet"
                href={`/admin/content/drafts/${encodeURIComponent(createdDraft.draftId)}`}
              >
                继续填写内容
              </Link>
            </div>
          )}
        </section>

        <section className="admin-content-panel" aria-labelledby="draft-queue-title">
          <div className="admin-section-heading">
            <p className="admin-kicker">步骤 2</p>
            <h2 id="draft-queue-title">继续未完成内容</h2>
          </div>
          <form className="admin-inline-form" onSubmit={filterDrafts}>
            <label>
              <span>按日期筛选（可选）</span>
              <input
                aria-label="按日期筛选（可选）"
                onChange={(event) => setDraftFilter(event.currentTarget.value)}
                type="date"
                value={draftFilter}
              />
            </label>
            <button className="admin-button admin-button--quiet" type="submit">
              筛选
            </button>
          </form>
          {draftsState.kind === "loading" ? (
            <p className="admin-content-empty" role="status">
              正在读取未完成内容…
            </p>
          ) : null}
          {draftsState.kind === "error" ? (
            <p className="admin-message admin-message--error" role="alert">
              {draftsState.message}
            </p>
          ) : null}
          {draftsState.kind !== "loading" && drafts.length === 0 ? (
            <p className="admin-content-empty">没有未完成内容。</p>
          ) : null}
          {drafts.length > 0 ? (
            <ul className="admin-draft-queue" aria-label="可编辑草稿">
              {drafts.map((draft) => (
                <li key={draft.draftId}>
                  <div>
                    <strong>{draft.fortuneDate}</strong>
                    <small>
                      第 {draft.draftRevision} 次保存 · 更新于{" "}
                      {formatAdminDateTime(draft.updatedAt)}
                    </small>
                  </div>
                  <Link href={`/admin/content/drafts/${encodeURIComponent(draft.draftId)}`}>
                    继续编辑 {draft.fortuneDate}
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
          <p className="admin-kicker">步骤 3</p>
          <h2 id="version-index-title">查看已发布效果与版本</h2>
        </div>
        <form className="admin-inline-form" onSubmit={listVersions}>
          <label>
            <span>查看日期</span>
            <input
              aria-label="查看日期"
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
            {versionsState.kind === "loading" ? "正在查询…" : "查看内容版本"}
          </button>
        </form>
        {versionsState.kind === "error" ? (
          <p className="admin-message admin-message--error" role="alert">
            {versionsState.message}
          </p>
        ) : null}
        {versions !== null && versions.items.length === 0 ? (
          <p className="admin-content-empty">这个日期还没有已提交内容。</p>
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
                    状态记录 {item.lifecycleRevision} · {formatAdminDateTime(item.createdAt)}
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
