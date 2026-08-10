import { describe, expect, it, vi } from "vitest";

import type { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import type { ContentLifecycleStore } from "../content-lifecycle/content-lifecycle.store";
import type { ContentReleaseService } from "../content-release/content-release.service";
import type { ContentReleaseStore } from "../content-release/content-release.store";
import type { StoredDayCorrection } from "../day-correction/day-correction.store";
import { InMemoryDayCorrectionStore } from "../day-correction/in-memory-day-correction.store";
import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import {
  type AutoPublicationCorrectionCoordinator,
  ContentAutoPublicationWorker,
} from "./content-auto-publication.worker";

vi.mock("../content-lifecycle/immediate-publication-modules", () => ({
  prepareImmediatePublicationModules: vi.fn(() => ({})),
}));

function dependencies(fortuneDate: string, effectiveFrom: string, effectiveTo: string) {
  const store = {
    findDraft: vi.fn().mockResolvedValue({
      createdAt: "2026-08-03T00:00:00.000Z",
      draftId: "draft-auto",
      draftRevision: 4,
      fortuneDate,
      modules: {},
      state: "draft",
      updatedAt: "2026-08-03T00:00:00.000Z",
    }),
    listDraftImageAssets: vi.fn().mockResolvedValue([{}, {}]),
    listDrafts: vi.fn().mockResolvedValue([
      {
        createdAt: "2026-08-03T00:00:00.000Z",
        draftId: "draft-auto",
        draftRevision: 4,
        fortuneDate,
        state: "draft",
        updatedAt: "2026-08-03T00:00:00.000Z",
      },
    ]),
    readVersionListView: vi.fn().mockResolvedValue({
      projection: {
        activeContentVersion: null,
        fortuneDate,
        revision: 4,
      },
      versions: [],
    }),
    readVersionView: vi.fn().mockResolvedValue({
      evidence: [],
      imageSet: {},
      projection: {
        activeContentVersion: null,
        fortuneDate,
        revision: 5,
      },
      version: {
        contentVersion: "content-auto",
        draftId: "draft-auto",
        effectiveFrom,
        effectiveTo,
        fortuneDate,
        state: "approved",
      },
    }),
  } as unknown as ContentLifecycleStore;
  const lifecycle = {
    submitAutomaticProductionDraft: vi.fn().mockResolvedValue({
      kind: "submitted",
      result: {
        contentVersion: "content-auto",
        draftId: "draft-auto",
        lifecycleRevision: 5,
        state: "approved",
      },
    }),
  } as unknown as ContentLifecycleService;
  const release = {
    publish: vi.fn().mockResolvedValue({ kind: "applied" }),
    schedule: vi.fn().mockResolvedValue({ kind: "applied" }),
  } as unknown as ContentReleaseService;
  const releaseStore = {
    listReleaseEvents: vi.fn<ContentReleaseStore["listReleaseEvents"]>().mockResolvedValue([]),
    readProjection: vi.fn<ContentReleaseStore["readProjection"]>().mockResolvedValue({
      activeContentVersion: null,
      fortuneDate,
      lifecycleRevision: 4,
      scheduledContentVersion: null,
      scheduledEffectiveFrom: null,
      scheduleSlotRevision: 0,
    }),
  };
  const production = {
    list: vi.fn().mockResolvedValue({
      items: [{ draftId: "draft-auto", fortuneDate }],
    }),
  };
  return { lifecycle, production, release, releaseStore, store };
}

function openCorrection(updatedAt: string): StoredDayCorrection {
  return {
    appliedAction: null,
    applyDraftRevision: null,
    applyIdempotencyKeyHash: null,
    applyRequestHash: null,
    applyMode: null,
    applyStartedRevision: null,
    baselineActiveContentVersion: null,
    baselineLifecycleRevision: 0,
    correctionId: "correction-auto-race",
    correctionRevision: 1,
    createdAt: updatedAt,
    draftId: "draft-correction-auto-race",
    fortuneDate: "2026-08-03",
    scheduledEffectiveFrom: null,
    sourceContentVersion: "content-source-auto-race",
    status: "open",
    submittedContentVersion: null,
    submittedLifecycleRevision: null,
    updatedAt,
  };
}

describe("ContentAutoPublicationWorker", () => {
  it("does not reopen the previous served day after the 18:00 switch", async () => {
    const deps = dependencies("2026-08-03", "2026-08-02T10:00:00.000Z", "2026-08-03T10:00:00.000Z");
    const workerNow = new Date("2026-08-03T10:00:00.000Z");
    const worker = new ContentAutoPublicationWorker(
      deps.store,
      deps.lifecycle,
      deps.release,
      deps.releaseStore,
      deps.production,
      { now: () => workerNow },
      undefined,
      new PublicContentContextResolver(),
    );

    await expect(worker.runWindow()).resolves.toEqual({
      failed: 0,
      published: 0,
      scheduled: 0,
      waiting: 0,
    });
    expect(deps.store.readVersionListView).not.toHaveBeenCalled();
  });

  it("passes one frozen worker instant into correction ownership checks", async () => {
    const deps = dependencies("2026-08-03", "2026-08-02T10:00:00.000Z", "2026-08-03T10:00:00.000Z");
    const workerNow = new Date("2026-08-03T03:00:00.000Z");
    const now = vi.fn().mockReturnValue(workerNow);
    const hasOpenOwnership = vi.fn().mockResolvedValue(true);
    const corrections: AutoPublicationCorrectionCoordinator = {
      hasOpenOwnership,
      withOpenFortuneDateLock: <T>(_fortuneDate: string, work: () => Promise<T>) => work(),
    };
    const worker = new ContentAutoPublicationWorker(
      deps.store,
      deps.lifecycle,
      deps.release,
      deps.releaseStore,
      deps.production,
      { now },
      corrections,
    );

    await expect(worker.runWindow()).resolves.toEqual({
      failed: 0,
      published: 0,
      scheduled: 0,
      waiting: 1,
    });
    expect(now).toHaveBeenCalledTimes(1);
    expect(hasOpenOwnership).toHaveBeenCalledWith("2026-08-03", workerNow);
    expect(deps.lifecycle.submitAutomaticProductionDraft).not.toHaveBeenCalled();
  });

  it("lets a correction that acquires the date lock first renew its lease before auto publication", async () => {
    const deps = dependencies("2026-08-03", "2026-08-02T10:00:00.000Z", "2026-08-03T10:00:00.000Z");
    const workerNow = new Date("2026-08-03T03:00:00.000Z");
    const corrections = new InMemoryDayCorrectionStore([
      openCorrection("2026-08-03T02:00:00.000Z"),
    ]);
    let enterBrowser!: () => void;
    let releaseBrowser!: () => void;
    const browserEntered = new Promise<void>((resolve) => {
      enterBrowser = resolve;
    });
    const browserRelease = new Promise<void>((resolve) => {
      releaseBrowser = resolve;
    });
    const browser = corrections.withOpenFortuneDateLock("2026-08-03", async () => {
      await corrections.renewOpenOwnership("correction-auto-race", workerNow.toISOString());
      enterBrowser();
      await browserRelease;
    });
    await browserEntered;
    const worker = new ContentAutoPublicationWorker(
      deps.store,
      deps.lifecycle,
      deps.release,
      deps.releaseStore,
      deps.production,
      { now: () => workerNow },
      corrections,
    );
    const result = worker.runWindow();
    await Promise.resolve();
    expect(deps.store.readVersionListView).not.toHaveBeenCalled();

    releaseBrowser();
    await browser;
    await expect(result).resolves.toEqual({
      failed: 0,
      published: 0,
      scheduled: 0,
      waiting: 1,
    });
    expect(deps.lifecycle.submitAutomaticProductionDraft).not.toHaveBeenCalled();
  });

  it("finishes auto publication before a stale correction can reacquire the same date lock", async () => {
    const deps = dependencies("2026-08-03", "2026-08-02T10:00:00.000Z", "2026-08-03T10:00:00.000Z");
    const workerNow = new Date("2026-08-03T03:00:00.000Z");
    const corrections = new InMemoryDayCorrectionStore([
      openCorrection("2026-08-03T02:00:00.000Z"),
    ]);
    const originalReadVersionList = deps.store.readVersionListView.bind(deps.store);
    let enterAutoRead!: () => void;
    let releaseAutoRead!: () => void;
    const autoReadEntered = new Promise<void>((resolve) => {
      enterAutoRead = resolve;
    });
    const autoReadRelease = new Promise<void>((resolve) => {
      releaseAutoRead = resolve;
    });
    deps.store.readVersionListView = vi.fn(async (fortuneDate) => {
      enterAutoRead();
      await autoReadRelease;
      return originalReadVersionList(fortuneDate);
    });
    const worker = new ContentAutoPublicationWorker(
      deps.store,
      deps.lifecycle,
      deps.release,
      deps.releaseStore,
      deps.production,
      { now: () => workerNow },
      corrections,
    );
    const result = worker.runWindow();
    await autoReadEntered;
    let browserEntered = false;
    const browser = corrections.withOpenFortuneDateLock("2026-08-03", async () => {
      browserEntered = true;
      await corrections.renewOpenOwnership("correction-auto-race", workerNow.toISOString());
    });
    await Promise.resolve();
    expect(browserEntered).toBe(false);

    releaseAutoRead();
    await expect(result).resolves.toEqual({
      failed: 0,
      published: 1,
      scheduled: 0,
      waiting: 0,
    });
    await browser;
    expect(browserEntered).toBe(true);
    expect(deps.release.publish).toHaveBeenCalledTimes(1);
  });

  it("publishes a ready draft inside its active fortune-date window", async () => {
    const deps = dependencies("2026-08-03", "2026-08-02T10:00:00.000Z", "2026-08-03T10:00:00.000Z");
    const worker = new ContentAutoPublicationWorker(
      deps.store,
      deps.lifecycle,
      deps.release,
      deps.releaseStore,
      deps.production,
      { now: () => new Date("2026-08-03T03:00:00.000Z") },
    );

    await expect(worker.runWindow()).resolves.toEqual({
      failed: 0,
      published: 1,
      scheduled: 0,
      waiting: 0,
    });
    expect(deps.release.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        contentVersion: "content-auto",
        expectedLifecycleRevision: 5,
      }),
    );
  });

  it("schedules a ready future draft at its fixed effective time", async () => {
    const deps = dependencies("2026-08-04", "2026-08-03T10:00:00.000Z", "2026-08-04T10:00:00.000Z");
    const worker = new ContentAutoPublicationWorker(
      deps.store,
      deps.lifecycle,
      deps.release,
      deps.releaseStore,
      deps.production,
      { now: () => new Date("2026-08-03T03:00:00.000Z") },
    );

    await expect(worker.runWindow()).resolves.toEqual({
      failed: 0,
      published: 0,
      scheduled: 1,
      waiting: 0,
    });
    expect(deps.release.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        contentVersion: "content-auto",
        effectiveFrom: "2026-08-03T10:00:00.000Z",
      }),
    );
  });

  it("never auto-submits an ordinary correction draft that is not production-bound", async () => {
    const deps = dependencies("2026-08-04", "2026-08-03T10:00:00.000Z", "2026-08-04T10:00:00.000Z");
    deps.production.list.mockResolvedValue({ items: [] });
    const worker = new ContentAutoPublicationWorker(
      deps.store,
      deps.lifecycle,
      deps.release,
      deps.releaseStore,
      deps.production,
      { now: () => new Date("2026-08-03T03:00:00.000Z") },
    );

    await expect(worker.runWindow()).resolves.toEqual({
      failed: 0,
      published: 0,
      scheduled: 0,
      waiting: 0,
    });
    expect(deps.lifecycle.submitAutomaticProductionDraft).not.toHaveBeenCalled();
    expect(deps.release.publish).not.toHaveBeenCalled();
    expect(deps.release.schedule).not.toHaveBeenCalled();
  });

  it("resumes the same submitted version after a release crash without creating another version", async () => {
    const deps = dependencies("2026-08-03", "2026-08-02T10:00:00.000Z", "2026-08-03T10:00:00.000Z");
    let submitted = false;
    deps.lifecycle.submitAutomaticProductionDraft = vi.fn().mockImplementation(() => {
      submitted = true;
      return Promise.resolve({
        kind: "submitted",
        result: {
          contentVersion: "content-auto",
          draftId: "draft-auto",
          lifecycleRevision: 5,
          state: "approved",
        },
      });
    });
    deps.store.readVersionListView = vi.fn().mockImplementation(() =>
      Promise.resolve({
        projection: {
          activeContentVersion: null,
          fortuneDate: "2026-08-03",
          revision: 5,
        },
        versions: submitted
          ? [
              {
                contentVersion: "content-auto",
                draftId: "draft-auto",
                effectiveFrom: "2026-08-02T10:00:00.000Z",
                effectiveTo: "2026-08-03T10:00:00.000Z",
                fortuneDate: "2026-08-03",
                state: "approved",
              },
            ]
          : [],
      }),
    );
    deps.release.publish = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection dropped after submit"))
      .mockResolvedValueOnce({ kind: "applied" });
    const worker = new ContentAutoPublicationWorker(
      deps.store,
      deps.lifecycle,
      deps.release,
      deps.releaseStore,
      deps.production,
      { now: () => new Date("2026-08-03T03:00:00.000Z") },
    );

    await expect(worker.runWindow()).resolves.toEqual({
      failed: 1,
      published: 0,
      scheduled: 0,
      waiting: 0,
    });
    await expect(worker.runWindow()).resolves.toEqual({
      failed: 0,
      published: 1,
      scheduled: 0,
      waiting: 0,
    });

    expect(deps.lifecycle.submitAutomaticProductionDraft).toHaveBeenCalledTimes(1);
    expect(deps.release.publish).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(deps.release.publish).mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          contentVersion: "content-auto",
          idempotencyKey: "automatic-publish:content-auto:v1",
        }),
      );
    }
  });

  it("never reschedules an old production version after a correction replaces its schedule", async () => {
    const deps = dependencies("2026-08-04", "2026-08-03T10:00:00.000Z", "2026-08-04T10:00:00.000Z");
    const worker = new ContentAutoPublicationWorker(
      deps.store,
      deps.lifecycle,
      deps.release,
      deps.releaseStore,
      deps.production,
      { now: () => new Date("2026-08-03T03:00:00.000Z") },
    );

    await expect(worker.runWindow()).resolves.toMatchObject({ scheduled: 1 });
    deps.store.readVersionListView = vi.fn().mockResolvedValue({
      projection: {
        activeContentVersion: null,
        fortuneDate: "2026-08-04",
        revision: 7,
      },
      versions: [
        {
          contentVersion: "content-auto",
          draftId: "draft-auto",
          effectiveFrom: "2026-08-03T10:00:00.000Z",
          effectiveTo: "2026-08-04T10:00:00.000Z",
          fortuneDate: "2026-08-04",
          state: "approved",
        },
      ],
    });
    deps.releaseStore.readProjection.mockResolvedValue({
      activeContentVersion: null,
      fortuneDate: "2026-08-04",
      lifecycleRevision: 7,
      scheduledContentVersion: "content-correction",
      scheduledEffectiveFrom: "2026-08-03T10:00:00.000Z",
      scheduleSlotRevision: 2,
    });
    deps.releaseStore.listReleaseEvents.mockResolvedValue([
      {
        action: "schedule",
        actorId: "system:auto-publication-worker",
        afterActiveContentVersion: null,
        afterScheduleSlotRevision: 1,
        beforeActiveContentVersion: null,
        beforeScheduleSlotRevision: 0,
        contentVersion: "content-auto",
        fortuneDate: "2026-08-04",
        idempotencyKey: "automatic-schedule:content-auto:v1",
        occurredAt: "2026-08-03T03:00:00.000Z",
        reason: "自动排期",
        releaseEventId: "release-auto-schedule",
        requestId: "worker-auto-release-content-auto",
        scheduleTaskId: "schedule-auto",
        transitions: [],
      },
    ]);

    await expect(worker.runWindow()).resolves.toEqual({
      failed: 0,
      published: 0,
      scheduled: 0,
      waiting: 1,
    });
    expect(deps.lifecycle.submitAutomaticProductionDraft).toHaveBeenCalledTimes(1);
    expect(deps.release.schedule).toHaveBeenCalledTimes(1);
  });

  it("reports the current published projection instead of an earlier automatic schedule event", async () => {
    const deps = dependencies("2026-08-04", "2026-08-03T10:00:00.000Z", "2026-08-04T10:00:00.000Z");
    deps.store.readVersionListView = vi.fn().mockResolvedValue({
      projection: {
        activeContentVersion: "content-auto",
        fortuneDate: "2026-08-04",
        revision: 7,
      },
      versions: [
        {
          contentVersion: "content-auto",
          draftId: "draft-auto",
          effectiveFrom: "2026-08-03T10:00:00.000Z",
          effectiveTo: "2026-08-04T10:00:00.000Z",
          fortuneDate: "2026-08-04",
          state: "published",
        },
      ],
    });
    deps.releaseStore.readProjection.mockResolvedValue({
      activeContentVersion: "content-auto",
      fortuneDate: "2026-08-04",
      lifecycleRevision: 7,
      scheduledContentVersion: null,
      scheduledEffectiveFrom: null,
      scheduleSlotRevision: 1,
    });
    deps.releaseStore.listReleaseEvents.mockResolvedValue([
      {
        action: "schedule",
        actorId: "system:auto-publication-worker",
        afterActiveContentVersion: null,
        afterScheduleSlotRevision: 1,
        beforeActiveContentVersion: null,
        beforeScheduleSlotRevision: 0,
        contentVersion: "content-auto",
        fortuneDate: "2026-08-04",
        idempotencyKey: "automatic-schedule:content-auto:v1",
        occurredAt: "2026-08-03T03:00:00.000Z",
        reason: "自动排期",
        releaseEventId: "release-auto-schedule-before-publish",
        requestId: "worker-auto-release-content-auto",
        scheduleTaskId: "schedule-auto-before-publish",
        transitions: [],
      },
    ]);
    const worker = new ContentAutoPublicationWorker(
      deps.store,
      deps.lifecycle,
      deps.release,
      deps.releaseStore,
      deps.production,
      { now: () => new Date("2026-08-03T16:00:00.000Z") },
    );

    await expect(worker.runWindow()).resolves.toEqual({
      failed: 0,
      published: 1,
      scheduled: 0,
      waiting: 0,
    });
    expect(deps.release.schedule).not.toHaveBeenCalled();
    expect(deps.release.publish).not.toHaveBeenCalled();
  });

  it("does not treat a same-actor release event with a different idempotency key as automatic", async () => {
    const deps = dependencies("2026-08-04", "2026-08-03T10:00:00.000Z", "2026-08-04T10:00:00.000Z");
    deps.store.readVersionListView = vi.fn().mockResolvedValue({
      projection: {
        activeContentVersion: null,
        fortuneDate: "2026-08-04",
        revision: 5,
      },
      versions: [
        {
          contentVersion: "content-auto",
          draftId: "draft-auto",
          effectiveFrom: "2026-08-03T10:00:00.000Z",
          effectiveTo: "2026-08-04T10:00:00.000Z",
          fortuneDate: "2026-08-04",
          state: "approved",
        },
      ],
    });
    deps.releaseStore.listReleaseEvents.mockResolvedValue([
      {
        action: "schedule",
        actorId: "system:auto-publication-worker",
        afterActiveContentVersion: null,
        afterScheduleSlotRevision: 1,
        beforeActiveContentVersion: null,
        beforeScheduleSlotRevision: 0,
        contentVersion: "content-auto",
        fortuneDate: "2026-08-04",
        idempotencyKey: "operator-schedule:content-auto:v1",
        occurredAt: "2026-08-03T02:00:00.000Z",
        reason: "同一系统账号执行的其他排期动作",
        releaseEventId: "release-not-auto-schedule",
        requestId: "request-not-auto-schedule",
        scheduleTaskId: "schedule-not-auto",
        transitions: [],
      },
    ]);
    const worker = new ContentAutoPublicationWorker(
      deps.store,
      deps.lifecycle,
      deps.release,
      deps.releaseStore,
      deps.production,
      { now: () => new Date("2026-08-03T03:00:00.000Z") },
    );

    await expect(worker.runWindow()).resolves.toEqual({
      failed: 0,
      published: 0,
      scheduled: 1,
      waiting: 0,
    });
    expect(deps.release.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "automatic-schedule:content-auto:v1",
      }),
    );
  });
});
