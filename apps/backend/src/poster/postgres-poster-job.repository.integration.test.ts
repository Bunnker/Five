import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresPosterJobRepository } from "./postgres-poster-job.repository";

// This suite atomically claims the next global job, so it only runs against an explicitly
// disposable database and never against the developer's ordinary DATABASE_URL.
const databaseUrl = process.env.FIVE_POSTER_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase("PostgresPosterJobRepository", () => {
  let pool: Pool;
  let repository: PostgresPosterJobRepository;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    repository = new PostgresPosterJobRepository(pool, 1);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function cleanIntegrationRows(): Promise<void> {
    await pool.query(
      "DELETE FROM poster_asset_reservations WHERE job_id LIKE 'repository-%' OR job_id LIKE 'unused-%' OR job_id LIKE 'conflict-%' OR job_id LIKE 'capacity-%' OR job_id LIKE 'reuse-%' OR job_id LIKE 'race-%'",
    );
    await pool.query(
      "DELETE FROM poster_job_idempotency WHERE job_id LIKE 'repository-%' OR job_id LIKE 'unused-%' OR job_id LIKE 'conflict-%' OR job_id LIKE 'capacity-%' OR job_id LIKE 'reuse-%' OR job_id LIKE 'race-%'",
    );
    await pool.query(
      "DELETE FROM poster_jobs WHERE job_id LIKE 'repository-%' OR job_id LIKE 'unused-%' OR job_id LIKE 'conflict-%' OR job_id LIKE 'capacity-%' OR job_id LIKE 'reuse-%' OR job_id LIKE 'race-%'",
    );
  }

  beforeEach(cleanIntegrationRows);
  afterEach(cleanIntegrationRows);

  it("persists idempotency and atomically claims a single durable job", async () => {
    const suffix = randomUUID();
    const jobId = `repository-${suffix}`;
    const idempotencyKey = `idempotency-${suffix}`;
    const input = {
      channelId: `integration-${suffix}`.slice(0, 64),
      currentActiveContentVersion: "fd-20260715-r3",
      expectedContentVersion: "fd-20260715-r3",
      fortuneDate: "2026-07-15",
      idempotencyKey,
      jobId,
      landingUrl: `https://five.example.com/daily/2026-07-15?channelId=integration&expectedContentVersion=fd-20260715-r3`,
      posterTemplateVersion: "poster-template-v3",
      requestHash: "a".repeat(64),
    };

    const created = await repository.createOrReuse(input);
    const replay = await repository.createOrReuse({ ...input, jobId: `unused-${suffix}` });
    const conflict = await repository.createOrReuse({
      ...input,
      expectedContentVersion: "fd-20260715-r4",
      jobId: `conflict-${suffix}`,
      requestHash: "b".repeat(64),
    });
    const reusedAtCapacity = await repository.createOrReuse({
      ...input,
      idempotencyKey: `reuse-${suffix}`,
      jobId: `reuse-${suffix}`,
    });
    const rateLimited = await repository.createOrReuse({
      ...input,
      channelId: `capacity-${suffix}`.slice(0, 64),
      idempotencyKey: `capacity-${suffix}`,
      jobId: `capacity-${suffix}`,
      requestHash: "c".repeat(64),
    });
    const [firstClaim, secondClaim] = await Promise.all([
      repository.claimNext({
        attemptToken: `attempt-a-${suffix}`,
        workerId: `worker-a-${suffix}`,
      }),
      repository.claimNext({
        attemptToken: `attempt-b-${suffix}`,
        workerId: `worker-b-${suffix}`,
      }),
    ]);
    const claimed = firstClaim ?? secondClaim;

    expect(created).toMatchObject({ kind: "created", record: { jobId } });
    expect(replay).toMatchObject({ kind: "existing", record: { jobId } });
    expect(conflict).toEqual({ kind: "idempotency_conflict" });
    expect(reusedAtCapacity).toMatchObject({ kind: "existing", record: { jobId } });
    expect(rateLimited).toEqual({ kind: "rate_limited", queueCapacity: 1 });
    expect([firstClaim, secondClaim].filter((value) => value?.jobId === jobId)).toHaveLength(1);
    expect(claimed).toMatchObject({ attempts: 1, jobId, status: "processing" });

    if (claimed === null) {
      throw new Error("Expected one claimed poster job");
    }
    const staleAssetKey = `stale-${jobId}.svg`;
    await expect(
      repository.reserveAsset({
        assetKey: staleAssetKey,
        attemptToken: claimed.attemptToken ?? "",
        jobId,
        workerId: claimed.lockedBy ?? "",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.findRetainedAssetKeys([staleAssetKey, "unknown-poster.svg"]),
    ).resolves.toEqual([staleAssetKey]);
    await expect(repository.acknowledgeGarbageAsset(staleAssetKey)).resolves.toBe(false);
    await pool.query(
      "UPDATE poster_jobs SET locked_at = now() - interval '6 minutes' WHERE job_id = $1",
      [jobId],
    );
    const replacementClaim = await repository.claimNext({
      attemptToken: `attempt-replacement-${suffix}`,
      workerId: `worker-replacement-${suffix}`,
    });
    expect(replacementClaim).toMatchObject({
      attemptToken: `attempt-replacement-${suffix}`,
      attempts: 2,
      jobId,
    });
    await expect(repository.claimGarbageAssetKeys({ limit: 16 })).resolves.toEqual([staleAssetKey]);
    await expect(repository.acknowledgeGarbageAsset(staleAssetKey)).resolves.toBe(true);
    await expect(repository.findRetainedAssetKeys([staleAssetKey])).resolves.toEqual([]);
    await expect(repository.claimGarbageAssetKeys({ limit: 16 })).resolves.toEqual([]);

    await expect(
      repository.completeReady({
        assetKey: staleAssetKey,
        assetUrl: `https://assets.example.com/${staleAssetKey}`,
        attemptToken: claimed.attemptToken ?? "",
        currentActiveContentVersion: "fd-20260715-r3",
        jobId,
        posterInstanceId: `stale-poster-${jobId}`,
        workerId: claimed.lockedBy ?? "",
      }),
    ).resolves.toBe(false);
    if (replacementClaim === null) {
      throw new Error("Expected the stale poster claim to be replaced");
    }
    await expect(
      repository.reserveAsset({
        assetKey: `private-${suffix}.svg`,
        attemptToken: replacementClaim.attemptToken ?? "",
        jobId,
        workerId: replacementClaim.lockedBy ?? "",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.completeReady({
        assetKey: `private-${suffix}.svg`,
        assetUrl: `https://assets.example.com/private-${suffix}.svg`,
        attemptToken: replacementClaim.attemptToken ?? "",
        currentActiveContentVersion: "fd-20260715-r3",
        jobId,
        posterInstanceId: `poster-${suffix}`,
        workerId: replacementClaim.lockedBy ?? "",
      }),
    ).resolves.toBe(true);
    await expect(repository.findById(jobId)).resolves.toMatchObject({
      assetKey: `private-${suffix}.svg`,
      jobId,
      status: "ready",
    });
    await expect(
      repository.findRetainedAssetKeys([`private-${suffix}.svg`, staleAssetKey]),
    ).resolves.toEqual([`private-${suffix}.svg`]);
  });

  it("serializes concurrent creators at queue capacity", async () => {
    const suffix = randomUUID();
    const input = (side: "a" | "b") => ({
      channelId: `race-${side}-${suffix}`.slice(0, 64),
      currentActiveContentVersion: "fd-20260715-r3",
      expectedContentVersion: "fd-20260715-r3",
      fortuneDate: "2026-07-15",
      idempotencyKey: `race-idempotency-${side}-${suffix}`,
      jobId: `race-${side}-${suffix}`,
      landingUrl: `https://five.example.com/daily/2026-07-15?channelId=race-${side}&expectedContentVersion=fd-20260715-r3`,
      posterTemplateVersion: "poster-template-v3",
      requestHash: side.repeat(64),
    });

    const results = await Promise.all([
      repository.createOrReuse(input("a")),
      repository.createOrReuse(input("b")),
    ]);

    expect(results.filter((result) => result.kind === "created")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "rate_limited")).toEqual([
      { kind: "rate_limited", queueCapacity: 1 },
    ]);
  });
});
