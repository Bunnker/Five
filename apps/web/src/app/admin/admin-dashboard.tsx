"use client";

import Link from "next/link";
import { useState } from "react";

import { adminApi, describeAdminApiError, type AdminSession } from "./admin-api";
import { AdminSessionGate } from "./admin-session-gate";
import { useAdminSession } from "./admin-session-context";

type ActionState = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
});

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
          <p className="admin-kicker">ON DUTY · 当前值守</p>
          <h1 id="admin-dashboard-title">控制台</h1>
          <p>
            已验证维护者 <strong>{session.username}</strong>
          </p>
        </div>
        <span className="admin-status-badge admin-status-badge--safe">会话有效</span>
      </section>

      <section className="admin-session-ledger" aria-labelledby="session-ledger-title">
        <div className="admin-section-heading">
          <p className="admin-kicker">SESSION LEDGER</p>
          <h2 id="session-ledger-title">本次会话</h2>
        </div>
        <dl>
          <div>
            <dt>闲置期限</dt>
            <dd>
              <time dateTime={session.idleExpiresAt}>
                {dateTimeFormat.format(new Date(session.idleExpiresAt))}
              </time>
            </dd>
          </div>
          <div>
            <dt>绝对期限</dt>
            <dd>
              <time dateTime={session.absoluteExpiresAt}>
                {dateTimeFormat.format(new Date(session.absoluteExpiresAt))}
              </time>
            </dd>
          </div>
          <div>
            <dt>凭据修订</dt>
            <dd>第 {session.credentialRevision} 版</dd>
          </div>
        </dl>
        <p className="admin-inline-note">安全令牌只存在当前运行页面的内存中，不在此处显示。</p>
      </section>

      <section className="admin-command-grid" aria-label="后台入口">
        <Link className="admin-command-card admin-command-card--content" href="/admin/content">
          <span className="admin-command-card__number">01</span>
          <span>
            <strong>内容工作台</strong>
            <small>创建草稿、登记大师核对并查看版本</small>
          </span>
          <span aria-hidden="true">↗</span>
        </Link>
        <Link className="admin-command-card" href="/admin/security">
          <span className="admin-command-card__number">02</span>
          <span>
            <strong>安全记录</strong>
            <small>查看登录、恢复、限流与控制动作</small>
          </span>
          <span aria-hidden="true">↗</span>
        </Link>
        <Link className="admin-command-card admin-command-card--danger" href="/admin/emergency">
          <span className="admin-command-card__number">03</span>
          <span>
            <strong>紧急控制</strong>
            <small>停止或恢复全部公开内容</small>
          </span>
          <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <section className="admin-signout" aria-labelledby="signout-title">
        <div>
          <p className="admin-kicker">HANDOVER</p>
          <h2 id="signout-title">结束值守</h2>
          <p>在共用设备上请注销全部会话；这不会修改管理员密码或验证器。</p>
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
