import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AdminAuthService } from "../admin-auth/admin-auth.service";
import { AppModule } from "../app.module";
import { ADMIN_AUTH_SERVICE } from "./admin-http.providers";
import { installAdminRequestProtection } from "./admin-request-protection";
import { installAdminImageMultipart } from "./admin-image-multipart";

describe("real application admin HTTP boundary", () => {
  let app: NestFastifyApplication;
  let originalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://five:five@127.0.0.1:1/five";
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: false, trustProxy: "loopback" }),
      { logger: false },
    );
    await installAdminImageMultipart(app.getHttpAdapter().getInstance());
    installAdminRequestProtection(
      app.getHttpAdapter().getInstance(),
      app.get<AdminAuthService>(ADMIN_AUTH_SERVICE),
      new Set(["http://127.0.0.1:3000"]),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("registers the session route and denies it before any database access", async () => {
    const response = await app.inject({
      headers: { "x-request-id": "registered-admin-boundary" },
      method: "GET",
      url: "/admin/api/v1/auth/session",
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers).toMatchObject({
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-request-id": "registered-admin-boundary",
    });
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("registers the content workflow behind the same protected admin boundary", async () => {
    const response = await app.inject({
      headers: { "x-request-id": "registered-content-boundary" },
      method: "GET",
      url: "/admin/api/v1/daily-content-drafts",
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers).toMatchObject({
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-request-id": "registered-content-boundary",
    });
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("registers the analytics overview behind the same protected admin boundary", async () => {
    const response = await app.inject({
      headers: { "x-request-id": "registered-analytics-boundary" },
      method: "GET",
      url: "/admin/api/v1/analytics/overview?from=2026-08-01&to=2026-08-09",
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers).toMatchObject({
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-request-id": "registered-analytics-boundary",
    });
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("fails a real persistent login preflight closed without leaking the connection", async () => {
    const response = await app.inject({
      headers: {
        origin: "http://127.0.0.1:3000",
        "x-request-id": "registered-admin-store-failure",
      },
      method: "POST",
      payload: { password: "correct horse battery staple", username: "Operator" },
      url: "/admin/api/v1/auth/sessions",
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("30");
    expect(response.json()).toMatchObject({
      error: { code: "ADMIN_SERVICE_UNAVAILABLE", retryable: true },
    });
    expect(response.body).not.toMatch(/postgresql|127\.0\.0\.1:1|ECONNREFUSED/iu);
  });
});
