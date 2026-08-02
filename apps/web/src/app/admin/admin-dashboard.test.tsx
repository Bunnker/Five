import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminDashboard } from "./admin-dashboard";
import { AdminSessionProvider } from "./admin-session-context";
import { createAdminEmptyResponse, createAdminJsonResponse } from "./admin-test-responses";

const testNowMs = Date.now();
const sessionResponse = {
  absoluteExpiresAt: new Date(testNowMs + 12 * 60 * 60 * 1000).toISOString(),
  credentialRevision: 3,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: new Date(testNowMs + 30 * 60 * 1000).toISOString(),
  issuedAt: new Date(testNowMs).toISOString(),
  username: "maintainer",
};

describe("AdminDashboard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads the memory-only session and logs out with its CSRF token", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(sessionResponse))
      .mockResolvedValueOnce(createAdminEmptyResponse());

    render(
      <AdminSessionProvider>
        <AdminDashboard />
      </AdminSessionProvider>,
    );

    expect(await screen.findByText("maintainer")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /安全记录/ })).toHaveAttribute(
      "href",
      "/admin/security",
    );
    expect(screen.getByRole("link", { name: /紧急控制/ })).toHaveAttribute(
      "href",
      "/admin/emergency",
    );
    expect(screen.getByRole("link", { name: /内容工作台/ })).toHaveAttribute(
      "href",
      "/admin/content",
    );
    fireEvent.click(screen.getByRole("button", { name: "退出当前会话" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/admin/api/v1/auth/session",
        expect.objectContaining({
          cache: "no-store",
          credentials: "same-origin",
          headers: expect.objectContaining({ "X-CSRF-Token": sessionResponse.csrfToken }),
          method: "DELETE",
        }),
      ),
    );
    expect(await screen.findByRole("link", { name: "前往登录" })).toBeInTheDocument();
  });

  it("revokes all sessions with only the contract-defined CSRF header", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(sessionResponse))
      .mockResolvedValueOnce(createAdminEmptyResponse());
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");

    render(
      <AdminSessionProvider>
        <AdminDashboard />
      </AdminSessionProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "注销全部会话" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/admin/api/v1/auth/logout-all",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-CSRF-Token": sessionResponse.csrfToken,
        }),
        method: "POST",
      }),
    );
    const [, requestInit] = fetchMock.mock.calls[1] ?? [];
    expect(new Headers(requestInit?.headers).has("Idempotency-Key")).toBe(false);
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it("discards a restored bfcache view and revalidates the session", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(sessionResponse))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    render(
      <AdminSessionProvider>
        <AdminDashboard />
      </AdminSessionProvider>,
    );
    expect(await screen.findByText("maintainer")).toBeInTheDocument();

    const restoredEvent = new Event("pageshow");
    Object.defineProperty(restoredEvent, "persisted", { value: true });
    window.dispatchEvent(restoredEvent);

    expect(await screen.findByRole("link", { name: "前往登录" })).toBeInTheDocument();
    expect(screen.queryByText("maintainer")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
