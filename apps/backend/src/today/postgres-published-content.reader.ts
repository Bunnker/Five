import type { components } from "@five/api-contract";
import type { Pool, PoolClient } from "pg";

import type {
  ContentState,
  DraftModules,
  PreflightCheck,
  StoredContentVersion,
} from "../content-lifecycle/content-lifecycle.store";
import type { ContentReleaseEventAction } from "../content-release/content-release.store";
import type { StoredDailyImageSet } from "../daily-images/daily-image-asset.store";
import { projectDailyImageSet } from "../daily-images/image-delivery-projection";
import type {
  DailyContentResolutionReader,
  ResolveDailyContentInput,
  ResolvedDailyContent,
} from "./daily-content-resolution.reader";
import { projectPublishedDailyContent } from "./published-content-projector";
import type { PublishedContentReader } from "./today-content.service";

interface ActiveVersionRow {
  content_version: string;
  created_at: Date | string;
  draft_id: string;
  effective_from: Date | string | null;
  effective_to: Date | string | null;
  fortune_date: string;
  preflight_checks: unknown;
  snapshot: unknown;
  state: ContentState;
}

interface DailyImageSetRow {
  assets_json: unknown;
  content_version: string;
  fortune_date: string;
  lifecycle_revision: number | string;
  slots_json: unknown;
}

interface WithdrawalRow {
  asset_id: string;
  audit_event_id: string;
  reason: string;
  withdrawal_event_id: string;
  withdrawn_at: Date | string;
}

interface ExpectedVersionRow {
  state: ContentState;
}

interface ReleaseEventRow {
  action: ContentReleaseEventAction;
  after_active_content_version: string | null;
}

type DailyContent = components["schemas"]["DailyContent"];
type WithdrawalEvent = components["schemas"]["ImageAssetWithdrawalEvent"];
type VersionResolutionReason = components["schemas"]["VersionResolution"]["reason"];

interface PublishedSnapshot {
  content: DailyContent;
  reason: VersionResolutionReason;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function storedVersion(row: ActiveVersionRow): StoredContentVersion {
  return {
    contentVersion: row.content_version,
    createdAt: iso(row.created_at),
    draftId: row.draft_id,
    effectiveFrom: nullableIso(row.effective_from),
    effectiveTo: nullableIso(row.effective_to),
    fortuneDate: row.fortune_date,
    preflightChecks: structuredClone(row.preflight_checks as PreflightCheck[]),
    snapshot: structuredClone(row.snapshot as DraftModules),
    state: row.state as Exclude<ContentState, "draft">,
  };
}

function storedImageSet(row: DailyImageSetRow): StoredDailyImageSet {
  return {
    assets: structuredClone(row.assets_json as StoredDailyImageSet["assets"]),
    contentVersion: row.content_version,
    fortuneDate: row.fortune_date,
    lifecycleRevision: Number(row.lifecycle_revision),
    slots: structuredClone(row.slots_json as StoredDailyImageSet["slots"]),
    withdrawalEvents: [],
  };
}

function withdrawal(row: WithdrawalRow): WithdrawalEvent {
  return {
    assetId: row.asset_id,
    auditEventId: row.audit_event_id,
    reason: row.reason,
    withdrawalEventId: row.withdrawal_event_id,
    withdrawnAt: iso(row.withdrawn_at),
  };
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

async function resolveVersionReason(
  client: PoolClient,
  fortuneDate: string,
  expectedContentVersion: string | null,
  activeContentVersion: string,
): Promise<VersionResolutionReason> {
  if (expectedContentVersion === null || expectedContentVersion === activeContentVersion) {
    return "current";
  }

  const expectedVersion = await client.query<ExpectedVersionRow>(
    `SELECT expected_version.state
       FROM content_versions AS expected_version
      WHERE expected_version.content_version = $1
        AND expected_version.fortune_date = $2::date
      LIMIT 1`,
    [expectedContentVersion, fortuneDate],
  );
  if (expectedVersion.rows[0]?.state === "withdrawn") {
    return "withdrawn";
  }

  const latestActivation = await client.query<ReleaseEventRow>(
    `SELECT action,
            after_active_content_version
       FROM content_release_events
      WHERE fortune_date = $1::date
        AND after_active_content_version = $2
        AND action IN ('publish', 'scheduled_publish', 'withdraw', 'rollback')
      ORDER BY occurred_at DESC, release_event_id DESC
      LIMIT 1`,
    [fortuneDate, activeContentVersion],
  );
  const activation = latestActivation.rows[0];
  if (
    activation?.action === "rollback" ||
    (activation?.action === "withdraw" &&
      activation.after_active_content_version === activeContentVersion)
  ) {
    return "rolled_back";
  }

  return "replaced";
}

export class PostgresPublishedContentReader
  implements PublishedContentReader, DailyContentResolutionReader
{
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async findActiveByFortuneDate(fortuneDate: string): Promise<DailyContent | null> {
    const snapshot = await this.readPublishedSnapshot(fortuneDate, null);
    return snapshot?.content ?? null;
  }

  async resolve({
    expectedContentVersion,
    fortuneDate,
  }: ResolveDailyContentInput): Promise<ResolvedDailyContent> {
    const snapshot = await this.readPublishedSnapshot(fortuneDate, expectedContentVersion);
    if (snapshot === null) {
      return { kind: "missing" };
    }

    return {
      content: snapshot.content,
      kind: "ready",
      reason: snapshot.reason,
    };
  }

  private async readPublishedSnapshot(
    fortuneDate: string,
    expectedContentVersion: string | null,
  ): Promise<PublishedSnapshot | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const active = await client.query<ActiveVersionRow>(
        `SELECT version.content_version,
                version.created_at,
                version.draft_id,
                version.effective_from,
                version.effective_to,
                version.fortune_date::text,
                version.preflight_checks,
                version.snapshot,
                version.state
           FROM content_lifecycle_days AS day
           JOIN content_versions AS version
             ON version.content_version = day.active_content_version
            AND version.fortune_date = day.fortune_date
          WHERE day.fortune_date = $1::date
            AND version.state = 'published'
          LIMIT 1`,
        [fortuneDate],
      );
      const versionRow = active.rows[0];
      let content: DailyContent | null = null;
      if (versionRow !== undefined) {
        const imageSetResult = await client.query<DailyImageSetRow>(
          `SELECT assets_json,
                  content_version,
                  fortune_date::text,
                  lifecycle_revision,
                  slots_json
             FROM daily_image_sets
            WHERE content_version = $1
              AND fortune_date = $2::date
            LIMIT 1`,
          [versionRow.content_version, fortuneDate],
        );
        const imageSetRow = imageSetResult.rows[0];
        if (imageSetRow !== undefined) {
          const imageSet = storedImageSet(imageSetRow);
          const assetIds = imageSet.assets.map((asset) => asset.assetId);
          const withdrawalRows =
            assetIds.length === 0
              ? []
              : (
                  await client.query<WithdrawalRow>(
                    `SELECT withdrawal_event_id,
                            asset_id,
                            reason,
                            withdrawn_at,
                            audit_event_id
                       FROM image_asset_withdrawal_events
                      WHERE asset_id = ANY($1::varchar[])
                      ORDER BY withdrawn_at, withdrawal_event_id`,
                    [assetIds],
                  )
                ).rows;
          const currentImageSet = projectDailyImageSet(imageSet, withdrawalRows.map(withdrawal));
          content = projectPublishedDailyContent(storedVersion(versionRow), currentImageSet);
        }
      }
      const snapshot =
        content === null
          ? null
          : {
              content,
              reason: await resolveVersionReason(
                client,
                fortuneDate,
                expectedContentVersion,
                content.versions.contentVersion,
              ),
            };
      await client.query("COMMIT");
      return snapshot;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
