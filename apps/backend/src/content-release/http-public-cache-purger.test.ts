import { describe, expect, it, vi } from "vitest";

import type { StoredImageCachePurgeIntent } from "../daily-images/daily-image-asset.store";
import type { StoredPublicCachePurgeIntent } from "./content-release.store";
import { HttpPublicCachePurger } from "./http-public-cache-purger";

const INTENT: StoredPublicCachePurgeIntent = {
  action: "publish",
  afterActiveContentVersion: "content-new",
  attempts: 1,
  attemptToken: "attempt-1",
  availableAt: "2026-08-01T16:00:00.000Z",
  beforeActiveContentVersion: "content-old",
  claimedAt: "2026-08-01T16:00:01.000Z",
  createdAt: "2026-08-01T16:00:00.000Z",
  fortuneDate: "2026-08-02",
  lastError: null,
  leaseExpiresAt: "2026-08-01T16:05:01.000Z",
  processedAt: null,
  purgeIntentId: "purge-1",
  requestId: "request-1",
  status: "processing",
  workerId: "worker-1",
};

const IMAGE_INTENT: StoredImageCachePurgeIntent = {
  assetId: "asset-withdrawn",
  attempts: 1,
  attemptToken: "attempt-image-1",
  availableAt: "2026-08-01T16:00:00.000Z",
  claimedAt: "2026-08-01T16:00:01.000Z",
  contentVersion: "content-image",
  createdAt: "2026-08-01T16:00:00.000Z",
  fortuneDate: "2026-08-02",
  lastError: null,
  leaseExpiresAt: "2026-08-01T16:05:01.000Z",
  processedAt: null,
  purgeIntentId: "purge-image-1",
  requestId: "request-image-1",
  status: "processing",
  workerId: "image-worker-1",
};

describe("HttpPublicCachePurger", () => {
  it("purges the today page, daily page and date cache tag without leaking the token into the body", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const purger = new HttpPublicCachePurger(
      {
        endpoint: "https://cache.example.test/purge",
        token: "cache-secret",
      },
      fetcher,
    );

    await expect(purger.purge(INTENT)).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cache.example.test/purge");
    expect(init).toMatchObject({
      headers: {
        Authorization: "Bearer cache-secret",
        "Content-Type": "application/json",
        "Idempotency-Key": "purge-1",
        "X-Request-Id": "request-1",
      },
      method: "POST",
    });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      action: "publish",
      activeContentVersion: { after: "content-new", before: "content-old" },
      cacheTags: ["five:today", "five:fortune-date:2026-08-02"],
      fortuneDate: "2026-08-02",
      paths: ["/api/v1/today", "/api/v1/daily/2026-08-02"],
      purgeIntentId: "purge-1",
      requestId: "request-1",
    });
    expect(JSON.stringify(body)).not.toContain("cache-secret");
  });

  it("fails closed when no purge endpoint is configured", async () => {
    const fetcher = vi.fn();
    const purger = new HttpPublicCachePurger({ endpoint: null, token: null }, fetcher);

    await expect(purger.purge(INTENT)).rejects.toThrow(
      "Public cache purge endpoint is not configured",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("purges an image withdrawal with a stable idempotency key and image cache tags", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const purger = new HttpPublicCachePurger(
      { endpoint: "https://cache.example.test/purge", token: null },
      fetcher,
    );

    await expect(purger.purge(IMAGE_INTENT)).resolves.toBeUndefined();

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "Idempotency-Key": "purge-image-1",
      "X-Request-Id": "request-image-1",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      action: "image_asset_withdrawn",
      assetId: "asset-withdrawn",
      cacheTags: [
        "five:today",
        "five:fortune-date:2026-08-02",
        "five:content-version:content-image",
        "five:image-asset:asset-withdrawn",
      ],
      contentVersion: "content-image",
      fortuneDate: "2026-08-02",
      paths: ["/api/v1/today", "/api/v1/daily/2026-08-02"],
      purgeIntentId: "purge-image-1",
      requestId: "request-image-1",
    });
  });

  it("reports only the response status when the purge endpoint rejects the request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("provider detail containing cache-secret", { status: 503 }));
    const purger = new HttpPublicCachePurger(
      { endpoint: "https://cache.example.test/purge", token: "cache-secret" },
      fetcher,
    );

    await expect(purger.purge(INTENT)).rejects.toThrow("Public cache purge failed with status 503");
  });
});
