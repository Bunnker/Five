"use client";

import { useCallback, useEffect, useState } from "react";

import { adminApi, describeAdminApiError, type SecurityEvent } from "../admin-api";
import { AdminSessionGate } from "../admin-session-gate";
import { useAdminSession } from "../admin-session-context";

const actionLabels: Record<SecurityEvent["action"], string> = {
  bootstrap_completed: "完成初始配置",
  csrf_rejected: "安全校验拒绝",
  emergency_resume: "恢复公开内容",
  emergency_stop: "停止公开内容",
  login_password: "密码核验",
  login_totp: "动态码登录",
  logout_all: "注销全部会话",
  logout_current: "退出当前会话",
  offline_reset: "离线重置",
  rate_limited: "触发限流",
  recovery_code: "恢复码核验",
  recovery_completed: "完成控制权恢复",
};

type LoadingState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "loading-more" }
  | { kind: "error"; message: string };

const occurredAtFormat = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  year: "numeric",
});

function SecurityEventCard({ event }: { event: SecurityEvent }) {
  return (
    <article className="admin-event-card">
      <header>
        <span
          className={`admin-status-badge admin-status-badge--${event.outcome === "succeeded" ? "safe" : "rejected"}`}
        >
          {event.outcome === "succeeded" ? "成功" : "已拒绝"}
        </span>
        <time dateTime={event.occurredAt}>
          {occurredAtFormat.format(new Date(event.occurredAt))}
        </time>
      </header>
      <h2>{actionLabels[event.action]}</h2>
      <dl>
        <div>
          <dt>来源指纹</dt>
          <dd>
            <code>{event.sourceFingerprint}</code>
          </dd>
        </div>
        <div>
          <dt>浏览器摘要</dt>
          <dd>{event.clientSummary ?? "未提供"}</dd>
        </div>
        {event.reason === null ? null : (
          <div>
            <dt>记录原因</dt>
            <dd>{event.reason}</dd>
          </div>
        )}
        <div>
          <dt>请求编号</dt>
          <dd>
            <code>{event.requestId}</code>
          </dd>
        </div>
      </dl>
    </article>
  );
}

function SecurityEventsContent() {
  const { clearSession } = useAdminSession();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>({ kind: "loading" });

  const loadEvents = useCallback(
    async (cursor: string | null, append: boolean) => {
      setLoadingState({ kind: append ? "loading-more" : "loading" });
      const result = await adminApi.listSecurityEvents(cursor);
      if (!result.ok) {
        if (result.error.status === 401) {
          clearSession();
          return;
        }
        setLoadingState({
          kind: "error",
          message: describeAdminApiError(result.error, true),
        });
        return;
      }

      setEvents((current) =>
        append ? [...current, ...result.data.items] : [...result.data.items],
      );
      setNextCursor(result.data.nextCursor);
      setLoadingState({ kind: "ready" });
    },
    [clearSession],
  );

  useEffect(() => {
    void loadEvents(null, false);
  }, [loadEvents]);

  return (
    <div className="admin-security-page">
      <header className="admin-page-heading">
        <div>
          <p className="admin-kicker">SECURITY LEDGER · 至少保留 365 天</p>
          <h1>安全记录</h1>
        </div>
        <p>这里只显示单向来源指纹与受限浏览器摘要，不返回地址、凭据或令牌原文。</p>
      </header>

      {loadingState.kind === "loading" ? (
        <p className="admin-loading" role="status">
          正在读取安全记录…
        </p>
      ) : null}

      {events.length === 0 && loadingState.kind === "ready" ? (
        <section className="admin-state-card">
          <h2>还没有安全记录</h2>
          <p>完成登录、恢复或紧急控制后，相关结果会出现在这里。</p>
        </section>
      ) : null}

      {events.length > 0 ? (
        <div className="admin-event-list" aria-label="安全事件">
          {events.map((event) => (
            <SecurityEventCard event={event} key={event.eventId} />
          ))}
        </div>
      ) : null}

      {loadingState.kind === "error" ? (
        <div className="admin-message admin-message--error" role="alert">
          <p>{loadingState.message}</p>
          <button
            className="admin-button admin-button--quiet"
            onClick={() => void loadEvents(null, false)}
            type="button"
          >
            重新加载
          </button>
        </div>
      ) : null}

      {nextCursor !== null && loadingState.kind !== "error" ? (
        <button
          className="admin-button admin-button--quiet admin-button--center"
          disabled={loadingState.kind === "loading-more"}
          onClick={() => void loadEvents(nextCursor, true)}
          type="button"
        >
          {loadingState.kind === "loading-more" ? "正在加载…" : "加载更多记录"}
        </button>
      ) : null}
    </div>
  );
}

export function SecurityEventsPanel() {
  return <AdminSessionGate>{() => <SecurityEventsContent />}</AdminSessionGate>;
}
