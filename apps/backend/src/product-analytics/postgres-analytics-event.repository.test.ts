import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { StoredAnalyticsEventInput } from "./analytics-event.repository";
import { PostgresAnalyticsEventRepository } from "./postgres-analytics-event.repository";

function input(eventId: string): StoredAnalyticsEventInput {
  return {
    anonymousIdHmac: "a".repeat(64),
    channelId: "organic",
    contentVersion: "fd-20260809-r1",
    eventId,
    eventName: "view_today_summary",
    expiresAt: new Date("2026-11-07T12:00:00.000Z"),
    fortuneDate: "2026-08-09",
    observedAt: new Date("2026-08-09T12:00:00.000Z"),
    posterInstanceIdHmac: null,
    referralIdHmac: null,
    requestHash: "b".repeat(64),
    sourceContentVersion: null,
  };
}

function client(): PoolClient {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("SELECT request_hash")) return { rows: [] };
      if (sql.includes("COUNT(*) AS global_count")) {
        return { rows: [{ anonymous_count: "0", global_count: "0" }] };
      }
      return { rowCount: 1, rows: [] };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
}

describe("PostgresAnalyticsEventRepository connection budget", () => {
  it("rejects excess side-channel writes before they can occupy the shared database pool", async () => {
    const pendingConnections: Array<(value: PoolClient) => void> = [];
    const pool = {
      connect: vi.fn(
        () =>
          new Promise<PoolClient>((resolve) => {
            pendingConnections.push(resolve);
          }),
      ),
    } as unknown as Pool;
    const repository = new PostgresAnalyticsEventRepository(pool);

    const first = repository.record(input("event:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    const second = repository.record(input("event:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));

    await expect(
      repository.record(input("event:cccccccc-cccc-4ccc-8ccc-cccccccccccc")),
    ).resolves.toEqual({ kind: "rate_limited" });
    expect(pool.connect).toHaveBeenCalledTimes(2);

    pendingConnections[0]?.(client());
    pendingConnections[1]?.(client());
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: "accepted" },
      { kind: "accepted" },
    ]);
  });
});
