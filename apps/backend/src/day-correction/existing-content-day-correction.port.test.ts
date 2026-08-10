import { describe, expect, it } from "vitest";

import type { ContentLifecycleStore } from "../content-lifecycle/content-lifecycle.store";
import type { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import type { ContentReleaseService } from "../content-release/content-release.service";
import type { ContentReleaseStore } from "../content-release/content-release.store";
import { ExistingContentDayCorrectionPort } from "./existing-content-day-correction.port";

describe("ExistingContentDayCorrectionPort", () => {
  it("prefers the scheduled version as the future working-copy source while preserving active preconditions", async () => {
    const lifecycle = {
      listVersions: async () => ({
        activeContentVersion: "content-active",
        fortuneDate: "2026-08-08",
        items: [
          {
            contentVersion: "content-approved-newer",
            createdAt: "2026-08-06T10:00:00.000Z",
            effectiveFrom: "2026-08-07T23:00:00+08:00",
            effectiveTo: "2026-08-08T23:00:00+08:00",
            lifecycleRevision: 12,
            state: "approved" as const,
          },
        ],
      }),
    } as unknown as ContentLifecycleService;
    const releaseStore = {
      readProjection: async () => ({
        activeContentVersion: "content-active",
        fortuneDate: "2026-08-08",
        lifecycleRevision: 12,
        scheduleSlotRevision: 4,
        scheduledContentVersion: "content-scheduled",
        scheduledEffectiveFrom: "2026-08-07T23:00:00+08:00",
      }),
    } as unknown as ContentReleaseStore;
    const port = new ExistingContentDayCorrectionPort(
      lifecycle,
      {} as ContentReleaseService,
      releaseStore,
      {} as ContentLifecycleStore,
    );

    await expect(port.resolveBaseline("2026-08-08")).resolves.toEqual({
      activeContentVersion: "content-active",
      copySourceContentVersion: "content-scheduled",
      lifecycleRevision: 12,
    });
  });

  it("returns only an image candidate attached to the requested draft, including its slot", async () => {
    const candidate = {
      asset: { assetId: "asset-uploaded" },
      draftId: "draft-correction",
      fortuneDate: "2026-08-08",
      imageSlot: "required_primary" as const,
      reviewLocked: false,
      storageKey: "aa/asset.png",
      uploadedAt: "2026-08-06T10:00:00.000Z",
    };
    const lifecycleStore = {
      readDraftImageAssetView: async (draftId: string) =>
        draftId === candidate.draftId
          ? {
              candidates: [candidate],
              draft: {
                draftId,
                draftRevision: 3,
                fortuneDate: candidate.fortuneDate,
              },
            }
          : null,
    } as unknown as ContentLifecycleStore;
    const port = new ExistingContentDayCorrectionPort(
      {} as ContentLifecycleService,
      {} as ContentReleaseService,
      {} as ContentReleaseStore,
      lifecycleStore,
    );

    await expect(
      port.readDraftImageCandidate(candidate.draftId, candidate.asset.assetId),
    ).resolves.toEqual({
      asset: candidate.asset,
      draftId: candidate.draftId,
      fortuneDate: candidate.fortuneDate,
      imageSlot: "required_primary",
    });
    await expect(
      port.readDraftImageCandidate(candidate.draftId, "asset-other"),
    ).resolves.toBeNull();
  });
});
