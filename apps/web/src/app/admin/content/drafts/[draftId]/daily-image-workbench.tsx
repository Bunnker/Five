"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isDeliverableAdminImageAsset,
  isImageAssetReviewRequest,
  isImageAssetUploadMetadata,
} from "@five/api-contract/runtime";

import {
  adminApi,
  createIdempotencyKey,
  describeAdminImageApiError,
  type AdminImageAsset,
  type ContentDraft,
  type DraftImageAssetList,
  type ImageAssetReviewRequest,
  type ImageAssetUploadMetadata,
} from "../../../admin-api";
import { shanghaiLocalDateTimeToIso } from "../../../admin-date-time";

type VisualModule = NonNullable<ContentDraft["modules"]["visual_and_rights"]>;
type Candidate = DraftImageAssetList["items"][number];
type DailyImageSlot = NonNullable<Candidate["imageSlot"]>;
type ReviewCheckKey =
  | "colorAndCopyConsistency"
  | "garmentAndPersonIntegrity"
  | "rightsAndIdentityRisk"
  | "scenarioAndImitability"
  | "mobileAndWechatPreview"
  | "aiLabelCompliance";

type ReviewForm = {
  aiLabelStatus: ImageAssetReviewRequest["aiLabelStatus"];
  checks: Record<ReviewCheckKey, boolean>;
  message: string | null;
  notes: string;
  pending: boolean;
  retryPending: boolean;
  rightsStatus: ImageAssetReviewRequest["rightsStatus"];
};

type UploadIntent = {
  etag: string;
  file: File;
  idempotencyKey: string;
  imageSlot: DailyImageSlot;
  metadata: ImageAssetUploadMetadata;
};

type ReviewIntent = {
  body: ImageAssetReviewRequest;
  etag: string;
  idempotencyKey: string;
};

type UploadForm = {
  aiLabelStatus: ImageAssetUploadMetadata["aiLabelStatus"];
  altText: string;
  declaredModel: string;
  generatedAt: string;
  generationMethod: ImageAssetUploadMetadata["generationMethod"];
  imageSlot: DailyImageSlot;
  promptVersion: string;
  reproductionReference: string;
  rightsRecordIds: string;
  sourceMaterialReferences: string;
  sourceType: ImageAssetUploadMetadata["sourceType"];
};

type Props = {
  csrfToken: string;
  disabled: boolean;
  draftId: string;
  draftRevision: number;
  etag: string;
  fortuneDate: string;
  onCandidatesChange: (candidates: DraftImageAssetList["items"]) => void;
  onConflict: (message: string) => void;
  onRevisionChange: (revision: { draftRevision: number; etag: string }) => void;
  onUnauthorized: () => void;
  visualModule: VisualModule | null;
};

const reviewChecks: ReadonlyArray<{ key: ReviewCheckKey; label: string; detail: string }> = [
  {
    detail: "主次颜色、色名与当日文案一致。",
    key: "colorAndCopyConsistency",
    label: "颜色与文案一致",
  },
  {
    detail: "手指、肢体、衣领、纽扣与叠穿关系自然。",
    key: "garmentAndPersonIntegrity",
    label: "人物与服装无错误",
  },
  {
    detail: "无未授权商标、肖像或可识别身份风险。",
    key: "rightsAndIdentityRisk",
    label: "商标、肖像与权利风险已排除",
  },
  {
    detail: "场景可被普通用户模仿，不暗示不实效果。",
    key: "scenarioAndImitability",
    label: "场景可模仿且无误导",
  },
  {
    detail: "在手机窄屏和微信内置浏览器中主体清楚。",
    key: "mobileAndWechatPreview",
    label: "手机与微信预览通过",
  },
  {
    detail: "AI 素材完成适用标识；非 AI 素材确认不适用。",
    key: "aiLabelCompliance",
    label: "AI 标识符合要求",
  },
];

const slotDefinitions = [
  { code: "required_primary", label: "必备主图", note: "大吉色为主" },
  { code: "required_alternative", label: "必备备选图", note: "大吉色与次吉色" },
  { code: "optional", label: "可选图", note: "质量不足可不提供" },
] as const;

const initialUploadForm: UploadForm = {
  aiLabelStatus: "not_applicable",
  altText: "",
  declaredModel: "",
  generatedAt: "",
  generationMethod: "licensed_upload",
  imageSlot: "required_primary",
  promptVersion: "",
  reproductionReference: "",
  rightsRecordIds: "",
  sourceMaterialReferences: "",
  sourceType: "licensed",
};

function isAiUpload(form: UploadForm): boolean {
  return (
    form.sourceType === "ai_generated" ||
    form.generationMethod === "codex" ||
    form.generationMethod === "relay" ||
    form.generationMethod === "external_tool"
  );
}

function nonEmptyUniqueLines(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function createReviewForm(asset: AdminImageAsset): ReviewForm {
  const manualReview = asset.manualReview;
  return {
    aiLabelStatus: asset.aiLabelStatus,
    checks: Object.fromEntries(
      reviewChecks.map(({ key }) => [key, manualReview?.[key] === "passed"]),
    ) as Record<ReviewCheckKey, boolean>,
    message: null,
    notes: manualReview?.notes ?? "",
    pending: false,
    retryPending: false,
    rightsStatus: asset.rightsStatus,
  };
}

function sourceLabel(sourceType: AdminImageAsset["sourceType"]): string {
  if (sourceType === "ai_generated") return "AI 生成";
  if (sourceType === "fallback_template") return "降级模板";
  return "授权或自有素材";
}

function reviewStatusLabel(status: AdminImageAsset["reviewStatus"]): string {
  if (status === "approved") return "人工检查已批准";
  if (status === "rejected") return "人工检查已拒绝";
  if (status === "withdrawn") return "素材已下线";
  return "等待人工检查";
}

function assetSafetyLabel(asset: AdminImageAsset | undefined): string {
  if (asset === undefined) return "候选中未找到";
  if (isDeliverableAdminImageAsset(asset)) return "已审核安全";
  if (asset.reviewStatus === "rejected") return "人工检查已拒绝";
  if (asset.reviewStatus === "withdrawn") return "素材已下线";
  return "等待人工检查";
}

function replaceCandidate(current: Candidate[], candidate: Candidate): Candidate[] {
  const existingIndex = current.findIndex(({ asset }) => asset.assetId === candidate.asset.assetId);
  if (existingIndex < 0) return [candidate, ...current];
  return current.map((item, index) => (index === existingIndex ? candidate : item));
}

export function DailyImageWorkbench({
  csrfToken,
  disabled,
  draftId,
  draftRevision,
  etag,
  fortuneDate,
  onCandidatesChange,
  onConflict,
  onRevisionChange,
  onUnauthorized,
  visualModule,
}: Props) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadState, setLoadState] = useState<
    { kind: "loading" | "ready" } | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [uploadForm, setUploadForm] = useState<UploadForm>(initialUploadForm);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<
    { kind: "idle" | "uploading" } | { kind: "error" | "success" | "uncertain"; message: string }
  >({ kind: "idle" });
  const [reviewForms, setReviewForms] = useState<Record<string, ReviewForm>>({});
  const [currentEtag, setCurrentEtag] = useState(etag);
  const draftRevisionRef = useRef(draftRevision);
  const uploadIntentRef = useRef<UploadIntent | null>(null);
  const reviewIntentsRef = useRef<Record<string, ReviewIntent>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setCurrentEtag(etag), [etag]);
  useEffect(() => {
    draftRevisionRef.current = draftRevision;
  }, [draftRevision]);
  useEffect(() => {
    onCandidatesChange(candidates);
  }, [candidates, onCandidatesChange]);

  const syncRevision = useCallback(
    (nextRevision: number, response: Response) => {
      const nextEtag = response.headers.get("ETag");
      if (nextEtag === null) return false;
      setCurrentEtag(nextEtag);
      draftRevisionRef.current = nextRevision;
      onRevisionChange({ draftRevision: nextRevision, etag: nextEtag });
      return true;
    },
    [onRevisionChange],
  );

  const loadCandidates = useCallback(async () => {
    setLoadState({ kind: "loading" });
    const result = await adminApi.listDraftImages(draftId);
    if (!result.ok) {
      if (result.error.status === 401) {
        onUnauthorized();
        return;
      }
      setLoadState({ kind: "error", message: describeAdminImageApiError(result.error) });
      return;
    }
    setCandidates(result.data.items);
    setReviewForms((current) =>
      Object.fromEntries(
        result.data.items.map((candidate) => [
          candidate.asset.assetId,
          current[candidate.asset.assetId] ?? createReviewForm(candidate.asset),
        ]),
      ),
    );
    const nextEtag = result.response.headers.get("ETag");
    if (nextEtag !== null && result.data.draftRevision !== draftRevisionRef.current) {
      onConflict("其他页面已更新草稿，请重新载入后再继续图片操作。");
    } else if (nextEtag !== null) {
      setCurrentEtag(nextEtag);
    }
    setLoadState({ kind: "ready" });
  }, [draftId, onConflict, onUnauthorized]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  function updateUploadForm<K extends keyof UploadForm>(key: K, value: UploadForm[K]) {
    if (uploadIntentRef.current !== null) return;
    setUploadForm((current) => ({ ...current, [key]: value }));
    setUploadState({ kind: "idle" });
  }

  function changeSourceType(sourceType: UploadForm["sourceType"]) {
    if (uploadIntentRef.current !== null) return;
    setUploadForm((current) => {
      if (sourceType === "ai_generated") {
        return {
          ...current,
          aiLabelStatus: "pending",
          generationMethod: "codex",
          sourceType,
        };
      }
      return {
        ...current,
        aiLabelStatus: "not_applicable",
        declaredModel: "",
        generatedAt: "",
        generationMethod:
          sourceType === "fallback_template" ? "fallback_template" : "licensed_upload",
        promptVersion: "",
        reproductionReference: "",
        sourceType,
      };
    });
    setUploadState({ kind: "idle" });
  }

  async function uploadCandidate() {
    if (disabled || uploadState.kind === "uploading") return;
    let intent = uploadIntentRef.current;
    if (intent === null) {
      if (uploadFile === null) {
        setUploadState({ kind: "error", message: "请选择一张图片文件。" });
        return;
      }
      const aiUpload = isAiUpload(uploadForm);
      const generatedAt = aiUpload ? shanghaiLocalDateTimeToIso(uploadForm.generatedAt) : null;
      const sourceMaterialReferences = nonEmptyUniqueLines(uploadForm.sourceMaterialReferences);
      const rightsRecordIds = nonEmptyUniqueLines(uploadForm.rightsRecordIds);
      if (sourceMaterialReferences.length === 0 || rightsRecordIds.length === 0) {
        setUploadState({
          kind: "error",
          message: "每张图片至少需要一条来源材料和一个权利记录编号。",
        });
        return;
      }
      const metadata = {
        aiLabelStatus: aiUpload ? uploadForm.aiLabelStatus : "not_applicable",
        altText: uploadForm.altText.trim(),
        declaredModel: aiUpload ? uploadForm.declaredModel.trim() || null : null,
        generatedAt,
        generationMethod: uploadForm.generationMethod,
        promptVersion: aiUpload ? uploadForm.promptVersion.trim() || null : null,
        reproductionReference: aiUpload ? uploadForm.reproductionReference.trim() || null : null,
        rightsRecordIds,
        sourceMaterialReferences,
        sourceType: uploadForm.sourceType,
      };
      if (!isImageAssetUploadMetadata(metadata)) {
        setUploadState({
          kind: "error",
          message: aiUpload
            ? "请完整填写替代文字、模型、提示词版本、北京时间生成时间和重现引用。"
            : "图片来源元数据不完整，请检查替代文字与记录编号。",
        });
        return;
      }
      let idempotencyKey: string;
      try {
        idempotencyKey = createIdempotencyKey();
      } catch {
        setUploadState({ kind: "error", message: "当前浏览器无法生成安全操作编号，不能上传。" });
        return;
      }
      intent = {
        etag: currentEtag,
        file: uploadFile,
        idempotencyKey,
        imageSlot: uploadForm.imageSlot,
        metadata,
      };
      uploadIntentRef.current = intent;
    }
    const formData = new FormData();
    formData.append("file", intent.file);
    formData.append("imageSlot", intent.imageSlot);
    // Keep metadata as a regular field: a Blob receives filename="blob" and Fastify treats it
    // as a second file, violating the one-file multipart contract in real browsers.
    formData.append("metadata", JSON.stringify(intent.metadata));
    setUploadState({ kind: "uploading" });
    const result = await adminApi.uploadDraftImage({
      csrfToken,
      draftId,
      etag: intent.etag,
      formData,
      idempotencyKey: intent.idempotencyKey,
    });
    if (!result.ok) {
      if (result.error.status === 401) {
        uploadIntentRef.current = null;
        onUnauthorized();
        return;
      }
      if (result.error.status === 412) {
        uploadIntentRef.current = null;
        onConflict("其他页面已更新草稿，图片未覆盖服务端内容，请重新载入后再上传。");
        setUploadState({ kind: "idle" });
        return;
      }
      const outcomeUncertain = result.error.status === 0 || result.error.status >= 500;
      if (!outcomeUncertain) uploadIntentRef.current = null;
      setUploadState({
        kind: outcomeUncertain ? "uncertain" : "error",
        message: outcomeUncertain
          ? "上传结果暂时无法确认；表单已冻结，只能用同一文件和元数据重试。"
          : describeAdminImageApiError(result.error),
      });
      return;
    }
    uploadIntentRef.current = null;
    syncRevision(result.data.draftRevision, result.response);
    const candidate = {
      asset: result.data.asset,
      imageSlot: result.data.imageSlot,
      previewUrl: result.data.previewUrl,
      reviewLocked: result.data.reviewLocked,
      selectedForSlot: result.data.selectedForSlot,
    };
    setCandidates((current) => replaceCandidate(current, candidate));
    setReviewForms((current) => ({
      ...current,
      [candidate.asset.assetId]: createReviewForm(candidate.asset),
    }));
    setUploadFile(null);
    if (fileInputRef.current !== null) fileInputRef.current.value = "";
    setUploadForm(initialUploadForm);
    setUploadState({ kind: "success", message: "图片候选已上传，请继续完成人工检查。" });
  }

  function updateReviewForm(assetId: string, update: (current: ReviewForm) => ReviewForm) {
    setReviewForms((current) => {
      const form = current[assetId];
      return form === undefined ? current : { ...current, [assetId]: update(form) };
    });
  }

  function editReviewForm(assetId: string, update: (current: ReviewForm) => ReviewForm) {
    if (reviewIntentsRef.current[assetId] !== undefined) return;
    updateReviewForm(assetId, update);
  }

  async function reviewCandidate(candidate: Candidate, decision: "approved" | "rejected") {
    const assetId = candidate.asset.assetId;
    const form = reviewForms[assetId];
    if (form === undefined || form.pending || disabled || candidate.reviewLocked) return;
    let intent = reviewIntentsRef.current[assetId];
    if (intent !== undefined && intent.body.decision !== decision) return;
    if (intent === undefined) {
      const body: ImageAssetReviewRequest = {
        aiLabelCompliance: form.checks.aiLabelCompliance ? "passed" : "failed",
        aiLabelStatus: form.aiLabelStatus,
        colorAndCopyConsistency: form.checks.colorAndCopyConsistency ? "passed" : "failed",
        decision,
        garmentAndPersonIntegrity: form.checks.garmentAndPersonIntegrity ? "passed" : "failed",
        mobileAndWechatPreview: form.checks.mobileAndWechatPreview ? "passed" : "failed",
        notes: form.notes.trim(),
        rightsAndIdentityRisk: form.checks.rightsAndIdentityRisk ? "passed" : "failed",
        rightsStatus: form.rightsStatus,
        scenarioAndImitability: form.checks.scenarioAndImitability ? "passed" : "failed",
      };
      if (!isImageAssetReviewRequest(body)) {
        updateReviewForm(assetId, (current) => ({
          ...current,
          message: "批准前六项检查必须全部通过，权利需已清理，AI 标识需完成。",
        }));
        return;
      }
      let idempotencyKey: string;
      try {
        idempotencyKey = createIdempotencyKey();
      } catch {
        updateReviewForm(assetId, (current) => ({
          ...current,
          message: "当前浏览器无法生成安全操作编号，不能保存检查。",
        }));
        return;
      }
      intent = { body, etag: currentEtag, idempotencyKey };
      reviewIntentsRef.current[assetId] = intent;
    }
    updateReviewForm(assetId, (current) => ({ ...current, message: null, pending: true }));
    const result = await adminApi.reviewDraftImage({
      assetId,
      body: intent.body,
      csrfToken,
      draftId,
      etag: intent.etag,
      idempotencyKey: intent.idempotencyKey,
    });
    if (!result.ok) {
      if (result.error.status === 401) {
        delete reviewIntentsRef.current[assetId];
        onUnauthorized();
        return;
      }
      if (result.error.status === 412) {
        delete reviewIntentsRef.current[assetId];
        onConflict("其他页面已更新草稿，本次图片检查没有覆盖服务端，请重新载入后再操作。");
        updateReviewForm(assetId, (current) => ({
          ...current,
          pending: false,
          retryPending: false,
        }));
        return;
      }
      const outcomeUncertain = result.error.status === 0 || result.error.status >= 500;
      if (!outcomeUncertain) delete reviewIntentsRef.current[assetId];
      updateReviewForm(assetId, (current) => ({
        ...current,
        message: outcomeUncertain
          ? "检查结果暂时无法确认；表单与结论已冻结，只能重试原检查请求。"
          : describeAdminImageApiError(result.error),
        pending: false,
        retryPending: outcomeUncertain,
      }));
      return;
    }
    delete reviewIntentsRef.current[assetId];
    syncRevision(result.data.draftRevision, result.response);
    const updatedCandidate = {
      asset: result.data.asset,
      imageSlot: result.data.imageSlot,
      previewUrl: result.data.previewUrl,
      reviewLocked: result.data.reviewLocked,
      selectedForSlot: result.data.selectedForSlot,
    };
    setCandidates((current) => replaceCandidate(current, updatedCandidate));
    setReviewForms((current) => ({
      ...current,
      [assetId]: {
        ...createReviewForm(result.data.asset),
        message: reviewStatusLabel(result.data.asset.reviewStatus),
      },
    }));
  }

  const aiUpload = isAiUpload(uploadForm);
  const uploadControlsDisabled =
    disabled || uploadState.kind === "uploading" || uploadState.kind === "uncertain";
  const knownAssets = new Map(
    [...(visualModule?.assets ?? []), ...candidates.map(({ asset }) => asset)].map((asset) => [
      asset.assetId,
      asset,
    ]),
  );

  return (
    <div className="admin-image-workbench">
      <section className="admin-image-source-rail" aria-label="图片来源优先级">
        <div data-active="true">
          <span>01 · 默认</span>
          <strong>GPT Image 2 自动生成</strong>
          <small>Worker 提前生成并上传到 Five 图片存储。</small>
        </div>
        <div>
          <span>02 · 补位</span>
          <strong>手动上传</strong>
          <small>缺图或生成结果不合适时直接替换候选。</small>
        </div>
        <div>
          <span>03 · 后续</span>
          <strong>搭配图库复用</strong>
          <small>按颜色、场景和人群复用已有模特图。</small>
        </div>
      </section>
      <section className="admin-image-slots" aria-labelledby="image-slot-title">
        <header>
          <div>
            <p className="admin-kicker">DAILY IMAGE SET · 2 + 1</p>
            <h3 id="image-slot-title">封面槽位</h3>
          </div>
          <p>槽位引用只来自下方高级 JSON；这里不会替你生成或改写穿法。</p>
        </header>
        <div className="admin-image-slots__grid">
          {slotDefinitions.map(({ code, label, note }) => {
            const look = visualModule?.looks.find((item) => item.imageSlot === code);
            const coverAsset = look === undefined ? undefined : knownAssets.get(look.coverAssetId);
            const fallbackAsset =
              look?.fallbackAssetId === null || look?.fallbackAssetId === undefined
                ? undefined
                : knownAssets.get(look.fallbackAssetId);
            const invalidFallback =
              look !== undefined &&
              code !== "optional" &&
              (look.fallbackAssetId === null ||
                look.fallbackAssetId === look.coverAssetId ||
                !isDeliverableAdminImageAsset(fallbackAsset));
            return (
              <article className="admin-image-slot" data-slot={code} key={code}>
                <span>
                  {code === "optional" ? "03" : code === "required_primary" ? "01" : "02"}
                </span>
                <div>
                  <h4>{label}</h4>
                  <p>{note}</p>
                  {look === undefined ? (
                    <strong>{code === "optional" ? "可选图未配置" : "尚未在 JSON 配置"}</strong>
                  ) : (
                    <dl>
                      <div>
                        <dt>封面</dt>
                        <dd>
                          {look.coverAssetId} <small>{assetSafetyLabel(coverAsset)}</small>
                        </dd>
                      </div>
                      <div>
                        <dt>降级</dt>
                        <dd>
                          {look.fallbackAssetId ?? "未配置"}{" "}
                          <small>{assetSafetyLabel(fallbackAsset)}</small>
                        </dd>
                      </div>
                    </dl>
                  )}
                  {invalidFallback ? <em>降级素材尚未审核安全</em> : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="admin-image-upload" aria-labelledby="image-upload-title">
        <header>
          <div>
            <p className="admin-kicker">UPLOAD · INTERNAL ONLY</p>
            <h3 id="image-upload-title">上传图片候选</h3>
          </div>
          <p>文件只送往服务端；页面不保存文件、草稿或权利凭据。</p>
        </header>
        <div className="admin-image-upload__form">
          <label className="admin-image-field">
            <span>用于哪个位置</span>
            <select
              disabled={uploadControlsDisabled}
              onChange={(event) =>
                updateUploadForm("imageSlot", event.currentTarget.value as DailyImageSlot)
              }
              value={uploadForm.imageSlot}
            >
              {slotDefinitions.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-image-field admin-image-field--wide">
            <span>选择图片文件</span>
            <input
              accept="image/avif,image/webp,image/jpeg,image/png"
              disabled={uploadControlsDisabled}
              onChange={(event) => {
                if (uploadIntentRef.current !== null) return;
                setUploadFile(event.currentTarget.files?.[0] ?? null);
                setUploadState({ kind: "idle" });
              }}
              ref={fileInputRef}
              type="file"
            />
          </label>
          <label className="admin-image-field admin-image-field--wide">
            <span>图片替代文字</span>
            <input
              disabled={uploadControlsDisabled}
              maxLength={300}
              onChange={(event) => updateUploadForm("altText", event.currentTarget.value)}
              value={uploadForm.altText}
            />
          </label>
          <label className="admin-image-field">
            <span>图片来源</span>
            <select
              disabled={uploadControlsDisabled}
              onChange={(event) =>
                changeSourceType(event.currentTarget.value as UploadForm["sourceType"])
              }
              value={uploadForm.sourceType}
            >
              <option value="licensed">授权或自有素材</option>
              <option value="ai_generated">AI 生成</option>
              <option value="fallback_template">降级模板</option>
            </select>
          </label>
          <label className="admin-image-field">
            <span>生成或上传方式</span>
            <select
              disabled={uploadControlsDisabled}
              onChange={(event) =>
                updateUploadForm(
                  "generationMethod",
                  event.currentTarget.value as UploadForm["generationMethod"],
                )
              }
              value={uploadForm.generationMethod}
            >
              {uploadForm.sourceType === "ai_generated" ? (
                <>
                  <option value="codex">Codex 主管线</option>
                  <option value="relay">供应商无关中转</option>
                  <option value="external_tool">外部生成工具</option>
                </>
              ) : uploadForm.sourceType === "fallback_template" ? (
                <option value="fallback_template">降级模板</option>
              ) : (
                <>
                  <option value="licensed_upload">授权素材上传</option>
                  <option value="owned_upload">自有素材上传</option>
                </>
              )}
            </select>
          </label>
          {aiUpload ? (
            <div className="admin-image-ai-fields">
              <p>AI 素材需保留可复核、可重现的生成链路。</p>
              <label className="admin-image-field">
                <span>声明模型</span>
                <input
                  disabled={uploadControlsDisabled}
                  onChange={(event) => updateUploadForm("declaredModel", event.currentTarget.value)}
                  value={uploadForm.declaredModel}
                />
              </label>
              <label className="admin-image-field">
                <span>提示词版本</span>
                <input
                  disabled={uploadControlsDisabled}
                  onChange={(event) => updateUploadForm("promptVersion", event.currentTarget.value)}
                  value={uploadForm.promptVersion}
                />
              </label>
              <label className="admin-image-field">
                <span>生成时间</span>
                <input
                  aria-label="生成时间"
                  disabled={uploadControlsDisabled}
                  onChange={(event) => updateUploadForm("generatedAt", event.currentTarget.value)}
                  type="datetime-local"
                  value={uploadForm.generatedAt}
                />
                <small>按北京时间填写。</small>
              </label>
              <label className="admin-image-field">
                <span>重现引用</span>
                <input
                  disabled={uploadControlsDisabled}
                  maxLength={500}
                  onChange={(event) =>
                    updateUploadForm("reproductionReference", event.currentTarget.value)
                  }
                  value={uploadForm.reproductionReference}
                />
              </label>
              <label className="admin-image-field">
                <span>AI 标识初始状态</span>
                <select
                  disabled={uploadControlsDisabled}
                  onChange={(event) =>
                    updateUploadForm(
                      "aiLabelStatus",
                      event.currentTarget.value as UploadForm["aiLabelStatus"],
                    )
                  }
                  value={uploadForm.aiLabelStatus}
                >
                  <option value="pending">待完成</option>
                  <option value="complete">已完成</option>
                  <option value="failed">失败</option>
                </select>
              </label>
            </div>
          ) : (
            <p className="admin-image-upload__hint">
              非 AI 素材不需要填写模型、提示词、生成时间和重现引用，AI 标识记为“不适用”。
            </p>
          )}
          <label className="admin-image-field admin-image-field--wide">
            <span>来源材料（每行一条）</span>
            <textarea
              disabled={uploadControlsDisabled}
              onChange={(event) =>
                updateUploadForm("sourceMaterialReferences", event.currentTarget.value)
              }
              rows={3}
              value={uploadForm.sourceMaterialReferences}
            />
          </label>
          <label className="admin-image-field admin-image-field--wide">
            <span>权利记录编号（每行一条）</span>
            <textarea
              disabled={uploadControlsDisabled}
              onChange={(event) => updateUploadForm("rightsRecordIds", event.currentTarget.value)}
              rows={3}
              value={uploadForm.rightsRecordIds}
            />
          </label>
        </div>
        <div className="admin-image-upload__actions">
          <button
            className="admin-button admin-button--primary"
            disabled={disabled || uploadState.kind === "uploading"}
            onClick={() => void uploadCandidate()}
            type="button"
          >
            {uploadState.kind === "uploading"
              ? "正在上传…"
              : uploadState.kind === "uncertain"
                ? "重试原上传"
                : "上传图片候选"}
          </button>
          {uploadState.kind === "error" || uploadState.kind === "uncertain" ? (
            <p className="admin-message admin-message--error" role="alert">
              {uploadState.message}
            </p>
          ) : null}
          {uploadState.kind === "success" ? (
            <p className="admin-message admin-message--success" role="status">
              {uploadState.message}
            </p>
          ) : null}
        </div>
      </section>

      <section className="admin-image-candidates" aria-labelledby="image-candidates-title">
        <header>
          <div>
            <p className="admin-kicker">MANUAL REVIEW · SIX CHECKS</p>
            <h3 id="image-candidates-title">逐图人工检查</h3>
          </div>
          <button
            className="admin-button admin-button--quiet"
            disabled={disabled || loadState.kind === "loading"}
            onClick={() => void loadCandidates()}
            type="button"
          >
            刷新候选
          </button>
        </header>
        {loadState.kind === "loading" ? <p role="status">正在读取服务端图片候选…</p> : null}
        {loadState.kind === "error" ? (
          <p className="admin-message admin-message--error" role="alert">
            {loadState.message}
          </p>
        ) : null}
        {loadState.kind === "ready" && candidates.length === 0 ? (
          <p className="admin-image-candidates__empty">
            还没有图片候选。上传后会在这里恢复，不依赖本地存储。
          </p>
        ) : null}
        <div className="admin-image-candidates__list">
          {candidates.map((candidate) => {
            const { asset } = candidate;
            const reviewForm = reviewForms[asset.assetId] ?? createReviewForm(asset);
            const retryDecision = reviewIntentsRef.current[asset.assetId]?.body.decision ?? null;
            const reviewControlsDisabled =
              disabled || candidate.reviewLocked || reviewForm.pending || reviewForm.retryPending;
            return (
              <article className="admin-image-candidate" key={asset.assetId}>
                <div className="admin-image-candidate__preview">
                  {/* Authenticated previews are dynamic, same-origin files with server-owned dimensions. */}
                  <img alt={asset.altText} src={candidate.previewUrl} />
                  <span data-status={asset.reviewStatus}>
                    {reviewStatusLabel(asset.reviewStatus)}
                  </span>
                </div>
                <div className="admin-image-candidate__body">
                  <header>
                    <div>
                      <h4>{asset.altText}</h4>
                      <code>{asset.assetId}</code>
                    </div>
                    <strong>
                      {sourceLabel(asset.sourceType)} · {candidate.imageSlot ?? "未分槽"}
                      {candidate.selectedForSlot ? " · 当前使用" : ""}
                    </strong>
                  </header>
                  <dl className="admin-image-asset-facts">
                    <div>
                      <dt>文件</dt>
                      <dd>
                        {asset.width} × {asset.height} ·{" "}
                        {asset.mediaType.replace("image/", "").toUpperCase()}
                      </dd>
                    </div>
                    <div>
                      <dt>SHA-256</dt>
                      <dd title={asset.sha256}>
                        {asset.sha256.slice(0, 12)}…{asset.sha256.slice(-8)}
                      </dd>
                    </div>
                    <div>
                      <dt>生成方式</dt>
                      <dd>{asset.generationMethod}</dd>
                    </div>
                    <div>
                      <dt>权利 / 标识</dt>
                      <dd>
                        {asset.rightsStatus} / {asset.aiLabelStatus}
                      </dd>
                    </div>
                  </dl>
                  {asset.sourceType === "ai_generated" ? (
                    <p className="admin-image-candidate__provenance">
                      {asset.declaredModel} · {asset.promptVersion} · {asset.reproductionReference}
                    </p>
                  ) : null}
                  {candidate.reviewLocked ? (
                    <p className="admin-image-review-lock" role="note">
                      复制素材审核已冻结；如需调整请上传新素材
                    </p>
                  ) : null}
                  <fieldset className="admin-image-review-checks" disabled={reviewControlsDisabled}>
                    <legend>六项检查</legend>
                    {reviewChecks.map(({ detail, key, label }) => (
                      <label key={key}>
                        <input
                          aria-label={label}
                          checked={reviewForm.checks[key]}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked;
                            editReviewForm(asset.assetId, (current) => ({
                              ...current,
                              checks: { ...current.checks, [key]: checked },
                              message: null,
                            }));
                          }}
                          type="checkbox"
                        />
                        <span>
                          <strong>{label}</strong>
                          <small>{detail}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="admin-image-review-fields">
                    <label className="admin-image-field">
                      <span>权利状态</span>
                      <select
                        aria-label={`${asset.assetId} 权利状态`}
                        disabled={reviewControlsDisabled}
                        onChange={(event) => {
                          const rightsStatus = event.currentTarget
                            .value as ReviewForm["rightsStatus"];
                          editReviewForm(asset.assetId, (current) => ({
                            ...current,
                            message: null,
                            rightsStatus,
                          }));
                        }}
                        value={reviewForm.rightsStatus}
                      >
                        <option value="pending">待清理</option>
                        <option value="cleared">已清理</option>
                        <option value="rejected">已拒绝</option>
                        <option value="revoked">已撤销</option>
                      </select>
                    </label>
                    <label className="admin-image-field">
                      <span>AI 标识状态</span>
                      <select
                        aria-label={`${asset.assetId} AI 标识状态`}
                        disabled={reviewControlsDisabled}
                        onChange={(event) => {
                          const aiLabelStatus = event.currentTarget
                            .value as ReviewForm["aiLabelStatus"];
                          editReviewForm(asset.assetId, (current) => ({
                            ...current,
                            aiLabelStatus,
                            message: null,
                          }));
                        }}
                        value={reviewForm.aiLabelStatus}
                      >
                        <option value="not_applicable">不适用</option>
                        <option value="pending">待完成</option>
                        <option value="complete">已完成</option>
                        <option value="failed">失败</option>
                      </select>
                    </label>
                    <label className="admin-image-field admin-image-field--wide">
                      <span>审核备注</span>
                      <textarea
                        aria-label={`${asset.assetId} 审核备注`}
                        disabled={reviewControlsDisabled}
                        maxLength={2000}
                        onChange={(event) => {
                          const notes = event.currentTarget.value;
                          editReviewForm(asset.assetId, (current) => ({
                            ...current,
                            message: null,
                            notes,
                          }));
                        }}
                        rows={3}
                        value={reviewForm.notes}
                      />
                    </label>
                  </div>
                  <div className="admin-image-review-actions">
                    <button
                      className="admin-button admin-button--primary"
                      disabled={
                        disabled ||
                        candidate.reviewLocked ||
                        reviewForm.pending ||
                        (reviewForm.retryPending && retryDecision !== "approved")
                      }
                      onClick={() => void reviewCandidate(candidate, "approved")}
                      type="button"
                    >
                      {reviewForm.pending && retryDecision === "approved"
                        ? "正在重试批准…"
                        : reviewForm.pending
                          ? "正在保存…"
                          : reviewForm.retryPending && retryDecision === "approved"
                            ? `重试批准 ${asset.assetId}`
                            : `批准 ${asset.assetId}`}
                    </button>
                    <button
                      className="admin-button admin-button--danger-outline"
                      disabled={
                        disabled ||
                        candidate.reviewLocked ||
                        reviewForm.pending ||
                        (reviewForm.retryPending && retryDecision !== "rejected")
                      }
                      onClick={() => void reviewCandidate(candidate, "rejected")}
                      type="button"
                    >
                      {reviewForm.pending && retryDecision === "rejected"
                        ? "正在重试拒绝…"
                        : reviewForm.retryPending && retryDecision === "rejected"
                          ? `重试拒绝 ${asset.assetId}`
                          : `拒绝 ${asset.assetId}`}
                    </button>
                    {reviewForm.message === null ? null : (
                      <p
                        className={
                          asset.reviewStatus === "approved"
                            ? "admin-message admin-message--success"
                            : "admin-message admin-message--error"
                        }
                        role={asset.reviewStatus === "approved" ? "status" : "alert"}
                      >
                        {reviewForm.message}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <p className="admin-image-workbench__revision">
        图片候选绑定命理日 {fortuneDate} · 当前草稿修订 {draftRevision}
      </p>
    </div>
  );
}
