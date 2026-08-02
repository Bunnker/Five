"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  adminApi,
  createIdempotencyKey,
  describeAdminContentApiError,
  parseDraftModuleJson,
  type AdminSession,
  type ContentDraft,
  type DraftModuleCode,
  type SubmitDraftResult,
} from "../../../admin-api";
import { AdminSessionGate } from "../../../admin-session-gate";
import { useAdminSession } from "../../../admin-session-context";
import { DailyImageWorkbench } from "./daily-image-workbench";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string }
  | { kind: "conflict"; message: string };

type ModuleState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const moduleDefinitions: ReadonlyArray<{
  code: DraftModuleCode;
  description: string;
  label: string;
  number: string;
}> = [
  {
    code: "calendar_algorithm",
    description: "历法结果、完整五档、算法与规则版本。",
    label: "日历与算法",
    number: "A",
  },
  {
    code: "copy_and_formula",
    description: "平衡建议、穿搭公式、依据与分享文案。",
    label: "文案与穿法",
    number: "B",
  },
  {
    code: "visual_and_rights",
    description: "两张必备图、可选图、素材审核与权利记录。",
    label: "视觉与权利",
    number: "C",
  },
  {
    code: "poster_consistency",
    description: "海报模板、样图素材与版本一致性。",
    label: "海报一致性",
    number: "D",
  },
];

function moduleSourcesFromDraft(draft: ContentDraft): Record<DraftModuleCode, string> {
  return Object.fromEntries(
    moduleDefinitions.map(({ code }) => [
      code,
      draft.modules[code] === null ? "{}" : JSON.stringify(draft.modules[code], null, 2),
    ]),
  ) as Record<DraftModuleCode, string>;
}

function persistedModuleSource(draft: ContentDraft, moduleCode: DraftModuleCode): string {
  const module = draft.modules[moduleCode];
  return module === null ? "{}" : JSON.stringify(module, null, 2);
}

function unsavedModuleDefinitions(
  draft: ContentDraft,
  moduleSources: Record<DraftModuleCode, string>,
) {
  return moduleDefinitions.filter(
    ({ code }) => moduleSources[code] !== persistedModuleSource(draft, code),
  );
}

function initialModuleStates(): Record<DraftModuleCode, ModuleState> {
  return Object.fromEntries(
    moduleDefinitions.map(({ code }) => [code, { kind: "idle" }]),
  ) as Record<DraftModuleCode, ModuleState>;
}

function DraftEditorContent({ draftId, session }: { draftId: string; session: AdminSession }) {
  const { clearSession } = useAdminSession();
  const [draft, setDraft] = useState<ContentDraft | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [moduleSources, setModuleSources] = useState<Record<DraftModuleCode, string>>(
    () =>
      Object.fromEntries(moduleDefinitions.map(({ code }) => [code, "{}"])) as Record<
        DraftModuleCode,
        string
      >,
  );
  const [moduleStates, setModuleStates] =
    useState<Record<DraftModuleCode, ModuleState>>(initialModuleStates);
  const [submitState, setSubmitState] = useState<ModuleState>({ kind: "idle" });
  const [submittedVersion, setSubmittedVersion] = useState<SubmitDraftResult | null>(null);
  const pendingSubmitKeyRef = useRef<string | null>(null);

  const loadDraft = useCallback(async () => {
    setLoadState({ kind: "loading" });
    const result = await adminApi.getDraft(draftId);
    if (!result.ok) {
      if (result.error.status === 401) {
        clearSession();
        return;
      }
      setLoadState({ kind: "error", message: describeAdminContentApiError(result.error) });
      return;
    }
    const newEtag = result.response.headers.get("ETag");
    if (newEtag === null) {
      setLoadState({ kind: "error", message: "后台没有返回草稿修订凭据，已阻止编辑。" });
      return;
    }
    setDraft(result.data);
    setEtag(newEtag);
    setModuleSources(moduleSourcesFromDraft(result.data));
    setModuleStates(initialModuleStates());
    setSubmitState({ kind: "idle" });
    setLoadState({ kind: "ready" });
  }, [clearSession, draftId]);

  useEffect(() => {
    void loadDraft();
  }, [loadDraft]);

  const synchronizeImageRevision = useCallback(
    ({ draftRevision, etag: nextEtag }: { draftRevision: number; etag: string }) => {
      setEtag(nextEtag);
      setDraft((current) =>
        current === null ? current : { ...current, draftRevision, updatedAt: current.updatedAt },
      );
    },
    [],
  );

  const reportImageConflict = useCallback((message: string) => {
    setLoadState({ kind: "conflict", message });
  }, []);

  async function saveModule(moduleCode: DraftModuleCode) {
    if (draft === null || etag === null || loadState.kind !== "ready") return;
    const parsed = parseDraftModuleJson(moduleCode, moduleSources[moduleCode]);
    if (!parsed.ok) {
      setModuleStates((current) => ({
        ...current,
        [moduleCode]: { kind: "error", message: parsed.message },
      }));
      return;
    }
    setModuleStates((current) => ({ ...current, [moduleCode]: { kind: "saving" } }));
    const result = await adminApi.updateDraftModule({
      csrfToken: session.csrfToken,
      draftId: draft.draftId,
      etag,
      module: parsed.value,
      moduleCode,
    });
    if (!result.ok) {
      if (result.error.status === 401) {
        clearSession();
        return;
      }
      if (result.error.status === 412) {
        setLoadState({
          kind: "conflict",
          message: "其他页面已经更新这份草稿。当前内容没有覆盖服务端，请重新载入后再编辑。",
        });
        setModuleStates((current) => ({ ...current, [moduleCode]: { kind: "idle" } }));
        return;
      }
      setModuleStates((current) => ({
        ...current,
        [moduleCode]: { kind: "error", message: describeAdminContentApiError(result.error) },
      }));
      return;
    }
    const newEtag = result.response.headers.get("ETag");
    if (newEtag === null) {
      setLoadState({ kind: "error", message: "模块已响应，但无法确认新的修订号，请重新载入。" });
      return;
    }
    setEtag(newEtag);
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            draftRevision: result.data.draftRevision,
            modules: { ...current.modules, [moduleCode]: result.data.module },
          },
    );
    setModuleSources((current) => ({
      ...current,
      [moduleCode]: JSON.stringify(result.data.module, null, 2),
    }));
    setModuleStates((current) => ({
      ...current,
      [moduleCode]: { kind: "success", message: "模块已保存，并取得新的草稿修订号。" },
    }));
  }

  async function submitDraft() {
    if (
      draft === null ||
      etag === null ||
      submitState.kind === "saving" ||
      loadState.kind !== "ready"
    ) {
      return;
    }
    const unsaved = unsavedModuleDefinitions(draft, moduleSources);
    if (unsaved.length > 0) {
      setSubmitState({
        kind: "error",
        message: `提交前必须保存所有修改。尚未保存：${unsaved.map(({ label }) => label).join("、")}。`,
      });
      return;
    }
    if (moduleDefinitions.some(({ code }) => moduleStates[code].kind === "saving")) {
      setSubmitState({ kind: "error", message: "模块仍在保存，请保存完成后再提交。" });
      return;
    }
    const missing = moduleDefinitions.filter(({ code }) => draft.modules[code] === null);
    if (missing.length > 0) {
      setSubmitState({
        kind: "error",
        message: `提交前必须保存四个模块。尚缺：${missing.map(({ label }) => label).join("、")}。`,
      });
      return;
    }
    try {
      pendingSubmitKeyRef.current ??= createIdempotencyKey();
    } catch {
      setSubmitState({ kind: "error", message: "当前浏览器无法生成安全操作编号，不能提交。" });
      return;
    }
    setSubmitState({ kind: "saving" });
    const result = await adminApi.submitDraft({
      csrfToken: session.csrfToken,
      draftId: draft.draftId,
      etag,
      idempotencyKey: pendingSubmitKeyRef.current,
    });
    if (!result.ok) {
      if (result.error.status === 401) {
        clearSession();
        return;
      }
      if (result.error.status === 412) {
        pendingSubmitKeyRef.current = null;
        setLoadState({
          kind: "conflict",
          message: "其他页面已经更新这份草稿。当前提交已停止，请重新载入后核对。",
        });
        setSubmitState({ kind: "idle" });
        return;
      }
      if (result.error.status !== 0 && result.error.status < 500)
        pendingSubmitKeyRef.current = null;
      setSubmitState({
        kind: "error",
        message:
          result.error.status === 0 || result.error.status >= 500
            ? "提交结果暂时无法确认；再次提交会复用同一操作编号。"
            : describeAdminContentApiError(result.error),
      });
      return;
    }
    pendingSubmitKeyRef.current = null;
    setSubmittedVersion(result.data);
    setSubmitState({ kind: "success", message: "草稿已冻结为不可变内容版本，等待大师核对。" });
  }

  if (loadState.kind === "loading") {
    return (
      <p className="admin-loading" role="status">
        正在读取草稿与修订号…
      </p>
    );
  }

  if (loadState.kind === "error" || draft === null || etag === null) {
    return (
      <section className="admin-state-card">
        <p className="admin-kicker">DRAFT UNAVAILABLE</p>
        <h1>无法打开草稿</h1>
        <p role="alert">
          {loadState.kind === "error" ? loadState.message : "草稿响应不完整，已阻止编辑。"}
        </p>
        <button
          className="admin-button admin-button--quiet"
          onClick={() => void loadDraft()}
          type="button"
        >
          重新读取
        </button>
      </section>
    );
  }

  return (
    <div className="admin-content-page admin-draft-editor">
      <header className="admin-page-heading">
        <div>
          <p className="admin-kicker">EDITABLE DRAFT · {draft.fortuneDate}</p>
          <h1>编辑每日草稿</h1>
        </div>
        <p>
          草稿修订 {draft.draftRevision} · <code>{etag}</code>
        </p>
      </header>

      {loadState.kind === "conflict" ? (
        <div className="admin-message admin-message--error" role="alert">
          <p>{loadState.message}</p>
          <button
            className="admin-button admin-button--quiet"
            onClick={() => void loadDraft()}
            type="button"
          >
            重新载入草稿
          </button>
        </div>
      ) : null}

      <nav className="admin-module-jump" aria-label="草稿模块">
        {moduleDefinitions.map(({ code, label, number }) => (
          <a href={`#module-${code}`} key={code}>
            <span>{number}</span>
            {label}
          </a>
        ))}
      </nav>

      <div className="admin-module-stack">
        {moduleDefinitions.map(({ code, description, label, number }) => {
          const state = moduleStates[code];
          const hasUnsavedChanges = moduleSources[code] !== persistedModuleSource(draft, code);
          return (
            <section className="admin-module-editor" id={`module-${code}`} key={code}>
              <header>
                <span aria-hidden="true">{number}</span>
                <div>
                  <h2>{label}</h2>
                  <p>{description}</p>
                </div>
                <strong>
                  {hasUnsavedChanges
                    ? "有未保存修改"
                    : draft.modules[code] === null
                      ? "未保存"
                      : "已保存"}
                </strong>
              </header>
              {code === "visual_and_rights" ? (
                <DailyImageWorkbench
                  csrfToken={session.csrfToken}
                  disabled={
                    state.kind === "saving" ||
                    loadState.kind !== "ready" ||
                    submittedVersion !== null
                  }
                  draftId={draft.draftId}
                  draftRevision={draft.draftRevision}
                  etag={etag}
                  fortuneDate={draft.fortuneDate}
                  onConflict={reportImageConflict}
                  onRevisionChange={synchronizeImageRevision}
                  onUnauthorized={clearSession}
                  visualModule={draft.modules.visual_and_rights}
                />
              ) : null}
              <label>
                <span>{label} JSON</span>
                <textarea
                  aria-label={`${label} JSON`}
                  disabled={
                    state.kind === "saving" ||
                    loadState.kind !== "ready" ||
                    submittedVersion !== null
                  }
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setModuleSources((current) => ({ ...current, [code]: value }));
                    setModuleStates((current) => ({ ...current, [code]: { kind: "idle" } }));
                  }}
                  spellCheck={false}
                  value={moduleSources[code]}
                />
              </label>
              <div className="admin-module-editor__actions">
                <button
                  className="admin-button admin-button--quiet"
                  disabled={
                    state.kind === "saving" ||
                    loadState.kind !== "ready" ||
                    submittedVersion !== null
                  }
                  onClick={() => void saveModule(code)}
                  type="button"
                >
                  {state.kind === "saving" ? `正在保存${label}…` : `保存${label}`}
                </button>
                {state.kind === "success" ? <p role="status">{state.message}</p> : null}
              </div>
              {state.kind === "error" ? (
                <p className="admin-message admin-message--error" role="alert">
                  {state.message}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>

      <section className="admin-submit-draft" aria-labelledby="submit-draft-title">
        <div>
          <p className="admin-kicker">FREEZE · IRREVERSIBLE SNAPSHOT</p>
          <h2 id="submit-draft-title">提交大师核对</h2>
          <p>提交会冻结四个模块并生成唯一内容版本；之后不能原地修改。</p>
        </div>
        <button
          className="admin-button admin-button--primary"
          disabled={
            submitState.kind === "saving" || submittedVersion !== null || loadState.kind !== "ready"
          }
          onClick={() => void submitDraft()}
          type="button"
        >
          {submitState.kind === "saving" ? "正在冻结…" : "提交并冻结版本"}
        </button>
        {submitState.kind === "error" ? (
          <p className="admin-message admin-message--error" role="alert">
            {submitState.message}
          </p>
        ) : null}
        {submittedVersion === null ? null : (
          <div className="admin-message admin-message--success" role="status">
            <p>{submitState.kind === "success" ? submitState.message : "版本已经生成。"}</p>
            <Link
              className="admin-button admin-button--quiet"
              href={`/admin/content/versions/${encodeURIComponent(submittedVersion.contentVersion)}`}
            >
              查看不可变版本
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

export function DraftEditor({ draftId }: { draftId: string }) {
  return (
    <AdminSessionGate>
      {(session) => <DraftEditorContent draftId={draftId} session={session} />}
    </AdminSessionGate>
  );
}
