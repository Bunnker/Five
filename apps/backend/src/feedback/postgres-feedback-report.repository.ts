import type { Pool, PoolClient } from "pg";

import type {
  CreateFeedbackReportRecordInput,
  CreateFeedbackReportResult,
  FeedbackReportRepository,
} from "./feedback-report.repository";

export interface FeedbackRateLimitOptions {
  capacity: number;
  windowSeconds: number;
}

const DEFAULT_RATE_LIMIT: FeedbackRateLimitOptions = {
  capacity: 60,
  windowSeconds: 60,
};

interface RateLimitRow {
  accepted_count: number;
  retry_after_seconds: number;
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export class PostgresFeedbackReportRepository implements FeedbackReportRepository {
  private readonly capacity: number;
  private readonly windowSeconds: number;

  constructor(
    private readonly pool: Pool,
    options: FeedbackRateLimitOptions = DEFAULT_RATE_LIMIT,
  ) {
    this.capacity = requirePositiveInteger(options.capacity, "feedback rate-limit capacity");
    this.windowSeconds = requirePositiveInteger(
      options.windowSeconds,
      "feedback rate-limit window",
    );
  }

  async create(input: CreateFeedbackReportRecordInput): Promise<CreateFeedbackReportResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // One global lock avoids retaining an IP address or durable browser identifier solely for
      // abuse control. The capacity is deliberately generous because all anonymous visitors share it.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('five-feedback-report-global-rate-limit'))",
      );
      const limit = await this.readRateLimit(client);

      if (limit.accepted_count >= this.capacity) {
        await this.recordRateLimitOutcome(client, input.requestId, "rate_limited");
        await client.query("COMMIT");
        return {
          kind: "rate_limited",
          retryAfterSeconds: Math.max(1, limit.retry_after_seconds),
        };
      }

      await client.query(
        `INSERT INTO feedback_reports (
           feedback_id,
           category,
           message,
           fortune_date,
           content_version,
           channel_id,
           contact,
           request_id,
           status,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, 'received', clock_timestamp(), clock_timestamp())`,
        [
          input.feedbackId,
          input.category,
          input.message,
          input.fortuneDate,
          input.contentVersion,
          input.channelId,
          input.contact,
          input.requestId,
        ],
      );
      await this.recordRateLimitOutcome(client, input.requestId, "accepted");
      await client.query("COMMIT");
      return { feedbackId: input.feedbackId, kind: "accepted" };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readRateLimit(client: PoolClient): Promise<RateLimitRow> {
    const result = await client.query<RateLimitRow>(
      `SELECT
         COUNT(*)::integer AS accepted_count,
         COALESCE(
           GREATEST(
             1,
             CEIL(EXTRACT(EPOCH FROM (
               MIN(created_at) + ($1::integer * INTERVAL '1 second') - clock_timestamp()
             )))::integer
           ),
           $1::integer
         ) AS retry_after_seconds
       FROM feedback_reports
       WHERE created_at > clock_timestamp() - ($1::integer * INTERVAL '1 second')`,
      [this.windowSeconds],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Feedback rate-limit query returned no result");
    }
    return row;
  }

  private async recordRateLimitOutcome(
    client: PoolClient,
    requestId: string,
    outcome: "accepted" | "rate_limited",
  ): Promise<void> {
    // These aggregates are transient abuse-control state, not visitor analytics. Keeping only the
    // last day bounds storage while retaining enough evidence to diagnose current rate limiting.
    await client.query(
      `DELETE FROM feedback_rate_limit_windows
       WHERE window_ends_at < clock_timestamp() - INTERVAL '24 hours'`,
    );
    await client.query(
      `INSERT INTO feedback_rate_limit_windows (
         window_started_at,
         window_ends_at,
         accepted_count,
         rejected_count,
         last_request_id,
         updated_at
       )
       SELECT
         date_bin($1::integer * INTERVAL '1 second', observed_at, TIMESTAMPTZ '2000-01-01 00:00:00+00'),
         date_bin($1::integer * INTERVAL '1 second', observed_at, TIMESTAMPTZ '2000-01-01 00:00:00+00')
           + ($1::integer * INTERVAL '1 second'),
         CASE WHEN $2::text = 'accepted' THEN 1 ELSE 0 END,
         CASE WHEN $2::text = 'rate_limited' THEN 1 ELSE 0 END,
         $3,
         observed_at
       FROM (SELECT clock_timestamp() AS observed_at) AS observed
       ON CONFLICT (window_started_at) DO UPDATE SET
         accepted_count = feedback_rate_limit_windows.accepted_count
           + CASE WHEN $2::text = 'accepted' THEN 1 ELSE 0 END,
         rejected_count = feedback_rate_limit_windows.rejected_count
           + CASE WHEN $2::text = 'rate_limited' THEN 1 ELSE 0 END,
         last_request_id = EXCLUDED.last_request_id,
         updated_at = EXCLUDED.updated_at`,
      [this.windowSeconds, outcome, requestId],
    );
  }

  private async rollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error; the pool will discard an unusable connection.
    }
  }
}
