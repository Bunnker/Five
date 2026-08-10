import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RequestContextResolver } from "../request-context/request-context-resolver";
import { AdminOperationsDateResolver } from "./admin-operations-date.resolver";
import { PostgresAdminOperationsStore } from "./postgres-admin-operations.store";

const databaseUrl = process.env.FIVE_CONTENT_LIFECYCLE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase("PostgreSQL admin operations snapshot", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
  });

  afterAll(async () => pool.end());

  it("executes the 42-day calendar read against the migrated schema", async () => {
    const dateResolver = new AdminOperationsDateResolver(
      new RequestContextResolver({ now: () => new Date("2030-01-01T00:00:00.000Z") }),
    );
    const fortuneDates = Array.from({ length: 42 }, (_, index) =>
      dateResolver.shiftFortuneDate("2030-01-01", index),
    );
    const store = new PostgresAdminOperationsStore(pool, dateResolver);

    const days = await store.readDays(fortuneDates);

    expect(days.map((day) => day.fortuneDate)).toEqual(fortuneDates);
    expect(days.every((day) => day.invariantBroken === false)).toBe(true);
  });

  it("projects an automatic production and its exact owning draft in the same snapshot", async () => {
    await pool.query(
      `INSERT INTO content_drafts (
         draft_id, fortune_date, draft_revision, modules, submitted_content_version,
         created_at, updated_at, submitted_at
       ) VALUES (
         'draft-admin-snapshot-2030-03-01', '2030-03-01', 1,
         '{"calendar_algorithm":null,"copy_and_formula":null,"poster_consistency":null,"visual_and_rights":null}'::jsonb,
         NULL, '2030-02-28T03:00:00.000Z', '2030-02-28T03:05:00.000Z', NULL
       );
       INSERT INTO daily_content_productions (
         fortune_date, draft_id, status, completed_image_slots, pending_image_slots,
         last_error, actor_id, request_id, updated_at
       ) VALUES (
         '2030-03-01', 'draft-admin-snapshot-2030-03-01', 'generating', 0, 2,
         NULL, 'system:test', 'request-admin-snapshot-20300301', '2030-02-28T03:05:00.000Z'
       )`,
    );
    const dateResolver = new AdminOperationsDateResolver(
      new RequestContextResolver({ now: () => new Date("2030-02-28T04:00:00.000Z") }),
    );
    const store = new PostgresAdminOperationsStore(pool, dateResolver);

    const [day] = await store.readDays(["2030-03-01"]);

    expect(day).toMatchObject({
      draft: {
        draftId: "draft-admin-snapshot-2030-03-01",
        draftRevision: 1,
      },
      fortuneDate: "2030-03-01",
      invariantBroken: false,
      production: {
        optionalJobStatus: "not_requested",
        requiredJobs: [
          {
            deliveryReady: false,
            imageSlot: "required_primary",
            status: "failed",
          },
          {
            deliveryReady: false,
            imageSlot: "required_alternative",
            status: "failed",
          },
        ],
        status: "failed",
      },
    });
  });

  it("returns a complete pre-commit state while a publication switch commits mid-read", async () => {
    await pool.query(
      `INSERT INTO content_lifecycle_days (
         fortune_date, lifecycle_revision, active_content_version,
         schedule_slot_revision, scheduled_content_version, scheduled_effective_from
       ) VALUES ('2030-04-01', 1, NULL, 0, NULL, NULL);
       INSERT INTO content_drafts (
         draft_id, fortune_date, draft_revision, modules, submitted_content_version,
         created_at, updated_at, submitted_at
       ) VALUES
         (
           'draft-admin-snapshot-a', '2030-04-01', 1,
           '{"calendar_algorithm":null,"copy_and_formula":null,"poster_consistency":null,"visual_and_rights":null}'::jsonb,
           NULL, '2030-03-31T02:00:00.000Z', '2030-03-31T02:00:00.000Z', NULL
         ),
         (
           'draft-admin-snapshot-b', '2030-04-01', 1,
           '{"calendar_algorithm":null,"copy_and_formula":null,"poster_consistency":null,"visual_and_rights":null}'::jsonb,
           NULL, '2030-03-31T03:00:00.000Z', '2030-03-31T03:00:00.000Z', NULL
         );
       INSERT INTO content_versions (
         content_version, draft_id, fortune_date, state, snapshot, preflight_checks,
         created_at, effective_from, effective_to
       ) VALUES
         (
           'content-admin-snapshot-a', 'draft-admin-snapshot-a', '2030-04-01', 'published',
           '{"calendar_algorithm":null,"copy_and_formula":null,"poster_consistency":null,"visual_and_rights":null}'::jsonb,
           '[]'::jsonb, '2030-03-31T02:00:00.000Z',
           '2030-03-31T10:00:00.000Z', '2030-04-01T10:00:00.000Z'
         ),
         (
           'content-admin-snapshot-b', 'draft-admin-snapshot-b', '2030-04-01', 'approved',
           '{"calendar_algorithm":null,"copy_and_formula":null,"poster_consistency":null,"visual_and_rights":null}'::jsonb,
           '[]'::jsonb, '2030-03-31T03:00:00.000Z',
           '2030-03-31T10:00:00.000Z', '2030-04-01T10:00:00.000Z'
         );
       UPDATE content_lifecycle_days
          SET active_content_version = 'content-admin-snapshot-a'
        WHERE fortune_date = '2030-04-01'`,
    );

    const readerClient = await pool.connect();
    let markSnapshotEstablished!: () => void;
    const snapshotEstablished = new Promise<void>((resolve) => {
      markSnapshotEstablished = resolve;
    });
    let resumeReader!: () => void;
    const readerMayContinue = new Promise<void>((resolve) => {
      resumeReader = resolve;
    });
    let paused = false;
    const wrappedClient = {
      query: async (statement: unknown, parameters?: readonly unknown[]) => {
        const result = await readerClient.query(statement as string, parameters as unknown[]);
        if (!paused && String(statement).includes("FROM daily_content_productions AS production")) {
          paused = true;
          markSnapshotEstablished();
          await readerMayContinue;
        }
        return result;
      },
      release: () => readerClient.release(),
    };
    const wrappedPool = {
      connect: () => Promise.resolve(wrappedClient),
    } as unknown as Pool;
    const dateResolver = new AdminOperationsDateResolver(
      new RequestContextResolver({ now: () => new Date("2030-03-31T04:00:00.000Z") }),
    );
    const store = new PostgresAdminOperationsStore(wrappedPool, dateResolver);
    const readBeforeCommit = store.readDays(["2030-04-01"]);

    await snapshotEstablished;
    const writer: PoolClient = await pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query(
        `UPDATE content_versions
            SET state = 'superseded'
          WHERE content_version = 'content-admin-snapshot-a';
         UPDATE content_versions
            SET state = 'published'
          WHERE content_version = 'content-admin-snapshot-b';
         UPDATE content_lifecycle_days
            SET active_content_version = 'content-admin-snapshot-b', lifecycle_revision = 2
          WHERE fortune_date = '2030-04-01'`,
      );
      await writer.query("COMMIT");
    } catch (error) {
      await writer.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      writer.release();
      resumeReader();
    }

    const [beforeCommit] = await readBeforeCommit;
    expect(beforeCommit).toMatchObject({
      active: { contentVersion: "content-admin-snapshot-a", state: "published" },
      invariantBroken: false,
      lifecycleRevision: 1,
    });

    const [afterCommit] = await new PostgresAdminOperationsStore(pool, dateResolver).readDays([
      "2030-04-01",
    ]);
    expect(afterCommit).toMatchObject({
      active: { contentVersion: "content-admin-snapshot-b", state: "published" },
      invariantBroken: false,
      lifecycleRevision: 2,
    });
  });
});
