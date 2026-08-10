import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type {
  ContentVersionListReadView,
  ContentVersionReadView,
} from "../content-lifecycle/content-lifecycle.store";
import type {
  ContentReleaseProjection,
  StoredContentReleaseEvent,
} from "../content-release/content-release.store";
import { RequestContextResolver } from "../request-context/request-context-resolver";
import { AdminOperationsDateResolver } from "./admin-operations-date.resolver";
import {
  PostgresAdminOperationsStore,
  resolveCurrentPublicationFailure,
} from "./postgres-admin-operations.store";

const dateResolver = new AdminOperationsDateResolver(
  new RequestContextResolver({ now: () => new Date("2026-08-06T00:00:00.000Z") }),
);

function releaseEvent(
  action: StoredContentReleaseEvent["action"],
  occurredAt: string,
): StoredContentReleaseEvent {
  return {
    action,
    actorId: "system:scheduled-release-worker",
    afterActiveContentVersion: null,
    afterScheduleSlotRevision: 2,
    beforeActiveContentVersion: null,
    beforeScheduleSlotRevision: 2,
    contentVersion: "content-2026-08-07",
    fortuneDate: "2026-08-07",
    idempotencyKey: null,
    occurredAt,
    reason: action === "scheduled_publish_failed" ? "temporary release failure" : "recovered",
    releaseEventId: `release-${action}-${occurredAt}`,
    requestId: "request-release-20260807",
    scheduleTaskId: "schedule-task-20260807",
    transitions: [],
  };
}

describe("PostgresAdminOperationsStore", () => {
  it("reads a 42-day calendar from one repeatable-read snapshot with bounded queries", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    const poolQuery = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PostgresAdminOperationsStore(
      { connect, query: poolQuery } as unknown as Pool,
      dateResolver,
    );
    const fortuneDates = Array.from({ length: 42 }, (_, index) =>
      dateResolver.shiftFortuneDate("2026-08-01", index),
    );

    const days = await store.readDays(fortuneDates);

    expect(days.map((day) => day.fortuneDate)).toEqual(fortuneDates);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(query.mock.calls[0]?.[0]).toBe(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(query.mock.calls.length).toBeLessThanOrEqual(10);
    const productionCall = query.mock.calls.find(([statement]) =>
      String(statement).includes("FROM daily_content_productions AS production"),
    );
    expect(String(productionCall?.[0])).toContain(
      "WHERE production.fortune_date = ANY($1::date[])",
    );
    expect(productionCall?.[1]).toEqual([fortuneDates]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases the snapshot connection when a batch read fails", async () => {
    const failure = new Error("snapshot read failed");
    const query = vi.fn().mockImplementation((statement: unknown) => {
      if (String(statement).includes("FROM content_versions")) return Promise.reject(failure);
      return Promise.resolve({ rows: [] });
    });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    const store = new PostgresAdminOperationsStore(
      { connect, query: vi.fn() } as unknown as Pool,
      dateResolver,
    );

    await expect(store.readDays(["2026-08-07"])).rejects.toBe(failure);

    expect(query.mock.calls.some(([statement]) => statement === "ROLLBACK")).toBe(true);
    expect(query.mock.calls.some(([statement]) => statement === "COMMIT")).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("hides a draft candidate that was globally withdrawn through another content version", async () => {
    const imageSlots = [
      {
        attemptLimit: 3,
        attempts: 1,
        canRetry: false,
        deliveryReady: true,
        imageSlot: "required_primary",
        lastError: null,
        nextAttemptAt: null,
        status: "ready",
      },
      {
        attemptLimit: 3,
        attempts: 0,
        canRetry: false,
        deliveryReady: false,
        imageSlot: "required_alternative",
        lastError: null,
        nextAttemptAt: "2026-08-06T03:10:00.000Z",
        status: "pending",
      },
      {
        attemptLimit: 0,
        attempts: 0,
        canRetry: false,
        deliveryReady: false,
        imageSlot: "optional",
        lastError: null,
        nextAttemptAt: null,
        status: "not_requested",
      },
    ];
    const query = vi.fn().mockImplementation((statement: unknown, parameters?: unknown[]) => {
      const sql = String(statement);
      if (sql.includes("FROM daily_content_productions AS production")) {
        return Promise.resolve({
          rows: [
            {
              completed_image_slots: 1,
              draft_id: "draft-shared-withdrawal",
              draft_revision: 2,
              fortune_date: "2026-08-07",
              image_slots: imageSlots,
              last_error: null,
              pending_image_slots: 1,
              status: "generating",
              updated_at: "2026-08-06T03:00:00.000Z",
            },
          ],
        });
      }
      if (sql.includes("FROM content_drafts")) {
        return Promise.resolve({
          rows: [
            {
              created_at: "2026-08-06T02:00:00.000Z",
              draft_id: "draft-shared-withdrawal",
              draft_revision: 2,
              fortune_date: "2026-08-07",
              modules: {
                calendar_algorithm: null,
                copy_and_formula: null,
                poster_consistency: {
                  posterTemplateVersion: "poster-v1",
                  sampleAssetId: "asset-shared-withdrawn",
                  templateId: "template-v1",
                },
                visual_and_rights: {
                  assetManifestVersion: "manifest-v1",
                  assets: [{ assetId: "asset-shared-withdrawn" }],
                  looks: [],
                  rightsRecords: [],
                },
              },
              updated_at: "2026-08-06T03:00:00.000Z",
            },
          ],
        });
      }
      if (sql.includes("FROM draft_image_candidates AS candidate")) {
        return Promise.resolve({
          rows: [
            {
              asset_id: "asset-shared-withdrawn",
              asset_json: { assetId: "asset-shared-withdrawn" },
              draft_id: "draft-shared-withdrawal",
              fortune_date: "2026-08-07",
              image_slot: "required_primary",
              review_locked: false,
              selected_for_slot: true,
              selection_source: "automatic_generation",
              storage_key: "aa/shared.png",
              uploaded_at: "2026-08-06T02:30:00.000Z",
            },
          ],
        });
      }
      if (sql.includes("FROM image_asset_withdrawal_events")) {
        const queriedAssetIds = (parameters?.[0] as string[] | undefined) ?? [];
        return Promise.resolve({
          rows: queriedAssetIds.includes("asset-shared-withdrawn")
            ? [
                {
                  asset_id: "asset-shared-withdrawn",
                  audit_event_id: "audit-shared-withdrawn",
                  reason: "另一日期发现图片不安全。",
                  withdrawal_event_id: "withdraw-shared-withdrawn",
                  withdrawn_at: "2026-08-06T02:45:00.000Z",
                },
              ]
            : [],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });
    const store = new PostgresAdminOperationsStore(
      { connect, query: vi.fn() } as unknown as Pool,
      dateResolver,
    );

    const [day] = await store.readDays(["2026-08-07"]);

    expect(day?.draft?.imageCandidates).toEqual([]);
    expect(day?.draft?.modules.poster_consistency).toBeNull();
    expect(day?.draft?.modules.visual_and_rights).toBeNull();
  });

  it("marks a projection that points at another fortune date as inconsistent", async () => {
    const version = {
      contentVersion: "content-wrong-fortune-date",
      createdAt: "2026-08-06T10:00:00.000Z",
      draftId: "draft-wrong-fortune-date",
      effectiveFrom: "2026-08-06T18:00:00+08:00",
      effectiveTo: "2026-08-07T18:00:00+08:00",
      fortuneDate: "2026-08-08",
      preflightChecks: [],
      snapshot: {},
      state: "published" as const,
    } as unknown as ContentVersionReadView["version"];
    const projection = {
      activeContentVersion: version.contentVersion,
      fortuneDate: "2026-08-07",
      revision: 4,
    };
    const store = new PostgresAdminOperationsStore(
      { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool,
      dateResolver,
      {
        lifecycle: {
          findDraft: vi.fn(),
          listDrafts: vi.fn().mockResolvedValue([]),
          readDraftImageAssetView: vi.fn().mockResolvedValue(null),
          readVersionListView: vi.fn().mockResolvedValue({ projection, versions: [version] }),
          readVersionView: vi.fn().mockResolvedValue({
            evidence: [],
            imageSet: null,
            projection,
            version,
          }),
        },
        production: { listProductions: vi.fn().mockResolvedValue([]) },
        release: {
          listReleaseEvents: vi.fn().mockResolvedValue([]),
          readProjection: vi.fn().mockResolvedValue({
            activeContentVersion: version.contentVersion,
            fortuneDate: "2026-08-07",
            lifecycleRevision: 4,
            scheduledContentVersion: null,
            scheduledEffectiveFrom: null,
            scheduleSlotRevision: 0,
          }),
        },
      },
    );

    const [day] = await store.readDays(["2026-08-07"]);

    expect(day?.invariantBroken).toBe(true);
  });

  it("keeps named required image slots and treats an absent optional job as not requested", async () => {
    const version = {
      contentVersion: "content-2026-08-07",
      createdAt: "2026-08-06T10:00:00.000Z",
      draftId: "draft-2026-08-07",
      effectiveFrom: "2026-08-06T23:00:00+08:00",
      effectiveTo: "2026-08-07T23:00:00+08:00",
      fortuneDate: "2026-08-07",
      preflightChecks: [],
      snapshot: {},
      state: "scheduled" as const,
    } as unknown as ContentVersionReadView["version"];
    const versionList: ContentVersionListReadView = {
      projection: {
        activeContentVersion: null,
        fortuneDate: "2026-08-07",
        revision: 5,
      },
      versions: [version],
    };
    const releaseProjection: ContentReleaseProjection = {
      activeContentVersion: null,
      fortuneDate: "2026-08-07",
      lifecycleRevision: 5,
      scheduledContentVersion: version.contentVersion,
      scheduledEffectiveFrom: version.effectiveFrom,
      scheduleSlotRevision: 3,
    };
    const readVersionView = vi.fn().mockResolvedValue({
      evidence: [],
      imageSet: {
        assets: [],
        contentVersion: version.contentVersion,
        fortuneDate: version.fortuneDate,
        lifecycleRevision: 5,
        slots: [
          {
            coverAssetId: "asset-primary",
            deliveryStatus: "active",
            detailAssetIds: [],
            fallbackAssetId: "fallback-primary",
            imageSlot: "required_primary",
            lookId: "look-primary",
            servedCoverAssetId: "asset-primary",
            servedDetailAssetIds: [],
          },
          {
            coverAssetId: "asset-alternative",
            deliveryStatus: "active",
            detailAssetIds: [],
            fallbackAssetId: "fallback-alternative",
            imageSlot: "required_alternative",
            lookId: "look-alternative",
            servedCoverAssetId: "asset-alternative",
            servedDetailAssetIds: [],
          },
        ],
        withdrawalEvents: [],
      },
      projection: versionList.projection!,
      version,
    } satisfies ContentVersionReadView);
    const query = vi.fn().mockResolvedValue({
      rows: [
        { fortune_date: "2026-08-07", image_slot: "required_primary", status: "completed" },
        {
          fortune_date: "2026-08-07",
          image_slot: "required_alternative",
          status: "completed",
        },
      ],
    });
    const listProductions = vi.fn().mockResolvedValue([
      {
        completedImageSlots: 2,
        draftId: version.draftId,
        draftRevision: 1,
        fortuneDate: version.fortuneDate,
        imageSlots: [
          {
            deliveryReady: true,
            imageSlot: "required_primary",
            lastError: null,
            status: "ready",
          },
          {
            deliveryReady: false,
            imageSlot: "required_alternative",
            lastError: "两张必备图片内容重复，请替换备选图。",
            status: "ready",
          },
          {
            deliveryReady: false,
            imageSlot: "optional",
            lastError: null,
            status: "not_requested",
          },
        ],
        lastError: null,
        pendingImageSlots: 0,
        status: "awaiting_review",
        updatedAt: "2026-08-06T10:10:00.000Z",
      },
    ]);
    const store = new PostgresAdminOperationsStore({ query } as unknown as Pool, dateResolver, {
      lifecycle: {
        findDraft: vi.fn(),
        listDrafts: vi.fn().mockResolvedValue([]),
        readDraftImageAssetView: vi.fn().mockResolvedValue(null),
        readVersionListView: vi.fn().mockResolvedValue(versionList),
        readVersionView,
      },
      production: {
        listProductions,
      },
      release: {
        listReleaseEvents: vi
          .fn()
          .mockResolvedValue([
            releaseEvent("scheduled_publish_failed", "2026-08-06T15:00:05.000Z"),
          ]),
        readProjection: vi.fn().mockResolvedValue(releaseProjection),
      },
    });

    const [day] = await store.readDays(["2026-08-07"]);

    expect(day?.scheduled?.imageSlots.map((slot) => slot.imageSlot)).toEqual([
      "required_primary",
      "required_alternative",
    ]);
    expect(day?.production?.optionalJobStatus).toBe("not_requested");
    expect(day?.production?.requiredJobs).toEqual([
      {
        deliveryReady: true,
        imageSlot: "required_primary",
        lastError: null,
        status: "ready",
      },
      {
        deliveryReady: false,
        imageSlot: "required_alternative",
        lastError: "两张必备图片内容重复，请替换备选图。",
        status: "ready",
      },
    ]);
    expect(day?.publicationFailure).toMatchObject({
      occurredAt: "2026-08-06T15:00:05.000Z",
    });
    expect(day?.invariantBroken).toBe(false);
    expect(listProductions).toHaveBeenCalledWith();
    expect(String(query.mock.calls[0]?.[0])).toContain("daily_content_image_slot_currents");
  });

  it("keeps only a latest unresolved scheduled-publish failure", () => {
    const priorSchedule = releaseEvent("schedule", "2026-08-06T14:59:00.000Z");
    const failure = releaseEvent("scheduled_publish_failed", "2026-08-06T15:00:05.000Z");
    const recovery = releaseEvent("scheduled_publish", "2026-08-06T15:00:15.000Z");

    expect(resolveCurrentPublicationFailure([failure, priorSchedule])).toEqual({
      occurredAt: failure.occurredAt,
      reason: failure.reason,
    });
    expect(resolveCurrentPublicationFailure([failure, recovery])).toBeNull();
  });

  it("uses the production draft when a same-day correction draft also exists", async () => {
    const productionDraft = {
      draftId: "draft-production-2026-08-07",
      draftRevision: 4,
      fortuneDate: "2026-08-07",
      state: "draft" as const,
      updatedAt: "2026-08-06T09:00:00.000Z",
    };
    const correctionDraft = {
      ...productionDraft,
      draftId: "draft-correction-2026-08-07",
      draftRevision: 9,
      updatedAt: "2026-08-06T10:00:00.000Z",
    };
    const productionDraftView = {
      candidates: [],
      draft: {
        ...productionDraft,
        modules: {
          calendar_algorithm: null,
          copy_and_formula: null,
          poster_consistency: null,
          visual_and_rights: null,
        },
      },
    };
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PostgresAdminOperationsStore({ query } as unknown as Pool, dateResolver, {
      lifecycle: {
        findDraft: vi.fn(),
        listDrafts: vi.fn().mockResolvedValue([correctionDraft, productionDraft]),
        readDraftImageAssetView: vi.fn().mockResolvedValue(productionDraftView),
        readVersionListView: vi.fn().mockResolvedValue({ projection: null, versions: [] }),
        readVersionView: vi.fn(),
      },
      production: {
        listProductions: vi.fn().mockResolvedValue([
          {
            completedImageSlots: 0,
            draftId: productionDraft.draftId,
            draftRevision: productionDraft.draftRevision,
            fortuneDate: productionDraft.fortuneDate,
            lastError: null,
            pendingImageSlots: 3,
            status: "generating",
            updatedAt: productionDraft.updatedAt,
          },
        ]),
      },
      release: {
        listReleaseEvents: vi.fn().mockResolvedValue([]),
        readProjection: vi.fn().mockResolvedValue(null),
      },
    });

    const [day] = await store.readDays(["2026-08-07"]);

    expect(day?.draft).toEqual({
      draftId: productionDraft.draftId,
      draftRevision: productionDraft.draftRevision,
      imageCandidates: [],
      modules: productionDraftView.draft.modules,
      updatedAt: productionDraft.updatedAt,
    });
  });

  it("does not expose a standalone correction draft as automatic production", async () => {
    const correctionDraft = {
      draftId: "draft-correction-2026-08-07",
      draftRevision: 9,
      fortuneDate: "2026-08-07",
      state: "draft" as const,
      updatedAt: "2026-08-06T10:00:00.000Z",
    };
    const store = new PostgresAdminOperationsStore(
      { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool,
      dateResolver,
      {
        lifecycle: {
          findDraft: vi.fn(),
          listDrafts: vi.fn().mockResolvedValue([correctionDraft]),
          readDraftImageAssetView: vi.fn().mockResolvedValue(null),
          readVersionListView: vi.fn().mockResolvedValue({ projection: null, versions: [] }),
          readVersionView: vi.fn(),
        },
        production: { listProductions: vi.fn().mockResolvedValue([]) },
        release: {
          listReleaseEvents: vi.fn().mockResolvedValue([]),
          readProjection: vi.fn().mockResolvedValue(null),
        },
      },
    );

    const [day] = await store.readDays(["2026-08-07"]);

    expect(day?.draft).toBeNull();
    expect(day?.production).toBeNull();
  });
});
