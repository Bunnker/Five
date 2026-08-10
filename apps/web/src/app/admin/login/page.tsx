"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAdminSession } from "../admin-session-context";
import { LoginForm } from "./login-form";

export default function AdminLoginPage() {
  const router = useRouter();
  const { adoptSession, state } = useAdminSession();

  if (state.kind === "authenticated") {
    return (
      <div className="admin-auth-page">
        <div className="admin-session-present" role="status">
          <span>当前已有有效会话</span>
          <Link href="/admin">返回今日</Link>
        </div>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="admin-auth-page">
        <div className="admin-session-present" role="status">
          <span>正在确认后台会话…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-auth-page">
      <LoginForm
        onAuthenticated={(session) => {
          adoptSession(session);
          router.replace("/admin");
        }}
      />
    </div>
  );
}
