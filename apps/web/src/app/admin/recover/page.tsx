"use client";

import Link from "next/link";

import { useAdminSession } from "../admin-session-context";
import { RecoveryForm } from "./recovery-form";

export default function AdminRecoverPage() {
  const { adoptSession } = useAdminSession();
  return (
    <div className="admin-auth-page admin-auth-page--wide">
      <RecoveryForm onRecovered={adoptSession} />
      <Link className="admin-text-link" href="/admin/login">
        返回普通登录
      </Link>
    </div>
  );
}
