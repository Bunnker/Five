import { describe, expect, it, vi } from "vitest";

import type { ContentDraft } from "../content-lifecycle/content-lifecycle.store";
import type { StoredContentVersion } from "../content-lifecycle/content-lifecycle.store";
import { ContentReleaseService } from "../content-release/content-release.service";
import { InMemoryContentReleaseStore } from "../content-release/in-memory-content-release.store";
import { DayCorrectionWorkflow, type DayCorrectionContentPort } from "./day-correction.workflow";
import { InMemoryDayCorrectionStore } from "./in-memory-day-correction.store";

function unusedContentPort(): DayCorrectionContentPort {
  return new Proxy({} as DayCorrectionContentPort, {
    get: (_target, property) => {
      throw new Error(`Unexpected content port call: ${String(property)}`);
    },
  });
}

function workingDraft(
  correction: {
    readonly createdAt: string;
    readonly draftId: string;
    readonly fortuneDate: string;
  },
  draftRevision: number,
): ContentDraft {
  return {
    createdAt: correction.createdAt,
    draftId: correction.draftId,
    draftRevision,
    fortuneDate: correction.fortuneDate,
    modules: {
      calendar_algorithm: null,
      copy_and_formula: null,
      poster_consistency: null,
      visual_and_rights: null,
    },
    state: "draft",
    updatedAt: correction.createdAt,
  };
}

describe("DayCorrectionWorkflow", () => {
  it("hard-rejects algorithm fields before touching a working copy", async () => {
    const workflow = new DayCorrectionWorkflow(
      new InMemoryDayCorrectionStore(),
      unusedContentPort(),
      {
        resolve: () => {
          throw new Error("Patch must not resolve business time");
        },
      },
    );

    await expect(
      workflow.patch({
        actorId: "admin-1",
        command: {
          colors: ["red"],
          kind: "set_tier_colors",
          tierCode: "da_ji",
        },
        correctionId: "correction-1",
        expectedRevision: { correctionRevision: 1, draftRevision: 3 },
        requestId: "correction-request-1",
      }),
    ).resolves.toEqual({
      field: "tiers.colors",
      kind: "algorithm_field_read_only",
    });
  });

  it("changes only the named tier explanation and preserves algorithm output", async () => {
    const draft = {
      createdAt: "2026-08-06T08:00:00.000Z",
      draftId: "draft-1",
      draftRevision: 3,
      fortuneDate: "2026-08-07",
      modules: {
        calendar_algorithm: {
          algorithmVersion: "algorithm-v1",
          calendar: {
            branch: "辰",
            dayElement: "earth",
            dayElementLabel: "土",
            ganzhiDay: "壬辰",
            lunarDateText: "六月廿五",
            weekdayText: "星期五",
          },
          calendarDataVersion: "calendar-data-v1",
          calendarRuleVersion: "fortune-date-23h-v1",
          tiers: [
            {
              algorithmLabel: "大吉",
              colors: [{ colorCode: "white", name: "白色" }],
              displayLabel: "今日优先",
              displaySection: "primary",
              element: "metal",
              elementLabel: "金",
              explanation: "旧说明",
              rank: 1,
              relationText: "土生金",
              tierCode: "da_ji",
            },
          ],
        },
        copy_and_formula: null,
        poster_consistency: null,
        visual_and_rights: null,
      },
      state: "draft",
      updatedAt: "2026-08-06T08:00:00.000Z",
    } as ContentDraft;
    const captured: { module: ContentDraft["modules"]["calendar_algorithm"] | null } = {
      module: null,
    };
    const content = {
      readDraft: async () => structuredClone(draft),
      updateDraftModule: async (input: {
        module: NonNullable<ContentDraft["modules"]["calendar_algorithm"]>;
      }) => {
        captured.module = structuredClone(input.module);
        return {
          kind: "updated" as const,
          result: {
            draftId: draft.draftId,
            draftRevision: 4,
            module: input.module,
            moduleCode: "calendar_algorithm" as const,
          },
        };
      },
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      new InMemoryDayCorrectionStore([
        {
          appliedAction: null,
          applyDraftRevision: null,
          applyIdempotencyKeyHash: null,
          applyRequestHash: null,
          applyMode: null,
          applyStartedRevision: null,
          baselineActiveContentVersion: null,
          baselineLifecycleRevision: 0,
          correctionId: "correction-1",
          correctionRevision: 1,
          createdAt: "2026-08-06T08:00:00.000Z",
          draftId: draft.draftId,
          fortuneDate: draft.fortuneDate,
          scheduledEffectiveFrom: null,
          sourceContentVersion: null,
          status: "open",
          submittedContentVersion: null,
          submittedLifecycleRevision: null,
          updatedAt: "2026-08-06T08:00:00.000Z",
        },
      ]),
      content,
      { resolve: () => undefined as never },
    );

    await expect(
      workflow.patch({
        actorId: "admin-1",
        command: {
          explanation: "今天优先选择白色或银色上衣。",
          kind: "set_tier_explanation",
          tierCode: "da_ji",
        },
        correctionId: "correction-1",
        expectedRevision: { correctionRevision: 1, draftRevision: 3 },
        requestId: "correction-request-2",
      }),
    ).resolves.toMatchObject({
      draftRevision: 4,
      kind: "updated",
      moduleCode: "calendar_algorithm",
    });
    expect(captured.module?.tiers[0]).toEqual({
      ...draft.modules.calendar_algorithm?.tiers[0],
      explanation: "今天优先选择白色或银色上衣。",
    });
  });

  it("creates one correction working copy from the day baseline and reuses it", async () => {
    const store = new InMemoryDayCorrectionStore();
    let createCalls = 0;
    let createdDraft: ContentDraft | null = null;
    const content = {
      createDraft: async (input: {
        copyFromContentVersion: string | null;
        fortuneDate: string;
      }) => {
        createCalls += 1;
        expect(input).toMatchObject({
          copyFromContentVersion: "content-active",
          fortuneDate: "2026-08-07",
        });
        createdDraft = {
          createdAt: "2026-08-06T09:00:00.000Z",
          draftId: "draft-correction",
          draftRevision: 1,
          fortuneDate: input.fortuneDate,
          modules: {
            calendar_algorithm: null,
            copy_and_formula: null,
            poster_consistency: null,
            visual_and_rights: null,
          },
          state: "draft" as const,
          updatedAt: "2026-08-06T09:00:00.000Z",
        };
        return {
          draft: createdDraft,
          kind: "created" as const,
        };
      },
      readDraft: async () => structuredClone(createdDraft),
      resolveBaseline: async () => ({
        activeContentVersion: "content-active",
        copySourceContentVersion: "content-active",
        lifecycleRevision: 9,
      }),
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      store,
      content,
      { resolve: () => undefined as never },
      { now: () => new Date("2026-08-06T09:00:00.000Z") },
      {
        nextCorrectionId: () => "correction-reused",
        nextDraftId: () => "draft-correction",
      },
    );

    const first = await workflow.openWorkingCopy({
      actorId: "admin-1",
      fortuneDate: "2026-08-07",
      requestId: "correction-open-1",
    });
    const second = await workflow.openWorkingCopy({
      actorId: "admin-1",
      fortuneDate: "2026-08-07",
      requestId: "correction-open-2",
    });

    expect(first).toMatchObject({
      correction: {
        baselineActiveContentVersion: "content-active",
        baselineLifecycleRevision: 9,
        correctionId: "correction-reused",
        draftId: "draft-correction",
        status: "open",
      },
      kind: "ready",
    });
    expect(second).toEqual(first);
    expect(createCalls).toBe(1);
  });

  it("serializes concurrent opens so only one working draft is created for a fortuneDate", async () => {
    const store = new InMemoryDayCorrectionStore();
    let createCalls = 0;
    let releaseCreate: (() => void) | undefined;
    let signalCreateStarted: (() => void) | undefined;
    const createStarted = new Promise<void>((resolve) => {
      signalCreateStarted = resolve;
    });
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const drafts = new Map<string, ContentDraft>();
    const content = {
      createDraft: async (input: { fortuneDate: string }) => {
        createCalls += 1;
        const draft: ContentDraft = {
          createdAt: "2026-08-06T09:00:00.000Z",
          draftId: `draft-concurrent-open-${createCalls}`,
          draftRevision: 1,
          fortuneDate: input.fortuneDate,
          modules: {
            calendar_algorithm: null,
            copy_and_formula: null,
            poster_consistency: null,
            visual_and_rights: null,
          },
          state: "draft",
          updatedAt: "2026-08-06T09:00:00.000Z",
        };
        drafts.set(draft.draftId, draft);
        signalCreateStarted?.();
        await createGate;
        return { draft, kind: "created" as const };
      },
      readDraft: async (draftId: string) => structuredClone(drafts.get(draftId) ?? null),
      resolveBaseline: async () => ({
        activeContentVersion: "content-active",
        copySourceContentVersion: "content-active",
        lifecycleRevision: 9,
      }),
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      store,
      content,
      { resolve: () => undefined as never },
      { now: () => new Date("2026-08-06T09:00:00.000Z") },
      {
        nextCorrectionId: () => "correction-concurrent-open",
        nextDraftId: () => "draft-concurrent-open-1",
      },
    );

    const first = workflow.openWorkingCopy({
      actorId: "admin-1",
      fortuneDate: "2026-08-07",
      requestId: "correction-concurrent-open-1",
    });
    await createStarted;
    const second = workflow.openWorkingCopy({
      actorId: "admin-1",
      fortuneDate: "2026-08-07",
      requestId: "correction-concurrent-open-2",
    });
    await Promise.resolve();
    const callsBeforeRelease = createCalls;
    releaseCreate?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(callsBeforeRelease).toBe(1);
    expect(createCalls).toBe(1);
    expect(secondResult).toEqual(firstResult);
    expect(drafts).toHaveLength(1);
  });

  it("recovers the reserved draft after a crash between draft creation and correction finalization", async () => {
    const store = new InMemoryDayCorrectionStore();
    const finalize = vi.spyOn(store, "finalizeOpenIntent");
    finalize.mockRejectedValueOnce(new Error("process stopped before correction finalization"));
    const drafts = new Map<string, ContentDraft>();
    let createCalls = 0;
    const content = {
      createDraft: async (input: { draftId: string; fortuneDate: string }) => {
        createCalls += 1;
        const existing = drafts.get(input.draftId);
        if (existing !== undefined)
          return { draft: structuredClone(existing), kind: "created" as const };
        const draft: ContentDraft = {
          createdAt: "2026-08-06T09:00:00.000Z",
          draftId: input.draftId,
          draftRevision: 1,
          fortuneDate: input.fortuneDate,
          modules: {
            calendar_algorithm: null,
            copy_and_formula: null,
            poster_consistency: null,
            visual_and_rights: null,
          },
          state: "draft",
          updatedAt: "2026-08-06T09:00:00.000Z",
        };
        drafts.set(draft.draftId, draft);
        return { draft: structuredClone(draft), kind: "created" as const };
      },
      readDraft: async (draftId: string) => structuredClone(drafts.get(draftId) ?? null),
      resolveBaseline: async () => ({
        activeContentVersion: "content-active",
        copySourceContentVersion: "content-active",
        lifecycleRevision: 9,
      }),
    } as unknown as DayCorrectionContentPort;
    let identifier = 0;
    const workflow = new DayCorrectionWorkflow(
      store,
      content,
      { resolve: () => undefined as never },
      { now: () => new Date("2026-08-06T09:00:00.000Z") },
      {
        nextCorrectionId: () => `correction-crash-${++identifier}`,
        nextDraftId: () => `draft-crash-${identifier}`,
      },
    );
    const input = {
      actorId: "admin-1",
      fortuneDate: "2026-08-07",
      requestId: "correction-open-crash",
    };

    await expect(workflow.openWorkingCopy(input)).rejects.toThrow(
      "process stopped before correction finalization",
    );
    await expect(workflow.openWorkingCopy(input)).resolves.toMatchObject({
      correction: { correctionId: "correction-crash-1", draftId: "draft-crash-1" },
      draft: { draftId: "draft-crash-1" },
      kind: "ready",
    });
    expect(createCalls).toBe(2);
    expect(drafts).toHaveLength(1);
  });

  it("uses one request context to submit and immediately replace the current fortuneDate", async () => {
    const correction = {
      appliedAction: null,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      baselineActiveContentVersion: "content-old",
      baselineLifecycleRevision: 7,
      correctionId: "correction-current",
      correctionRevision: 1,
      createdAt: "2026-08-06T10:00:00.000Z",
      draftId: "draft-current",
      fortuneDate: "2026-08-07",
      scheduledEffectiveFrom: null,
      sourceContentVersion: "content-old",
      status: "open" as const,
      submittedContentVersion: null,
      submittedLifecycleRevision: null,
      updatedAt: "2026-08-06T10:00:00.000Z",
    };
    const store = new InMemoryDayCorrectionStore([correction]);
    let contextCalls = 0;
    let submitKey = "";
    let publishKey = "";
    const action = {
      activeContentVersion: "content-new",
      auditEventId: "audit-current",
      contentVersion: "content-new",
      fortuneDate: correction.fortuneDate,
      lifecycleRevision: 9,
      state: "published" as const,
      transitions: [
        {
          contentVersion: "content-old",
          fromState: "published" as const,
          toState: "superseded" as const,
        },
        {
          contentVersion: "content-new",
          fromState: "approved" as const,
          toState: "published" as const,
        },
      ],
    };
    const content = {
      readDraft: async () => workingDraft(correction, 3),
      publish: async (input: {
        contentVersion: string;
        expectedActiveContentVersion: string | null;
        expectedLifecycleRevision: number;
        idempotencyKey: string;
      }) => {
        publishKey = input.idempotencyKey;
        expect(input).toMatchObject({
          contentVersion: "content-new",
          expectedActiveContentVersion: "content-old",
          expectedLifecycleRevision: 8,
        });
        return { action, kind: "applied" as const };
      },
      schedule: async () => {
        throw new Error("Current correction must not be scheduled");
      },
      submitCorrectionDraft: async (input: {
        draftId: string;
        expectedDraftRevision: number;
        idempotencyKey: string;
      }) => {
        submitKey = input.idempotencyKey;
        expect(input).toMatchObject({ draftId: "draft-current", expectedDraftRevision: 3 });
        return {
          kind: "submitted" as const,
          result: {
            contentVersion: "content-new",
            draftId: "draft-current",
            lifecycleRevision: 8,
            state: "approved" as const,
          },
        };
      },
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      store,
      content,
      {
        resolve: () => {
          contextCalls += 1;
          return {
            civilDate: "2026-08-06",
            crossedDayBoundary: true,
            dayBoundary: "23:00",
            fortuneDate: correction.fortuneDate,
            responseGeneratedAt: "2026-08-06T23:05:00+08:00",
            shichen: "子",
            timezone: "Asia/Shanghai",
          };
        },
      },
      { now: () => new Date("2026-08-06T15:05:00.000Z") },
    );

    await expect(
      workflow.apply({
        actorId: "admin-1",
        correctionId: correction.correctionId,
        expectedRevision: { correctionRevision: 1, draftRevision: 3 },
        idempotencyKey: "external-correction-key-0001",
        reason: "修正今天用户端的穿搭说明。",
        requestId: "correction-apply-current",
      }),
    ).resolves.toMatchObject({ action, kind: "applied", mode: "immediate" });
    expect(contextCalls).toBe(1);
    expect(submitKey).toMatch(/^correction\.submit\.[0-9a-f]{64}$/u);
    expect(publishKey).toMatch(/^correction\.publish\.[0-9a-f]{64}$/u);
    expect(publishKey).not.toBe(submitKey);
    await expect(store.findById(correction.correctionId)).resolves.toMatchObject({
      appliedAction: action,
      status: "applied",
      submittedContentVersion: "content-new",
      submittedLifecycleRevision: 8,
    });
    await expect(
      workflow.apply({
        actorId: "admin-1",
        correctionId: correction.correctionId,
        expectedRevision: { correctionRevision: 1, draftRevision: 3 },
        idempotencyKey: "external-correction-key-0001",
        reason: "修正今天用户端的穿搭说明。",
        requestId: "correction-apply-current-replay",
      }),
    ).resolves.toMatchObject({ action, kind: "existing", mode: "immediate" });
    await expect(
      workflow.apply({
        actorId: "admin-1",
        correctionId: correction.correctionId,
        expectedRevision: { correctionRevision: 4, draftRevision: 3 },
        idempotencyKey: "external-correction-key-0001",
        reason: "修正今天用户端的穿搭说明。",
        requestId: "correction-apply-current-replay-new-etag",
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    await expect(
      workflow.apply({
        actorId: "admin-1",
        correctionId: correction.correctionId,
        expectedRevision: { correctionRevision: 1, draftRevision: 3 },
        idempotencyKey: "external-correction-key-0001",
        reason: "另一项订正意图。",
        requestId: "correction-apply-current-replay-new-reason",
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    await expect(
      workflow.apply({
        actorId: "admin-1",
        correctionId: correction.correctionId,
        expectedRevision: { correctionRevision: 1, draftRevision: 3 },
        idempotencyKey: "external-correction-key-different",
        reason: "修正今天用户端的穿搭说明。",
        requestId: "correction-apply-current-conflict",
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
  });

  it("redecides a 17:59:59 scheduled correction as immediate when submission completes at 18:00", async () => {
    const correction = {
      appliedAction: null,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      baselineActiveContentVersion: null,
      baselineLifecycleRevision: 5,
      correctionId: "correction-boundary-race",
      correctionRevision: 1,
      createdAt: "2026-08-06T09:59:00.000Z",
      draftId: "draft-boundary-race",
      fortuneDate: "2026-08-07",
      scheduledEffectiveFrom: null,
      sourceContentVersion: "content-before-boundary",
      status: "open" as const,
      submittedContentVersion: null,
      submittedLifecycleRevision: null,
      updatedAt: "2026-08-06T09:59:00.000Z",
    };
    const store = new InMemoryDayCorrectionStore([correction]);
    const action = {
      activeContentVersion: "content-boundary-correction",
      auditEventId: "audit-boundary-correction",
      contentVersion: "content-boundary-correction",
      fortuneDate: correction.fortuneDate,
      lifecycleRevision: 7,
      state: "published" as const,
      transitions: [
        {
          contentVersion: "content-boundary-correction",
          fromState: "approved" as const,
          toState: "published" as const,
        },
      ],
    };
    let contextCalls = 0;
    let publishCalls = 0;
    let scheduleCalls = 0;
    let submitCalls = 0;
    const contexts = [
      {
        civilDate: "2026-08-06",
        crossedDayBoundary: false,
        dayBoundary: "23:00" as const,
        fortuneDate: "2026-08-06",
        responseGeneratedAt: "2026-08-06T17:59:59.999+08:00",
        shichen: "酉" as const,
        timezone: "Asia/Shanghai" as const,
      },
      {
        civilDate: "2026-08-06",
        crossedDayBoundary: false,
        dayBoundary: "23:00" as const,
        fortuneDate: "2026-08-06",
        responseGeneratedAt: "2026-08-06T18:00:00+08:00",
        shichen: "酉" as const,
        timezone: "Asia/Shanghai" as const,
      },
    ];
    const content = {
      publish: async () => {
        publishCalls += 1;
        return { action, kind: "applied" as const };
      },
      readDraft: async () => workingDraft(correction, 3),
      schedule: async () => {
        scheduleCalls += 1;
        return { kind: "schedule_time_invalid" as const };
      },
      submitCorrectionDraft: async () => {
        submitCalls += 1;
        return {
          kind: "submitted" as const,
          result: {
            contentVersion: "content-boundary-correction",
            draftId: correction.draftId,
            lifecycleRevision: 6,
            state: "approved" as const,
          },
        };
      },
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      store,
      content,
      {
        resolve: () => {
          const context = contexts[Math.min(contextCalls, contexts.length - 1)]!;
          contextCalls += 1;
          return context;
        },
      },
      { now: () => new Date("2026-08-06T10:00:00.000Z") },
    );
    const input = {
      actorId: "admin-1",
      correctionId: correction.correctionId,
      expectedRevision: { correctionRevision: 1, draftRevision: 3 },
      idempotencyKey: "external-correction-boundary-race",
      reason: "18:00 边界完成的订正仍应安全替换。",
      requestId: "correction-boundary-race",
    };

    await expect(workflow.apply(input)).resolves.toMatchObject({
      action,
      kind: "applied",
      mode: "immediate",
    });
    expect(contextCalls).toBe(2);
    expect(submitCalls).toBe(1);
    expect(scheduleCalls).toBe(0);
    expect(publishCalls).toBe(1);
    await expect(store.findById(correction.correctionId)).resolves.toMatchObject({
      applyMode: "immediate",
      correctionRevision: 5,
      scheduledEffectiveFrom: null,
      status: "applied",
    });
    await expect(
      workflow.apply({ ...input, requestId: "correction-boundary-race-replay" }),
    ).resolves.toMatchObject({ action, kind: "existing", mode: "immediate" });
    expect(submitCalls).toBe(1);
    expect(publishCalls).toBe(1);
  });

  it("safely retries as immediate when 18:00 arrives inside the schedule attempt", async () => {
    const correction = {
      appliedAction: null,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      baselineActiveContentVersion: null,
      baselineLifecycleRevision: 5,
      correctionId: "correction-schedule-boundary-race",
      correctionRevision: 1,
      createdAt: "2026-08-06T09:59:00.000Z",
      draftId: "draft-schedule-boundary-race",
      fortuneDate: "2026-08-07",
      scheduledEffectiveFrom: null,
      sourceContentVersion: "content-before-schedule-boundary",
      status: "open" as const,
      submittedContentVersion: null,
      submittedLifecycleRevision: null,
      updatedAt: "2026-08-06T09:59:00.000Z",
    };
    const store = new InMemoryDayCorrectionStore([correction]);
    const action = {
      activeContentVersion: "content-schedule-boundary-correction",
      auditEventId: "audit-schedule-boundary-correction",
      contentVersion: "content-schedule-boundary-correction",
      fortuneDate: correction.fortuneDate,
      lifecycleRevision: 7,
      state: "published" as const,
      transitions: [
        {
          contentVersion: "content-schedule-boundary-correction",
          fromState: "approved" as const,
          toState: "published" as const,
        },
      ],
    };
    const contexts = [
      "2026-08-06T17:59:59.000+08:00",
      "2026-08-06T17:59:59.999+08:00",
      "2026-08-06T18:00:00+08:00",
    ];
    let contextCalls = 0;
    let publishCalls = 0;
    let scheduleCalls = 0;
    const content = {
      publish: async () => {
        publishCalls += 1;
        return { action, kind: "applied" as const };
      },
      readDraft: async () => workingDraft(correction, 3),
      schedule: async () => {
        scheduleCalls += 1;
        return { kind: "schedule_time_invalid" as const };
      },
      submitCorrectionDraft: async () => ({
        kind: "submitted" as const,
        result: {
          contentVersion: "content-schedule-boundary-correction",
          draftId: correction.draftId,
          lifecycleRevision: 6,
          state: "approved" as const,
        },
      }),
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      store,
      content,
      {
        resolve: () => {
          const responseGeneratedAt = contexts[Math.min(contextCalls, contexts.length - 1)]!;
          contextCalls += 1;
          return {
            civilDate: "2026-08-06",
            crossedDayBoundary: false,
            dayBoundary: "23:00",
            fortuneDate: "2026-08-06",
            responseGeneratedAt,
            shichen: "酉",
            timezone: "Asia/Shanghai",
          };
        },
      },
      { now: () => new Date("2026-08-06T10:00:00.000Z") },
    );

    await expect(
      workflow.apply({
        actorId: "admin-1",
        correctionId: correction.correctionId,
        expectedRevision: { correctionRevision: 1, draftRevision: 3 },
        idempotencyKey: "external-correction-schedule-boundary",
        reason: "排期调用跨过 18:00 后应安全转为立即替换。",
        requestId: "correction-schedule-boundary",
      }),
    ).resolves.toMatchObject({ action, kind: "applied", mode: "immediate" });
    expect(contextCalls).toBe(3);
    expect(scheduleCalls).toBe(1);
    expect(publishCalls).toBe(1);
    await expect(store.findById(correction.correctionId)).resolves.toMatchObject({
      applyMode: "immediate",
      correctionRevision: 5,
      scheduledEffectiveFrom: null,
      status: "applied",
    });
  });

  it("retains the approved version after a release outage and resumes with stable child keys", async () => {
    const correction = {
      appliedAction: null,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      baselineActiveContentVersion: "content-before",
      baselineLifecycleRevision: 5,
      correctionId: "correction-resume",
      correctionRevision: 1,
      createdAt: "2026-08-06T10:00:00.000Z",
      draftId: "draft-resume",
      fortuneDate: "2026-08-07",
      scheduledEffectiveFrom: null,
      sourceContentVersion: "content-before",
      status: "open" as const,
      submittedContentVersion: null,
      submittedLifecycleRevision: null,
      updatedAt: "2026-08-06T10:00:00.000Z",
    };
    const store = new InMemoryDayCorrectionStore([correction]);
    let contextCalls = 0;
    let submitCalls = 0;
    const publishKeys: string[] = [];
    const action = {
      activeContentVersion: "content-approved",
      auditEventId: "audit-resumed",
      contentVersion: "content-approved",
      fortuneDate: correction.fortuneDate,
      lifecycleRevision: 7,
      state: "published" as const,
      transitions: [
        {
          contentVersion: "content-before",
          fromState: "published" as const,
          toState: "superseded" as const,
        },
        {
          contentVersion: "content-approved",
          fromState: "approved" as const,
          toState: "published" as const,
        },
      ],
    };
    const content = {
      readDraft: async () => workingDraft(correction, 4),
      publish: async (input: { idempotencyKey: string }) => {
        publishKeys.push(input.idempotencyKey);
        if (publishKeys.length === 1) throw new Error("temporary release outage");
        return { action, kind: "applied" as const };
      },
      submitCorrectionDraft: async () => {
        submitCalls += 1;
        return {
          kind: "submitted" as const,
          result: {
            contentVersion: "content-approved",
            draftId: correction.draftId,
            lifecycleRevision: 6,
            state: "approved" as const,
          },
        };
      },
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(store, content, {
      resolve: () => {
        contextCalls += 1;
        return {
          civilDate: "2026-08-06",
          crossedDayBoundary: true,
          dayBoundary: "23:00",
          fortuneDate: correction.fortuneDate,
          responseGeneratedAt: "2026-08-06T23:10:00+08:00",
          shichen: "子",
          timezone: "Asia/Shanghai",
        };
      },
    });
    const applyInput = {
      actorId: "admin-1",
      correctionId: correction.correctionId,
      expectedRevision: { correctionRevision: 1, draftRevision: 4 },
      idempotencyKey: "external-correction-resume-0001",
      reason: "恢复未完成的当天替换。",
      requestId: "correction-resume-first",
    };

    await expect(workflow.apply(applyInput)).resolves.toEqual({ kind: "release_unavailable" });
    await expect(store.findById(correction.correctionId)).resolves.toMatchObject({
      status: "submitted",
      submittedContentVersion: "content-approved",
      submittedLifecycleRevision: 6,
    });
    await expect(
      workflow.apply({ ...applyInput, requestId: "correction-resume-retry" }),
    ).resolves.toMatchObject({ action, kind: "applied", mode: "immediate" });
    expect(submitCalls).toBe(1);
    expect(contextCalls).toBe(1);
    expect(publishKeys).toHaveLength(2);
    expect(publishKeys[1]).toBe(publishKeys[0]);
  });

  it("abandons a submitted correction after a permanent release conflict so the day can be reopened", async () => {
    const correction = {
      appliedAction: null,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      baselineActiveContentVersion: "content-before-conflict",
      baselineLifecycleRevision: 5,
      correctionId: "correction-terminal-conflict",
      correctionRevision: 1,
      createdAt: "2026-08-06T10:00:00.000Z",
      draftId: "draft-terminal-conflict",
      fortuneDate: "2026-08-07",
      scheduledEffectiveFrom: null,
      sourceContentVersion: "content-before-conflict",
      status: "open" as const,
      submittedContentVersion: null,
      submittedLifecycleRevision: null,
      updatedAt: "2026-08-06T10:00:00.000Z",
    };
    const store = new InMemoryDayCorrectionStore([correction]);
    let publishCalls = 0;
    let submitCalls = 0;
    const content = {
      publish: async () => {
        publishCalls += 1;
        return { currentRevision: 9, kind: "revision_mismatch" as const };
      },
      readDraft: async () => workingDraft(correction, 4),
      submitCorrectionDraft: async () => {
        submitCalls += 1;
        return {
          kind: "submitted" as const,
          result: {
            contentVersion: "content-terminal-conflict",
            draftId: correction.draftId,
            lifecycleRevision: 6,
            state: "approved" as const,
          },
        };
      },
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      store,
      content,
      {
        resolve: () => ({
          civilDate: "2026-08-06",
          crossedDayBoundary: true,
          dayBoundary: "23:00",
          fortuneDate: correction.fortuneDate,
          responseGeneratedAt: "2026-08-06T23:10:00+08:00",
          shichen: "子",
          timezone: "Asia/Shanghai",
        }),
      },
      { now: () => new Date("2026-08-06T15:10:00.000Z") },
    );
    const applyInput = {
      actorId: "admin-1",
      correctionId: correction.correctionId,
      expectedRevision: { correctionRevision: 1, draftRevision: 4 },
      idempotencyKey: "external-correction-terminal-conflict",
      reason: "生命周期冲突时终止本次订正。",
      requestId: "correction-terminal-conflict",
    };

    const releaseFailed = {
      correctionRevision: 4,
      draftRevision: 4,
      kind: "release_failed",
      result: { currentRevision: 9, kind: "revision_mismatch" },
    } as const;
    await expect(workflow.apply(applyInput)).resolves.toEqual(releaseFailed);
    await expect(
      workflow.apply({ ...applyInput, requestId: "correction-terminal-conflict-response-lost" }),
    ).resolves.toEqual(releaseFailed);
    await expect(
      workflow.apply({
        ...applyInput,
        reason: "同一个幂等键不能表达另一项订正。",
        requestId: "correction-terminal-conflict-different-intent",
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    expect(submitCalls).toBe(1);
    expect(publishCalls).toBe(1);
    await expect(store.findById(correction.correctionId)).resolves.toMatchObject({
      correctionRevision: 4,
      status: "abandoned",
      terminalFailure: { currentRevision: 9, kind: "revision_mismatch" },
    });
    await expect(store.findOpenByFortuneDate(correction.fortuneDate)).resolves.toBeNull();
  });

  it("resumes the same draft ETag and apply intent after submission crashes", async () => {
    const correction = {
      appliedAction: null,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      baselineActiveContentVersion: "content-before-crash",
      baselineLifecycleRevision: 4,
      correctionId: "correction-submit-crash",
      correctionRevision: 1,
      createdAt: "2026-08-06T10:00:00.000Z",
      draftId: "draft-submit-crash",
      fortuneDate: "2026-08-07",
      scheduledEffectiveFrom: null,
      sourceContentVersion: "content-before-crash",
      status: "open" as const,
      submittedContentVersion: null,
      submittedLifecycleRevision: null,
      updatedAt: "2026-08-06T10:00:00.000Z",
    };
    const store = new InMemoryDayCorrectionStore([correction]);
    let contextCalls = 0;
    let submitCalls = 0;
    const action = {
      activeContentVersion: "content-after-crash",
      auditEventId: "audit-submit-crash",
      contentVersion: "content-after-crash",
      fortuneDate: correction.fortuneDate,
      lifecycleRevision: 6,
      state: "published" as const,
      transitions: [
        {
          contentVersion: "content-before-crash",
          fromState: "published" as const,
          toState: "superseded" as const,
        },
        {
          contentVersion: "content-after-crash",
          fromState: "approved" as const,
          toState: "published" as const,
        },
      ],
    };
    const content = {
      readDraft: async () => workingDraft(correction, 4),
      publish: async () => ({ action, kind: "applied" as const }),
      submitCorrectionDraft: async () => {
        submitCalls += 1;
        if (submitCalls === 1) throw new Error("process stopped after beginApply");
        return {
          kind: "submitted" as const,
          result: {
            contentVersion: "content-after-crash",
            draftId: correction.draftId,
            lifecycleRevision: 5,
            state: "approved" as const,
          },
        };
      },
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(store, content, {
      resolve: () => {
        contextCalls += 1;
        return {
          civilDate: "2026-08-06",
          crossedDayBoundary: true,
          dayBoundary: "23:00",
          fortuneDate: correction.fortuneDate,
          responseGeneratedAt: "2026-08-06T23:10:00+08:00",
          shichen: "子",
          timezone: "Asia/Shanghai",
        };
      },
    });
    const firstInput = {
      actorId: "admin-1",
      correctionId: correction.correctionId,
      expectedRevision: { correctionRevision: 1, draftRevision: 4 },
      idempotencyKey: "external-correction-submit-crash-0001",
      reason: "继续崩溃前开始的当天替换。",
      requestId: "correction-submit-crash-first",
    };

    await expect(workflow.apply(firstInput)).rejects.toThrow("process stopped after beginApply");
    await expect(store.findById(correction.correctionId)).resolves.toMatchObject({
      applyStartedRevision: 1,
      correctionRevision: 2,
      status: "applying",
    });
    await expect(
      workflow.apply({
        ...firstInput,
        requestId: "correction-submit-crash-retry",
      }),
    ).resolves.toMatchObject({ action, kind: "applied", mode: "immediate" });
    expect(contextCalls).toBe(1);
    expect(submitCalls).toBe(2);
  });

  it("allows only one of two different apply intents to claim the correction", async () => {
    const correction = {
      appliedAction: null,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      baselineActiveContentVersion: null,
      baselineLifecycleRevision: 1,
      correctionId: "correction-concurrent-apply",
      correctionRevision: 1,
      createdAt: "2026-08-06T10:00:00.000Z",
      draftId: "draft-concurrent-apply",
      fortuneDate: "2026-08-07",
      scheduledEffectiveFrom: null,
      sourceContentVersion: null,
      status: "open" as const,
      submittedContentVersion: null,
      submittedLifecycleRevision: null,
      updatedAt: "2026-08-06T10:00:00.000Z",
    };
    let releaseSubmit: (() => void) | undefined;
    let signalSubmitStarted: (() => void) | undefined;
    const submitStarted = new Promise<void>((resolve) => {
      signalSubmitStarted = resolve;
    });
    const submitGate = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    const action = {
      activeContentVersion: "content-concurrent",
      auditEventId: "audit-concurrent",
      contentVersion: "content-concurrent",
      fortuneDate: correction.fortuneDate,
      lifecycleRevision: 3,
      state: "published" as const,
      transitions: [
        {
          contentVersion: "content-concurrent",
          fromState: "approved" as const,
          toState: "published" as const,
        },
      ],
    };
    const content = {
      publish: async () => ({ action, kind: "applied" as const }),
      readDraft: async () => workingDraft(correction, 2),
      submitCorrectionDraft: async () => {
        signalSubmitStarted?.();
        await submitGate;
        return {
          kind: "submitted" as const,
          result: {
            contentVersion: "content-concurrent",
            draftId: correction.draftId,
            lifecycleRevision: 2,
            state: "approved" as const,
          },
        };
      },
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      new InMemoryDayCorrectionStore([correction]),
      content,
      {
        resolve: () => ({
          civilDate: "2026-08-06",
          crossedDayBoundary: true,
          dayBoundary: "23:00",
          fortuneDate: correction.fortuneDate,
          responseGeneratedAt: "2026-08-06T23:20:00+08:00",
          shichen: "子",
          timezone: "Asia/Shanghai",
        }),
      },
    );
    const common = {
      actorId: "admin-1",
      correctionId: correction.correctionId,
      expectedRevision: { correctionRevision: 1, draftRevision: 2 },
      reason: "并发应用测试。",
    };

    const first = workflow.apply({
      ...common,
      idempotencyKey: "external-concurrent-apply-first",
      requestId: "concurrent-apply-first",
    });
    await submitStarted;
    let secondSettled = false;
    const second = workflow
      .apply({
        ...common,
        idempotencyKey: "external-concurrent-apply-second",
        requestId: "concurrent-apply-second",
      })
      .finally(() => {
        secondSettled = true;
      });
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    releaseSubmit?.();
    await expect(first).resolves.toMatchObject({ action, kind: "applied" });
    await expect(second).resolves.toEqual({ kind: "idempotency_conflict" });
  });

  it("rejects a stale apply draft ETag before claiming the correction", async () => {
    const correction = {
      appliedAction: null,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      baselineActiveContentVersion: null,
      baselineLifecycleRevision: 1,
      correctionId: "correction-stale-apply",
      correctionRevision: 1,
      createdAt: "2026-08-06T10:00:00.000Z",
      draftId: "draft-stale-apply",
      fortuneDate: "2026-08-07",
      scheduledEffectiveFrom: null,
      sourceContentVersion: null,
      status: "open" as const,
      submittedContentVersion: null,
      submittedLifecycleRevision: null,
      updatedAt: "2026-08-06T10:00:00.000Z",
    };
    const store = new InMemoryDayCorrectionStore([correction]);
    const content = {
      readDraft: async () => workingDraft(correction, 4),
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(store, content, {
      resolve: () => ({
        civilDate: "2026-08-06",
        crossedDayBoundary: true,
        dayBoundary: "23:00",
        fortuneDate: correction.fortuneDate,
        responseGeneratedAt: "2026-08-06T23:20:00+08:00",
        shichen: "子",
        timezone: "Asia/Shanghai",
      }),
    });

    await expect(
      workflow.apply({
        actorId: "admin-1",
        correctionId: correction.correctionId,
        expectedRevision: { correctionRevision: 1, draftRevision: 3 },
        idempotencyKey: "external-stale-apply-key",
        reason: "过期页面不得应用。",
        requestId: "stale-apply-request",
      }),
    ).resolves.toEqual({
      currentRevision: { correctionRevision: 1, draftRevision: 4 },
      kind: "revision_mismatch",
    });
    await expect(store.findById(correction.correctionId)).resolves.toMatchObject({
      correctionRevision: 1,
      status: "open",
    });
  });

  it("reopens the correction if the draft changes between preflight and submission", async () => {
    const correction = {
      appliedAction: null,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      baselineActiveContentVersion: null,
      baselineLifecycleRevision: 1,
      correctionId: "correction-patch-race",
      correctionRevision: 1,
      createdAt: "2026-08-06T10:00:00.000Z",
      draftId: "draft-patch-race",
      fortuneDate: "2026-08-07",
      scheduledEffectiveFrom: null,
      sourceContentVersion: null,
      status: "open" as const,
      submittedContentVersion: null,
      submittedLifecycleRevision: null,
      updatedAt: "2026-08-06T10:00:00.000Z",
    };
    const store = new InMemoryDayCorrectionStore([correction]);
    const content = {
      readDraft: async () => workingDraft(correction, 3),
      submitCorrectionDraft: async () => ({
        currentRevision: 4,
        kind: "revision_mismatch" as const,
      }),
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(store, content, {
      resolve: () => ({
        civilDate: "2026-08-06",
        crossedDayBoundary: true,
        dayBoundary: "23:00",
        fortuneDate: correction.fortuneDate,
        responseGeneratedAt: "2026-08-06T23:20:00+08:00",
        shichen: "子",
        timezone: "Asia/Shanghai",
      }),
    });

    await expect(
      workflow.apply({
        actorId: "admin-1",
        correctionId: correction.correctionId,
        expectedRevision: { correctionRevision: 1, draftRevision: 3 },
        idempotencyKey: "external-patch-race-key",
        reason: "验证草稿并发。",
        requestId: "patch-race-request",
      }),
    ).resolves.toEqual({
      currentRevision: { correctionRevision: 3, draftRevision: 4 },
      kind: "revision_mismatch",
    });
    await expect(store.findById(correction.correctionId)).resolves.toMatchObject({
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      correctionRevision: 3,
      status: "open",
    });
  });

  it("adopts a same-draft uploaded candidate and replaces only the named image slot", async () => {
    const candidateAsset = {
      aiLabelStatus: "not_applicable",
      altText: "白色通勤模特穿搭",
      assetId: "asset-new",
      declaredModel: null,
      fileUrl: "https://assets.example.test/asset-new.png",
      generatedAt: null,
      generationMethod: "licensed_upload",
      height: 1600,
      manualReview: null,
      mediaType: "image/png",
      promptVersion: null,
      reproductionReference: null,
      reviewStatus: "pending",
      rightsRecordIds: ["rights-new"],
      rightsStatus: "pending",
      sha256: "a".repeat(64),
      sourceMaterialReferences: ["upload:asset-new"],
      sourceType: "licensed",
      width: 1200,
    } as const;
    const draft = {
      createdAt: "2026-08-06T08:00:00.000Z",
      draftId: "draft-image",
      draftRevision: 6,
      fortuneDate: "2026-08-08",
      modules: {
        calendar_algorithm: null,
        copy_and_formula: null,
        poster_consistency: null,
        visual_and_rights: {
          assetManifestVersion: "assets-v1",
          assets: [{ assetId: "asset-old" }, { assetId: "asset-fallback" }],
          looks: [
            {
              coverAssetId: "asset-old",
              detailAssetIds: ["asset-detail"],
              fallbackAssetId: "asset-fallback",
              imageSlot: "required_primary",
              lookId: "look-primary",
            },
            {
              coverAssetId: "asset-optional",
              detailAssetIds: [],
              fallbackAssetId: null,
              imageSlot: "optional",
              lookId: "look-optional",
            },
          ],
          rightsRecords: [],
        },
      },
      state: "draft",
      updatedAt: "2026-08-06T08:00:00.000Z",
    } as unknown as ContentDraft;
    const captured: { module: ContentDraft["modules"]["visual_and_rights"] | null } = {
      module: null,
    };
    const content = {
      readDraftImageCandidate: async () => ({
        asset: candidateAsset,
        draftId: draft.draftId,
        fortuneDate: draft.fortuneDate,
        imageSlot: "required_primary" as const,
      }),
      readDraft: async () => structuredClone(draft),
      updateDraftModule: async (input: {
        module: NonNullable<ContentDraft["modules"]["visual_and_rights"]>;
      }) => {
        captured.module = structuredClone(input.module);
        return {
          kind: "updated" as const,
          result: {
            draftId: draft.draftId,
            draftRevision: 7,
            module: input.module,
            moduleCode: "visual_and_rights" as const,
          },
        };
      },
    } as unknown as DayCorrectionContentPort;
    const store = new InMemoryDayCorrectionStore([
      {
        appliedAction: null,
        applyDraftRevision: null,
        applyIdempotencyKeyHash: null,
        applyRequestHash: null,
        applyMode: null,
        applyStartedRevision: null,
        baselineActiveContentVersion: null,
        baselineLifecycleRevision: 0,
        correctionId: "correction-image",
        correctionRevision: 1,
        createdAt: draft.createdAt,
        draftId: draft.draftId,
        fortuneDate: draft.fortuneDate,
        scheduledEffectiveFrom: null,
        sourceContentVersion: null,
        status: "open",
        submittedContentVersion: null,
        submittedLifecycleRevision: null,
        updatedAt: draft.updatedAt,
      },
    ]);
    const workflow = new DayCorrectionWorkflow(
      store,
      content,
      { resolve: () => undefined as never },
      { now: () => new Date("2026-08-06T08:05:00.000Z") },
    );

    await expect(
      workflow.patch({
        actorId: "admin-1",
        command: {
          assetId: "asset-new",
          imageSlot: "required_primary",
          kind: "replace_image_cover",
        },
        correctionId: "correction-image",
        expectedRevision: { correctionRevision: 1, draftRevision: 6 },
        requestId: "correction-image-replace",
      }),
    ).resolves.toMatchObject({
      draftRevision: 7,
      kind: "updated",
      moduleCode: "visual_and_rights",
    });
    expect(captured.module?.looks).toEqual([
      expect.objectContaining({
        coverAssetId: "asset-new",
        detailAssetIds: ["asset-detail"],
        fallbackAssetId: "asset-fallback",
        imageSlot: "required_primary",
      }),
      expect.objectContaining({ coverAssetId: "asset-optional", imageSlot: "optional" }),
    ]);
    expect(captured.module?.assets).toEqual([
      { assetId: "asset-old" },
      { assetId: "asset-fallback" },
      candidateAsset,
    ]);
    expect(captured.module?.rightsRecords).toEqual([
      {
        kind: "internal_record",
        recordedAt: "2026-08-06T08:05:00.000Z",
        reference: "订正图片：asset-new",
        rightsRecordId: "rights-new",
      },
    ]);
    expect(captured.module?.assets.filter((asset) => asset.assetId === "asset-new")).toHaveLength(
      1,
    );
  });

  it.each([
    {
      candidateDraftId: "draft-other",
      candidateFortuneDate: "2026-08-08",
      candidateImageSlot: "optional" as const,
      label: "another draft",
    },
    {
      candidateDraftId: "draft-image-foreign",
      candidateFortuneDate: "2026-08-09",
      candidateImageSlot: "optional" as const,
      label: "another fortuneDate",
    },
    {
      candidateDraftId: "draft-image-foreign",
      candidateFortuneDate: "2026-08-08",
      candidateImageSlot: "required_primary" as const,
      label: "another image slot",
    },
  ])("hard-rejects an uploaded image candidate from $label", async (candidate) => {
    const draft = {
      createdAt: "2026-08-06T08:00:00.000Z",
      draftId: "draft-image-foreign",
      draftRevision: 2,
      fortuneDate: "2026-08-08",
      modules: {
        calendar_algorithm: null,
        copy_and_formula: null,
        poster_consistency: null,
        visual_and_rights: {
          assetManifestVersion: "assets-v1",
          assets: [{ assetId: "asset-old" }],
          looks: [
            {
              coverAssetId: "asset-old",
              detailAssetIds: [],
              fallbackAssetId: null,
              imageSlot: "optional",
              lookId: "look-optional",
            },
          ],
          rightsRecords: [],
        },
      },
      state: "draft",
      updatedAt: "2026-08-06T08:00:00.000Z",
    } as unknown as ContentDraft;
    let updateCalls = 0;
    const content = {
      readDraft: async () => structuredClone(draft),
      readDraftImageCandidate: async () => ({
        asset: { assetId: "asset-foreign" },
        draftId: candidate.candidateDraftId,
        fortuneDate: candidate.candidateFortuneDate,
        imageSlot: candidate.candidateImageSlot,
      }),
      updateDraftModule: async () => {
        updateCalls += 1;
        throw new Error("A foreign image candidate must not be persisted");
      },
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      new InMemoryDayCorrectionStore([
        {
          appliedAction: null,
          applyDraftRevision: null,
          applyIdempotencyKeyHash: null,
          applyRequestHash: null,
          applyMode: null,
          applyStartedRevision: null,
          baselineActiveContentVersion: null,
          baselineLifecycleRevision: 0,
          correctionId: "correction-image-foreign",
          correctionRevision: 1,
          createdAt: draft.createdAt,
          draftId: draft.draftId,
          fortuneDate: draft.fortuneDate,
          scheduledEffectiveFrom: null,
          sourceContentVersion: null,
          status: "open",
          submittedContentVersion: null,
          submittedLifecycleRevision: null,
          updatedAt: draft.updatedAt,
        },
      ]),
      content,
      { resolve: () => undefined as never },
    );

    await expect(
      workflow.patch({
        actorId: "admin-1",
        command: {
          assetId: "asset-foreign",
          imageSlot: "optional",
          kind: "replace_image_cover",
        },
        correctionId: "correction-image-foreign",
        expectedRevision: { correctionRevision: 1, draftRevision: 2 },
        requestId: "correction-image-foreign",
      }),
    ).resolves.toEqual({ kind: "invalid_asset_reference" });
    expect(updateCalls).toBe(0);
  });

  it("edits one outfit explanation without exposing the formula's algorithmic slots", async () => {
    const draft = {
      createdAt: "2026-08-06T08:00:00.000Z",
      draftId: "draft-outfit-copy",
      draftRevision: 2,
      fortuneDate: "2026-08-08",
      modules: {
        calendar_algorithm: null,
        copy_and_formula: {
          balanceSuggestion: {},
          basis: {},
          copyVersion: "copy-v1",
          outfitFormulas: [
            {
              disclaimer: "旧穿搭说明",
              formulaId: "formula-commute",
              kind: "triple",
              lookIds: ["look-primary"],
              slots: [{ role: "primary", tierCode: "da_ji" }],
              title: "通勤搭配",
            },
          ],
          outfitVersion: "outfit-v1",
          share: {
            copyText: "旧分享文案",
            posterJobEndpoint: "/api/v1/poster-jobs",
            posterTemplateVersion: "poster-v1",
            summaryText: "旧分享摘要",
          },
        },
        poster_consistency: null,
        visual_and_rights: null,
      },
      state: "draft",
      updatedAt: "2026-08-06T08:00:00.000Z",
    } as unknown as ContentDraft;
    const captured: { module: ContentDraft["modules"]["copy_and_formula"] | null } = {
      module: null,
    };
    const content = {
      readDraft: async () => structuredClone(draft),
      updateDraftModule: async (input: {
        module: NonNullable<ContentDraft["modules"]["copy_and_formula"]>;
      }) => {
        captured.module = structuredClone(input.module);
        return {
          kind: "updated" as const,
          result: {
            draftId: draft.draftId,
            draftRevision: 3,
            module: input.module,
            moduleCode: "copy_and_formula" as const,
          },
        };
      },
    } as unknown as DayCorrectionContentPort;
    const store = new InMemoryDayCorrectionStore([
      {
        appliedAction: null,
        applyDraftRevision: null,
        applyIdempotencyKeyHash: null,
        applyRequestHash: null,
        applyMode: null,
        applyStartedRevision: null,
        baselineActiveContentVersion: null,
        baselineLifecycleRevision: 0,
        correctionId: "correction-outfit-copy",
        correctionRevision: 1,
        createdAt: draft.createdAt,
        draftId: draft.draftId,
        fortuneDate: draft.fortuneDate,
        scheduledEffectiveFrom: null,
        sourceContentVersion: null,
        status: "open",
        submittedContentVersion: null,
        submittedLifecycleRevision: null,
        updatedAt: draft.updatedAt,
      },
    ]);
    const workflow = new DayCorrectionWorkflow(store, content, {
      resolve: () => undefined as never,
    });

    await expect(
      workflow.patch({
        actorId: "admin-1",
        command: {
          disclaimer: "60/30/10 是易模仿的穿搭比例参考。",
          formulaId: "formula-commute",
          kind: "set_outfit_formula_disclaimer",
        },
        correctionId: "correction-outfit-copy",
        expectedRevision: { correctionRevision: 1, draftRevision: 2 },
        requestId: "correction-outfit-copy",
      }),
    ).resolves.toMatchObject({
      draftRevision: 3,
      kind: "updated",
      moduleCode: "copy_and_formula",
    });
    expect(captured.module?.outfitFormulas[0]).toEqual({
      ...draft.modules.copy_and_formula?.outfitFormulas[0],
      disclaimer: "60/30/10 是易模仿的穿搭比例参考。",
    });
  });

  it("supports consecutive visible-copy edits and rejects a stale draft ETag", async () => {
    const draft = {
      createdAt: "2026-08-06T08:00:00.000Z",
      draftId: "draft-visible-copy",
      draftRevision: 5,
      fortuneDate: "2026-08-08",
      modules: {
        calendar_algorithm: null,
        copy_and_formula: {
          balanceSuggestion: {
            accessoryExamples: ["丝巾"],
            description: "旧平衡建议",
            preferredTierCode: "da_ji",
            title: "已经穿了注意色",
          },
          basis: {
            disclaimer: "旧依据说明",
            steps: ["先看日五行", "再映射五档颜色"],
          },
          copyVersion: "copy-v1",
          outfitFormulas: [
            {
              disclaimer: "原穿搭说明",
              formulaId: "formula-weekend",
              kind: "dual",
              lookIds: ["look-alternative"],
              slots: [
                { role: "primary", tierCode: "da_ji" },
                { role: "secondary", tierCode: "ci_ji" },
              ],
              title: "旧标题",
            },
          ],
          outfitVersion: "outfit-v1",
          share: {},
        },
        poster_consistency: null,
        visual_and_rights: null,
      },
      state: "draft",
      updatedAt: "2026-08-06T08:00:00.000Z",
    } as unknown as ContentDraft;
    const captured: NonNullable<ContentDraft["modules"]["copy_and_formula"]>[] = [];
    let currentDraft = structuredClone(draft);
    const content = {
      readDraft: async () => structuredClone(currentDraft),
      updateDraftModule: async (input: {
        expectedDraftRevision: number;
        module: NonNullable<ContentDraft["modules"]["copy_and_formula"]>;
      }) => {
        if (input.expectedDraftRevision !== currentDraft.draftRevision) {
          return {
            currentRevision: currentDraft.draftRevision,
            kind: "revision_mismatch" as const,
          };
        }
        captured.push(structuredClone(input.module));
        currentDraft = {
          ...currentDraft,
          draftRevision: currentDraft.draftRevision + 1,
          modules: { ...currentDraft.modules, copy_and_formula: structuredClone(input.module) },
        };
        return {
          kind: "updated" as const,
          result: {
            draftId: draft.draftId,
            draftRevision: currentDraft.draftRevision,
            module: input.module,
            moduleCode: "copy_and_formula" as const,
          },
        };
      },
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      new InMemoryDayCorrectionStore([
        {
          appliedAction: null,
          applyDraftRevision: null,
          applyIdempotencyKeyHash: null,
          applyRequestHash: null,
          applyMode: null,
          applyStartedRevision: null,
          baselineActiveContentVersion: null,
          baselineLifecycleRevision: 0,
          correctionId: "correction-visible-copy",
          correctionRevision: 1,
          createdAt: draft.createdAt,
          draftId: draft.draftId,
          fortuneDate: draft.fortuneDate,
          scheduledEffectiveFrom: null,
          sourceContentVersion: null,
          status: "open",
          submittedContentVersion: null,
          submittedLifecycleRevision: null,
          updatedAt: draft.updatedAt,
        },
      ]),
      content,
      { resolve: () => undefined as never },
    );

    await expect(
      workflow.patch({
        actorId: "admin-1",
        command: {
          formulaId: "formula-weekend",
          kind: "set_outfit_formula_title",
          title: "周末轻松搭配",
        },
        correctionId: "correction-visible-copy",
        expectedRevision: { correctionRevision: 1, draftRevision: 5 },
        requestId: "correction-formula-title",
      }),
    ).resolves.toMatchObject({ draftRevision: 6, kind: "updated" });
    await expect(
      workflow.patch({
        actorId: "admin-1",
        command: {
          disclaimer: "内容依据传统文化，仅供日常穿搭参考。",
          kind: "set_basis_disclaimer",
        },
        correctionId: "correction-visible-copy",
        expectedRevision: { correctionRevision: 1, draftRevision: 6 },
        requestId: "correction-basis-disclaimer",
      }),
    ).resolves.toMatchObject({ draftRevision: 7, kind: "updated" });
    await expect(
      workflow.patch({
        actorId: "admin-1",
        command: {
          description: "已经穿了注意色，也可以用大吉色配饰做小面积补充。",
          kind: "set_balance_suggestion_description",
        },
        correctionId: "correction-visible-copy",
        expectedRevision: { correctionRevision: 1, draftRevision: 7 },
        requestId: "correction-balance-description",
      }),
    ).resolves.toMatchObject({ draftRevision: 8, kind: "updated" });
    await expect(
      workflow.patch({
        actorId: "admin-1",
        command: {
          copyText: "今天适合白色系通勤穿搭，转发给也在纠结穿什么的朋友。",
          kind: "set_share_copy",
        },
        correctionId: "correction-visible-copy",
        expectedRevision: { correctionRevision: 1, draftRevision: 8 },
        requestId: "correction-share-copy",
      }),
    ).resolves.toMatchObject({ draftRevision: 9, kind: "updated" });
    await expect(
      workflow.patch({
        actorId: "admin-1",
        command: {
          disclaimer: "过期页面不应覆盖新内容。",
          kind: "set_basis_disclaimer",
        },
        correctionId: "correction-visible-copy",
        expectedRevision: { correctionRevision: 1, draftRevision: 6 },
        requestId: "correction-stale-copy",
      }),
    ).resolves.toEqual({
      currentRevision: { correctionRevision: 1, draftRevision: 9 },
      kind: "revision_mismatch",
    });

    expect(captured[0]?.outfitFormulas[0]).toEqual({
      ...draft.modules.copy_and_formula?.outfitFormulas[0],
      title: "周末轻松搭配",
    });
    expect(captured[0]?.basis).toEqual(draft.modules.copy_and_formula?.basis);
    expect(captured[1]?.basis).toEqual({
      ...draft.modules.copy_and_formula?.basis,
      disclaimer: "内容依据传统文化，仅供日常穿搭参考。",
    });
    expect(captured[1]?.outfitFormulas[0]?.title).toBe("周末轻松搭配");
    expect(captured[2]?.balanceSuggestion).toEqual({
      ...draft.modules.copy_and_formula?.balanceSuggestion,
      description: "已经穿了注意色，也可以用大吉色配饰做小面积补充。",
    });
    expect(captured[3]?.share).toEqual({
      ...draft.modules.copy_and_formula?.share,
      copyText: "今天适合白色系通勤穿搭，转发给也在纠结穿什么的朋友。",
    });
    expect(captured).toHaveLength(4);
  });

  it("schedules a future correction at the public 18:00 effectiveFrom", async () => {
    const correction = {
      appliedAction: null,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      baselineActiveContentVersion: null,
      baselineLifecycleRevision: 2,
      correctionId: "correction-future",
      correctionRevision: 1,
      createdAt: "2026-08-06T10:00:00.000Z",
      draftId: "draft-future",
      fortuneDate: "2026-08-08",
      scheduledEffectiveFrom: null,
      sourceContentVersion: null,
      status: "open" as const,
      submittedContentVersion: null,
      submittedLifecycleRevision: null,
      updatedAt: "2026-08-06T10:00:00.000Z",
    };
    const action = {
      activeContentVersion: null,
      auditEventId: "audit-future",
      contentVersion: "content-future",
      fortuneDate: correction.fortuneDate,
      lifecycleRevision: 4,
      state: "scheduled" as const,
      transitions: [
        {
          contentVersion: "content-future",
          fromState: "approved" as const,
          toState: "scheduled" as const,
        },
      ],
    };
    let scheduledEffectiveFrom = "";
    const content = {
      readDraft: async () => workingDraft(correction, 5),
      publish: async () => {
        throw new Error("Future correction must not publish immediately");
      },
      schedule: async (input: { effectiveFrom: string }) => {
        scheduledEffectiveFrom = input.effectiveFrom;
        return { action, kind: "applied" as const };
      },
      submitCorrectionDraft: async () => ({
        kind: "submitted" as const,
        result: {
          contentVersion: "content-future",
          draftId: correction.draftId,
          lifecycleRevision: 3,
          state: "approved" as const,
        },
      }),
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      new InMemoryDayCorrectionStore([correction]),
      content,
      {
        resolve: () => ({
          civilDate: "2026-08-06",
          crossedDayBoundary: false,
          dayBoundary: "23:00",
          fortuneDate: "2026-08-06",
          responseGeneratedAt: "2026-08-06T18:00:00+08:00",
          shichen: "酉",
          timezone: "Asia/Shanghai",
        }),
      },
    );

    await expect(
      workflow.apply({
        actorId: "admin-1",
        correctionId: correction.correctionId,
        expectedRevision: { correctionRevision: 1, draftRevision: 5 },
        idempotencyKey: "external-correction-future-0001",
        reason: "修正未来日期穿搭说明。",
        requestId: "correction-apply-future",
      }),
    ).resolves.toMatchObject({ action, kind: "applied", mode: "scheduled" });
    expect(scheduledEffectiveFrom).toBe("2026-08-07T18:00:00+08:00");
  });

  it("replaces an existing future schedule without conflicting with active or lifecycle preconditions", async () => {
    const fortuneDate = "2026-08-08";
    const effectiveFrom = "2026-08-07T18:00:00+08:00";
    const version = (
      contentVersion: string,
      state: StoredContentVersion["state"],
    ): StoredContentVersion => ({
      contentVersion,
      createdAt: "2026-08-06T02:00:00.000Z",
      draftId: `draft-${contentVersion}`,
      effectiveFrom,
      effectiveTo: "2026-08-08T18:00:00+08:00",
      fortuneDate,
      preflightChecks: [],
      snapshot: {
        calendar_algorithm: null,
        copy_and_formula: null,
        poster_consistency: null,
        visual_and_rights: null,
      },
      state,
    });
    const releaseStore = new InMemoryContentReleaseStore();
    releaseStore.seedProjection({
      activeContentVersion: "content-active",
      fortuneDate,
      lifecycleRevision: 13,
      scheduleSlotRevision: 4,
      scheduledContentVersion: "content-scheduled-old",
      scheduledEffectiveFrom: effectiveFrom,
    });
    releaseStore.seedVersion(version("content-scheduled-old", "scheduled"));
    releaseStore.seedVersion(version("content-scheduled-new", "approved"));
    const release = new ContentReleaseService(
      releaseStore,
      { now: () => new Date("2026-08-06T10:00:00.000Z") },
      undefined,
      () => [],
    );
    const correction = {
      appliedAction: null,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      baselineActiveContentVersion: "content-active",
      baselineLifecycleRevision: 12,
      correctionId: "correction-schedule-replace",
      correctionRevision: 1,
      createdAt: "2026-08-06T08:00:00.000Z",
      draftId: "draft-schedule-replace",
      fortuneDate,
      scheduledEffectiveFrom: null,
      sourceContentVersion: "content-scheduled-old",
      status: "open" as const,
      submittedContentVersion: null,
      submittedLifecycleRevision: null,
      updatedAt: "2026-08-06T08:00:00.000Z",
    };
    const content = {
      publish: async () => {
        throw new Error("Future correction must not publish immediately");
      },
      readDraft: async () => workingDraft(correction, 2),
      schedule: (input: Parameters<ContentReleaseService["schedule"]>[0]) =>
        release.schedule(input),
      submitCorrectionDraft: async () => ({
        kind: "submitted" as const,
        result: {
          contentVersion: "content-scheduled-new",
          draftId: correction.draftId,
          lifecycleRevision: 13,
          state: "approved" as const,
        },
      }),
    } as unknown as DayCorrectionContentPort;
    const workflow = new DayCorrectionWorkflow(
      new InMemoryDayCorrectionStore([correction]),
      content,
      {
        resolve: () => ({
          civilDate: "2026-08-06",
          crossedDayBoundary: false,
          dayBoundary: "23:00",
          fortuneDate: "2026-08-06",
          responseGeneratedAt: "2026-08-06T18:00:00+08:00",
          shichen: "酉",
          timezone: "Asia/Shanghai",
        }),
      },
    );

    await expect(
      workflow.apply({
        actorId: "admin-1",
        correctionId: correction.correctionId,
        expectedRevision: { correctionRevision: 1, draftRevision: 2 },
        idempotencyKey: "external-schedule-replace-key",
        reason: "替换未来日期已存在的排期。",
        requestId: "schedule-replace-request",
      }),
    ).resolves.toMatchObject({
      action: {
        activeContentVersion: "content-active",
        lifecycleRevision: 14,
        state: "scheduled",
        transitions: [
          {
            contentVersion: "content-scheduled-old",
            fromState: "scheduled",
            toState: "approved",
          },
          {
            contentVersion: "content-scheduled-new",
            fromState: "approved",
            toState: "scheduled",
          },
        ],
      },
      kind: "applied",
      mode: "scheduled",
    });
    await expect(releaseStore.readProjection(fortuneDate)).resolves.toMatchObject({
      activeContentVersion: "content-active",
      lifecycleRevision: 14,
      scheduleSlotRevision: 5,
      scheduledContentVersion: "content-scheduled-new",
    });
  });

  it("rejects a past fortuneDate before submission", async () => {
    const store = new InMemoryDayCorrectionStore([
      {
        appliedAction: null,
        applyDraftRevision: null,
        applyIdempotencyKeyHash: null,
        applyRequestHash: null,
        applyMode: null,
        applyStartedRevision: null,
        baselineActiveContentVersion: "content-past",
        baselineLifecycleRevision: 4,
        correctionId: "correction-past",
        correctionRevision: 1,
        createdAt: "2026-08-06T10:00:00.000Z",
        draftId: "draft-past",
        fortuneDate: "2026-08-06",
        scheduledEffectiveFrom: null,
        sourceContentVersion: "content-past",
        status: "open",
        submittedContentVersion: null,
        submittedLifecycleRevision: null,
        updatedAt: "2026-08-06T10:00:00.000Z",
      },
    ]);
    const workflow = new DayCorrectionWorkflow(store, unusedContentPort(), {
      resolve: () => ({
        civilDate: "2026-08-07",
        crossedDayBoundary: false,
        dayBoundary: "23:00",
        fortuneDate: "2026-08-07",
        responseGeneratedAt: "2026-08-07T12:00:00+08:00",
        shichen: "午",
        timezone: "Asia/Shanghai",
      }),
    });

    await expect(
      workflow.apply({
        actorId: "admin-1",
        correctionId: "correction-past",
        expectedRevision: { correctionRevision: 1, draftRevision: 2 },
        idempotencyKey: "external-correction-past-0001",
        reason: "过去日期不应应用。",
        requestId: "correction-apply-past",
      }),
    ).resolves.toEqual({ kind: "past_date" });
    await expect(store.findById("correction-past")).resolves.toMatchObject({ status: "open" });
  });
});
