import type { components } from "@five/api-contract";
import { describe, expect, it, vi } from "vitest";

import type { PublishedContentReader } from "../today/today-content.service";
import { InMemoryPosterJobRepository, type PosterJobRepository } from "./poster-job.repository";
import { PosterJobService } from "./poster-job.service";

type DailyContent = components["schemas"]["DailyContent"];

function publishedContent(
  contentVersion = "fd-20260715-r3",
  posterTemplateVersion = "poster-template-v3",
): DailyContent {
  return {
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
    share: { posterTemplateVersion },
    versions: { contentVersion, posterTemplateVersion },
  } as DailyContent;
}

function serviceWith(
  content: DailyContent | null,
  repository: PosterJobRepository = new InMemoryPosterJobRepository(),
): PosterJobService {
  const reader: PublishedContentReader = {
    findActiveByFortuneDate: () => Promise.resolve(content),
  };

  return new PosterJobService(
    repository,
    reader,
    () => "poster-job-01",
    "https://five.example.com",
  );
}

describe("PosterJobService", () => {
  it("creates one version-locked job and reuses it for the same idempotent request", async () => {
    const service = serviceWith(publishedContent());
    const input = {
      channelId: "organic",
      expectedContentVersion: "fd-20260715-r3",
      fortuneDate: "2026-07-15",
    };

    const first = await service.create(input, "018f9d15-7c70-7bb2-8f9d-123456789abc");
    const replay = await service.create(input, "018f9d15-7c70-7bb2-8f9d-123456789abc");

    expect(first).toEqual({
      job: {
        assetUrl: null,
        channelId: "organic",
        currentActiveContentVersion: "fd-20260715-r3",
        entry: null,
        jobId: "poster-job-01",
        posterInstanceId: null,
        posterTemplateVersion: "poster-template-v3",
        sourceContentVersion: "fd-20260715-r3",
        status: "processing",
      },
      kind: "accepted",
    });
    expect(replay).toEqual({ ...first, kind: "existing" });
  });

  it("puts the public poster job id in the QR landing URL as an independent referral", async () => {
    const repository = new InMemoryPosterJobRepository();
    const service = serviceWith(publishedContent(), repository);

    await service.create(
      {
        channelId: "user_share",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      "018f9d15-7c70-7bb2-8f9d-poster-referral",
    );

    const record = await repository.findById("poster-job-01");
    expect(record).not.toBeNull();
    const landingUrl = new URL(record?.landingUrl ?? "");
    expect(Object.fromEntries(landingUrl.searchParams)).toEqual({
      channelId: "user_share",
      expectedContentVersion: "fd-20260715-r3",
      referralId: "poster-job-01",
      referralKind: "poster",
    });
    expect(landingUrl.searchParams.get("referralId")).not.toBe(
      landingUrl.searchParams.get("anonymousId"),
    );
  });

  it("rejects a changed request that reuses an idempotency key", async () => {
    const service = serviceWith(publishedContent());
    const idempotencyKey = "018f9d15-7c70-7bb2-8f9d-123456789abc";
    await service.create(
      {
        channelId: "organic",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      idempotencyKey,
    );

    await expect(
      service.create(
        {
          channelId: "wechat-group",
          expectedContentVersion: "fd-20260715-r3",
          fortuneDate: "2026-07-15",
        },
        idempotencyKey,
      ),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
  });

  it("returns the current version without creating work when the page version is stale", async () => {
    const repository = new InMemoryPosterJobRepository();
    const service = serviceWith(publishedContent("fd-20260715-r4"), repository);

    await expect(
      service.create(
        {
          channelId: "organic",
          expectedContentVersion: "fd-20260715-r3",
          fortuneDate: "2026-07-15",
        },
        "018f9d15-7c70-7bb2-8f9d-stale-version",
      ),
    ).resolves.toEqual({
      currentActiveContentVersion: "fd-20260715-r4",
      kind: "version_changed",
    });
    await expect(repository.findById("poster-job-01")).resolves.toBeNull();
  });

  it("isolates published-content read failure to the poster capability", async () => {
    const reader: PublishedContentReader = {
      findActiveByFortuneDate: () => Promise.reject(new Error("temporary read failure")),
    };
    const service = new PosterJobService(
      new InMemoryPosterJobRepository(),
      reader,
      () => "poster-job-01",
    );

    await expect(
      service.create(
        {
          channelId: "organic",
          expectedContentVersion: "fd-20260715-r3",
          fortuneDate: "2026-07-15",
        },
        "018f9d15-7c70-7bb2-8f9d-unavailable",
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("replays an existing idempotent result before consulting unavailable current content", async () => {
    const repository = new InMemoryPosterJobRepository();
    const findActiveByFortuneDate = vi
      .fn<PublishedContentReader["findActiveByFortuneDate"]>()
      .mockResolvedValueOnce(publishedContent())
      .mockRejectedValueOnce(new Error("published content temporarily unavailable"));
    const service = new PosterJobService(
      repository,
      { findActiveByFortuneDate },
      () => "poster-job-idempotent-read-order",
    );
    const request = {
      channelId: "organic",
      expectedContentVersion: "fd-20260715-r3",
      fortuneDate: "2026-07-15",
    };
    const key = "018f9d15-7c70-7bb2-8f9d-read-order";
    const first = await service.create(request, key);

    await expect(service.create(request, key)).resolves.toEqual({
      ...first,
      kind: "existing",
    });
    expect(findActiveByFortuneDate).toHaveBeenCalledTimes(1);
  });

  it("replays the original job even if the active content would now resolve to a new version", async () => {
    const repository = new InMemoryPosterJobRepository();
    const findActiveByFortuneDate = vi
      .fn<PublishedContentReader["findActiveByFortuneDate"]>()
      .mockResolvedValueOnce(publishedContent())
      .mockResolvedValueOnce(publishedContent("fd-20260715-r4"));
    const service = new PosterJobService(
      repository,
      { findActiveByFortuneDate },
      () => "poster-job-idempotent-version",
    );
    const request = {
      channelId: "organic",
      expectedContentVersion: "fd-20260715-r3",
      fortuneDate: "2026-07-15",
    };
    const key = "018f9d15-7c70-7bb2-8f9d-version-replay";
    const first = await service.create(request, key);

    await expect(service.create(request, key)).resolves.toEqual({
      ...first,
      kind: "existing",
    });
    expect(findActiveByFortuneDate).toHaveBeenCalledTimes(1);
  });
});
