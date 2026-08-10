import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adminApi, type AdminApiResult } from "./admin-api";
import { AdminNavigation } from "./admin-navigation";
import { AdminSessionProvider } from "./admin-session-context";
import { AdminSidebar } from "./admin-sidebar";

const navigation = vi.hoisted(() => ({ pathname: "/admin" }));

vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

function apiSuccess<T>(data: T): AdminApiResult<T> {
  return { data, ok: true, response: new Response(null, { status: 200 }) };
}

afterEach(() => {
  navigation.pathname = "/admin";
  vi.restoreAllMocks();
});

describe("AdminNavigation", () => {
  it("keeps the four daily-operation destinations, marks Today active, and ends the session", async () => {
    const session = {
      absoluteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1_000).toISOString(),
      credentialRevision: 3,
      csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
      idleExpiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
      issuedAt: new Date().toISOString(),
      username: "maintainer",
    };
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    const logout = vi.spyOn(adminApi, "logout").mockResolvedValue(apiSuccess(null));

    render(
      <AdminSessionProvider>
        <AdminNavigation variant="header" />
      </AdminSessionProvider>,
    );

    await screen.findByRole("button", { name: "退出当前会话" });
    const nav = screen.getByRole("navigation", { name: "后台顶部导航" });
    expect(nav.querySelectorAll(".admin-primary-nav__link")).toHaveLength(4);
    expect(within(nav).getByRole("link", { name: "今日" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "日历" })).toHaveAttribute(
      "href",
      "/admin/calendar",
    );
    expect(within(nav).getByRole("link", { name: "异常" })).toHaveAttribute(
      "href",
      "/admin/issues",
    );
    expect(within(nav).getByRole("link", { name: "数据" })).toHaveAttribute(
      "href",
      "/admin/analytics",
    );

    fireEvent.click(screen.getByText("更多"));
    expect(screen.getByRole("link", { name: "恢复安全版本（高级）" })).toHaveAttribute(
      "href",
      "/admin/content",
    );
    expect(screen.getByRole("link", { name: "高级配置" })).toHaveAttribute(
      "href",
      "/admin/content",
    );
    fireEvent.click(screen.getByRole("button", { name: "退出当前会话" }));

    await waitFor(() => expect(logout).toHaveBeenCalledWith(session.csrfToken));
    expect(screen.queryByRole("button", { name: "退出当前会话" })).not.toBeInTheDocument();
  });

  it("renders the desktop sidebar variant with the active calendar destination", async () => {
    navigation.pathname = "/admin/calendar/2026-08-07";
    vi.spyOn(adminApi, "getSession").mockResolvedValue(
      apiSuccess({
        absoluteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1_000).toISOString(),
        credentialRevision: 3,
        csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
        idleExpiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
        issuedAt: new Date().toISOString(),
        username: "maintainer",
      }),
    );

    render(
      <AdminSessionProvider>
        <AdminNavigation variant="sidebar" />
      </AdminSessionProvider>,
    );

    const calendarLink = screen.getByRole("link", { name: "日历" });
    expect(calendarLink).toHaveAttribute("aria-current", "page");
    expect(calendarLink.querySelector("svg")).toBeInTheDocument();
    expect(await screen.findByText("maintainer")).toBeInTheDocument();
  });

  it("marks the data report destination active", async () => {
    navigation.pathname = "/admin/analytics";
    vi.spyOn(adminApi, "getSession").mockResolvedValue(
      apiSuccess({
        absoluteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1_000).toISOString(),
        credentialRevision: 3,
        csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
        idleExpiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
        issuedAt: new Date().toISOString(),
        username: "maintainer",
      }),
    );

    render(
      <AdminSessionProvider>
        <AdminNavigation variant="sidebar" />
      </AdminSessionProvider>,
    );

    expect(screen.getByRole("link", { name: "数据" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the login page free of the authenticated desktop sidebar", async () => {
    navigation.pathname = "/admin/login";
    const getSession = vi.spyOn(adminApi, "getSession").mockResolvedValue(
      apiSuccess({
        absoluteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1_000).toISOString(),
        credentialRevision: 3,
        csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
        idleExpiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
        issuedAt: new Date().toISOString(),
        username: "maintainer",
      }),
    );

    render(
      <AdminSessionProvider>
        <AdminNavigation variant="header" />
        <AdminSidebar />
      </AdminSessionProvider>,
    );

    await waitFor(() => expect(getSession).toHaveBeenCalledOnce());
    expect(screen.queryByRole("navigation", { name: "后台顶部导航" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "后台侧栏" })).not.toBeInTheDocument();
  });
});
