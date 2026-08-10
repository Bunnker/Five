import { describe, expect, it } from "vitest";

import { InMemoryPosterJobRepository } from "./poster-job.repository";

describe("PosterJobRepository claim fencing", () => {
  it("replaces a legacy two-parameter landing job without weakening idempotency conflict detection", async () => {
    const repository = new InMemoryPosterJobRepository(10);
    const common = {
      channelId: "organic",
      currentActiveContentVersion: "fd-20260715-r3",
      expectedContentVersion: "fd-20260715-r3",
      fortuneDate: "2026-07-15",
      idempotencyKey: "018f9d15-7c70-7bb2-8f9d-legacy-replay",
      posterTemplateVersion: "poster-template-v3",
      requestHash: "a".repeat(64),
    };
    const legacy = await repository.createOrReuse({
      ...common,
      jobId: "poster-job-legacy-landing",
      landingUrl:
        "https://five.example.com/daily/2026-07-15?channelId=organic&expectedContentVersion=fd-20260715-r3",
    });
    expect(legacy).toMatchObject({ kind: "created" });

    await expect(
      repository.findByIdempotency(common.idempotencyKey, common.requestHash),
    ).resolves.toEqual({ kind: "missing" });
    await expect(
      repository.findByIdempotency(common.idempotencyKey, "b".repeat(64)),
    ).resolves.toEqual({ kind: "idempotency_conflict" });

    const replacement = await repository.createOrReuse({
      ...common,
      jobId: "poster-job-current-landing",
      landingUrl:
        "https://five.example.com/daily/2026-07-15?channelId=organic&expectedContentVersion=fd-20260715-r3&referralId=poster-job-current-landing&referralKind=poster",
    });
    expect(replacement).toMatchObject({
      kind: "created",
      record: { jobId: "poster-job-current-landing", status: "processing" },
    });
    await expect(repository.findById("poster-job-legacy-landing")).resolves.toMatchObject({
      assetKey: null,
      assetUrl: null,
      status: "version_changed",
    });
    await expect(
      repository.findByIdempotency(common.idempotencyKey, common.requestHash),
    ).resolves.toMatchObject({
      kind: "existing",
      record: { jobId: "poster-job-current-landing" },
    });
  });

  it("stops retaining a ready legacy QR asset and leaves a reserved in-flight asset for garbage cleanup", async () => {
    const createLegacy = async (
      repository: InMemoryPosterJobRepository,
      jobId: string,
      idempotencyKey: string,
    ) => {
      await repository.createOrReuse({
        channelId: jobId,
        currentActiveContentVersion: "fd-20260715-r3",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
        idempotencyKey,
        jobId,
        landingUrl:
          "https://five.example.com/daily/2026-07-15?channelId=organic&expectedContentVersion=fd-20260715-r3",
        posterTemplateVersion: "poster-template-v3",
        requestHash: jobId.at(-1)?.repeat(64) ?? "c".repeat(64),
      });
    };
    const readyRepository = new InMemoryPosterJobRepository(10);
    await createLegacy(readyRepository, "legacy-ready-a", "legacy-ready-idempotency");
    const readyClaim = await readyRepository.claimNext({
      attemptToken: "legacy-ready-attempt",
      workerId: "legacy-ready-worker",
    });
    expect(readyClaim?.jobId).toBe("legacy-ready-a");
    await readyRepository.reserveAsset({
      assetKey: "poster-legacy-ready.png",
      attemptToken: "legacy-ready-attempt",
      jobId: "legacy-ready-a",
      workerId: "legacy-ready-worker",
    });
    await readyRepository.completeReady({
      assetKey: "poster-legacy-ready.png",
      assetUrl: "https://assets.example.com/poster-legacy-ready.png",
      attemptToken: "legacy-ready-attempt",
      currentActiveContentVersion: "fd-20260715-r3",
      jobId: "legacy-ready-a",
      posterInstanceId: "legacy-ready-poster",
      workerId: "legacy-ready-worker",
    });

    await readyRepository.createOrReuse({
      channelId: "legacy-ready-a",
      currentActiveContentVersion: "fd-20260715-r3",
      expectedContentVersion: "fd-20260715-r3",
      fortuneDate: "2026-07-15",
      idempotencyKey: "current-ready-idempotency",
      jobId: "current-ready-a",
      landingUrl:
        "https://five.example.com/daily/2026-07-15?channelId=legacy-ready-a&expectedContentVersion=fd-20260715-r3&referralId=current-ready-a&referralKind=poster",
      posterTemplateVersion: "poster-template-v3",
      requestHash: "d".repeat(64),
    });
    await expect(
      readyRepository.findRetainedAssetKeys(["poster-legacy-ready.png"]),
    ).resolves.toEqual([]);

    const processingRepository = new InMemoryPosterJobRepository(10);
    await createLegacy(
      processingRepository,
      "legacy-processing-b",
      "legacy-processing-idempotency",
    );
    const processingClaim = await processingRepository.claimNext({
      attemptToken: "legacy-processing-attempt",
      workerId: "legacy-processing-worker",
    });
    expect(processingClaim?.jobId).toBe("legacy-processing-b");
    await processingRepository.reserveAsset({
      assetKey: "poster-legacy-processing.png",
      attemptToken: "legacy-processing-attempt",
      jobId: "legacy-processing-b",
      workerId: "legacy-processing-worker",
    });
    await processingRepository.createOrReuse({
      channelId: "legacy-processing-b",
      currentActiveContentVersion: "fd-20260715-r3",
      expectedContentVersion: "fd-20260715-r3",
      fortuneDate: "2026-07-15",
      idempotencyKey: "current-processing-idempotency",
      jobId: "current-processing-b",
      landingUrl:
        "https://five.example.com/daily/2026-07-15?channelId=legacy-processing-b&expectedContentVersion=fd-20260715-r3&referralId=current-processing-b&referralKind=poster",
      posterTemplateVersion: "poster-template-v3",
      requestHash: "e".repeat(64),
    });
    await expect(processingRepository.claimGarbageAssetKeys({ limit: 10 })).resolves.toEqual([
      "poster-legacy-processing.png",
    ]);
  });

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
