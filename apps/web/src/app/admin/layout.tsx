import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AdminNavigationGuard } from "./admin-navigation-guard";
import { AdminSessionProvider } from "./admin-session-context";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Five 后台值守",
};

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AdminSessionProvider>
      <AdminNavigationGuard>
        <div className="admin-root">
          <div className="admin-frame">
            <header className="admin-masthead">
              <Link className="admin-brand" href="/admin" aria-label="Five 后台控制台">
                <span aria-hidden="true">五</span>
                <span>
                  <strong>Five</strong>
                  <small>后台值守</small>
                </span>
              </Link>
              <nav aria-label="后台导航">
                <Link href="/admin">控制台</Link>
                <Link href="/admin/content">内容工作台</Link>
                <Link href="/admin/security">安全记录</Link>
                <Link href="/admin/emergency">紧急控制</Link>
              </nav>
            </header>
            <main className="admin-main">{children}</main>
            <footer className="admin-footer">
              <span>单一维护者 · 双重验证</span>
              <Link href="/">返回公开页面</Link>
            </footer>
          </div>
        </div>
      </AdminNavigationGuard>
    </AdminSessionProvider>
  );
}
