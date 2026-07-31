import { describe, expect, it, vi } from "vitest";

import {
  installPublicAccessGate,
  type PublicAccessGateFastifyInstance,
  type PublicAccessGateRequest,
  type PublicAccessStateReader,
} from "./public-access-gate";

interface CapturedReply {
  readonly body: unknown;
  readonly headers: Record<string, string | number>;
  readonly statusCode: number;
}

function createHarness(reader: PublicAccessStateReader) {
  let hook:
    | ((
        request: PublicAccessGateRequest,
        reply: {
          header(name: string, value: string | number): unknown;
          send(body: unknown): unknown;
          status(code: number): unknown;
        },
        done: (error?: Error) => void,
      ) => void)
    | undefined;

  const instance = {
    addHook: vi.fn((_name, candidate) => {
      hook = candidate;
    }),
  } as unknown as PublicAccessGateFastifyInstance;
  installPublicAccessGate(instance, reader);

  async function inject(input: PublicAccessGateRequest): Promise<CapturedReply | null> {
    if (hook === undefined) {
      throw new Error("Public access hook was not installed");
    }

    const headers: Record<string, string | number> = {};
    let body: unknown;
    let statusCode = 200;
    let completed = false;

    await new Promise<void>((resolve, reject) => {
      const reply = {
        header(name: string, value: string | number) {
          headers[name.toLowerCase()] = value;
          return this;
        },
        send(value: unknown) {
          body = value;
          completed = true;
          resolve();
          return this;
        },
        status(code: number) {
          statusCode = code;
          return this;
        },
      };
      hook?.(input, reply, (error) => {
        completed = true;
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });

    return body === undefined && completed ? null : { body, headers, statusCode };
  }

  return { inject, instance };
}

describe("public access emergency gate", () => {
  it.each([
    ["GET", "/api/v1/today"],
    ["GET", "/api/v1/daily/2026-07-31"],
    ["GET", "/api/v1/daily/2026-07-31/looks/look-1?expectedContentVersion=v1"],
    ["POST", "/api/v1/poster-jobs"],
    ["GET", "/api/v1/poster-jobs/job-1"],
    ["GET", "/api/v1/poster-assets/poster-1.svg"],
  ])("fails closed for %s %s while public access is stopped", async (method, url) => {
    const reader: PublicAccessStateReader = {
      getPublicAccessControl: vi.fn().mockResolvedValue({ publiclyEnabled: false }),
    };
    const { inject } = createHarness(reader);

    const response = await inject({
      headers: { "x-request-id": "emergency-request-01" },
      method,
      url,
    });

    expect(response).toEqual({
      body: {
        error: {
          code: "PUBLIC_ACCESS_STOPPED",
          details: {},
          message: "公开内容已暂停，请稍后再试。",
          requestId: "emergency-request-01",
          retryable: true,
        },
      },
      headers: {
        "cache-control": "no-store",
        "retry-after": 60,
        "x-request-id": "emergency-request-01",
      },
      statusCode: 503,
    });
  });

  it.each([
    ["GET", "/health/live"],
    ["GET", "/health/ready"],
    ["POST", "/api/v1/feedback-reports"],
    ["GET", "/admin/api/v1/emergency-control"],
  ])("does not gate %s %s", async (method, url) => {
    const getPublicAccessControl = vi.fn();
    const { inject } = createHarness({ getPublicAccessControl });

    await expect(inject({ headers: {}, method, url })).resolves.toBeNull();
    expect(getPublicAccessControl).not.toHaveBeenCalled();
  });

  it("continues to the route when public access is enabled", async () => {
    const { inject } = createHarness({
      getPublicAccessControl: vi.fn().mockResolvedValue({ publiclyEnabled: true }),
    });

    await expect(inject({ headers: {}, method: "GET", url: "/api/v1/today" })).resolves.toBeNull();
  });

  it("fails closed without leaking a state-store failure", async () => {
    const { inject } = createHarness({
      getPublicAccessControl: vi.fn().mockRejectedValue(new Error("postgres://secret")),
    });

    const response = await inject({
      headers: { "x-request-id": "emergency-store-failure" },
      method: "GET",
      url: "/api/v1/today",
    });

    expect(response?.statusCode).toBe(503);
    expect(response?.headers).toMatchObject({
      "cache-control": "no-store",
      "retry-after": 30,
      "x-request-id": "emergency-store-failure",
    });
    expect(response?.body).toMatchObject({
      error: { code: "CONTENT_NOT_READY", requestId: "emergency-store-failure" },
    });
    expect(JSON.stringify(response)).not.toContain("postgres://secret");
  });
});
