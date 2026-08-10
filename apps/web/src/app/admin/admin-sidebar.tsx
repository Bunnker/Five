"use client";

import { usePathname } from "next/navigation";

import { AdminNavigation } from "./admin-navigation";
import { useAdminSession } from "./admin-session-context";

export function AdminSidebar() {
  const pathname = usePathname();
  const { state } = useAdminSession();

  if (pathname === "/admin/login" || state.kind === "unauthenticated") return null;

  return (
    <aside className="admin-sidebar" aria-label="后台侧栏">
      <AdminNavigation variant="sidebar" />
    </aside>
  );
}
