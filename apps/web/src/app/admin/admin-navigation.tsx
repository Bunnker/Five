"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { adminApi, describeAdminApiError } from "./admin-api";
import { useAdminSession } from "./admin-session-context";

type LogoutState = { kind: "error"; message: string } | { kind: "idle" } | { kind: "submitting" };

type NavigationVariant = "header" | "sidebar";

const primaryLinks = [
  { href: "/admin", icon: "today", label: "今日" },
  { href: "/admin/calendar", icon: "calendar", label: "日历" },
  { href: "/admin/analytics", icon: "analytics", label: "数据" },
  { href: "/admin/issues", icon: "issues", label: "异常" },
] as const;

function isPrimaryLinkActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === href : pathname.startsWith(href);
}

function NavigationIcon({ name }: { name: (typeof primaryLinks)[number]["icon"] | "more" }) {
  if (name === "analytics") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 19h16M6 16v-5m6 5V6m6 10V9" />
      </svg>
    );
  }
  if (name === "calendar") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }
  if (name === "issues") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="m12 4 8 15H4L12 4Zm0 5v4m0 3v1" />
      </svg>
    );
  }
  if (name === "more") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12h.01M12 12h.01M16 12h.01" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 6h14v14H5V6Zm3-3v5m8-5v5M8 11h3m2 0h3m-8 4h3m2 0h3" />
    </svg>
  );
}

export function AdminNavigation({ variant = "header" }: { variant?: NavigationVariant }) {
  const { clearSession, state } = useAdminSession();
  const pathname = usePathname();
  const [logoutState, setLogoutState] = useState<LogoutState>({ kind: "idle" });

  async function logoutCurrent(): Promise<void> {
    if (state.kind !== "authenticated" || logoutState.kind === "submitting") return;
    setLogoutState({ kind: "submitting" });
    const result = await adminApi.logout(state.session.csrfToken);
    if (result.ok || result.error.status === 401) {
      clearSession();
      return;
    }
    setLogoutState({
      kind: "error",
      message: describeAdminApiError(result.error, true),
    });
  }

  if (pathname === "/admin/login") return null;

  return (
    <nav
      className={`admin-primary-nav admin-primary-nav--${variant}`}
      aria-label={variant === "header" ? "后台顶部导航" : "后台侧边导航"}
    >
      <div className="admin-primary-nav__items">
        {primaryLinks.map((link) => (
          <Link
            aria-current={isPrimaryLinkActive(pathname, link.href) ? "page" : undefined}
            className="admin-primary-nav__link"
            href={link.href}
            key={link.href}
          >
            <span className="admin-primary-nav__icon">
              <NavigationIcon name={link.icon} />
            </span>
            <span>{link.label}</span>
          </Link>
        ))}
      </div>
      <details className="admin-more-nav">
        <summary>
          <span className="admin-primary-nav__icon">
            <NavigationIcon name="more" />
          </span>
          <span>更多</span>
        </summary>
        <div>
          <Link href="/admin/content">恢复安全版本（高级）</Link>
          <Link href="/admin/security">安全设置与审计</Link>
          <Link href="/admin/content">高级配置</Link>
          <Link href="/admin/emergency">紧急控制</Link>
          {state.kind === "authenticated" ? (
            <>
              <span className="admin-more-nav__account">当前账号：{state.session.username}</span>
              <button
                className="admin-more-nav__action"
                disabled={logoutState.kind === "submitting"}
                onClick={() => void logoutCurrent()}
                type="button"
              >
                {logoutState.kind === "submitting" ? "正在退出…" : "退出当前会话"}
              </button>
            </>
          ) : null}
          {logoutState.kind === "error" ? (
            <span className="admin-more-nav__error" role="alert">
              {logoutState.message}
            </span>
          ) : null}
        </div>
      </details>
      {variant === "sidebar" && state.kind === "authenticated" ? (
        <div className="admin-sidebar-operator">
          <span aria-hidden="true">{state.session.username.slice(0, 1).toUpperCase()}</span>
          <small>{state.session.username}</small>
        </div>
      ) : null}
    </nav>
  );
}
