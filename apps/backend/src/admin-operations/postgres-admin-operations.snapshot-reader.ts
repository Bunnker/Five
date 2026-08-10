import type { Pool, PoolClient } from "pg";

import type {
  ContentState,
  ContentVersionListReadView,
  ContentVersionReadView,
  DraftImageAssetReadView,
  DraftModules,
  LifecycleProjection,
  PreflightCheck,
  StoredContentVersion,
} from "../content-lifecycle/content-lifecycle.store";
import type { DailyContentProduction } from "../content-production/content-production.service";
import { PostgresContentProductionStore } from "../content-production/postgres-content-production.store";
import type {
  StoredDailyImageSet,
  StoredDraftImageAsset,
} from "../daily-images/daily-image-asset.store";
import { projectDailyImageSet } from "../daily-images/image-delivery-projection";
import type {
  ContentReleaseProjection,
  StoredContentReleaseEvent,
} from "../content-release/content-release.store";

interface ProjectionRow {
  readonly active_content_version: string | null;
  readonly fortune_date: string;
  readonly lifecycle_revision: number | string;
  readonly schedule_slot_revision: number | string;
  readonly scheduled_content_version: string | null;
  readonly scheduled_effective_from: Date | string | null;
}

interface VersionRow {
  readonly content_version: string;
  readonly created_at: Date | string;
  readonly draft_id: string;
  readonly effective_from: Date | string | null;
  readonly effective_to: Date | string | null;
  readonly fortune_date: string;
  readonly preflight_checks: unknown;
  readonly snapshot: unknown;
  readonly state: Exclude<ContentState, "draft">;
}

interface ReleaseEventRow {
  readonly action: StoredContentReleaseEvent["action"];
  readonly actor_id: string;
  readonly after_active_content_version: string | null;
  readonly after_schedule_slot_revision: number | string;
  readonly before_active_content_version: string | null;
  readonly before_schedule_slot_revision: number | string;
  readonly content_version: string;
  readonly fortune_date: string;
  readonly idempotency_key: string | null;
  readonly occurred_at: Date | string;
  readonly reason: string;
  readonly release_event_id: string;
  readonly request_id: string;
  readonly schedule_task_id: string | null;
  readonly transitions_json: unknown;
}

interface DraftRow {
  readonly created_at: Date | string;
  readonly draft_id: string;
  readonly draft_revision: number | string;
  readonly fortune_date: string;
  readonly modules: unknown;
  readonly updated_at: Date | string;
}

interface DraftImageAssetRow {
  readonly asset_id: string;
  readonly asset_json: unknown;
  readonly draft_id: string;
  readonly fortune_date: string;
  readonly image_slot: StoredDraftImageAsset["imageSlot"];
  readonly review_locked: boolean;
  readonly selected_for_slot: boolean;
  readonly selection_source: StoredDraftImageAsset["selectionSource"];
  readonly storage_key: string;
  readonly uploaded_at: Date | string;
}

interface DailyImageSetRow {
  readonly assets_json: unknown;
  readonly content_version: string;
  readonly fortune_date: string;
  readonly lifecycle_revision: number | string;
  readonly slots_json: unknown;
}

interface ImageWithdrawalRow {
  readonly asset_id: string;
  readonly audit_event_id: string;
  readonly reason: string;
  readonly withdrawal_event_id: string;
  readonly withdrawn_at: Date | string;
}

export interface AdminOperationsPostgresSnapshot {
  readonly draftViewsById: ReadonlyMap<string, DraftImageAssetReadView>;
  readonly productionsByDate: ReadonlyMap<string, DailyContentProduction>;
  readonly releaseEventsByDate: ReadonlyMap<string, readonly StoredContentReleaseEvent[]>;
  readonly releaseProjectionsByDate: ReadonlyMap<string, ContentReleaseProjection>;
  readonly versionListsByDate: ReadonlyMap<string, ContentVersionListReadView>;
  readonly versionViewsById: ReadonlyMap<string, ContentVersionReadView>;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function mapVersion(row: VersionRow): StoredContentVersion {
  return {
    contentVersion: row.content_version,
    createdAt: asIso(row.created_at),
    draftId: row.draft_id,
    effectiveFrom: nullableIso(row.effective_from),
    effectiveTo: nullableIso(row.effective_to),
    fortuneDate: row.fortune_date,
    preflightChecks: structuredClone(row.preflight_checks as PreflightCheck[]),
    snapshot: structuredClone(row.snapshot as DraftModules),
    state: row.state,
  };
}

function lifecycleProjection(row: ProjectionRow): LifecycleProjection {
  return {
    activeContentVersion: row.active_content_version,
    fortuneDate: row.fortune_date,
    revision: Number(row.lifecycle_revision),
  };
}

function releaseProjection(row: ProjectionRow): ContentReleaseProjection {
  return {
    activeContentVersion: row.active_content_version,
    fortuneDate: row.fortune_date,
    lifecycleRevision: Number(row.lifecycle_revision),
    scheduledContentVersion: row.scheduled_content_version,
    scheduledEffectiveFrom: nullableIso(row.scheduled_effective_from),
    scheduleSlotRevision: Number(row.schedule_slot_revision),
  };
}

function mapReleaseEvent(row: ReleaseEventRow): StoredContentReleaseEvent {
  return {
    action: row.action,
    actorId: row.actor_id,
    afterActiveContentVersion: row.after_active_content_version,
    afterScheduleSlotRevision: Number(row.after_schedule_slot_revision),
    beforeActiveContentVersion: row.before_active_content_version,
    beforeScheduleSlotRevision: Number(row.before_schedule_slot_revision),
    contentVersion: row.content_version,
    fortuneDate: row.fortune_date,
    idempotencyKey: row.idempotency_key,
    occurredAt: asIso(row.occurred_at),
    reason: row.reason,
    releaseEventId: row.release_event_id,
    requestId: row.request_id,
    scheduleTaskId: row.schedule_task_id,
    transitions: structuredClone(row.transitions_json as StoredContentReleaseEvent["transitions"]),
  };
}

function mapDraftImageAsset(row: DraftImageAssetRow): StoredDraftImageAsset {
  return {
    asset: structuredClone(row.asset_json as StoredDraftImageAsset["asset"]),
    draftId: row.draft_id,
    fortuneDate: row.fortune_date,
    imageSlot: row.image_slot,
    reviewLocked: row.review_locked,
    selectedForSlot: row.selected_for_slot,
    selectionSource: row.selection_source,
    storageKey: row.storage_key,
    uploadedAt: asIso(row.uploaded_at),
  };
}

function mapDailyImageSet(
  row: DailyImageSetRow,
  withdrawals: readonly ImageWithdrawalRow[],
): StoredDailyImageSet {
  const assets = structuredClone(row.assets_json as StoredDailyImageSet["assets"]);
  const assetIds = new Set(assets.map((asset) => asset.assetId));
  return projectDailyImageSet(
    {
      assets,
      contentVersion: row.content_version,
      fortuneDate: row.fortune_date,
      lifecycleRevision: Number(row.lifecycle_revision),
      slots: structuredClone(row.slots_json as StoredDailyImageSet["slots"]),
      withdrawalEvents: [],
    },
    withdrawals
      .filter((withdrawal) => assetIds.has(withdrawal.asset_id))
      .map((withdrawal) => ({
        assetId: withdrawal.asset_id,
        auditEventId: withdrawal.audit_event_id,
        reason: withdrawal.reason,
        withdrawalEventId: withdrawal.withdrawal_event_id,
        withdrawnAt: asIso(withdrawal.withdrawn_at),
      })),
  );
}

function appendToMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

export async function readAdminOperationsPostgresSnapshot(
  client: PoolClient,
  fortuneDates: readonly string[],
): Promise<AdminOperationsPostgresSnapshot> {
  const productionStore = new PostgresContentProductionStore(client as unknown as Pool);
  // A single pg client serializes queries. Keep the flow explicit so this remains
  // compatible with pg 9 while every batch still observes the outer RR snapshot.
  const productions = await productionStore.listProductions(fortuneDates);
  const projectionResult = await client.query<ProjectionRow>(
    `SELECT
           fortune_date::text,
           lifecycle_revision,
           active_content_version,
           schedule_slot_revision,
           scheduled_content_version,
           scheduled_effective_from
         FROM content_lifecycle_days
         WHERE fortune_date = ANY($1::date[])
         ORDER BY fortune_date`,
    [[...fortuneDates]],
  );
  const versionResult = await client.query<VersionRow>(
    `SELECT
           content_version,
           draft_id,
           fortune_date::text,
           state,
           snapshot,
           preflight_checks,
           created_at,
           effective_from,
           effective_to
         FROM content_versions
         WHERE fortune_date = ANY($1::date[])
         ORDER BY fortune_date, created_at DESC, content_version DESC`,
    [[...fortuneDates]],
  );
  const releaseEventResult = await client.query<ReleaseEventRow>(
    `SELECT DISTINCT ON (fortune_date)
           release_event_id,
           action,
           occurred_at,
           request_id,
           fortune_date::text,
           content_version,
           actor_id,
           reason,
           idempotency_key,
           before_active_content_version,
           after_active_content_version,
           before_schedule_slot_revision,
           after_schedule_slot_revision,
           transitions_json,
           schedule_task_id
         FROM content_release_events
         WHERE fortune_date = ANY($1::date[])
         ORDER BY fortune_date, occurred_at DESC, release_event_id DESC`,
    [[...fortuneDates]],
  );
  const wantedVersionIds = new Set<string>();
  for (const row of projectionResult.rows) {
    if (row.active_content_version !== null) wantedVersionIds.add(row.active_content_version);
    if (row.scheduled_content_version !== null) wantedVersionIds.add(row.scheduled_content_version);
  }
  const approvedDates = new Set<string>();
  for (const row of versionResult.rows) {
    if (row.state !== "approved" || approvedDates.has(row.fortune_date)) continue;
    approvedDates.add(row.fortune_date);
    wantedVersionIds.add(row.content_version);
  }
  const imageSetResult = await client.query<DailyImageSetRow>(
    `SELECT
           content_version,
           fortune_date::text,
           lifecycle_revision,
           assets_json,
           slots_json
         FROM daily_image_sets
         WHERE content_version = ANY($1::varchar[])
         ORDER BY fortune_date, content_version`,
    [[...wantedVersionIds]],
  );

  const draftIds = [...new Set(productions.map((production) => production.draftId))];
  const imageSetAssetIds = [
    ...new Set(
      imageSetResult.rows.flatMap((row) =>
        (row.assets_json as StoredDailyImageSet["assets"]).map((asset) => asset.assetId),
      ),
    ),
  ];
  const draftResult = await client.query<DraftRow>(
    `SELECT
         draft_id,
         fortune_date::text,
         draft_revision,
         modules,
         created_at,
         updated_at
       FROM content_drafts
       WHERE draft_id = ANY($1::varchar[])
         AND submitted_content_version IS NULL
       ORDER BY updated_at, draft_id`,
    [draftIds],
  );
  const candidateResult = await client.query<DraftImageAssetRow>(
    `SELECT
         candidate.asset_id,
         candidate.draft_id,
         candidate.fortune_date::text,
         candidate.image_slot,
         candidate.review_locked,
         EXISTS (
           SELECT 1
           FROM draft_image_slot_selections AS selection
           WHERE selection.draft_id = candidate.draft_id
             AND selection.image_slot = candidate.image_slot
             AND selection.asset_id = candidate.asset_id
         ) AS selected_for_slot,
         (
           SELECT selection.selection_source
           FROM draft_image_slot_selections AS selection
           WHERE selection.draft_id = candidate.draft_id
             AND selection.image_slot = candidate.image_slot
             AND selection.asset_id = candidate.asset_id
         ) AS selection_source,
         asset.storage_key,
         asset.asset_json,
         candidate.uploaded_at
       FROM draft_image_candidates AS candidate
       JOIN daily_image_assets AS asset USING (asset_id)
       WHERE candidate.draft_id = ANY($1::varchar[])
       ORDER BY candidate.draft_id, candidate.uploaded_at, candidate.asset_id`,
    [draftIds],
  );
  const assetIds = [
    ...new Set([...imageSetAssetIds, ...candidateResult.rows.map((row) => row.asset_id)]),
  ];
  const withdrawalResult = await client.query<ImageWithdrawalRow>(
    `SELECT
         withdrawal_event_id,
         asset_id,
         reason,
         withdrawn_at,
         audit_event_id
       FROM image_asset_withdrawal_events
       WHERE asset_id = ANY($1::varchar[])
       ORDER BY withdrawn_at, withdrawal_event_id`,
    [assetIds],
  );

  const projectionsByDate = new Map(projectionResult.rows.map((row) => [row.fortune_date, row]));
  const versionsByDate = new Map<string, StoredContentVersion[]>();
  const versionsById = new Map<string, StoredContentVersion>();
  for (const row of versionResult.rows) {
    const version = mapVersion(row);
    appendToMap(versionsByDate, version.fortuneDate, version);
    versionsById.set(version.contentVersion, version);
  }

  const releaseEventsByDate = new Map<string, StoredContentReleaseEvent[]>();
  for (const row of releaseEventResult.rows) {
    appendToMap(releaseEventsByDate, row.fortune_date, mapReleaseEvent(row));
  }

  const globallyWithdrawnAssetIds = new Set(
    withdrawalResult.rows.map((withdrawal) => withdrawal.asset_id),
  );
  const candidatesByDraftId = new Map<string, StoredDraftImageAsset[]>();
  for (const row of candidateResult.rows) {
    if (globallyWithdrawnAssetIds.has(row.asset_id)) continue;
    appendToMap(candidatesByDraftId, row.draft_id, mapDraftImageAsset(row));
  }
  const draftViewsById = new Map<string, DraftImageAssetReadView>();
  for (const row of draftResult.rows) {
    const storedModules = structuredClone(row.modules as DraftModules);
    const modules =
      storedModules.visual_and_rights?.assets.some((asset) =>
        globallyWithdrawnAssetIds.has(asset.assetId),
      ) === true
        ? { ...storedModules, poster_consistency: null, visual_and_rights: null }
        : storedModules;
    draftViewsById.set(row.draft_id, {
      candidates: candidatesByDraftId.get(row.draft_id) ?? [],
      draft: {
        createdAt: asIso(row.created_at),
        draftId: row.draft_id,
        draftRevision: Number(row.draft_revision),
        fortuneDate: row.fortune_date,
        modules,
        state: "draft",
        updatedAt: asIso(row.updated_at),
      },
    });
  }

  const imageSetsByVersion = new Map(
    imageSetResult.rows.map((row) => [
      row.content_version,
      mapDailyImageSet(row, withdrawalResult.rows),
    ]),
  );
  const releaseProjectionsByDate = new Map(
    projectionResult.rows.map((row) => [row.fortune_date, releaseProjection(row)]),
  );
  const versionListsByDate = new Map<string, ContentVersionListReadView>();
  for (const fortuneDate of fortuneDates) {
    const projectionRow = projectionsByDate.get(fortuneDate);
    const versions = versionsByDate.get(fortuneDate) ?? [];
    versionListsByDate.set(fortuneDate, {
      projection: projectionRow === undefined ? null : lifecycleProjection(projectionRow),
      versions,
    });
    const approved = versions.find((version) => version.state === "approved");
    for (const contentVersion of [
      projectionRow?.active_content_version,
      projectionRow?.scheduled_content_version,
      approved?.contentVersion,
    ]) {
      if (contentVersion !== undefined && contentVersion !== null) {
        wantedVersionIds.add(contentVersion);
      }
    }
  }

  const versionViewsById = new Map<string, ContentVersionReadView>();
  for (const contentVersion of wantedVersionIds) {
    const version = versionsById.get(contentVersion);
    if (version === undefined) continue;
    const projectionRow = projectionsByDate.get(version.fortuneDate);
    if (projectionRow === undefined) {
      throw new Error(`Lifecycle projection missing for ${contentVersion}`);
    }
    versionViewsById.set(contentVersion, {
      evidence: [],
      imageSet: imageSetsByVersion.get(contentVersion) ?? null,
      projection: lifecycleProjection(projectionRow),
      version,
    });
  }

  return {
    draftViewsById,
    productionsByDate: new Map(
      productions.map((production) => [production.fortuneDate, production]),
    ),
    releaseEventsByDate,
    releaseProjectionsByDate,
    versionListsByDate,
    versionViewsById,
  };
}
