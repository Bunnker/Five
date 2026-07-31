"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type { AdminSession } from "./admin-api";
import { useAdminSession } from "./admin-session-context";

export function AdminSessionGate({ children }: { children: (session: AdminSession) => ReactNode }) {
  const { refreshSession, state } = useAdminSession();

  if (state.kind === "loading") {
    return (
      <section className="admin-state-card" aria-live="polite">
        <span className="admin-state-card__mark" aria-hidden="true" />
        <h1>正在确认后台会话</h1>
        <p>只向同源后台核验安全 Cookie，不读取浏览器本地存储。</p>
      </section>
    );
  }

  if (state.kind === "unauthenticated") {
    return (
      <section className="admin-state-card">
        <p className="admin-kicker">SESSION REQUIRED</p>
        <h1>需要重新登录</h1>
        <p>后台会话不存在、已经闲置失效，或到达十二小时绝对期限。</p>
        <Link className="admin-button admin-button--primary" href="/admin/login">
          前往登录
        </Link>
      </section>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <section className="admin-state-card">
        <p className="admin-kicker">CONNECTION PAUSED</p>
        <h1>暂时无法确认会话</h1>
        <p role="alert">{state.message}</p>
        <button
          className="admin-button admin-button--quiet"
          onClick={() => void refreshSession()}
          type="button"
        >
          重新确认
        </button>
      </section>
    );
  }

  return children(state.session);
}
