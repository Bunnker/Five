"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  adminApi,
  createIdempotencyKey,
  describeAdminImageApiError,
  type AdminContentVersion,
  type AdminDailyImageSet,
  type AdminImageAsset,
  type WithdrawImageAssetRequest,
} from "../../../admin-api";
import { formatAdminDateTimeWithYear } from "../../../admin-date-time";

type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

type ActionState =
  | { kind: "idle" }
  | { assetId: string; kind: "loading" }
  | { assetId: string; kind: "error" | "uncertain"; message: string }
  | { kind: "success"; message: string };

type WithdrawalIntent = {
  body: WithdrawImageAssetRequest;
  etag: string;
  idempotencyKey: string;
};

type Props = {
  activeContentVersion: string | null;
  contentVersion: string;
  csrfToken: string;
  enabled?: boolean;
  onLifecycleChange: (input: { etag: string; lifecycleRevision: number }) => void;
  onUnauthorized: () => void;
  versionState: AdminContentVersion["state"];
};

const slotLabels = {
  optional: "可选图",
  required_alternative: "必备备选图",
  required_primary: "必备主图",
} as const;

const statusLabels = {
  aiLabel: {
    complete: "标识已完成",
    failed: "标识失败",
    not_applicable: "无需 AI 标识",
    pending: "等待 AI 标识",
  },
  review: {
    approved: "人工检查通过",
    pending: "等待人工检查",
    rejected: "人工检查拒绝",
    withdrawn: "已停止使用",
  },
  rights: {
    cleared: "权利已核清",
    pending: "权利待核清",
    rejected: "权利不通过",
    revoked: "权利已撤销",
  },
} as const;

function previewPath(assetId: string): string {
  return `/admin/api/v1/image-assets/${encodeURIComponent(assetId)}/preview`;
}

function deliveryLabel(status: "active" | "fallback" | "omitted" | "unavailable"): string {
  if (status === "active") return "当前交付：原图";
  if (status === "fallback") return "当前交付：已切换审核降级图";
  if (status === "omitted") return "当前交付：已省略可选图";
  return "当前交付：必备图不可用";
}

function assetRoles(imageSet: AdminDailyImageSet, assetId: string): string[] {
  const roles = new Set<string>();
  imageSet.slots.forEach((slot) => {
    const slotLabel = slotLabels[slot.imageSlot];
    if (slot.coverAssetId === assetId) roles.add(`${slotLabel} · 原封面`);
    if (slot.fallbackAssetId === assetId) roles.add(`${slotLabel} · 降级素材`);
    if (slot.detailAssetIds.includes(assetId)) roles.add(`${slotLabel} · 细节图`);
    if (slot.servedCoverAssetId === assetId) roles.add(`${slotLabel} · 当前封面`);
    if (slot.servedDetailAssetIds.includes(assetId)) roles.add(`${slotLabel} · 当前细节`);
  });
  if (roles.size === 0) roles.add("快照素材 · 未绑定公开槽位");
  return Array.from(roles);
}

function AssetFacts({ asset }: { asset: AdminImageAsset }) {
  return (
    <dl className="admin-image-facts">
      <div>
        <dt>素材编号</dt>
        <dd>
          <code>{asset.assetId}</code>
        </dd>
      </div>
      <div>
        <dt>文件核验</dt>
        <dd>
          {asset.width} × {asset.height} · {asset.mediaType}
        </dd>
      </div>
      <div>
        <dt>SHA-256</dt>
        <dd>
          <code>{asset.sha256}</code>
        </dd>
      </div>
      <div>
        <dt>来源</dt>
        <dd>
          {asset.sourceType} · {asset.generationMethod}
        </dd>
      </div>
      <div>
        <dt>来源材料</dt>
        <dd>{asset.sourceMaterialReferences.join("、")}</dd>
      </div>
      <div>
        <dt>权利记录</dt>
        <dd>{asset.rightsRecordIds.join("、")}</dd>
      </div>
      <div>
        <dt>检查状态</dt>
        <dd>
          {statusLabels.review[asset.reviewStatus]} · {statusLabels.rights[asset.rightsStatus]} ·{" "}
          {statusLabels.aiLabel[asset.aiLabelStatus]}
        </dd>
      </div>
      {asset.manualReview === null ? null : (
        <div>
          <dt>人工复核</dt>
          <dd>
            {asset.manualReview.reviewerAccountId} ·{" "}
            {formatAdminDateTimeWithYear(asset.manualReview.reviewedAt)}
            {asset.manualReview.notes.length > 0 ? ` · ${asset.manualReview.notes}` : ""}
          </dd>
        </div>
      )}
    </dl>
  );
}

export function AdminDailyImageSetPanel({
  activeContentVersion,
  contentVersion,
  csrfToken,
  enabled = true,
  onLifecycleChange,
  onUnauthorized,
}: Props) {
  const [imageSet, setImageSet] = useState<AdminDailyImageSet | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [actionState, setActionState] = useState<ActionState>({ kind: "idle" });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const pendingIntentsRef = useRef(new Map<string, WithdrawalIntent>());

  const loadImageSet = useCallback(async () => {
    setLoadState({ kind: "loading" });
    const result = await adminApi.getDailyImageSet(contentVersion);
    if (!result.ok) {
      if (result.error.status === 401) {
        onUnauthorized();
        return;
      }
      setLoadState({ kind: "error", message: describeAdminImageApiError(result.error) });
      return;
    }
    const latestEtag = result.response.headers.get("ETag");
    if (latestEtag === null) {
      setLoadState({
        kind: "error",
        message: "后台没有返回图片交付修订凭据，已阻止单图下线操作。",
      });
      return;
    }
    setImageSet(result.data);
    setEtag(latestEtag);
    setLoadState({ kind: "ready" });
  }, [contentVersion, onUnauthorized]);

  useEffect(() => {
    if (enabled) void loadImageSet();
  }, [enabled, loadImageSet]);

  const withdrawalEventsByAssetId = useMemo(
    () => new Map(imageSet?.withdrawalEvents.map((event) => [event.assetId, event]) ?? []),
    [imageSet],
  );

  async function withdrawAsset(assetId: string) {
    if (etag === null || actionState.kind === "loading") return;
    if (actionState.kind === "uncertain" && actionState.assetId !== assetId) return;
    let intent = pendingIntentsRef.current.get(assetId);
    if (intent === undefined) {
      const reason = (reasons[assetId] ?? "").trim();
      if (reason.length === 0) {
        setActionState({ assetId, kind: "error", message: "请填写单图下线原因。" });
        return;
      }
      let idempotencyKey: string;
      try {
        idempotencyKey = createIdempotencyKey();
      } catch {
        setActionState({
          assetId,
          kind: "error",
          message: "当前浏览器无法生成安全操作编号，不能执行单图下线。",
        });
        return;
      }
      intent = {
        body: { expectedActiveContentVersion: activeContentVersion, reason },
        etag,
        idempotencyKey,
      };
      pendingIntentsRef.current.set(assetId, intent);
      setReasons((current) => ({ ...current, [assetId]: reason }));
    }

    setActionState({ assetId, kind: "loading" });
    const result = await adminApi.withdrawImage({
      assetId,
      body: intent.body,
      contentVersion,
      csrfToken,
      etag: intent.etag,
      idempotencyKey: intent.idempotencyKey,
    });
    if (!result.ok) {
      if (result.error.status === 401) {
        pendingIntentsRef.current.delete(assetId);
        onUnauthorized();
        return;
      }
      const outcomeUncertain = result.error.status === 0 || result.error.status >= 500;
      if (!outcomeUncertain) pendingIntentsRef.current.delete(assetId);
      if (result.error.status === 412) await loadImageSet();
      setActionState({
        assetId,
        kind: outcomeUncertain ? "uncertain" : "error",
        message: outcomeUncertain
          ? "下线结果暂时无法确认。原因已冻结，只能重试原下线请求。"
          : result.error.status === 422
            ? "当前图片没有可继续交付的安全降级素材，请执行整版下线。"
            : describeAdminImageApiError(result.error),
      });
      return;
    }

    const latestEtag = result.response.headers.get("ETag");
    if (latestEtag === null) {
      setActionState({
        assetId,
        kind: "uncertain",
        message: "下线已响应但无法确认最新修订。原因已冻结，只能重试原下线请求。",
      });
      return;
    }
    pendingIntentsRef.current.delete(assetId);
    setImageSet(result.data.dailyImageSet);
    setEtag(latestEtag);
    setReasons((current) => ({ ...current, [assetId]: "" }));
    setActionState({
      kind: "success",
      message:
        result.data.deliveryAction === "fallback_activated"
          ? "问题图片已下线，公开交付已切换到审核通过的降级图。"
          : result.data.deliveryAction === "optional_omitted"
            ? "问题图片已下线，可选图已从公开交付中省略。"
            : result.data.deliveryAction === "detail_omitted"
              ? "问题细节图已从公开交付中省略。"
              : "图片下线事件已记录，当前公开交付未发生变化。",
    });
    onLifecycleChange({ etag: latestEtag, lifecycleRevision: result.data.lifecycleRevision });
  }

  if (!enabled) {
    return (
      <section
        className="admin-content-panel admin-image-set-panel"
        aria-labelledby="image-set-title"
      >
        <div className="admin-section-heading">
          <p className="admin-kicker">02 · DAILY IMAGE DELIVERY</p>
          <h2 id="image-set-title">每日图片组与当前交付</h2>
        </div>
        <p className="admin-content-empty">此版本没有冻结视觉与权利模块，因此没有每日图片组。</p>
      </section>
    );
  }

  if (loadState.kind === "loading" && imageSet === null) {
    return (
      <section
        className="admin-content-panel admin-image-set-panel"
        aria-labelledby="image-set-title"
      >
        <p className="admin-loading" id="image-set-title" role="status">
          正在读取每日图片交付…
        </p>
      </section>
    );
  }

  if (loadState.kind === "error" || imageSet === null) {
    return (
      <section
        className="admin-content-panel admin-image-set-panel"
        aria-labelledby="image-set-title"
      >
        <div className="admin-section-heading">
          <p className="admin-kicker">02 · DAILY IMAGE DELIVERY</p>
          <h2 id="image-set-title">每日图片组</h2>
        </div>
        <p className="admin-message admin-message--error" role="alert">
          {loadState.kind === "error" ? loadState.message : "图片交付响应不完整。"}
        </p>
        <button
          className="admin-button admin-button--quiet"
          onClick={() => void loadImageSet()}
          type="button"
        >
          重新读取图片组
        </button>
      </section>
    );
  }

  return (
    <section
      className="admin-content-panel admin-image-set-panel"
      aria-labelledby="image-set-title"
    >
      <div className="admin-section-heading admin-image-set-heading">
        <div>
          <p className="admin-kicker">02 · DAILY IMAGE DELIVERY</p>
          <h2 id="image-set-title">每日图片组与当前交付</h2>
        </div>
        <small>
          修订 {imageSet.lifecycleRevision} · {etag}
        </small>
      </div>
      <p className="admin-inline-note">
        素材快照保持不可变；“已撤”只依据追加式下线事件和服务端交付投影判断。预览统一经过后台同源路由。
      </p>

      <div className="admin-image-slot-grid">
        {imageSet.slots.map((slot) => {
          const slotLabel = slotLabels[slot.imageSlot];
          return (
            <article className="admin-image-slot-card" key={slot.imageSlot}>
              <header>
                <div>
                  <p>{slotLabel}</p>
                  <h3>{deliveryLabel(slot.deliveryStatus)}</h3>
                </div>
                <span
                  className={`admin-delivery-badge admin-delivery-badge--${slot.deliveryStatus}`}
                >
                  {slot.deliveryStatus}
                </span>
              </header>
              <dl className="admin-slot-projection">
                <div>
                  <dt>原始封面</dt>
                  <dd>
                    <code>{slot.coverAssetId}</code>
                  </dd>
                </div>
                <div>
                  <dt>降级素材</dt>
                  <dd>
                    {slot.fallbackAssetId === null ? "不适用" : <code>{slot.fallbackAssetId}</code>}
                  </dd>
                </div>
                <div>
                  <dt>当前封面</dt>
                  <dd>
                    {slot.servedCoverAssetId === null ? (
                      "无"
                    ) : (
                      <code>{slot.servedCoverAssetId}</code>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>原始细节</dt>
                  <dd>
                    {slot.detailAssetIds.length === 0 ? "无" : slot.detailAssetIds.join("、")}
                  </dd>
                </div>
                <div>
                  <dt>当前细节</dt>
                  <dd>
                    {slot.servedDetailAssetIds.length === 0
                      ? "无"
                      : slot.servedDetailAssetIds.join("、")}
                  </dd>
                </div>
              </dl>
              {slot.servedCoverAssetId === null ? (
                <p className="admin-image-omitted">
                  {slot.deliveryStatus === "unavailable"
                    ? "该必备槽位当前没有可安全交付的图片。"
                    : "该可选槽位当前不向公开页面交付图片。"}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>

      <section className="admin-image-asset-ledger" aria-labelledby="frozen-assets-title">
        <header>
          <div>
            <p className="admin-kicker">FROZEN ASSET LEDGER</p>
            <h3 id="frozen-assets-title">全部冻结素材</h3>
          </div>
          <p>包括未服务的降级图、细节图与未绑定素材；问题素材均需留下追加式下线审计。</p>
        </header>
        <div className="admin-image-asset-ledger__list">
          {imageSet.assets.map((asset) => {
            const withdrawalEvent = withdrawalEventsByAssetId.get(asset.assetId);
            const canWithdraw = withdrawalEvent === undefined;
            const reason = reasons[asset.assetId] ?? "";
            const targetUncertain =
              actionState.kind === "uncertain" && actionState.assetId === asset.assetId;
            const anotherIntentUncertain =
              actionState.kind === "uncertain" && actionState.assetId !== asset.assetId;
            const withdrawalControlsLocked =
              actionState.kind === "loading" || actionState.kind === "uncertain";
            return (
              <article className="admin-image-asset-card" key={asset.assetId}>
                <header>
                  <div>
                    <h4>{asset.altText}</h4>
                    <code>{asset.assetId}</code>
                  </div>
                  <div className="admin-image-role-list" aria-label={`${asset.assetId} 素材角色`}>
                    {assetRoles(imageSet, asset.assetId).map((role) => (
                      <span key={role}>{role}</span>
                    ))}
                    {withdrawalEvent === undefined ? null : <strong>已撤</strong>}
                  </div>
                </header>
                <div className="admin-image-asset-card__content">
                  {/* Authenticated previews must use the same-origin admin route, never fileUrl. */}
                  <img
                    alt={asset.altText}
                    className="admin-image-preview"
                    src={previewPath(asset.assetId)}
                  />
                  <AssetFacts asset={asset} />
                </div>

                {withdrawalEvent === undefined ? null : (
                  <div className="admin-image-asset-withdrawn">
                    <strong>已追加单图下线事件</strong>
                    <time dateTime={withdrawalEvent.withdrawnAt}>
                      {formatAdminDateTimeWithYear(withdrawalEvent.withdrawnAt)}
                    </time>
                    <p>{withdrawalEvent.reason}</p>
                    <small>审计 {withdrawalEvent.auditEventId}</small>
                  </div>
                )}

                {canWithdraw ? (
                  <div className="admin-image-withdrawal">
                    <label>
                      <span>{asset.assetId} 下线原因</span>
                      <textarea
                        aria-label={`${asset.assetId} 下线原因`}
                        disabled={withdrawalControlsLocked}
                        maxLength={2000}
                        onChange={(event) => {
                          if (pendingIntentsRef.current.size > 0) return;
                          const nextReason = event.currentTarget.value;
                          const assetId = asset.assetId;
                          setReasons((current) => ({ ...current, [assetId]: nextReason }));
                        }}
                        placeholder="说明权利、内容或画面问题；写入后不可改写"
                        rows={3}
                        value={reason}
                      />
                    </label>
                    <button
                      className="admin-button admin-button--danger-outline"
                      disabled={actionState.kind === "loading" || anotherIntentUncertain}
                      onClick={() => void withdrawAsset(asset.assetId)}
                      type="button"
                    >
                      {actionState.kind === "loading" && actionState.assetId === asset.assetId
                        ? "正在下线…"
                        : targetUncertain
                          ? `重试下线素材 ${asset.assetId}`
                          : `下线素材 ${asset.assetId}`}
                    </button>
                    {(actionState.kind === "error" || actionState.kind === "uncertain") &&
                    actionState.assetId === asset.assetId ? (
                      <p className="admin-message admin-message--error" role="alert">
                        {actionState.message}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {actionState.kind === "success" ? (
        <p className="admin-message admin-message--success" role="status">
          {actionState.message}
        </p>
      ) : null}

      {imageSet.withdrawalEvents.length === 0 ? null : (
        <details className="admin-image-withdrawal-history">
          <summary>查看下线审计（{imageSet.withdrawalEvents.length}）</summary>
          <ol>
            {imageSet.withdrawalEvents.map((event) => (
              <li key={event.withdrawalEventId}>
                <strong>{event.assetId}</strong>
                <time dateTime={event.withdrawnAt}>
                  {formatAdminDateTimeWithYear(event.withdrawnAt)}
                </time>
                <p>{event.reason}</p>
                <small>审计 {event.auditEventId}</small>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
