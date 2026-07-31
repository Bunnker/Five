import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminSessionProvider } from "../admin-session-context";
import { createAdminJsonResponse } from "../admin-test-responses";
import { SecurityEventsPanel } from "./security-events-panel";

const testNowMs = Date.now();
const sessionResponse = {
  absoluteExpiresAt: new Date(testNowMs + 12 * 60 * 60 * 1000).toISOString(),
  credentialRevision: 3,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: new Date(testNowMs + 30 * 60 * 1000).toISOString(),
  issuedAt: new Date(testNowMs).toISOString(),
  username: "maintainer",
};

describe("SecurityEventsPanel", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows sanitized security events and follows the opaque cursor", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(sessionResponse))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                action: "login_totp",
                clientSummary: "Safari · macOS",
                eventId: "event-01",
                occurredAt: "2026-07-31T08:00:00+08:00",
                outcome: "succeeded",
                reason: "维护者完成当班动态码验证",
                requestId: "request-0001",
                sourceFingerprint: "fingerprint-abcdef1234567890",
              },
            ],
            nextCursor: "opaque cursor/1",
          }),
          {
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "application/json; charset=utf-8",
              "X-Request-Id": "request-test-admin-0001",
            },
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                action: "rate_limited",
                clientSummary: null,
                eventId: "event-00",
                occurredAt: "2026-07-31T07:50:00+08:00",
                outcome: "rejected",
                reason: null,
                requestId: "request-0000",
                sourceFingerprint: "fingerprint-0000000000000000",
              },
            ],
            nextCursor: null,
          }),
          {
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "application/json; charset=utf-8",
              "X-Request-Id": "request-test-admin-0002",
            },
            status: 200,
          },
        ),
      );

    render(
      <AdminSessionProvider>
        <SecurityEventsPanel />
      </AdminSessionProvider>,
    );

    expect(await screen.findByText("动态码登录")).toBeInTheDocument();
    expect(screen.getByText("Safari · macOS")).toBeInTheDocument();
    expect(screen.getByText("维护者完成当班动态码验证")).toBeInTheDocument();
    expect(screen.getByText("fingerprint-abcdef1234567890")).toBeInTheDocument();
    expect(screen.queryByText(/IP 地址/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载更多记录" }));

    expect(await screen.findByText("触发限流")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/admin/api/v1/security-events?limit=50&cursor=opaque+cursor%2F1",
        expect.objectContaining({ cache: "no-store", credentials: "same-origin", method: "GET" }),
      ),
    );
    expect(screen.queryByRole("button", { name: "加载更多记录" })).not.toBeInTheDocument();
  });

  it("returns to the login gate when the security-events request says the session expired", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(sessionResponse))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    render(
      <AdminSessionProvider>
        <SecurityEventsPanel />
      </AdminSessionProvider>,
    );

    expect(await screen.findByRole("link", { name: "前往登录" })).toBeInTheDocument();
  });
});
