import { createHash } from "node:crypto";

import type { components } from "@five/api-contract";
import { isAdminImageAsset, isDraftImageAssetResult } from "@five/api-contract/runtime";
import type { Pool, PoolClient } from "pg";

import { prepareImmediatePublicationModules } from "../content-lifecycle/immediate-publication-modules";
import type {
  StoredDraftImageAsset,
  StoredDraftImageSelectionSource,
} from "../daily-images/daily-image-asset.store";
import type {
  CopyReusableCorrectionImageResult,
  CorrectionImageLibrary,
  ReusableCorrectionImage,
} from "./day-correction-image.workflow";

type AdminImageAsset = components["schemas"]["AdminImageAsset"];
type DailyImageSlot = components["schemas"]["DailyImageSlot"];
type DraftImageAssetResult = components["schemas"]["DraftImageAssetResult"];
type DraftModules = components["schemas"]["DraftModules"];

interface SourceRow {
  asset_id: string;
  asset_json?: unknown;
  content_version: string;
  fortune_date: Date | string;
  snapshot: unknown;
}

interface TargetRow {
  correction_revision: number | string;
  correction_status: string;
  draft_id: string;
  draft_revision: number | string;
  fortune_date: Date | string;
  modules: unknown;
  submitted_content_version: string | null;
}

interface CandidateBindingRow {
  image_slot: DailyImageSlot | null;
  review_locked: boolean;
}

interface CandidateStateRow {
  asset_json: unknown;
  asset_id: string;
  fortune_date: Date | string;
  image_slot: DailyImageSlot | null;
  review_locked: boolean;
  selected_for_slot: boolean;
  selection_source: StoredDraftImageSelectionSource | null;
  storage_key: string;
  uploaded_at: Date | string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function modules(value: unknown): DraftModules | null {
  const candidate = record(value);
  return candidate !== null &&
    "calendar_algorithm" in candidate &&
    "copy_and_formula" in candidate &&
    "poster_consistency" in candidate &&
    "visual_and_rights" in candidate
    ? (candidate as unknown as DraftModules)
    : null;
}

function colorSignature(value: DraftModules, imageSlot: DailyImageSlot): readonly string[] | null {
  const tiers = value.calendar_algorithm?.tiers;
  if (tiers === undefined) return null;
  const colors = (tierCode: string) =>
    tiers.find((tier) => tier.tierCode === tierCode)?.colors.map((color) => color.colorCode) ?? [];
  const selected =
    imageSlot === "required_primary"
      ? colors("da_ji")
      : imageSlot === "required_alternative"
        ? [...colors("da_ji"), ...colors("ci_ji")]
        : [...colors("da_ji"), ...colors("ping")];
  const signature = [...new Set(selected)].sort();
  return signature.length === 0 ? null : signature;
}

function sameColors(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fortuneDate(value: Date | string): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function copyHash(input: Parameters<CorrectionImageLibrary["copyEligibleToDraft"]>[0]): string {
  return createHash("sha256")
    .update(
      [
        input.actorId,
        input.assetId,
        input.correctionId,
        String(input.expectedRevision.correctionRevision),
        String(input.expectedRevision.draftRevision),
        input.imageSlot,
        input.reason,
        input.sourceContentVersion,
      ].join("\u0000"),
    )
    .digest("hex");
}

function parseStoredCopy(value: unknown): {
  readonly correctionRevision: number;
  readonly result: DraftImageAssetResult;
} | null {
  const candidate = record(value);
  if (
    candidate === null ||
    !Number.isSafeInteger(candidate.correctionRevision) ||
    !isDraftImageAssetResult(candidate.result)
  ) {
    return null;
  }
  return {
    correctionRevision: candidate.correctionRevision as number,
    result: candidate.result,
  };
}

function previewUrl(assetId: string): string {
  return `/admin/api/v1/image-assets/${encodeURIComponent(assetId)}/preview`;
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

/**
 * The catalogue and copy command share the same safety predicate. Copy is a single PostgreSQL
 * transaction: source revalidation, immutable candidate binding, slot selection, visual cover
 * replacement, draft revision and provenance event either all commit or all roll back.
 */
export class PostgresCorrectionImageLibrary implements CorrectionImageLibrary {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async copyEligibleToDraft(
    input: Parameters<CorrectionImageLibrary["copyEligibleToDraft"]>[0],
  ): Promise<CopyReusableCorrectionImageResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `five:day-correction-image-idempotency:${input.correctionId}:${input.idempotencyKey}`,
      ]);
      const requestHash = copyHash(input);
      const prior = await client.query<{ request_hash: string; response_json: unknown }>(
        `SELECT request_hash, response_json
           FROM day_correction_image_idempotency
          WHERE operation = 'reuse'
            AND correction_id = $1
            AND idempotency_key = $2`,
        [input.correctionId, input.idempotencyKey],
      );
      const priorRow = prior.rows[0];
      if (priorRow !== undefined) {
        const response = parseStoredCopy(priorRow.response_json);
        await client.query("COMMIT");
        return priorRow.request_hash === requestHash && response !== null
          ? { kind: "existing", ...response }
          : { kind: "idempotency_conflict" };
      }

      const target = await client.query<TargetRow>(
        `SELECT
           correction.correction_revision,
           correction.status AS correction_status,
           correction.draft_id,
           correction.fortune_date::text,
           draft.draft_revision,
           draft.modules,
           draft.submitted_content_version
           FROM day_corrections AS correction
           JOIN content_drafts AS draft ON draft.draft_id = correction.draft_id
          WHERE correction.correction_id = $1
          FOR UPDATE OF correction, draft`,
        [input.correctionId],
      );
      const targetRow = target.rows[0];
      if (targetRow === undefined) {
        await client.query("COMMIT");
        return { kind: "not_found" };
      }
      if (targetRow.correction_status !== "open" || targetRow.submitted_content_version !== null) {
        await client.query("COMMIT");
        return { kind: "invalid_state" };
      }
      const currentRevision = {
        correctionRevision: Number(targetRow.correction_revision),
        draftRevision: Number(targetRow.draft_revision),
      };
      if (
        currentRevision.correctionRevision !== input.expectedRevision.correctionRevision ||
        currentRevision.draftRevision !== input.expectedRevision.draftRevision
      ) {
        await client.query("COMMIT");
        return { currentRevision, kind: "revision_mismatch" };
      }
      const targetModules = modules(targetRow.modules);
      const targetColors =
        targetModules === null ? null : colorSignature(targetModules, input.imageSlot);
      if (targetModules === null || targetColors === null) {
        await client.query("COMMIT");
        return { kind: "invalid_state" };
      }

      const source = await client.query<SourceRow>(
        `SELECT
           version.content_version,
           version.fortune_date::text,
           version.snapshot,
           asset.asset_id,
           asset.asset_json
           FROM content_versions AS version
           JOIN daily_image_sets AS image_set
             ON image_set.content_version = version.content_version
           CROSS JOIN LATERAL jsonb_array_elements(image_set.slots_json) AS slot
           JOIN daily_image_assets AS asset
             ON asset.asset_id = slot ->> 'servedCoverAssetId'
           LEFT JOIN image_asset_withdrawal_events AS withdrawal
             ON withdrawal.asset_id = asset.asset_id
          WHERE version.content_version = $1
            AND asset.asset_id = $2
            AND version.state IN ('published', 'superseded')
            AND slot ->> 'imageSlot' = $3
            AND slot ->> 'deliveryStatus' = 'active'
            AND slot ->> 'servedCoverAssetId' = slot ->> 'coverAssetId'
            AND withdrawal.asset_id IS NULL
            AND asset.asset_json ->> 'reviewStatus' = 'approved'
            AND asset.asset_json ->> 'rightsStatus' = 'cleared'
            AND jsonb_typeof(asset.asset_json -> 'fileUrl') = 'string'
            AND (
              (
                asset.asset_json ->> 'sourceType' = 'ai_generated'
                AND asset.asset_json ->> 'aiLabelStatus' = 'complete'
              )
              OR
              (
                asset.asset_json ->> 'sourceType' <> 'ai_generated'
                AND asset.asset_json ->> 'aiLabelStatus' = 'not_applicable'
              )
            )
          FOR UPDATE OF asset`,
        [input.sourceContentVersion, input.assetId, input.imageSlot],
      );
      const sourceRow = source.rows[0];
      const sourceModules = modules(sourceRow?.snapshot);
      const sourceColors =
        sourceModules === null ? null : colorSignature(sourceModules, input.imageSlot);
      const asset: AdminImageAsset | null =
        sourceRow !== undefined && isAdminImageAsset(sourceRow.asset_json)
          ? sourceRow.asset_json
          : null;
      if (
        sourceRow === undefined ||
        asset === null ||
        sourceColors === null ||
        !sameColors(targetColors, sourceColors)
      ) {
        await client.query("COMMIT");
        return { kind: "ineligible" };
      }

      const occurredAt = this.now().toISOString();
      await client.query(
        `INSERT INTO draft_image_candidates (
           draft_id, asset_id, fortune_date, image_slot, review_locked, uploaded_at
         ) VALUES ($1, $2, $3::date, $4, true, $5::timestamptz)
         ON CONFLICT (draft_id, asset_id) DO NOTHING`,
        [targetRow.draft_id, input.assetId, targetRow.fortune_date, input.imageSlot, occurredAt],
      );
      const binding = await client.query<CandidateBindingRow>(
        `SELECT image_slot, review_locked
           FROM draft_image_candidates
          WHERE draft_id = $1 AND asset_id = $2`,
        [targetRow.draft_id, input.assetId],
      );
      if (
        binding.rows[0]?.image_slot !== input.imageSlot ||
        binding.rows[0]?.review_locked !== true
      ) {
        await client.query("ROLLBACK");
        return { kind: "ineligible" };
      }

      await client.query(
        `INSERT INTO draft_image_slot_selections (
           draft_id, image_slot, asset_id, selection_revision, selection_source,
           source_job_id, actor_id, reason, request_id, selected_at
         ) VALUES ($1, $2, $3, 1, 'correction_library', NULL, $4, $5, $6, $7::timestamptz)
         ON CONFLICT (draft_id, image_slot) DO UPDATE
           SET asset_id = EXCLUDED.asset_id,
               selection_revision = draft_image_slot_selections.selection_revision + 1,
               selection_source = EXCLUDED.selection_source,
               source_job_id = NULL,
               actor_id = EXCLUDED.actor_id,
               reason = EXCLUDED.reason,
               request_id = EXCLUDED.request_id,
               selected_at = EXCLUDED.selected_at`,
        [
          targetRow.draft_id,
          input.imageSlot,
          input.assetId,
          input.actorId,
          input.reason,
          input.requestId,
          occurredAt,
        ],
      );

      let nextModules = structuredClone(targetModules);
      if (nextModules.visual_and_rights === null) {
        const candidateRows = await client.query<CandidateStateRow>(
          `SELECT asset.asset_json,
                  asset.asset_id,
                  candidate.fortune_date::text,
                  candidate.image_slot,
                  candidate.review_locked,
                  asset.storage_key,
                  asset.uploaded_at,
                  COALESCE(selection.asset_id = candidate.asset_id, false) AS selected_for_slot,
                  CASE WHEN selection.asset_id = candidate.asset_id
                    THEN selection.selection_source ELSE NULL END AS selection_source
             FROM draft_image_candidates AS candidate
             JOIN daily_image_assets AS asset ON asset.asset_id = candidate.asset_id
             LEFT JOIN draft_image_slot_selections AS selection
               ON selection.draft_id = candidate.draft_id
              AND selection.image_slot = candidate.image_slot
            WHERE candidate.draft_id = $1
            ORDER BY candidate.image_slot, candidate.asset_id`,
          [targetRow.draft_id],
        );
        const selectedCandidates: StoredDraftImageAsset[] = candidateRows.rows.flatMap((row) => {
          if (!isAdminImageAsset(row.asset_json)) return [];
          return [
            {
              asset: row.asset_json,
              draftId: targetRow.draft_id,
              fortuneDate: fortuneDate(row.fortune_date),
              imageSlot: row.image_slot,
              reviewLocked: row.review_locked,
              selectedForSlot: row.selected_for_slot,
              selectionSource: row.selection_source,
              storageKey: row.storage_key,
              uploadedAt:
                row.uploaded_at instanceof Date
                  ? row.uploaded_at.toISOString()
                  : new Date(row.uploaded_at).toISOString(),
            },
          ];
        });
        nextModules =
          prepareImmediatePublicationModules(nextModules, selectedCandidates) ?? nextModules;
      } else {
        const lookIndex = nextModules.visual_and_rights.looks.findIndex(
          (look) => look.imageSlot === input.imageSlot,
        );
        const nextLook = nextModules.visual_and_rights.looks[lookIndex];
        if (lookIndex < 0 || nextLook === undefined) {
          await client.query("ROLLBACK");
          return { kind: "invalid_state" };
        }
        nextModules.visual_and_rights.assets = [
          ...new Map(
            [...nextModules.visual_and_rights.assets, structuredClone(asset)].map((item) => [
              item.assetId,
              item,
            ]),
          ).values(),
        ];
        nextModules.visual_and_rights.looks[lookIndex] = {
          ...nextLook,
          coverAssetId: input.assetId,
        };
      }
      const nextDraftRevision = currentRevision.draftRevision + 1;
      const updated = await client.query(
        `UPDATE content_drafts
            SET draft_revision = $1,
                modules = $2::jsonb,
                updated_at = $3::timestamptz
          WHERE draft_id = $4
            AND draft_revision = $5
            AND submitted_content_version IS NULL`,
        [
          nextDraftRevision,
          JSON.stringify(nextModules),
          occurredAt,
          targetRow.draft_id,
          currentRevision.draftRevision,
        ],
      );
      if (updated.rowCount !== 1) throw new Error("Correction library copy lost its draft lock");

      const result: DraftImageAssetResult = {
        asset,
        draftId: targetRow.draft_id,
        draftRevision: nextDraftRevision,
        fortuneDate: fortuneDate(targetRow.fortune_date),
        imageSlot: input.imageSlot,
        previewUrl: previewUrl(input.assetId),
        reviewLocked: true,
        selectedForSlot: true,
      };
      const response = {
        correctionRevision: currentRevision.correctionRevision,
        result,
      };
      await client.query(
        `INSERT INTO day_correction_image_reuse_events (
           reuse_event_id, correction_id, draft_id, fortune_date, asset_id,
           source_content_version, image_slot, actor_id, reason, request_id, occurred_at
         ) VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11::timestamptz)`,
        [
          `reuse-${requestHash}`,
          input.correctionId,
          targetRow.draft_id,
          fortuneDate(targetRow.fortune_date),
          input.assetId,
          input.sourceContentVersion,
          input.imageSlot,
          input.actorId,
          input.reason,
          input.requestId,
          occurredAt,
        ],
      );
      await client.query(
        `INSERT INTO day_correction_image_idempotency (
           operation, correction_id, idempotency_key, request_hash, response_json, created_at
         ) VALUES ('reuse', $1, $2, $3, $4::jsonb, $5::timestamptz)`,
        [
          input.correctionId,
          input.idempotencyKey,
          requestHash,
          JSON.stringify(response),
          occurredAt,
        ],
      );
      await client.query("COMMIT");
      return { kind: "copied", ...response };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listEligible(input: {
    readonly draftId: string;
    readonly imageSlot: DailyImageSlot;
    readonly limit: number;
  }): Promise<readonly ReusableCorrectionImage[]> {
    const target = await this.pool.query<{ modules: unknown }>(
      `SELECT modules
         FROM content_drafts
        WHERE draft_id = $1
          AND submitted_content_version IS NULL`,
      [input.draftId],
    );
    const targetModules = modules(target.rows[0]?.modules);
    if (targetModules === null) return [];
    const targetColors = colorSignature(targetModules, input.imageSlot);
    if (targetColors === null) return [];

    const candidates = await this.pool.query<SourceRow>(
      `SELECT
         version.content_version,
         version.fortune_date::text,
         version.snapshot,
         asset.asset_id
         FROM content_versions AS version
         JOIN daily_image_sets AS image_set
           ON image_set.content_version = version.content_version
         CROSS JOIN LATERAL jsonb_array_elements(image_set.slots_json) AS slot
         JOIN daily_image_assets AS asset
           ON asset.asset_id = slot ->> 'servedCoverAssetId'
         LEFT JOIN image_asset_withdrawal_events AS withdrawal
           ON withdrawal.asset_id = asset.asset_id
        WHERE version.state IN ('published', 'superseded')
          AND slot ->> 'imageSlot' = $1
          AND slot ->> 'deliveryStatus' = 'active'
          AND slot ->> 'servedCoverAssetId' = slot ->> 'coverAssetId'
          AND withdrawal.asset_id IS NULL
          AND asset.asset_json ->> 'reviewStatus' = 'approved'
          AND asset.asset_json ->> 'rightsStatus' = 'cleared'
          AND jsonb_typeof(asset.asset_json -> 'fileUrl') = 'string'
          AND (
            (
              asset.asset_json ->> 'sourceType' = 'ai_generated'
              AND asset.asset_json ->> 'aiLabelStatus' = 'complete'
            )
            OR
            (
              asset.asset_json ->> 'sourceType' <> 'ai_generated'
              AND asset.asset_json ->> 'aiLabelStatus' = 'not_applicable'
            )
          )
        ORDER BY version.fortune_date DESC, version.created_at DESC, asset.asset_id
        LIMIT $2`,
      [input.imageSlot, Math.min(input.limit * 10, 500)],
    );

    const items: ReusableCorrectionImage[] = [];
    for (const row of candidates.rows) {
      const sourceModules = modules(row.snapshot);
      if (sourceModules === null) continue;
      const sourceColors = colorSignature(sourceModules, input.imageSlot);
      if (sourceColors === null || !sameColors(targetColors, sourceColors)) continue;
      items.push({
        assetId: row.asset_id,
        colorCodes: sourceColors,
        imageSlot: input.imageSlot,
        previewUrl: previewUrl(row.asset_id),
        sourceContentVersion: row.content_version,
        sourceFortuneDate: fortuneDate(row.fortune_date),
      });
      if (items.length >= input.limit) break;
    }
    return items;
  }
}
