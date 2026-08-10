import { createHash, randomUUID } from "node:crypto";

import type {
  ContentDraft,
  DraftModuleByCode,
  ModuleCode,
} from "../content-lifecycle/content-lifecycle.store";
import type {
  CreateDraftResult,
  SubmitDraftResult,
  UpdateDraftModuleResult,
} from "../content-lifecycle/content-lifecycle.service";
import { CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN } from "../content-lifecycle/content-lifecycle.values";
import type { ContentReleaseActionResult } from "../content-release/content-release.service";
import type { AdminImageAsset } from "../daily-images/daily-image-asset.store";
import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import { PublicContentWindowResolver } from "../public-content/public-content-window-resolver";
import type { RequestContext } from "../request-context/request-context-resolver";
import type { DayCorrectionStore, StoredDayCorrection } from "./day-correction.store";

export interface DayCorrectionContentPort {
  createDraft(input: {
    readonly actorId: string;
    readonly copyFromContentVersion: string | null;
    readonly copyFromDraftId: string | null;
    readonly draftId: string;
    readonly fortuneDate: string;
    readonly requestId: string;
  }): Promise<CreateDraftResult>;
  readDraft(draftId: string): Promise<ContentDraft | null>;
  readDraftImageCandidate(
    draftId: string,
    assetId: string,
  ): Promise<{
    readonly asset: AdminImageAsset;
    readonly draftId: string;
    readonly fortuneDate: string;
    readonly imageSlot: "optional" | "required_alternative" | "required_primary" | null;
  } | null>;
  resolveBaseline(fortuneDate: string): Promise<{
    readonly activeContentVersion: string | null;
    readonly copySourceContentVersion: string | null;
    readonly copySourceDraftId?: string | null;
    readonly lifecycleRevision: number;
  }>;
  publish(input: {
    readonly actorId: string;
    readonly contentVersion: string;
    readonly expectedActiveContentVersion: string | null;
    readonly expectedLifecycleRevision: number;
    readonly idempotencyKey: string;
    readonly reason: string;
    readonly requestId: string;
  }): Promise<ContentReleaseActionResult>;
  schedule(input: {
    readonly actorId: string;
    readonly contentVersion: string;
    readonly effectiveFrom: string;
    readonly expectedActiveContentVersion: string | null;
    readonly expectedLifecycleRevision: number;
    readonly idempotencyKey: string;
    readonly reason: string;
    readonly requestId: string;
  }): Promise<ContentReleaseActionResult>;
  submitCorrectionDraft(input: {
    readonly actorId: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly idempotencyKey: string;
    readonly requestId: string;
  }): Promise<SubmitDraftResult>;
  updateDraftModule<C extends ModuleCode>(input: {
    readonly actorId: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly module: DraftModuleByCode[C];
    readonly moduleCode: C;
    readonly requestId: string;
  }): Promise<UpdateDraftModuleResult>;
}

export interface DayCorrectionRequestContextResolver {
  resolve(): RequestContext;
}

export interface DayCorrectionClock {
  now(): Date;
}

export interface DayCorrectionIdentifiers {
  nextCorrectionId(): string;
  nextDraftId(): string;
}

const SYSTEM_CLOCK: DayCorrectionClock = { now: () => new Date() };
const SYSTEM_IDENTIFIERS: DayCorrectionIdentifiers = {
  nextCorrectionId: () => `correction-${randomUUID()}`,
  nextDraftId: () => `correction-draft-${randomUUID()}`,
};
const OPEN_INTENT_TTL_MS = 15 * 60 * 1_000;

const ALGORITHM_COMMAND_FIELDS = {
  reorder_tiers: "tiers.rank",
  set_calendar: "calendar",
  set_day_element: "calendar.dayElement",
  set_effective_from: "effectiveFrom",
  set_effective_to: "effectiveTo",
  set_fortune_date: "fortuneDate",
  set_shichen: "requestContext.shichen",
  set_tier_colors: "tiers.colors",
} as const;

type AlgorithmCommandKind = keyof typeof ALGORITHM_COMMAND_FIELDS;

const EDITABLE_COMMAND_KINDS = new Set([
  "replace_image_cover",
  "set_balance_suggestion_description",
  "set_basis_disclaimer",
  "set_outfit_formula_disclaimer",
  "set_outfit_formula_title",
  "set_share_copy",
  "set_tier_explanation",
]);

export interface DayCorrectionWorkingRevision {
  readonly correctionRevision: number;
  readonly draftRevision: number;
}

interface ApplyDayCorrectionInput {
  readonly actorId: string;
  readonly correctionId: string;
  readonly expectedRevision: DayCorrectionWorkingRevision;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly requestId: string;
}

interface PatchDayCorrectionInput {
  readonly actorId: string;
  readonly command: unknown;
  readonly correctionId: string;
  readonly expectedRevision: DayCorrectionWorkingRevision;
  readonly requestId: string;
}

export type PatchDayCorrectionResult =
  | {
      readonly field: (typeof ALGORITHM_COMMAND_FIELDS)[AlgorithmCommandKind];
      readonly kind: "algorithm_field_read_only";
    }
  | { readonly kind: "invalid_command" }
  | { readonly kind: "invalid_value" }
  | { readonly kind: "not_found" }
  | { readonly kind: "invalid_state" }
  | { readonly kind: "target_not_found" }
  | { readonly kind: "invalid_asset_reference" }
  | { readonly currentRevision: DayCorrectionWorkingRevision; readonly kind: "revision_mismatch" }
  | {
      readonly correctionId: string;
      readonly correctionRevision: number;
      readonly draftRevision: number;
      readonly fortuneDate: string;
      readonly kind: "updated";
      readonly moduleCode: ModuleCode;
    };

export type OpenDayCorrectionResult =
  | {
      readonly correction: StoredDayCorrection;
      readonly draft: ContentDraft;
      readonly kind: "ready";
    }
  | { readonly kind: "invalid_argument" | "source_not_found" | "source_date_mismatch" }
  | { readonly kind: "working_copy_missing" };

export type ApplyDayCorrectionResult =
  | {
      readonly action: NonNullable<StoredDayCorrection["appliedAction"]>;
      readonly correctionId: string;
      readonly correctionRevision: number;
      readonly draftRevision: number;
      readonly kind: "applied" | "existing";
      readonly mode: "immediate" | "scheduled";
    }
  | { readonly kind: "invalid_argument" | "not_found" | "past_date" }
  | { readonly currentRevision: DayCorrectionWorkingRevision; readonly kind: "revision_mismatch" }
  | { readonly kind: "idempotency_conflict" | "invalid_state" }
  | { readonly kind: "submit_failed"; readonly result: SubmitDraftResult }
  | {
      readonly correctionRevision: number;
      readonly draftRevision: number;
      readonly kind: "release_failed";
      readonly result: ContentReleaseActionResult;
    }
  | { readonly kind: "release_unavailable" }
  | { readonly kind: "persistence_conflict" };

function commandKind(command: unknown): string | null {
  if (typeof command !== "object" || command === null || !("kind" in command)) return null;
  return typeof command.kind === "string" ? command.kind : null;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function replayableReleaseFailure(
  value: object | null | undefined,
): ContentReleaseActionResult | null {
  if (
    value === null ||
    value === undefined ||
    !("kind" in value) ||
    typeof value.kind !== "string"
  ) {
    return null;
  }
  switch (value.kind) {
    case "active_version_changed":
      return "currentActiveContentVersion" in value &&
        (typeof value.currentActiveContentVersion === "string" ||
          value.currentActiveContentVersion === null)
        ? (value as ContentReleaseActionResult)
        : null;
    case "revision_mismatch":
      return "currentRevision" in value &&
        Number.isSafeInteger(value.currentRevision) &&
        Number(value.currentRevision) >= 0
        ? (value as ContentReleaseActionResult)
        : null;
    case "preflight_failed":
      return "preflightChecks" in value && Array.isArray(value.preflightChecks)
        ? (value as ContentReleaseActionResult)
        : null;
    case "idempotency_conflict":
    case "invalid_argument":
    case "invalid_state":
    case "not_found":
    case "schedule_time_invalid":
    case "version_withdrawn":
      return value as ContentReleaseActionResult;
    default:
      return null;
  }
}

function validDisplayCopy(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value).length <= maximumLength
  );
}

export class DayCorrectionWorkflow {
  constructor(
    private readonly store: DayCorrectionStore,
    private readonly content: DayCorrectionContentPort,
    private readonly requestContextResolver: DayCorrectionRequestContextResolver,
    private readonly clock: DayCorrectionClock = SYSTEM_CLOCK,
    private readonly identifiers: DayCorrectionIdentifiers = SYSTEM_IDENTIFIERS,
    private readonly publicContentContextResolver = new PublicContentContextResolver(),
    private readonly publicContentWindowResolver = new PublicContentWindowResolver(),
  ) {}

  async apply(input: ApplyDayCorrectionInput): Promise<ApplyDayCorrectionResult> {
    if (!validApplyInput(input)) return { kind: "invalid_argument" };
    const located = await this.store.findById(input.correctionId);
    if (located === null) return { kind: "not_found" };
    return this.store.withOpenFortuneDateLock(located.fortuneDate, () =>
      this.applyUnderFortuneDateLock(input),
    );
  }

  private async applyUnderFortuneDateLock(
    input: ApplyDayCorrectionInput,
  ): Promise<ApplyDayCorrectionResult> {
    const keyHash = createHash("sha256").update(input.idempotencyKey).digest("hex");
    const existing = await this.store.findById(input.correctionId);
    if (existing === null) return { kind: "not_found" };
    let applyMode = existing.applyMode;
    let scheduledEffectiveFrom = existing.scheduledEffectiveFrom;
    if (applyMode === null) {
      const requestContext = this.requestContextResolver.resolve();
      const servedFortuneDate =
        this.publicContentContextResolver.resolve(requestContext).servedFortuneDate;
      if (existing.fortuneDate < servedFortuneDate) return { kind: "past_date" };
      applyMode = existing.fortuneDate === servedFortuneDate ? "immediate" : "scheduled";
      scheduledEffectiveFrom =
        applyMode === "scheduled"
          ? this.publicContentWindowResolver.resolve(existing.fortuneDate).effectiveFrom
          : null;
    }
    const applyRequestHash = correctionApplyRequestHash({
      ...input,
      applyMode,
    });
    if (existing.status === "applied") {
      if (
        existing.applyIdempotencyKeyHash !== keyHash ||
        existing.applyRequestHash !== applyRequestHash
      ) {
        return { kind: "idempotency_conflict" };
      }
      return existing.appliedAction === null || existing.applyMode === null
        ? { kind: "invalid_state" }
        : {
            action: existing.appliedAction,
            correctionId: existing.correctionId,
            correctionRevision: existing.correctionRevision,
            draftRevision: existing.applyDraftRevision ?? input.expectedRevision.draftRevision,
            kind: "existing",
            mode: existing.applyMode,
          };
    }
    if (existing.status === "abandoned") {
      if (
        existing.applyIdempotencyKeyHash !== keyHash ||
        existing.applyRequestHash !== applyRequestHash
      ) {
        return { kind: "idempotency_conflict" };
      }
      const terminalFailure = replayableReleaseFailure(existing.terminalFailure);
      return terminalFailure === null || existing.applyDraftRevision === null
        ? { kind: "invalid_state" }
        : {
            correctionRevision: existing.correctionRevision,
            draftRevision: existing.applyDraftRevision,
            kind: "release_failed",
            result: terminalFailure,
          };
    }
    if (existing.status === "open") {
      const draft = await this.content.readDraft(existing.draftId);
      if (draft === null || draft.fortuneDate !== existing.fortuneDate) {
        return { kind: "invalid_state" };
      }
      if (
        existing.correctionRevision !== input.expectedRevision.correctionRevision ||
        draft.draftRevision !== input.expectedRevision.draftRevision
      ) {
        return {
          currentRevision: {
            correctionRevision: existing.correctionRevision,
            draftRevision: draft.draftRevision,
          },
          kind: "revision_mismatch",
        };
      }
    } else if (
      existing.applyIdempotencyKeyHash !== keyHash ||
      existing.applyRequestHash !== applyRequestHash
    ) {
      return { kind: "idempotency_conflict" };
    }
    const begun = await this.store.beginApply({
      applyDraftRevision: existing.applyDraftRevision ?? input.expectedRevision.draftRevision,
      applyIdempotencyKeyHash: keyHash,
      applyRequestHash,
      applyMode,
      correctionId: input.correctionId,
      expectedCorrectionRevision:
        existing.applyStartedRevision ?? input.expectedRevision.correctionRevision,
      scheduledEffectiveFrom,
      updatedAt: this.clock.now().toISOString(),
    });
    if (!("correction" in begun)) {
      if (begun.kind !== "revision_mismatch") return begun;
      const currentDraft = await this.content.readDraft(existing.draftId);
      return currentDraft === null
        ? { kind: "invalid_state" }
        : {
            currentRevision: {
              correctionRevision: begun.currentRevision,
              draftRevision: currentDraft.draftRevision,
            },
            kind: "revision_mismatch",
          };
    }
    let correction = begun.correction;

    if (correction.submittedContentVersion === null) {
      const submitted = await this.content.submitCorrectionDraft({
        actorId: input.actorId,
        draftId: correction.draftId,
        expectedDraftRevision:
          correction.applyDraftRevision ?? input.expectedRevision.draftRevision,
        idempotencyKey: childIdempotencyKey(
          input.idempotencyKey,
          correction.correctionId,
          "submit",
        ),
        requestId: input.requestId,
      });
      if (
        (submitted.kind !== "submitted" && submitted.kind !== "existing") ||
        submitted.result.state !== "approved"
      ) {
        const reopened = await this.store.abandonApply({
          correctionId: correction.correctionId,
          expectedCorrectionRevision: correction.correctionRevision,
          updatedAt: this.clock.now().toISOString(),
        });
        if (reopened === null) return { kind: "persistence_conflict" };
        if (submitted.kind === "revision_mismatch") {
          return {
            currentRevision: {
              correctionRevision: reopened.correctionRevision,
              draftRevision: submitted.currentRevision,
            },
            kind: "revision_mismatch",
          };
        }
        return { kind: "submit_failed", result: submitted };
      }
      const saved = await this.store.recordSubmitted({
        contentVersion: submitted.result.contentVersion,
        correctionId: correction.correctionId,
        expectedCorrectionRevision: correction.correctionRevision,
        lifecycleRevision: submitted.result.lifecycleRevision,
        updatedAt: this.clock.now().toISOString(),
      });
      if (saved === null) return { kind: "persistence_conflict" };
      correction = saved;
    }
    if (
      correction.submittedContentVersion === null ||
      correction.submittedLifecycleRevision === null ||
      correction.applyMode === null
    ) {
      return { kind: "invalid_state" };
    }

    if (correction.applyMode === "scheduled") {
      const latestContext = this.requestContextResolver.resolve();
      const latestServedFortuneDate =
        this.publicContentContextResolver.resolve(latestContext).servedFortuneDate;
      if (correction.fortuneDate === latestServedFortuneDate) {
        const refreshed = await this.store.refreshApplyMode({
          applyMode: "immediate",
          applyRequestHash: correctionApplyRequestHash({
            ...input,
            applyMode: "immediate",
          }),
          correctionId: correction.correctionId,
          expectedCorrectionRevision: correction.correctionRevision,
          scheduledEffectiveFrom: null,
          updatedAt: this.clock.now().toISOString(),
        });
        if (refreshed === null) return { kind: "persistence_conflict" };
        correction = refreshed;
      }
    }
    if (
      correction.submittedContentVersion === null ||
      correction.submittedLifecycleRevision === null ||
      correction.applyMode === null
    ) {
      return { kind: "invalid_state" };
    }

    const commonRelease = {
      actorId: input.actorId,
      contentVersion: correction.submittedContentVersion,
      expectedActiveContentVersion: correction.baselineActiveContentVersion,
      expectedLifecycleRevision: correction.submittedLifecycleRevision,
      reason: input.reason,
      requestId: input.requestId,
    };
    let released: ContentReleaseActionResult;
    try {
      released =
        correction.applyMode === "immediate"
          ? await this.content.publish({
              ...commonRelease,
              idempotencyKey: childIdempotencyKey(
                input.idempotencyKey,
                correction.correctionId,
                "publish",
              ),
            })
          : correction.scheduledEffectiveFrom === null
            ? ({ kind: "invalid_argument" } as const)
            : await this.content.schedule({
                ...commonRelease,
                effectiveFrom: correction.scheduledEffectiveFrom,
                idempotencyKey: childIdempotencyKey(
                  input.idempotencyKey,
                  correction.correctionId,
                  "schedule",
                ),
              });
    } catch {
      // Submission progress is already durable; the same external key safely resumes release.
      return { kind: "release_unavailable" };
    }
    if (released.kind === "schedule_time_invalid" && correction.applyMode === "scheduled") {
      const retryContext = this.requestContextResolver.resolve();
      const retryServedFortuneDate =
        this.publicContentContextResolver.resolve(retryContext).servedFortuneDate;
      if (correction.fortuneDate === retryServedFortuneDate) {
        const refreshed = await this.store.refreshApplyMode({
          applyMode: "immediate",
          applyRequestHash: correctionApplyRequestHash({
            ...input,
            applyMode: "immediate",
          }),
          correctionId: correction.correctionId,
          expectedCorrectionRevision: correction.correctionRevision,
          scheduledEffectiveFrom: null,
          updatedAt: this.clock.now().toISOString(),
        });
        if (refreshed === null) return { kind: "persistence_conflict" };
        correction = refreshed;
        try {
          released = await this.content.publish({
            ...commonRelease,
            idempotencyKey: childIdempotencyKey(
              input.idempotencyKey,
              correction.correctionId,
              "publish",
            ),
          });
        } catch {
          return { kind: "release_unavailable" };
        }
      }
    }
    if (released.kind !== "applied" && released.kind !== "existing") {
      const abandoned = await this.store.recordAbandoned({
        correctionId: correction.correctionId,
        expectedCorrectionRevision: correction.correctionRevision,
        failure: released,
        updatedAt: this.clock.now().toISOString(),
      });
      if (abandoned === null) return { kind: "persistence_conflict" };
      return {
        correctionRevision: abandoned.correctionRevision,
        draftRevision: abandoned.applyDraftRevision ?? input.expectedRevision.draftRevision,
        kind: "release_failed",
        result: released,
      };
    }
    const releasedMode = correction.applyMode;
    if (releasedMode === null) return { kind: "invalid_state" };
    const applied = await this.store.recordApplied({
      action: released.action,
      correctionId: correction.correctionId,
      expectedCorrectionRevision: correction.correctionRevision,
      updatedAt: this.clock.now().toISOString(),
    });
    if (applied === null) return { kind: "persistence_conflict" };
    return {
      action: released.action,
      correctionId: applied.correctionId,
      correctionRevision: applied.correctionRevision,
      draftRevision: applied.applyDraftRevision ?? input.expectedRevision.draftRevision,
      kind: "applied",
      mode: releasedMode,
    };
  }

  async openWorkingCopy(input: {
    readonly actorId: string;
    readonly fortuneDate: string;
    readonly requestId: string;
  }): Promise<OpenDayCorrectionResult> {
    if (!validFortuneDate(input.fortuneDate)) return { kind: "invalid_argument" };
    return this.store.withOpenFortuneDateLock(input.fortuneDate, async () => {
      const concurrentlyOpened = await this.store.findOpenByFortuneDate(input.fortuneDate);
      if (concurrentlyOpened !== null) {
        await this.store.renewOpenOwnership(
          concurrentlyOpened.correctionId,
          this.clock.now().toISOString(),
        );
        const draft = await this.content.readDraft(concurrentlyOpened.draftId);
        if (draft === null) return { kind: "working_copy_missing" } as const;
        return draft.fortuneDate === input.fortuneDate
          ? ({ correction: concurrentlyOpened, draft, kind: "ready" } as const)
          : ({ kind: "source_date_mismatch" } as const);
      }

      const baseline = await this.content.resolveBaseline(input.fortuneDate);
      const copySourceDraftId = baseline.copySourceDraftId ?? null;
      if ((baseline.copySourceContentVersion === null) === (copySourceDraftId === null)) {
        return { kind: "source_not_found" } as const;
      }
      const now = this.clock.now().toISOString();
      const intent = await this.store.reserveOrGetOpenIntent({
        baselineActiveContentVersion: baseline.activeContentVersion,
        baselineLifecycleRevision: baseline.lifecycleRevision,
        correctionId: this.identifiers.nextCorrectionId(),
        createdAt: now,
        draftId: this.identifiers.nextDraftId(),
        expiresAt: new Date(Date.parse(now) + OPEN_INTENT_TTL_MS).toISOString(),
        fortuneDate: input.fortuneDate,
        sourceContentVersion: baseline.copySourceContentVersion,
        sourceDraftId: copySourceDraftId,
      });
      const created = await this.content.createDraft({
        actorId: input.actorId,
        copyFromContentVersion: intent.sourceContentVersion,
        copyFromDraftId: intent.sourceDraftId ?? null,
        draftId: intent.draftId,
        fortuneDate: input.fortuneDate,
        requestId: input.requestId,
      });
      if (created.kind !== "created") {
        await this.store.discardOpenIntent(intent);
        return created;
      }
      const correction = await this.store.finalizeOpenIntent({
        appliedAction: null,
        applyDraftRevision: null,
        applyIdempotencyKeyHash: null,
        applyRequestHash: null,
        applyMode: null,
        applyStartedRevision: null,
        baselineActiveContentVersion: intent.baselineActiveContentVersion,
        baselineLifecycleRevision: intent.baselineLifecycleRevision,
        correctionId: intent.correctionId,
        correctionRevision: 1,
        createdAt: now,
        draftId: intent.draftId,
        fortuneDate: input.fortuneDate,
        scheduledEffectiveFrom: null,
        sourceContentVersion: intent.sourceContentVersion,
        sourceDraftId: intent.sourceDraftId ?? null,
        status: "open",
        submittedContentVersion: null,
        submittedLifecycleRevision: null,
        terminalFailure: null,
        updatedAt: now,
      });
      const draft =
        correction.draftId === created.draft.draftId
          ? created.draft
          : await this.content.readDraft(correction.draftId);
      return draft === null
        ? ({ kind: "working_copy_missing" } as const)
        : ({ correction, draft, kind: "ready" } as const);
    });
  }

  async getWorkingCopy(correctionId: string): Promise<OpenDayCorrectionResult> {
    const located = await this.store.findById(correctionId);
    if (located === null) return { kind: "source_not_found" };
    return this.store.withOpenFortuneDateLock(located.fortuneDate, async () => {
      const correction = await this.store.findById(correctionId);
      if (correction === null) return { kind: "source_not_found" } as const;
      const updatedAt = this.clock.now().toISOString();
      if (correction.status === "open") {
        await this.store.renewOpenOwnership(correction.correctionId, updatedAt);
      }
      const draft = await this.content.readDraft(correction.draftId);
      if (draft === null) return { kind: "working_copy_missing" } as const;
      if (draft.fortuneDate !== correction.fortuneDate) {
        return { kind: "source_date_mismatch" } as const;
      }
      return {
        correction: correction.status === "open" ? { ...correction, updatedAt } : correction,
        draft,
        kind: "ready",
      } as const;
    });
  }

  async patch(input: PatchDayCorrectionInput): Promise<PatchDayCorrectionResult> {
    const kind = commandKind(input.command);
    if (kind !== null && kind in ALGORITHM_COMMAND_FIELDS) {
      return {
        field: ALGORITHM_COMMAND_FIELDS[kind as AlgorithmCommandKind],
        kind: "algorithm_field_read_only",
      };
    }
    if (kind === null || !EDITABLE_COMMAND_KINDS.has(kind)) {
      return { kind: "invalid_command" };
    }
    const located = await this.store.findById(input.correctionId);
    if (located === null) return { kind: "not_found" };
    return this.store.withOpenFortuneDateLock(located.fortuneDate, async () => {
      const result = await this.patchUnderFortuneDateLock(input);
      if (result.kind === "updated") {
        await this.store.renewOpenOwnership(input.correctionId, this.clock.now().toISOString());
      }
      return result;
    });
  }

  private async patchUnderFortuneDateLock(
    input: PatchDayCorrectionInput,
  ): Promise<PatchDayCorrectionResult> {
    const kind = commandKind(input.command);
    if (kind !== null && kind in ALGORITHM_COMMAND_FIELDS) {
      return {
        field: ALGORITHM_COMMAND_FIELDS[kind as AlgorithmCommandKind],
        kind: "algorithm_field_read_only",
      };
    }
    if (kind === null || !EDITABLE_COMMAND_KINDS.has(kind)) {
      return { kind: "invalid_command" };
    }
    const preflightCorrection = await this.store.findById(input.correctionId);
    if (preflightCorrection === null) return { kind: "not_found" };
    if (preflightCorrection.status !== "open") return { kind: "invalid_state" };
    const preflightDraft = await this.content.readDraft(preflightCorrection.draftId);
    if (preflightDraft === null || preflightDraft.fortuneDate !== preflightCorrection.fortuneDate) {
      return { kind: preflightDraft === null ? "not_found" : "invalid_state" };
    }
    if (
      preflightCorrection.correctionRevision !== input.expectedRevision.correctionRevision ||
      preflightDraft.draftRevision !== input.expectedRevision.draftRevision
    ) {
      return {
        currentRevision: {
          correctionRevision: preflightCorrection.correctionRevision,
          draftRevision: preflightDraft.draftRevision,
        },
        kind: "revision_mismatch",
      };
    }
    if (
      kind === "replace_image_cover" &&
      typeof input.command === "object" &&
      input.command !== null
    ) {
      if (!hasExactKeys(input.command, ["assetId", "imageSlot", "kind"])) {
        return { kind: "invalid_command" };
      }
      const command = input.command as Record<string, unknown>;
      if (
        typeof command.assetId !== "string" ||
        command.assetId.trim().length === 0 ||
        typeof command.imageSlot !== "string" ||
        !["required_primary", "required_alternative", "optional"].includes(command.imageSlot)
      ) {
        return { kind: "invalid_value" };
      }
      const correction = await this.store.findById(input.correctionId);
      if (correction === null) return { kind: "not_found" };
      if (correction.status !== "open") return { kind: "invalid_state" };
      const draft = await this.content.readDraft(correction.draftId);
      if (
        draft === null ||
        draft.fortuneDate !== correction.fortuneDate ||
        draft.modules.visual_and_rights === null
      ) {
        return { kind: draft === null ? "not_found" : "invalid_state" };
      }
      const module = structuredClone(draft.modules.visual_and_rights);
      const candidate = await this.content.readDraftImageCandidate(
        correction.draftId,
        command.assetId,
      );
      if (
        candidate === null ||
        candidate.draftId !== correction.draftId ||
        candidate.fortuneDate !== correction.fortuneDate ||
        candidate.imageSlot !== command.imageSlot
      ) {
        return { kind: "invalid_asset_reference" };
      }
      const lookIndex = module.looks.findIndex((look) => look.imageSlot === command.imageSlot);
      const look = module.looks[lookIndex];
      if (lookIndex < 0 || look === undefined) return { kind: "target_not_found" };
      module.assets = [
        ...new Map(
          [...module.assets, structuredClone(candidate.asset)].map((asset) => [
            asset.assetId,
            asset,
          ]),
        ).values(),
      ];
      const recordedRights = new Set(module.rightsRecords.map((record) => record.rightsRecordId));
      for (const rightsRecordId of candidate.asset.rightsRecordIds) {
        if (recordedRights.has(rightsRecordId)) continue;
        module.rightsRecords.push({
          kind: "internal_record",
          recordedAt: this.clock.now().toISOString(),
          reference: `订正图片：${candidate.asset.assetId}`,
          rightsRecordId,
        });
        recordedRights.add(rightsRecordId);
      }
      module.looks[lookIndex] = { ...look, coverAssetId: command.assetId };
      const updated = await this.content.updateDraftModule({
        actorId: input.actorId,
        draftId: correction.draftId,
        expectedDraftRevision: input.expectedRevision.draftRevision,
        module,
        moduleCode: "visual_and_rights",
        requestId: input.requestId,
      });
      return patchResult(updated, correction);
    }
    if (kind === "set_share_copy" && typeof input.command === "object" && input.command !== null) {
      if (!hasExactKeys(input.command, ["copyText", "kind"])) {
        return { kind: "invalid_command" };
      }
      const command = input.command as Record<string, unknown>;
      if (!validDisplayCopy(command.copyText, 500)) return { kind: "invalid_value" };
      const correction = await this.store.findById(input.correctionId);
      if (correction === null) return { kind: "not_found" };
      if (correction.status !== "open") return { kind: "invalid_state" };
      const draft = await this.content.readDraft(correction.draftId);
      if (
        draft === null ||
        draft.fortuneDate !== correction.fortuneDate ||
        draft.modules.copy_and_formula === null
      ) {
        return { kind: draft === null ? "not_found" : "invalid_state" };
      }
      const module = structuredClone(draft.modules.copy_and_formula);
      module.share = { ...module.share, copyText: command.copyText };
      const updated = await this.content.updateDraftModule({
        actorId: input.actorId,
        draftId: correction.draftId,
        expectedDraftRevision: input.expectedRevision.draftRevision,
        module,
        moduleCode: "copy_and_formula",
        requestId: input.requestId,
      });
      return patchResult(updated, correction);
    }
    if (
      kind === "set_outfit_formula_disclaimer" &&
      typeof input.command === "object" &&
      input.command !== null
    ) {
      if (!hasExactKeys(input.command, ["disclaimer", "formulaId", "kind"])) {
        return { kind: "invalid_command" };
      }
      const command = input.command as Record<string, unknown>;
      if (
        !validDisplayCopy(command.disclaimer, 300) ||
        typeof command.formulaId !== "string" ||
        command.formulaId.trim().length === 0
      ) {
        return { kind: "invalid_value" };
      }
      const correction = await this.store.findById(input.correctionId);
      if (correction === null) return { kind: "not_found" };
      if (correction.status !== "open") return { kind: "invalid_state" };
      const draft = await this.content.readDraft(correction.draftId);
      if (
        draft === null ||
        draft.fortuneDate !== correction.fortuneDate ||
        draft.modules.copy_and_formula === null
      ) {
        return { kind: draft === null ? "not_found" : "invalid_state" };
      }
      const module = structuredClone(draft.modules.copy_and_formula);
      const formulaIndex = module.outfitFormulas.findIndex(
        (formula) => formula.formulaId === command.formulaId,
      );
      const formula = module.outfitFormulas[formulaIndex];
      if (formulaIndex < 0 || formula === undefined) return { kind: "target_not_found" };
      module.outfitFormulas[formulaIndex] = {
        ...formula,
        disclaimer: command.disclaimer,
      };
      const updated = await this.content.updateDraftModule({
        actorId: input.actorId,
        draftId: correction.draftId,
        expectedDraftRevision: input.expectedRevision.draftRevision,
        module,
        moduleCode: "copy_and_formula",
        requestId: input.requestId,
      });
      return patchResult(updated, correction);
    }
    if (
      kind === "set_outfit_formula_title" &&
      typeof input.command === "object" &&
      input.command !== null
    ) {
      if (!hasExactKeys(input.command, ["formulaId", "kind", "title"])) {
        return { kind: "invalid_command" };
      }
      const command = input.command as Record<string, unknown>;
      if (
        !validDisplayCopy(command.title, 80) ||
        typeof command.formulaId !== "string" ||
        command.formulaId.trim().length === 0
      ) {
        return { kind: "invalid_value" };
      }
      const correction = await this.store.findById(input.correctionId);
      if (correction === null) return { kind: "not_found" };
      if (correction.status !== "open") return { kind: "invalid_state" };
      const draft = await this.content.readDraft(correction.draftId);
      if (
        draft === null ||
        draft.fortuneDate !== correction.fortuneDate ||
        draft.modules.copy_and_formula === null
      ) {
        return { kind: draft === null ? "not_found" : "invalid_state" };
      }
      const module = structuredClone(draft.modules.copy_and_formula);
      const formulaIndex = module.outfitFormulas.findIndex(
        (formula) => formula.formulaId === command.formulaId,
      );
      const formula = module.outfitFormulas[formulaIndex];
      if (formulaIndex < 0 || formula === undefined) return { kind: "target_not_found" };
      module.outfitFormulas[formulaIndex] = {
        ...formula,
        title: command.title,
      };
      const updated = await this.content.updateDraftModule({
        actorId: input.actorId,
        draftId: correction.draftId,
        expectedDraftRevision: input.expectedRevision.draftRevision,
        module,
        moduleCode: "copy_and_formula",
        requestId: input.requestId,
      });
      return patchResult(updated, correction);
    }
    if (
      kind === "set_basis_disclaimer" &&
      typeof input.command === "object" &&
      input.command !== null
    ) {
      if (!hasExactKeys(input.command, ["disclaimer", "kind"])) {
        return { kind: "invalid_command" };
      }
      const command = input.command as Record<string, unknown>;
      if (!validDisplayCopy(command.disclaimer, 300)) return { kind: "invalid_value" };
      const correction = await this.store.findById(input.correctionId);
      if (correction === null) return { kind: "not_found" };
      if (correction.status !== "open") return { kind: "invalid_state" };
      const draft = await this.content.readDraft(correction.draftId);
      if (
        draft === null ||
        draft.fortuneDate !== correction.fortuneDate ||
        draft.modules.copy_and_formula === null
      ) {
        return { kind: draft === null ? "not_found" : "invalid_state" };
      }
      const module = structuredClone(draft.modules.copy_and_formula);
      module.basis = { ...module.basis, disclaimer: command.disclaimer };
      const updated = await this.content.updateDraftModule({
        actorId: input.actorId,
        draftId: correction.draftId,
        expectedDraftRevision: input.expectedRevision.draftRevision,
        module,
        moduleCode: "copy_and_formula",
        requestId: input.requestId,
      });
      return patchResult(updated, correction);
    }
    if (
      kind === "set_balance_suggestion_description" &&
      typeof input.command === "object" &&
      input.command !== null
    ) {
      if (!hasExactKeys(input.command, ["description", "kind"])) {
        return { kind: "invalid_command" };
      }
      const command = input.command as Record<string, unknown>;
      if (!validDisplayCopy(command.description, 300)) return { kind: "invalid_value" };
      const correction = await this.store.findById(input.correctionId);
      if (correction === null) return { kind: "not_found" };
      if (correction.status !== "open") return { kind: "invalid_state" };
      const draft = await this.content.readDraft(correction.draftId);
      if (
        draft === null ||
        draft.fortuneDate !== correction.fortuneDate ||
        draft.modules.copy_and_formula === null
      ) {
        return { kind: draft === null ? "not_found" : "invalid_state" };
      }
      const module = structuredClone(draft.modules.copy_and_formula);
      module.balanceSuggestion = {
        ...module.balanceSuggestion,
        description: command.description,
      };
      const updated = await this.content.updateDraftModule({
        actorId: input.actorId,
        draftId: correction.draftId,
        expectedDraftRevision: input.expectedRevision.draftRevision,
        module,
        moduleCode: "copy_and_formula",
        requestId: input.requestId,
      });
      return patchResult(updated, correction);
    }
    if (
      kind !== "set_tier_explanation" ||
      typeof input.command !== "object" ||
      input.command === null
    ) {
      return { kind: "invalid_command" };
    }
    if (!hasExactKeys(input.command, ["explanation", "kind", "tierCode"])) {
      return { kind: "invalid_command" };
    }
    const command = input.command as Record<string, unknown>;
    if (!validDisplayCopy(command.explanation, 300) || typeof command.tierCode !== "string") {
      return { kind: "invalid_value" };
    }

    const correction = await this.store.findById(input.correctionId);
    if (correction === null) return { kind: "not_found" };
    if (correction.status !== "open") return { kind: "invalid_state" };
    const draft = await this.content.readDraft(correction.draftId);
    if (
      draft === null ||
      draft.fortuneDate !== correction.fortuneDate ||
      draft.modules.calendar_algorithm === null
    ) {
      return { kind: draft === null ? "not_found" : "invalid_state" };
    }
    const tierIndex = draft.modules.calendar_algorithm.tiers.findIndex(
      (tier) => tier.tierCode === command.tierCode,
    );
    if (tierIndex < 0) return { kind: "target_not_found" };
    const module = structuredClone(draft.modules.calendar_algorithm);
    const tier = module.tiers[tierIndex];
    if (tier === undefined) return { kind: "target_not_found" };
    module.tiers[tierIndex] = { ...tier, explanation: command.explanation };
    const updated = await this.content.updateDraftModule({
      actorId: input.actorId,
      draftId: correction.draftId,
      expectedDraftRevision: input.expectedRevision.draftRevision,
      module,
      moduleCode: "calendar_algorithm",
      requestId: input.requestId,
    });
    return patchResult(updated, correction);
  }
}

function patchResult(
  updated: UpdateDraftModuleResult,
  correction: StoredDayCorrection,
): PatchDayCorrectionResult {
  if (updated.kind === "revision_mismatch") {
    return {
      currentRevision: {
        correctionRevision: correction.correctionRevision,
        draftRevision: updated.currentRevision,
      },
      kind: "revision_mismatch",
    };
  }
  if (updated.kind !== "updated") return updated;
  return {
    correctionId: correction.correctionId,
    correctionRevision: correction.correctionRevision,
    draftRevision: updated.result.draftRevision,
    fortuneDate: correction.fortuneDate,
    kind: "updated",
    moduleCode: updated.result.moduleCode,
  };
}

function validFortuneDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function childIdempotencyKey(
  externalKey: string,
  correctionId: string,
  purpose: "publish" | "schedule" | "submit",
): string {
  const digest = createHash("sha256")
    .update(`${correctionId}\u0000${purpose}\u0000${externalKey}`)
    .digest("hex");
  return `correction.${purpose}.${digest}`;
}

function correctionApplyRequestHash(input: {
  readonly actorId: string;
  readonly applyMode: "immediate" | "scheduled";
  readonly correctionId: string;
  readonly expectedRevision: DayCorrectionWorkingRevision;
  readonly reason: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.actorId,
        input.correctionId,
        String(input.expectedRevision.correctionRevision),
        String(input.expectedRevision.draftRevision),
        input.applyMode,
        input.reason,
      ].join("\u0000"),
    )
    .digest("hex");
}

function validApplyInput(input: {
  readonly actorId: string;
  readonly expectedRevision: DayCorrectionWorkingRevision;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly requestId: string;
}): boolean {
  return (
    input.actorId.trim().length > 0 &&
    Number.isSafeInteger(input.expectedRevision.correctionRevision) &&
    input.expectedRevision.correctionRevision >= 1 &&
    Number.isSafeInteger(input.expectedRevision.draftRevision) &&
    input.expectedRevision.draftRevision >= 1 &&
    CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey) &&
    input.reason.trim().length > 0 &&
    Array.from(input.reason).length <= 2_000 &&
    input.requestId.length >= 8 &&
    input.requestId.length <= 128
  );
}
