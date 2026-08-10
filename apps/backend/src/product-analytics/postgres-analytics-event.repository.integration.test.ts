import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { StoredAnalyticsEventInput } from "./analytics-event.repository";
import { PostgresAnalyticsEventRepository } from "./postgres-analytics-event.repository";

const databaseUrl = process.env.FIVE_ANALYTICS_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase("PostgresAnalyticsEventRepository", () => {
  let pool: Pool;
  let repository: PostgresAnalyticsEventRepository;
  const eventIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    repository = new PostgresAnalyticsEventRepository(pool);
  });
  afterEach(async () => {
    if (eventIds.length > 0) {
      await pool.query("DELETE FROM analytics_events WHERE event_id = ANY($1::text[])", [
        eventIds.splice(0),
      ]);
    }
  });
  afterAll(async () => pool.end());

  function event(
    eventName: StoredAnalyticsEventInput["eventName"],
    overrides: Partial<StoredAnalyticsEventInput> = {},
  ): StoredAnalyticsEventInput {
    const eventId = `event-integration-${randomUUID()}`;
    eventIds.push(eventId);
    return {
      anonymousIdHmac: "a".repeat(64),
      channelId: "integration",
      contentVersion: "fd-20260809-r1",
      eventId,
      eventName,
      expiresAt: new Date("2026-11-07T12:00:00.000Z"),
      fortuneDate: "2026-08-09",
      observedAt: new Date("2026-08-09T12:00:00.000Z"),
      posterInstanceIdHmac: null,
      referralIdHmac: null,
      requestHash: "b".repeat(64),
      sourceContentVersion: null,
      ...overrides,
    };
  }

  it("serializes concurrent idempotency, distinguishes conflicts, and aggregates anonymous usage", async () => {
    const pageView = event("view_today_summary");
    const concurrent = await Promise.all([
      repository.record(pageView),
      repository.record(pageView),
    ]);
    expect(concurrent).toEqual(
      expect.arrayContaining([{ kind: "accepted" }, { kind: "duplicate" }]),
    );
    expect(await repository.record({ ...pageView, requestHash: "c".repeat(64) })).toEqual({
      kind: "idempotency_conflict",
    });

    await repository.record(event("open_outfit_hub"));
    await repository.record(event("view_daily_look"));
    await repository.record(event("view_look_detail"));
    await repository.record(
      event("share_summary_initiated", {
        referralIdHmac: "e".repeat(64),
      }),
    );
    await repository.record(
      event("share_link_landing_view", {
        anonymousIdHmac: "d".repeat(64),
        referralIdHmac: "e".repeat(64),
        sourceContentVersion: "fd-20260809-r1",
      }),
    );
    await repository.record(
      event("share_link_landing_view", {
        referralIdHmac: "e".repeat(64),
        sourceContentVersion: "fd-20260809-r1",
      }),
    );
    await repository.record(
      event("share_link_landing_view", {
        anonymousIdHmac: "d".repeat(64),
        referralIdHmac: "f".repeat(64),
        sourceContentVersion: "fd-20260809-r1",
      }),
    );
    await repository.record(
      event("share_link_landing_view", {
        anonymousIdHmac: "c".repeat(64),
        referralIdHmac: "e".repeat(64),
        sourceContentVersion: "fd-20260809-other-version",
      }),
    );
    await repository.record(
      event("share_poster_initiated", {
        posterInstanceIdHmac: "7".repeat(64),
        referralIdHmac: "6".repeat(64),
      }),
    );
    await repository.record(
      event("poster_landing_view", {
        anonymousIdHmac: "8".repeat(64),
        referralIdHmac: "6".repeat(64),
        sourceContentVersion: "fd-20260809-r1",
      }),
    );
    await repository.record(
      event("poster_save_requested", {
        posterInstanceIdHmac: "7".repeat(64),
      }),
    );
    await repository.record(
      event("poster_save_succeeded", {
        posterInstanceIdHmac: "7".repeat(64),
      }),
    );

    await expect(
      repository.overview({
        channelId: "integration",
        contentVersion: "fd-20260809-r1",
        fromFortuneDate: "2026-08-09",
        toFortuneDate: "2026-08-09",
      }),
    ).resolves.toMatchObject({
      anonymousBrowsers: 4,
      outfitDetailVisitors: 1,
      outfitHubVisitors: 1,
      pageViews: 7,
      posterSaveRequests: 1,
      posterSaveSucceeded: 1,
      referredBrowsers: 2,
      shareInitiations: 2,
      sharingBrowsers: 1,
    });

    const report = await repository.report({
      fromFortuneDate: "2026-08-03",
      toFortuneDate: "2026-08-09",
    });
    expect(report.summary).toMatchObject({
      anonymousBrowsers: 4,
      pageViews: 7,
      referredBrowsers: 2,
      shareInitiations: 2,
    });
    expect(report.daily).toHaveLength(7);
    expect(report.daily.map(({ fortuneDate }) => fortuneDate)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
    expect(report.daily.slice(0, 6)).toEqual(
      Array.from({ length: 6 }, (_, index) => ({
        anonymousBrowsers: 0,
        fortuneDate: `2026-08-0${index + 3}`,
        outfitDetailVisitors: 0,
        outfitHubVisitors: 0,
        pageViews: 0,
        posterSaveSucceeded: 0,
        referredBrowsers: 0,
        shareInitiations: 0,
        sharingBrowsers: 0,
      })),
    );
    expect(report.daily[6]).toMatchObject({
      anonymousBrowsers: 4,
      pageViews: 7,
      referredBrowsers: 2,
      shareInitiations: 2,
    });
    expect(report.channelBreakdown).toEqual([
      { anonymousBrowsers: 0, channelId: "organic", pageViews: 0, ratio: 0 },
      { anonymousBrowsers: 0, channelId: "wechat_official", pageViews: 0, ratio: 0 },
      { anonymousBrowsers: 0, channelId: "wechat_group", pageViews: 0, ratio: 0 },
      { anonymousBrowsers: 0, channelId: "user_share", pageViews: 0, ratio: 0 },
      { anonymousBrowsers: 4, channelId: "other", pageViews: 7, ratio: 1 },
    ]);
    expect(report.channelBreakdown.reduce((sum, point) => sum + point.pageViews, 0)).toBe(
      report.summary.pageViews,
    );

    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'analytics_events'`,
    );
    const names = columns.rows.map(({ column_name }) => column_name);
    expect(names).toContain("anonymous_id_hmac");
    expect(names).not.toContain("anonymous_id");
    expect(names).not.toContain("ip_address");
    expect(names).not.toContain("user_agent");
    expect(names).not.toContain("referrer");
    expect(names).not.toContain("url");
    expect(names).not.toContain("share_target");
  });

  it("purges only expired rows", async () => {
    const expired = event("view_today_summary", {
      expiresAt: new Date("2026-08-08T12:00:00.000Z"),
      observedAt: new Date("2026-05-10T12:00:00.000Z"),
    });
    const active = event("view_today_summary");
    await repository.record(expired);
    await repository.record(active);
    await expect(repository.purgeExpired(new Date("2026-08-09T12:00:00.000Z"))).resolves.toBe(1);
    await expect(
      pool.query<{ event_id: string }>(
        "SELECT event_id FROM analytics_events WHERE event_id = ANY($1::text[])",
        [[expired.eventId, active.eventId]],
      ),
    ).resolves.toMatchObject({ rows: [{ event_id: active.eventId }] });
  });

  it("returns 30 continuous dates, range-deduplicated browsers, and fixed safe channel buckets", async () => {
    await repository.record(
      event("view_today_summary", {
        channelId: "organic",
        fortuneDate: "2026-08-08",
      }),
    );
    await repository.record(
      event("view_today_summary", {
        channelId: "organic",
        fortuneDate: "2026-08-09",
      }),
    );
    await repository.record(
      event("view_daily_look", {
        anonymousIdHmac: "d".repeat(64),
        channelId: "wechat_official",
        fortuneDate: "2026-08-09",
      }),
    );
    await repository.record(
      event("view_today_summary", {
        anonymousIdHmac: "c".repeat(64),
        channelId: "campaign:untrusted-value",
        fortuneDate: "2026-08-10",
      }),
    );

    const report = await repository.report({
      fromFortuneDate: "2026-07-12",
      toFortuneDate: "2026-08-10",
    });

    expect(report.daily).toHaveLength(30);
    expect(report.daily[0]?.fortuneDate).toBe("2026-07-12");
    expect(report.daily[29]?.fortuneDate).toBe("2026-08-10");
    expect(report.summary).toMatchObject({ anonymousBrowsers: 3, pageViews: 4 });
    expect(report.daily.reduce((sum, point) => sum + point.pageViews, 0)).toBe(4);
    expect(report.channelBreakdown).toEqual([
      { anonymousBrowsers: 1, channelId: "organic", pageViews: 2, ratio: 0.5 },
      { anonymousBrowsers: 1, channelId: "wechat_official", pageViews: 1, ratio: 0.25 },
      { anonymousBrowsers: 0, channelId: "wechat_group", pageViews: 0, ratio: 0 },
      { anonymousBrowsers: 0, channelId: "user_share", pageViews: 0, ratio: 0 },
      { anonymousBrowsers: 1, channelId: "other", pageViews: 1, ratio: 0.25 },
    ]);
  });

  it("returns null channel ratios instead of fake zero percentages without page views", async () => {
    const report = await repository.report({
      fromFortuneDate: "2099-01-01",
      toFortuneDate: "2099-01-07",
    });

    expect(report.summary.pageViews).toBe(0);
    expect(report.daily).toHaveLength(7);
    expect(report.channelBreakdown).toEqual([
      { anonymousBrowsers: 0, channelId: "organic", pageViews: 0, ratio: null },
      { anonymousBrowsers: 0, channelId: "wechat_official", pageViews: 0, ratio: null },
      { anonymousBrowsers: 0, channelId: "wechat_group", pageViews: 0, ratio: null },
      { anonymousBrowsers: 0, channelId: "user_share", pageViews: 0, ratio: null },
      { anonymousBrowsers: 0, channelId: "other", pageViews: 0, ratio: null },
    ]);
  });

  it("caps one anonymous browser without retaining its network address", async () => {
    const outcomes = [];
    for (let index = 0; index < 61; index += 1) {
      outcomes.push(
        await repository.record(
          event("view_today_summary", {
            anonymousIdHmac: "9".repeat(64),
          }),
        ),
      );
    }

    expect(outcomes.slice(0, 60)).toEqual(Array.from({ length: 60 }, () => ({ kind: "accepted" })));
    expect(outcomes[60]).toEqual({ kind: "rate_limited" });
  });
});
