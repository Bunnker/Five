import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AdminNavigation } from "./admin-navigation";
import { AdminSessionProvider } from "./admin-session-context";
import { AdminSidebar } from "./admin-sidebar";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Five 内容管理",
};

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AdminSessionProvider>
      <div className="admin-root admin-root--operations-v2">
        <div className="admin-frame">
          <header className="admin-masthead">
            <Link className="admin-brand" href="/admin" aria-label="Five 后台控制台">
              <span aria-hidden="true">五</span>
              <span>
                <strong>Five</strong>
                <small>五行穿衣 · 内容管理</small>
              </span>
            </Link>
            <AdminNavigation variant="header" />
          </header>
          <div className="admin-workbench-shell">
            <AdminSidebar />
            <main className="admin-main">{children}</main>
          </div>
          <footer className="admin-footer">
            <span>单一维护者 · 账号密码登录</span>
            <Link href="/">返回公开页面</Link>
          </footer>
        </div>
      </div>
    </AdminSessionProvider>
  );
}
