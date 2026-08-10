import { describe, expect, it } from "vitest";

import { parsePosterJob, type PosterIntent } from "./poster-job";

const intent = {
  channelId: "organic",
  expectedContentVersion: "fd-20260715-r3",
  fortuneDate: "2026-07-15",
  posterJobEndpoint: "/api/v1/poster-jobs",
  posterTemplateVersion: "poster-template-v3",
} satisfies PosterIntent;

function readyPosterJob(landingUrl: string) {
  return {
    assetUrl: "https://cdn.five.example/posters/poster-instance-01.png",
    channelId: "organic",
    currentActiveContentVersion: "fd-20260715-r3",
    entry: { landingUrl, type: "web_qr" },
    jobId: "poster-job-01",
    posterInstanceId: "poster-instance-01",
    posterTemplateVersion: "poster-template-v3",
    sourceContentVersion: "fd-20260715-r3",
    status: "ready",
  } as const;
}

describe("parsePosterJob", () => {
  it("accepts the four-parameter poster landing URL returned by a ready worker job", () => {
    const job = readyPosterJob(
      "https://five.example/daily/2026-07-15?channelId=organic&expectedContentVersion=fd-20260715-r3&referralId=poster-job-01&referralKind=poster",
    );

    expect(parsePosterJob(job, intent)).toEqual(job);
  });

  it.each([
    ["another job id", "referralId=poster-job-02&referralKind=poster"],
    ["a non-poster referral", "referralId=poster-job-01&referralKind=share"],
    [
      "a duplicated referral id",
      "referralId=poster-job-01&referralId=poster-job-01&referralKind=poster",
    ],
  ])("rejects a ready landing URL carrying %s", (_case, referralQuery) => {
    const job = readyPosterJob(
      `https://five.example/daily/2026-07-15?channelId=organic&expectedContentVersion=fd-20260715-r3&${referralQuery}`,
    );

    expect(parsePosterJob(job, intent)).toBeNull();
  });
});
