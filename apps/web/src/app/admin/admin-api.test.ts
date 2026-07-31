import { afterEach, describe, expect, it, vi } from "vitest";

import { adminApi } from "./admin-api";

const validSession = {
  absoluteExpiresAt: "2026-08-01T08:00:00+08:00",
  credentialRevision: 3,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: "2026-07-31T20:30:00+08:00",
  issuedAt: "2026-07-31T20:00:00+08:00",
  username: "maintainer",
};

function adminJsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Request-Id": "request-admin-api-0001",
      ...headers,
    },
    status: 200,
  });
}

describe("adminApi response boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["undeclared response properties", { ...validSession, unexpected: "must fail closed" }],
    ["date-times without a timezone", { ...validSession, issuedAt: "2026-07-31T20:00:00" }],
    ["calendar-invalid RFC3339 dates", { ...validSession, issuedAt: "2026-02-30T20:00:00+08:00" }],
  ])("rejects %s", async (_label, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(adminJsonResponse(body)));

    const result = await adminApi.getSession();

    expect(result).toEqual({
      error: {
        kind: "api-error",
        requestId: "request-admin-api-0001",
        retryAfterSeconds: null,
        status: 502,
      },
      ok: false,
    });
  });

  it.each([
    ["a JSON media type", { "Content-Type": "text/plain" }],
    ["no-store cache control", { "Cache-Control": "private" }],
    ["a request id", { "X-Request-Id": "" }],
  ])("rejects a successful response without %s", async (_label, changedHeader) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(adminJsonResponse(validSession, changedHeader)),
    );

    const result = await adminApi.getSession();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(502);
  });

  it("requires the strong emergency-control ETag on emergency responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        adminJsonResponse(
          {
            auditEventId: null,
            changedAt: "2026-07-31T20:00:00+08:00",
            publicAccessEnabled: true,
            reason: null,
            revision: 4,
          },
          { ETag: 'W/"emergency-control:4"' },
        ),
      ),
    );

    const result = await adminApi.getEmergencyStatus();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(502);
  });

  it("accepts an exact payload with the required no-store response headers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(adminJsonResponse(validSession)));

    const result = await adminApi.getSession();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(validSession);
  });

  it("does not parse or expose an error response body", async () => {
    const response = new Response(JSON.stringify({ password: "must-not-leak" }), {
      headers: { "Content-Type": "application/json", "X-Request-Id": "request-error-0001" },
      status: 401,
    });
    const jsonSpy = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const result = await adminApi.getSession();

    expect(jsonSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: {
        kind: "api-error",
        requestId: "request-error-0001",
        retryAfterSeconds: null,
        status: 401,
      },
      ok: false,
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });
});
