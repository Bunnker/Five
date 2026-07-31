import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresFeedbackReportRepository } from "./postgres-feedback-report.repository";

// The suite deletes all feedback rows to exercise the global anonymous window. It only runs
// against a database explicitly designated as disposable for feedback integration tests.
const databaseUrl = process.env.FIVE_FEEDBACK_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase("PostgresFeedbackReportRepository", () => {
  let pool: Pool;
  let repository: PostgresFeedbackReportRepository;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    repository = new PostgresFeedbackReportRepository(pool, {
      capacity: 1,
      windowSeconds: 60,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function cleanFeedbackRows(): Promise<void> {
    await pool.query("DELETE FROM feedback_rate_limit_windows");
    await pool.query("DELETE FROM feedback_reports");
  }

  beforeEach(cleanFeedbackRows);
  afterEach(cleanFeedbackRows);

  it("persists one accepted report and atomically rejects concurrent excess without network identity", async () => {
    const suffix = randomUUID();
    const createInput = (side: "a" | "b") => ({
      category: side === "a" ? ("content_error" as const) : ("product_feedback" as const),
      channelId: `integration-${side}`,
      contact: side === "a" ? "user@example.com" : null,
      contentVersion: "fd-20260715-r3",
      feedbackId: `feedback-integration-${side}-${suffix}`,
      fortuneDate: "2026-07-15",
      message: `integration feedback ${side}`,
      requestId: `feedback-integration-request-${side}-${suffix}`,
    });

    const results = await Promise.all([
      repository.create(createInput("a")),
      repository.create(createInput("b")),
    ]);

    expect(results.filter((result) => result.kind === "accepted")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "rate_limited")).toHaveLength(1);
    expect(results.find((result) => result.kind === "rate_limited")).toMatchObject({
      retryAfterSeconds: expect.any(Number),
    });

    const storedReports = await pool.query<{
      category: string;
      channel_id: string;
      contact: string | null;
      content_version: string;
      fortune_date: string;
      message: string;
      request_id: string;
      status: string;
    }>(
      `SELECT
         category,
         channel_id,
         contact,
         content_version,
         fortune_date::text,
         message,
         request_id,
         status
       FROM feedback_reports`,
    );
    expect(storedReports.rows).toHaveLength(1);
    expect(storedReports.rows[0]).toMatchObject({
      category: expect.stringMatching(/^(content_error|product_feedback)$/u),
      channel_id: expect.stringMatching(/^integration-[ab]$/u),
      content_version: "fd-20260715-r3",
      fortune_date: "2026-07-15",
      message: expect.stringMatching(/^integration feedback [ab]$/u),
      request_id: expect.stringContaining("feedback-integration-request-"),
      status: "received",
    });

    const windows = await pool.query<{
      accepted_count: number;
      last_request_id: string;
      rejected_count: number;
    }>(
      `SELECT accepted_count, rejected_count, last_request_id
       FROM feedback_rate_limit_windows`,
    );
    expect(windows.rows).toHaveLength(1);
    expect(windows.rows[0]).toEqual({
      accepted_count: 1,
      last_request_id: expect.stringContaining("feedback-integration-request-"),
      rejected_count: 1,
    });

    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name IN ('feedback_reports', 'feedback_rate_limit_windows')`,
    );
    const columnNames = columns.rows.map(({ column_name }) => column_name);
    expect(columnNames).not.toContain("ip_address");
    expect(columnNames).not.toContain("user_agent");
    expect(columnNames).not.toContain("anonymous_id");
  });
});
