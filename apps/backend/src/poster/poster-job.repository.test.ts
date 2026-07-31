import { describe, expect, it } from "vitest";

import { InMemoryPosterJobRepository } from "./poster-job.repository";

describe("PosterJobRepository claim fencing", () => {
  it("allows a stale claim to be replaced and rejects every write from the old attempt", async () => {
    let now = 1_000_000;
    const repository = new InMemoryPosterJobRepository(10, () => now, 300_000);
    await repository.createOrReuse({
      channelId: "organic",
      currentActiveContentVersion: "fd-20260715-r3",
      expectedContentVersion: "fd-20260715-r3",
      fortuneDate: "2026-07-15",
      idempotencyKey: "018f9d15-7c70-7bb2-8f9d-fencing",
      jobId: "poster-job-fencing",
      landingUrl:
        "https://five.example.com/daily/2026-07-15?channelId=organic&expectedContentVersion=fd-20260715-r3",
      posterTemplateVersion: "poster-template-v3",
      requestHash: "a".repeat(64),
    });

    const oldClaim = await repository.claimNext({
      attemptToken: "attempt-old-private-token",
      workerId: "host-a-123-uuid-a",
    });
    await expect(
      repository.reserveAsset({
        assetKey: "poster-attempt-old-private-token.svg",
        attemptToken: "attempt-old-private-token",
        jobId: "poster-job-fencing",
        workerId: "host-a-123-uuid-a",
      }),
    ).resolves.toBe(true);
    now += 300_001;
    const newClaim = await repository.claimNext({
      attemptToken: "attempt-new-private-token",
      workerId: "host-b-456-uuid-b",
    });

    expect(oldClaim).toMatchObject({ attemptToken: "attempt-old-private-token", attempts: 1 });
    expect(newClaim).toMatchObject({ attemptToken: "attempt-new-private-token", attempts: 2 });
    await expect(repository.claimGarbageAssetKeys({ limit: 10 })).resolves.toEqual([
      "poster-attempt-old-private-token.svg",
    ]);
    await expect(
      repository.reserveAsset({
        assetKey: "poster-attempt-old-private-token.svg",
        attemptToken: "attempt-old-private-token",
        jobId: "poster-job-fencing",
        workerId: "host-a-123-uuid-a",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.reserveAsset({
        assetKey: "poster-attempt-new-private-token.svg",
        attemptToken: "attempt-new-private-token",
        jobId: "poster-job-fencing",
        workerId: "host-b-456-uuid-b",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.completeReady({
        assetKey: "poster-attempt-new-private-token.svg",
        assetUrl: "https://assets.example.com/poster-attempt-new-private-token.svg",
        attemptToken: "attempt-new-private-token",
        currentActiveContentVersion: "fd-20260715-r3",
        jobId: "poster-job-fencing",
        posterInstanceId: "poster-instance-new",
        workerId: "host-b-456-uuid-b",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.completeReady({
        assetKey: "poster-attempt-old-private-token.svg",
        assetUrl: "https://assets.example.com/poster-attempt-old-private-token.svg",
        attemptToken: "attempt-old-private-token",
        currentActiveContentVersion: "fd-20260715-r3",
        jobId: "poster-job-fencing",
        posterInstanceId: "poster-instance-old",
        workerId: "host-a-123-uuid-a",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.markVersionChanged({
        attemptToken: "attempt-old-private-token",
        currentActiveContentVersion: "fd-20260715-r4",
        jobId: "poster-job-fencing",
        workerId: "host-a-123-uuid-a",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.recordFailure({
        attemptToken: "attempt-old-private-token",
        errorMessage: "late old worker",
        jobId: "poster-job-fencing",
        maxAttempts: 3,
        workerId: "host-a-123-uuid-a",
      }),
    ).resolves.toBe("lost");
    await expect(repository.findById("poster-job-fencing")).resolves.toMatchObject({
      assetKey: "poster-attempt-new-private-token.svg",
      posterInstanceId: "poster-instance-new",
      status: "ready",
    });
    await expect(repository.claimGarbageAssetKeys({ limit: 10 })).resolves.toEqual([]);
  });
});
