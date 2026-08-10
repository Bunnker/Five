import { describe, expect, it, vi } from "vitest";

import type { GeneratedImageUploader } from "../content-production/content-image-production.worker";
import type { ImageGenerator } from "../content-production/openai-image.generator";
import type {
  ClaimedDayCorrectionImageJob,
  DayCorrectionImageJobStore,
} from "./day-correction-image-job.store";
import { DayCorrectionImageWorker } from "./day-correction-image.worker";

const job: ClaimedDayCorrectionImageJob = {
  actorId: "admin-1",
  attempts: 1,
  attemptLimit: 3,
  availableAt: "2026-08-06T12:00:00.000Z",
  completedAssetId: null,
  correctionId: "correction-worker-1",
  draftId: "draft-worker-1",
  draftRevision: 11,
  fortuneDate: "2026-08-08",
  generationRevision: 2,
  imageSlot: "required_primary",
  jobId: "correction-image-job-worker-1",
  lastError: null,
  modules: {
    calendar_algorithm: {
      algorithmVersion: "algorithm-v1",
      calendar: {
        branch: "寅",
        dayElement: "wood",
        dayElementLabel: "木",
        ganzhiDay: "庚寅",
        lunarDateText: "六月廿六",
        weekdayText: "星期六",
      },
      calendarDataVersion: "calendar-data-v1",
      calendarRuleVersion: "fortune-date-23h-v1",
      tiers: [
        {
          algorithmLabel: "大吉",
          colors: [{ colorCode: "green", name: "绿色" }],
          displayLabel: "今日优先",
          displaySection: "primary",
          element: "wood",
          elementLabel: "木",
          explanation: "test",
          rank: 1,
          relationText: "水生木",
          tierCode: "da_ji",
        },
      ],
    },
    copy_and_formula: null,
    poster_consistency: null,
    visual_and_rights: null,
  },
  promptVersion: "five-outfit-model-v1",
  reason: "重生成主图。",
  requestId: "correction-worker-request-1",
  requestedAt: "2026-08-06T12:00:00.000Z",
  status: "claimed",
};

describe("DayCorrectionImageWorker", () => {
  it("reuses the generator and safe candidate uploader, then records only the candidate", async () => {
    const complete = vi.fn().mockResolvedValue("completed");
    const store = {
      claimNext: vi.fn().mockResolvedValue(job),
      complete,
      recordFailure: vi.fn(),
    } as unknown as DayCorrectionImageJobStore;
    const generator = {
      generate: vi.fn().mockResolvedValue({
        bytes: Buffer.from("generated-image"),
        declaredMediaType: "image/png",
        model: "test-image-generator",
        reproductionReference: "test-generation-reference",
      }),
    } as unknown as ImageGenerator;
    const uploader = {
      upload: vi.fn().mockResolvedValue({ assetId: "asset-worker-candidate", draftRevision: 12 }),
    } as unknown as GeneratedImageUploader;
    const worker = new DayCorrectionImageWorker(store, generator, uploader, {
      now: () => new Date("2026-08-06T12:00:00.000Z"),
    });

    await expect(worker.runOne()).resolves.toBe("generated");
    expect(generator.generate).toHaveBeenCalledWith({
      prompt: expect.stringContaining("绿色"),
    });
    expect(uploader.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: job.draftId,
        expectedDraftRevision: 11,
        imageSlot: "required_primary",
        jobId: job.jobId,
        origin: "day_correction",
      }),
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "asset-worker-candidate", jobId: job.jobId }),
    );
  });

  it("does not call a paid generator when the provider is not configured", async () => {
    const store = { claimNext: vi.fn() } as unknown as DayCorrectionImageJobStore;
    const uploader = { upload: vi.fn() } as unknown as GeneratedImageUploader;

    await expect(new DayCorrectionImageWorker(store, null, uploader).runOne()).resolves.toBe(
      "not_configured",
    );
    expect(store.claimNext).not.toHaveBeenCalled();
  });
});
