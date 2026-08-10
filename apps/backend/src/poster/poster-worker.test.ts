import type { components } from "@five/api-contract";
import { describe, expect, it, vi } from "vitest";

import type { PublishedContentReader } from "../today/today-content.service";
import type { PosterAssetStore } from "./poster-asset.store";
import { InMemoryPosterJobRepository } from "./poster-job.repository";
import { PosterJobService } from "./poster-job.service";
import type { PosterRenderer } from "./poster-renderer";
import { PosterWorker } from "./poster-worker";

type DailyContent = components["schemas"]["DailyContent"];

const content = {
  fortuneDate: "2026-07-15",
  looks: [
    {
      coverImage: {
        aiDisclosure: "AI 生成穿搭示意图",
        aiGenerated: true,
        assetId: "reviewed-look-01",
        height: 1600,
        mediaType: "image/webp",
        url: "https://cdn.example.com/reviewed-look-01.webp",
        width: 1200,
      },
      requiredForPublish: true,
      sortOrder: 1,
    },
  ],
  share: { posterTemplateVersion: "poster-template-v3" },
  versions: {
    contentVersion: "fd-20260715-r3",
    posterTemplateVersion: "poster-template-v3",
  },
} as unknown as DailyContent;

describe("PosterWorker", () => {
  it("claims one job, verifies the active version twice, and publishes one deterministic asset", async () => {
    const repository = new InMemoryPosterJobRepository();
    const findActiveByFortuneDate = vi.fn(() => Promise.resolve(content));
    const reader: PublishedContentReader = { findActiveByFortuneDate };
    const jobService = new PosterJobService(
      repository,
      reader,
      () => "poster-job-01",
      "https://five.example.com",
    );
    await jobService.create(
      {
        channelId: "organic",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      "018f9d15-7c70-7bb2-8f9d-123456789abc",
    );
    findActiveByFortuneDate.mockClear();

    const render = vi.fn<PosterRenderer["render"]>(() =>
      Promise.resolve({ body: Buffer.from("png", "utf8"), mediaType: "image/png" }),
    );
    const put = vi.fn<PosterAssetStore["put"]>(() => Promise.resolve());
    const store: PosterAssetStore = {
      delete: () => Promise.resolve(),
      listKeys: () => Promise.resolve([]),
      put,
      read: () => Promise.resolve(null),
    };
    const worker = new PosterWorker(
      repository,
      reader,
      { render },
      store,
      "https://assets.example.com/posters/",
      "worker-01",
      () => "attempt-token-01",
    );

    expect(await worker.runOne()).toBe("ready");
    expect(await worker.runOne()).toBe("idle");
    expect(findActiveByFortuneDate).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledWith({
      content,
      landingUrl:
        "https://five.example.com/daily/2026-07-15?channelId=organic&expectedContentVersion=fd-20260715-r3&referralId=poster-job-01&referralKind=poster",
      posterTemplateVersion: "poster-template-v3",
      sourceContentVersion: "fd-20260715-r3",
    });
    expect(put).toHaveBeenCalledWith("poster-attempt-token-01.png", Buffer.from("png", "utf8"));
    expect(put).toHaveBeenCalledTimes(1);
    await expect(jobService.get("poster-job-01")).resolves.toEqual({
      assetUrl: "https://assets.example.com/posters/poster-attempt-token-01.png",
      channelId: "organic",
      currentActiveContentVersion: "fd-20260715-r3",
      entry: {
        landingUrl:
          "https://five.example.com/daily/2026-07-15?channelId=organic&expectedContentVersion=fd-20260715-r3&referralId=poster-job-01&referralKind=poster",
        type: "web_qr",
      },
      jobId: "poster-job-01",
      posterInstanceId: "poster-attempt-token-01",
      posterTemplateVersion: "poster-template-v3",
      sourceContentVersion: "fd-20260715-r3",
      status: "ready",
    });
  });

  it("keeps a ready asset when the database committed before the completion response was lost", async () => {
    const repository = new InMemoryPosterJobRepository();
    const reader: PublishedContentReader = {
      findActiveByFortuneDate: () => Promise.resolve(content),
    };
    const jobService = new PosterJobService(
      repository,
      reader,
      () => "poster-job-ambiguous-completion",
      "https://five.example.com",
    );
    await jobService.create(
      {
        channelId: "organic",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      "018f9d15-7c70-7bb2-8f9d-ambiguous-completion",
    );
    const completeReady = repository.completeReady.bind(repository);
    vi.spyOn(repository, "completeReady").mockImplementation(async (input) => {
      await completeReady(input);
      throw new Error("database response was lost after commit");
    });
    const assets = new Map<string, Buffer>();
    const deleteAsset = vi.fn<PosterAssetStore["delete"]>((assetKey) => {
      assets.delete(assetKey);
      return Promise.resolve();
    });
    const worker = new PosterWorker(
      repository,
      reader,
      {
        render: () => Promise.resolve({ body: Buffer.from("png", "utf8"), mediaType: "image/png" }),
      },
      {
        delete: deleteAsset,
        listKeys: () => Promise.resolve([...assets.keys()]),
        put: (assetKey, body) => {
          assets.set(assetKey, body);
          return Promise.resolve();
        },
        read: (assetKey) => Promise.resolve(assets.get(assetKey) ?? null),
      },
      "https://assets.example.com/posters/",
      "worker-ambiguous-completion",
      () => "attempt-ambiguous-completion",
    );

    await expect(worker.runOne()).resolves.toBe("ready");
    expect(deleteAsset).not.toHaveBeenCalled();
    expect([...assets.keys()]).toEqual(["poster-attempt-ambiguous-completion.png"]);
    await expect(jobService.get("poster-job-ambiguous-completion")).resolves.toMatchObject({
      assetUrl: "https://assets.example.com/posters/poster-attempt-ambiguous-completion.png",
      status: "ready",
    });
  });

  it("invalidates the unfinished job when the active version changes after rendering", async () => {
    const repository = new InMemoryPosterJobRepository();
    const changedContent = {
      ...content,
      versions: { ...content.versions, contentVersion: "fd-20260715-r4" },
    };
    const findActiveByFortuneDate = vi
      .fn<PublishedContentReader["findActiveByFortuneDate"]>()
      .mockResolvedValueOnce(content);
    const reader: PublishedContentReader = { findActiveByFortuneDate };
    const jobService = new PosterJobService(
      repository,
      reader,
      () => "poster-job-version-change",
      "https://five.example.com",
    );
    await jobService.create(
      {
        channelId: "organic",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      "018f9d15-7c70-7bb2-8f9d-version-change",
    );
    findActiveByFortuneDate
      .mockResolvedValueOnce(content)
      .mockResolvedValueOnce(changedContent as DailyContent);
    const deleteAsset = vi.fn<PosterAssetStore["delete"]>(() => Promise.resolve());
    const worker = new PosterWorker(
      repository,
      reader,
      {
        render: () => Promise.resolve({ body: Buffer.from("png", "utf8"), mediaType: "image/png" }),
      },
      {
        delete: deleteAsset,
        listKeys: () => Promise.resolve([]),
        put: () => Promise.resolve(),
        read: () => Promise.resolve(null),
      },
      "https://assets.example.com/posters/",
      "worker-version-check",
      () => "attempt-token-version-change",
    );

    expect(await worker.runOne()).toBe("version_changed");
    expect(deleteAsset).toHaveBeenCalledWith("poster-attempt-token-version-change.png");
    await expect(jobService.get("poster-job-version-change")).resolves.toMatchObject({
      assetUrl: null,
      currentActiveContentVersion: "fd-20260715-r4",
      entry: null,
      status: "version_changed",
    });
  });

  it("retries a transient render failure without publishing duplicate artifacts", async () => {
    const repository = new InMemoryPosterJobRepository();
    const reader: PublishedContentReader = {
      findActiveByFortuneDate: () => Promise.resolve(content),
    };
    const jobService = new PosterJobService(
      repository,
      reader,
      () => "poster-job-retry",
      "https://five.example.com",
    );
    await jobService.create(
      {
        channelId: "organic",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      "018f9d15-7c70-7bb2-8f9d-render-retry",
    );
    const render = vi
      .fn<PosterRenderer["render"]>()
      .mockRejectedValueOnce(new Error("temporary renderer failure"))
      .mockResolvedValueOnce({
        body: Buffer.from("png", "utf8"),
        mediaType: "image/png",
      });
    const put = vi.fn<PosterAssetStore["put"]>(() => Promise.resolve());
    const createAttemptToken = vi
      .fn<() => string>()
      .mockReturnValueOnce("attempt-token-retry-1")
      .mockReturnValueOnce("attempt-token-retry-2")
      .mockReturnValueOnce("attempt-token-retry-idle");
    const worker = new PosterWorker(
      repository,
      reader,
      { render },
      {
        delete: () => Promise.resolve(),
        listKeys: () => Promise.resolve([]),
        put,
        read: () => Promise.resolve(null),
      },
      "https://assets.example.com/posters/",
      "worker-retry",
      createAttemptToken,
    );

    expect(await worker.runOne()).toBe("retrying");
    expect(await worker.runOne()).toBe("ready");
    expect(await worker.runOne()).toBe("idle");
    expect(render).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(
      "poster-attempt-token-retry-2.png",
      Buffer.from("png", "utf8"),
    );
    expect(createAttemptToken).toHaveBeenCalledTimes(3);
    await expect(jobService.get("poster-job-retry")).resolves.toMatchObject({
      assetUrl: "https://assets.example.com/posters/poster-attempt-token-retry-2.png",
      status: "ready",
    });
  });

  it("lets a reclaimed attempt finish without the stale worker deleting its ready asset", async () => {
    let now = 1_000_000;
    const repository = new InMemoryPosterJobRepository(10, () => now, 300_000);
    const stableReader: PublishedContentReader = {
      findActiveByFortuneDate: () => Promise.resolve(content),
    };
    const jobService = new PosterJobService(
      repository,
      stableReader,
      () => "poster-job-stale-worker",
      "https://five.example.com",
    );
    await jobService.create(
      {
        channelId: "organic",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      "018f9d15-7c70-7bb2-8f9d-stale-worker",
    );

    let releaseOldRead: ((value: DailyContent) => void) | undefined;
    let signalOldClaim: (() => void) | undefined;
    const oldReadPending = new Promise<DailyContent>((resolve) => {
      releaseOldRead = resolve;
    });
    const oldClaimed = new Promise<void>((resolve) => {
      signalOldClaim = resolve;
    });
    let oldReadCount = 0;
    const oldReader: PublishedContentReader = {
      findActiveByFortuneDate: () => {
        oldReadCount += 1;
        if (oldReadCount === 1) {
          signalOldClaim?.();
          return oldReadPending;
        }
        return Promise.resolve(content);
      },
    };
    const assets = new Map<string, Buffer>();
    const deleteAsset = vi.fn<PosterAssetStore["delete"]>((assetKey) => {
      assets.delete(assetKey);
      return Promise.resolve();
    });
    const store: PosterAssetStore = {
      delete: deleteAsset,
      listKeys: () => Promise.resolve([...assets.keys()]),
      put: (assetKey, body) => {
        assets.set(assetKey, body);
        return Promise.resolve();
      },
      read: (assetKey) => Promise.resolve(assets.get(assetKey) ?? null),
    };
    const renderer: PosterRenderer = {
      render: () => Promise.resolve({ body: Buffer.from("png", "utf8"), mediaType: "image/png" }),
    };
    const oldWorker = new PosterWorker(
      repository,
      oldReader,
      renderer,
      store,
      "https://assets.example.com/posters/",
      "host-a-worker",
      () => "attempt-stale-old",
    );
    const newWorker = new PosterWorker(
      repository,
      stableReader,
      renderer,
      store,
      "https://assets.example.com/posters/",
      "host-b-worker",
      () => "attempt-reclaimed-new",
    );

    const staleRun = oldWorker.runOne();
    await oldClaimed;
    now += 300_001;
    await expect(newWorker.runOne()).resolves.toBe("ready");
    releaseOldRead?.(content);
    await expect(staleRun).resolves.toBe("lost");

    expect([...assets.keys()]).toEqual(["poster-attempt-reclaimed-new.png"]);
    await expect(jobService.get("poster-job-stale-worker")).resolves.toMatchObject({
      assetUrl: "https://assets.example.com/posters/poster-attempt-reclaimed-new.png",
      posterInstanceId: "poster-attempt-reclaimed-new",
      status: "ready",
    });
  });

  it("collects an asset persisted before a worker process crashes and publishes only the reclaimed attempt", async () => {
    let now = 1_000_000;
    const repository = new InMemoryPosterJobRepository(10, () => now, 300_000);
    const reader: PublishedContentReader = {
      findActiveByFortuneDate: () => Promise.resolve(content),
    };
    const jobService = new PosterJobService(
      repository,
      reader,
      () => "poster-job-crashed-after-put",
      "https://five.example.com",
    );
    await jobService.create(
      {
        channelId: "organic",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      "018f9d15-7c70-7bb2-8f9d-crashed-after-put",
    );

    const crashedClaim = await repository.claimNext({
      attemptToken: "attempt-crashed-after-put",
      workerId: "host-crashed-worker",
    });
    expect(crashedClaim).not.toBeNull();
    await expect(
      repository.reserveAsset({
        assetKey: "poster-attempt-crashed-after-put.png",
        attemptToken: "attempt-crashed-after-put",
        jobId: "poster-job-crashed-after-put",
        workerId: "host-crashed-worker",
      }),
    ).resolves.toBe(true);

    const assets = new Map<string, Buffer>();
    assets.set("poster-attempt-crashed-after-put.png", Buffer.from("orphaned", "utf8"));
    const deleteAsset = vi.fn<PosterAssetStore["delete"]>((assetKey) => {
      assets.delete(assetKey);
      return Promise.resolve();
    });
    const store: PosterAssetStore = {
      delete: deleteAsset,
      listKeys: () => Promise.resolve([...assets.keys()]),
      put: (assetKey, body) => {
        assets.set(assetKey, body);
        return Promise.resolve();
      },
      read: (assetKey) => Promise.resolve(assets.get(assetKey) ?? null),
    };
    now += 300_001;
    const worker = new PosterWorker(
      repository,
      reader,
      {
        render: () => Promise.resolve({ body: Buffer.from("png", "utf8"), mediaType: "image/png" }),
      },
      store,
      "https://assets.example.com/posters/",
      "host-reclaimed-worker",
      () => "attempt-reclaimed-after-crash",
    );

    await expect(worker.runOne()).resolves.toBe("ready");
    expect([...assets.keys()]).toEqual(["poster-attempt-reclaimed-after-crash.png"]);
    expect(deleteAsset).toHaveBeenCalledWith("poster-attempt-crashed-after-put.png");
    now += 300_001;
    await expect(worker.runOne()).resolves.toBe("idle");
    expect(deleteAsset).toHaveBeenCalledTimes(1);

    // A stale process can resume after its reservation was acknowledged, write its old key,
    // and crash again before its own cleanup. Store reconciliation must still find that orphan.
    assets.set("poster-attempt-crashed-after-put.png", Buffer.from("late orphan", "utf8"));
    await expect(worker.runOne()).resolves.toBe("idle");
    expect(deleteAsset).toHaveBeenCalledTimes(2);
    expect([...assets.keys()]).toEqual(["poster-attempt-reclaimed-after-crash.png"]);
    await expect(jobService.get("poster-job-crashed-after-put")).resolves.toMatchObject({
      assetUrl: "https://assets.example.com/posters/poster-attempt-reclaimed-after-crash.png",
      posterInstanceId: "poster-attempt-reclaimed-after-crash",
      status: "ready",
    });
  });
});
