import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminSessionProvider } from "../admin-session-context";
import { createAdminJsonResponse } from "../admin-test-responses";
import AdminLoginPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

describe("AdminLoginPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not show a second login form when the maintainer is already authenticated", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createAdminJsonResponse({
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
        <AdminLoginPage />
      </AdminSessionProvider>,
    );

    expect(await screen.findByText("当前已有有效会话")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回今日" })).toHaveAttribute("href", "/admin");
    expect(screen.queryByLabelText("管理员账号")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
  });
});
