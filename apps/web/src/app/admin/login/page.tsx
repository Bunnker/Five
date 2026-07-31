"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAdminSession } from "../admin-session-context";
import { LoginForm } from "./login-form";

export default function AdminLoginPage() {
  const router = useRouter();
  const { adoptSession, state } = useAdminSession();

  return (
    <div className="admin-auth-page">
      {state.kind === "authenticated" ? (
        <div className="admin-session-present" role="status">
          <span>当前已有有效会话</span>
          <Link href="/admin">返回控制台</Link>
        </div>
      ) : null}
      <LoginForm
        onAuthenticated={(session) => {
          adoptSession(session);
          router.replace("/admin");
        }}
      />
      <Link className="admin-text-link" href="/admin/recover">
        无法使用密码或原验证器？使用恢复码
      </Link>
    </div>
  );
}
