import type { Pool, PoolClient } from "pg";

import type {
  AnalyticsEventRepository,
  AnalyticsOverviewQuery,
  AnalyticsReportQuery,
  RecordStoredAnalyticsEventResult,
  StoredAnalyticsEventInput,
  StoredAnalyticsOverview,
  StoredAnalyticsReport,
} from "./analytics-event.repository";

interface ExistingEventRow {
  request_hash: string;
}

interface OverviewRow {
  anonymous_browsers: string | number;
  outfit_detail_visitors: string | number;
  outfit_hub_visitors: string | number;
  page_views: string | number;
  poster_save_failed: string | number;
  poster_save_requests: string | number;
  poster_save_succeeded: string | number;
  referred_browsers: string | number;
  share_initiations: string | number;
  sharing_browsers: string | number;
}

interface RateLimitRow {
  anonymous_count: string | number;
  global_count: string | number;
}

interface DailyRow {
  anonymous_browsers: string | number;
  fortune_date: string;
  outfit_detail_visitors: string | number;
  outfit_hub_visitors: string | number;
  page_views: string | number;
  poster_save_succeeded: string | number;
  referred_browsers: string | number;
  share_initiations: string | number;
  sharing_browsers: string | number;
}

interface ChannelRow {
  anonymous_browsers: string | number;
  channel_id: "organic" | "wechat_official" | "wechat_group" | "user_share" | "other";
  page_views: string | number;
}

const GLOBAL_EVENTS_PER_MINUTE = 300;
const EVENTS_PER_ANONYMOUS_BROWSER_PER_MINUTE = 60;
const MAX_CONCURRENT_RECORDS_PER_PROCESS = 2;
const PAGE_VIEW_EVENT_NAMES = [
  "view_today_summary",
  "view_daily_look",
  "share_link_landing_view",
  "poster_landing_view",
] as const;
const PAGE_VIEW_EVENT_SQL = PAGE_VIEW_EVENT_NAMES.map((name) => `'${name}'`).join(", ");

function count(value: string | number, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`analytics ${name} is outside the safe integer range`);
  }
  return parsed;
}

function overviewFromRow(row: OverviewRow): StoredAnalyticsOverview {
  return {
    anonymousBrowsers: count(row.anonymous_browsers, "anonymous browser count"),
    outfitDetailVisitors: count(row.outfit_detail_visitors, "outfit detail visitor count"),
    outfitHubVisitors: count(row.outfit_hub_visitors, "outfit hub visitor count"),
    pageViews: count(row.page_views, "page-view count"),
    posterSaveFailed: count(row.poster_save_failed, "poster-save failure count"),
    posterSaveRequests: count(row.poster_save_requests, "poster-save request count"),
    posterSaveSucceeded: count(row.poster_save_succeeded, "poster-save success count"),
    referredBrowsers: count(row.referred_browsers, "referred browser count"),
    shareInitiations: count(row.share_initiations, "share initiation count"),
    sharingBrowsers: count(row.sharing_browsers, "sharing browser count"),
  };
}

export class PostgresAnalyticsEventRepository implements AnalyticsEventRepository {
  private activeRecordOperations = 0;

  constructor(private readonly pool: Pool) {}

  async record(input: StoredAnalyticsEventInput): Promise<RecordStoredAnalyticsEventResult> {
    if (this.activeRecordOperations >= MAX_CONCURRENT_RECORDS_PER_PROCESS) {
      return { kind: "rate_limited" };
    }
    this.activeRecordOperations += 1;
    try {
      return await this.recordWithinConnectionBudget(input);
    } finally {
      this.activeRecordOperations -= 1;
    }
  }

  private async recordWithinConnectionBudget(
    input: StoredAnalyticsEventInput,
  ): Promise<RecordStoredAnalyticsEventResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize one browser-generated event id without retaining a network identifier. Hash
      // collisions only cause harmless transient serialization between unrelated events.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('five-analytics-event:' || $1::text))",
        [input.eventId],
      );
      const existing = await client.query<ExistingEventRow>(
        "SELECT request_hash FROM analytics_events WHERE event_id = $1",
        [input.eventId],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        await client.query("COMMIT");
        return prior.request_hash === input.requestHash
          ? { kind: "duplicate" }
          : { kind: "idempotency_conflict" };
      }

      // Serialize the intentionally small anonymous-event budget in PostgreSQL so multiple HTTP
      // processes share one limit without retaining an IP address or device fingerprint.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('five-analytics-global-rate'))");
      const recent = await client.query<RateLimitRow>(
        `SELECT
           COUNT(*) AS global_count,
           COUNT(*) FILTER (WHERE anonymous_id_hmac = $2) AS anonymous_count
         FROM analytics_events
         WHERE observed_at > $1::timestamptz - INTERVAL '1 minute'
           AND observed_at <= $1::timestamptz`,
        [input.observedAt, input.anonymousIdHmac],
      );
      const rate = recent.rows[0];
      if (rate === undefined) throw new Error("analytics rate-limit query returned no result");
      if (
        count(rate.global_count, "global recent event count") >= GLOBAL_EVENTS_PER_MINUTE ||
        count(rate.anonymous_count, "anonymous recent event count") >=
          EVENTS_PER_ANONYMOUS_BROWSER_PER_MINUTE
      ) {
        await client.query("COMMIT");
        return { kind: "rate_limited" };
      }

      await client.query(
        `INSERT INTO analytics_events (
           event_id,
           request_hash,
           event_name,
           anonymous_id_hmac,
           fortune_date,
           content_version,
           channel_id,
           referral_id_hmac,
           poster_instance_id_hmac,
           source_content_version,
           observed_at,
           expires_at
         ) VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12)`,
        [
          input.eventId,
          input.requestHash,
          input.eventName,
          input.anonymousIdHmac,
          input.fortuneDate,
          input.contentVersion,
          input.channelId,
          input.referralIdHmac,
          input.posterInstanceIdHmac,
          input.sourceContentVersion,
          input.observedAt,
          input.expiresAt,
        ],
      );
      await client.query("COMMIT");
      return { kind: "accepted" };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async overview(query: AnalyticsOverviewQuery): Promise<StoredAnalyticsOverview> {
    return this.queryOverview(query, (sql, values) => this.pool.query<OverviewRow>(sql, values));
  }

  private async queryOverview(
    query: AnalyticsOverviewQuery,
    execute: (sql: string, values: unknown[]) => Promise<{ readonly rows: readonly OverviewRow[] }>,
  ): Promise<StoredAnalyticsOverview> {
    const result = await execute(
      `SELECT
         COUNT(*) FILTER (
           WHERE event_name IN (${PAGE_VIEW_EVENT_SQL})
         ) AS page_views,
         COUNT(DISTINCT anonymous_id_hmac) AS anonymous_browsers,
         COUNT(DISTINCT anonymous_id_hmac) FILTER (
           WHERE event_name IN ('open_outfit_hub', 'view_daily_look')
         ) AS outfit_hub_visitors,
         COUNT(DISTINCT anonymous_id_hmac) FILTER (
           WHERE event_name = 'view_look_detail'
         ) AS outfit_detail_visitors,
         COUNT(*) FILTER (
           WHERE event_name IN ('share_summary_initiated', 'share_poster_initiated')
         ) AS share_initiations,
         COUNT(DISTINCT anonymous_id_hmac) FILTER (
           WHERE event_name IN ('share_summary_initiated', 'share_poster_initiated')
         ) AS sharing_browsers,
         COUNT(DISTINCT anonymous_id_hmac) FILTER (
           WHERE event_name IN ('share_link_landing_view', 'poster_landing_view')
             AND referral_id_hmac IS NOT NULL
             AND EXISTS (
               SELECT 1
                 FROM analytics_events AS share_origin
                WHERE share_origin.event_name IN (
                        'share_summary_initiated',
                        'share_poster_initiated'
                      )
                  AND share_origin.referral_id_hmac = analytics_events.referral_id_hmac
                  AND share_origin.anonymous_id_hmac <> analytics_events.anonymous_id_hmac
                  AND share_origin.content_version = analytics_events.source_content_version
                  AND share_origin.expires_at > CURRENT_TIMESTAMP
             )
         ) AS referred_browsers,
         COUNT(*) FILTER (WHERE event_name = 'poster_save_requested') AS poster_save_requests,
         COUNT(*) FILTER (WHERE event_name = 'poster_save_succeeded') AS poster_save_succeeded,
         COUNT(*) FILTER (WHERE event_name = 'poster_save_failed') AS poster_save_failed
       FROM analytics_events
       WHERE fortune_date BETWEEN $1::date AND $2::date
         AND ($3::text IS NULL OR channel_id = $3::text)
         AND ($4::text IS NULL OR content_version = $4::text)
         AND expires_at > CURRENT_TIMESTAMP`,
      [query.fromFortuneDate, query.toFortuneDate, query.channelId, query.contentVersion],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("analytics overview query returned no result");
    return overviewFromRow(row);
  }

  async report(query: AnalyticsReportQuery): Promise<StoredAnalyticsReport> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const summary = await this.queryOverview(
        {
          channelId: null,
          contentVersion: null,
          fromFortuneDate: query.fromFortuneDate,
          toFortuneDate: query.toFortuneDate,
        },
        (sql, values) => client.query<OverviewRow>(sql, values),
      );
      const dailyResult = await client.query<DailyRow>(
        `WITH report_dates AS (
           SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS fortune_date
         )
         SELECT
           to_char(report_dates.fortune_date, 'YYYY-MM-DD') AS fortune_date,
           COUNT(*) FILTER (
             WHERE event.event_name IN (${PAGE_VIEW_EVENT_SQL})
           ) AS page_views,
           COUNT(DISTINCT event.anonymous_id_hmac) AS anonymous_browsers,
           COUNT(DISTINCT event.anonymous_id_hmac) FILTER (
             WHERE event.event_name IN ('open_outfit_hub', 'view_daily_look')
           ) AS outfit_hub_visitors,
           COUNT(DISTINCT event.anonymous_id_hmac) FILTER (
             WHERE event.event_name = 'view_look_detail'
           ) AS outfit_detail_visitors,
           COUNT(*) FILTER (
             WHERE event.event_name IN ('share_summary_initiated', 'share_poster_initiated')
           ) AS share_initiations,
           COUNT(DISTINCT event.anonymous_id_hmac) FILTER (
             WHERE event.event_name IN ('share_summary_initiated', 'share_poster_initiated')
           ) AS sharing_browsers,
           COUNT(DISTINCT event.anonymous_id_hmac) FILTER (
             WHERE event.event_name IN ('share_link_landing_view', 'poster_landing_view')
               AND event.referral_id_hmac IS NOT NULL
               AND EXISTS (
                 SELECT 1
                   FROM analytics_events AS share_origin
                  WHERE share_origin.event_name IN (
                          'share_summary_initiated',
                          'share_poster_initiated'
                        )
                    AND share_origin.referral_id_hmac = event.referral_id_hmac
                    AND share_origin.anonymous_id_hmac <> event.anonymous_id_hmac
                    AND share_origin.content_version = event.source_content_version
                    AND share_origin.expires_at > CURRENT_TIMESTAMP
               )
           ) AS referred_browsers,
           COUNT(*) FILTER (
             WHERE event.event_name = 'poster_save_succeeded'
           ) AS poster_save_succeeded
         FROM report_dates
         LEFT JOIN analytics_events AS event
           ON event.fortune_date = report_dates.fortune_date
          AND event.expires_at > CURRENT_TIMESTAMP
         GROUP BY report_dates.fortune_date
         ORDER BY report_dates.fortune_date`,
        [query.fromFortuneDate, query.toFortuneDate],
      );
      const daily = dailyResult.rows.map((row) => ({
        anonymousBrowsers: count(row.anonymous_browsers, "daily anonymous browser count"),
        fortuneDate: row.fortune_date,
        outfitDetailVisitors: count(
          row.outfit_detail_visitors,
          "daily outfit detail visitor count",
        ),
        outfitHubVisitors: count(row.outfit_hub_visitors, "daily outfit hub visitor count"),
        pageViews: count(row.page_views, "daily page-view count"),
        posterSaveSucceeded: count(row.poster_save_succeeded, "daily poster-save success count"),
        referredBrowsers: count(row.referred_browsers, "daily referred browser count"),
        shareInitiations: count(row.share_initiations, "daily share initiation count"),
        sharingBrowsers: count(row.sharing_browsers, "daily sharing browser count"),
      }));
      const expectedDays =
        (new Date(`${query.toFortuneDate}T00:00:00.000Z`).valueOf() -
          new Date(`${query.fromFortuneDate}T00:00:00.000Z`).valueOf()) /
          86_400_000 +
        1;
      if (!Number.isInteger(expectedDays) || daily.length !== expectedDays) {
        throw new Error("analytics daily report did not return one row per fortune date");
      }

      const channelResult = await client.query<ChannelRow>(
        `WITH safe_buckets(channel_id, sort_order) AS (
           VALUES
             ('organic', 1),
             ('wechat_official', 2),
             ('wechat_group', 3),
             ('user_share', 4),
             ('other', 5)
         ), channel_totals AS (
           SELECT
             CASE
               WHEN channel_id IN ('organic', 'wechat_official', 'wechat_group', 'user_share')
                 THEN channel_id
               ELSE 'other'
             END AS channel_id,
             COUNT(*) AS page_views,
             COUNT(DISTINCT anonymous_id_hmac) AS anonymous_browsers
           FROM analytics_events
           WHERE fortune_date BETWEEN $1::date AND $2::date
             AND event_name IN (${PAGE_VIEW_EVENT_SQL})
             AND expires_at > CURRENT_TIMESTAMP
           GROUP BY 1
         )
         SELECT
           safe_buckets.channel_id,
           COALESCE(channel_totals.page_views, 0) AS page_views,
           COALESCE(channel_totals.anonymous_browsers, 0) AS anonymous_browsers
         FROM safe_buckets
         LEFT JOIN channel_totals USING (channel_id)
         ORDER BY safe_buckets.sort_order`,
        [query.fromFortuneDate, query.toFortuneDate],
      );
      const channelBreakdown = channelResult.rows.map((row) => {
        const pageViews = count(row.page_views, "channel page-view count");
        return {
          anonymousBrowsers: count(row.anonymous_browsers, "channel anonymous browser count"),
          channelId: row.channel_id,
          pageViews,
          ratio: summary.pageViews === 0 ? null : pageViews / summary.pageViews,
        };
      });
      if (
        channelBreakdown.reduce((total, point) => total + point.pageViews, 0) !== summary.pageViews
      ) {
        throw new Error("analytics channel page views do not match the report summary");
      }
      await client.query("COMMIT");
      return { channelBreakdown, daily, summary };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async purgeExpired(expiredAtOrBefore: Date): Promise<number> {
    const result = await this.pool.query("DELETE FROM analytics_events WHERE expires_at <= $1", [
      expiredAtOrBefore,
    ]);
    return result.rowCount ?? 0;
  }

  private async rollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error; the pool will discard an unusable connection.
    }
  }
}
