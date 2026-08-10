"use client";

import Link from "next/link";
import { useState } from "react";

import { adminApi, describeAdminApiError, type AdminSession } from "./admin-api";
import { AdminSessionGate } from "./admin-session-gate";
import { useAdminSession } from "./admin-session-context";

type ActionState = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };

function SessionDashboard({ session }: { session: AdminSession }) {
  const { clearSession } = useAdminSession();
  const [actionState, setActionState] = useState<ActionState>({ kind: "idle" });

  async function endSession(all: boolean) {
    if (actionState.kind === "submitting") return;
    setActionState({ kind: "submitting" });
    const result = all
      ? await adminApi.logoutAll(session.csrfToken)
      : await adminApi.logout(session.csrfToken);

    if (result.ok || (!result.ok && result.error.status === 401)) {
      clearSession();
      return;
    }
    setActionState({
      kind: "error",
      message: describeAdminApiError(result.error, true),
    });
  }

  const busy = actionState.kind === "submitting";

  return (
    <div className="admin-dashboard">
      <section className="admin-welcome" aria-labelledby="admin-dashboard-title">
        <div>
          <p className="admin-kicker">FIVE 内容后台</p>
          <h1 id="admin-dashboard-title">
            你好，<strong>{session.username}</strong>
          </h1>
          <p>每天的文字和模特图会自动准备并发布；在这里查看用户端效果，有问题直接修改替换。</p>
        </div>
        <span className="admin-status-badge admin-status-badge--safe">已登录</span>
      </section>

      <section className="admin-session-ledger" aria-labelledby="today-work-title">
        <div className="admin-section-heading">
          <p className="admin-kicker">今天的发布流程</p>
          <h2 id="today-work-title">今天要做什么</h2>
        </div>
        <dl>
          <div>
            <dt>1 · 准备内容</dt>
            <dd>填写五档颜色、穿搭建议和分享文案</dd>
          </div>
          <div>
            <dt>2 · 准备图片</dt>
            <dd>上传至少两张模特图并完成人工检查</dd>
          </div>
          <div>
            <dt>3 · 发布后修正</dt>
            <dd>先让用户看到，大师发现问题后再修改替换</dd>
          </div>
        </dl>
        <p className="admin-inline-note">
          <strong>当前本地公开页读取真实已发布内容</strong>
          。内容生成后直接发布，检查记录可以随后补充。
        </p>
      </section>

      <section className="admin-command-grid" aria-label="后台入口">
        <Link className="admin-command-card admin-command-card--content" href="/admin/content">
          <span className="admin-command-card__number">01</span>
          <span>
            <strong>管理今天的内容</strong>
            <small>查看用户端效果、修改并替换版本</small>
          </span>
          <span aria-hidden="true">↗</span>
        </Link>
        <Link className="admin-command-card" href="/admin/security">
          <span className="admin-command-card__number">02</span>
          <span>
            <strong>安全记录</strong>
            <small>查看登录、限流与重要操作</small>
          </span>
          <span aria-hidden="true">↗</span>
        </Link>
        <Link className="admin-command-card admin-command-card--danger" href="/admin/emergency">
          <span className="admin-command-card__number">03</span>
          <span>
            <strong>紧急停止公开页</strong>
            <small>仅在内容存在严重问题时使用</small>
          </span>
          <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <section className="admin-signout" aria-labelledby="signout-title">
        <div>
          <p className="admin-kicker">账号</p>
          <h2 id="signout-title">退出后台</h2>
          <p>当前账号：{session.username}。普通情况下退出当前会话即可。</p>
        </div>
        <div className="admin-form__actions">
          <button
            className="admin-button admin-button--quiet"
            disabled={busy}
            onClick={() => void endSession(false)}
            type="button"
          >
            退出当前会话
          </button>
          <button
            className="admin-button admin-button--danger-outline"
            disabled={busy}
            onClick={() => void endSession(true)}
            type="button"
          >
            注销全部会话
          </button>
        </div>
        {actionState.kind === "error" ? (
          <p className="admin-message admin-message--error" role="alert">
            {actionState.message}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function AdminDashboard() {
  return <AdminSessionGate>{(session) => <SessionDashboard session={session} />}</AdminSessionGate>;
}
