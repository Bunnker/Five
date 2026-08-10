import type { Pool } from "pg";

import type {
  DraftImageAssetReadView,
  ContentDraftSummary,
  ContentVersionListReadView,
  ContentVersionReadView,
} from "../content-lifecycle/content-lifecycle.store";
import type { DailyContentProduction } from "../content-production/content-production.service";
import type {
  ContentReleaseProjection,
  StoredContentReleaseEvent,
} from "../content-release/content-release.store";
import { projectDailyContentSnapshot } from "../today/published-content-projector";
import { AdminOperationsDateResolver } from "./admin-operations-date.resolver";
import type {
  AdminOperationsStoredDay,
  AdminOperationsStoredProduction,
  AdminOperationsStoredVersion,
  AdminOperationsStore,
} from "./admin-operations.service";
import { readAdminOperationsPostgresSnapshot } from "./postgres-admin-operations.snapshot-reader";

interface LifecycleReader {
  findDraft(draftId: string): Promise<unknown>;
  listDrafts(fortuneDate: string | null): Promise<ContentDraftSummary[]>;
  readDraftImageAssetView(draftId: string): Promise<DraftImageAssetReadView | null>;
  readVersionListView(fortuneDate: string): Promise<ContentVersionListReadView>;
  readVersionView(contentVersion: string): Promise<ContentVersionReadView | null>;
}

interface ReleaseReader {
  listReleaseEvents(fortuneDate: string): Promise<StoredContentReleaseEvent[]>;
  readProjection(fortuneDate: string): Promise<ContentReleaseProjection | null>;
}

interface ProductionReader {
  listProductions(): Promise<OperationsProduction[]>;
}

interface OperationsImageSlot {
  readonly deliveryReady: boolean;
  readonly imageSlot: "optional" | "required_alternative" | "required_primary";
  readonly lastError: string | null;
  readonly status: "failed" | "not_requested" | "pending" | "ready";
}

type OperationsProduction = DailyContentProduction & {
  readonly imageSlots?: readonly OperationsImageSlot[];
};

interface AdminOperationsReaders {
  readonly lifecycle: LifecycleReader;
  readonly production: ProductionReader;
  readonly release: ReleaseReader;
}

interface ImageJobRow {
  readonly fortune_date: Date | string;
  readonly image_slot: "optional" | "required_alternative" | "required_primary";
  readonly status: "claimed" | "completed" | "failed" | "queued" | "retryable";
}

function fortuneDateValue(value: Date | string, dateResolver: AdminOperationsDateResolver): string {
  if (typeof value === "string") return value.slice(0, 10);
  return dateResolver.formatShanghaiDate(value);
}

function jobStatus(status: ImageJobRow["status"]): "failed" | "pending" | "ready" {
  if (status === "completed") return "ready";
  return status === "failed" ? "failed" : "pending";
}

function optionalJobStatus(
  jobs: readonly ImageJobRow[],
): AdminOperationsStoredProduction["optionalJobStatus"] {
  const optional = jobs.find((job) => job.image_slot === "optional");
  if (optional === undefined) return "not_requested";
  if (optional.status === "completed") return "ready";
  return optional.status === "failed" ? "failed" : "queued";
}

function optionalProductionStatus(
  production: OperationsProduction,
  jobs: readonly ImageJobRow[],
): AdminOperationsStoredProduction["optionalJobStatus"] {
  const optional = production.imageSlots?.find((slot) => slot.imageSlot === "optional");
  if (optional === undefined) return optionalJobStatus(jobs);
  if (optional.status === "ready") return "ready";
  if (optional.status === "failed") return "failed";
  return optional.status === "not_requested" ? "not_requested" : "queued";
}

export function resolveCurrentPublicationFailure(
  events: readonly StoredContentReleaseEvent[],
): AdminOperationsStoredDay["publicationFailure"] {
  const latest = [...events]
    .sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.releaseEventId.localeCompare(right.releaseEventId),
    )
    .at(-1);
  return latest?.action === "scheduled_publish_failed"
    ? { occurredAt: latest.occurredAt, reason: latest.reason }
    : null;
}

function toStoredVersion(view: ContentVersionReadView | null): AdminOperationsStoredVersion | null {
  if (
    view === null ||
    view.version.effectiveFrom === null ||
    view.version.effectiveTo === null ||
    (view.version.state !== "approved" &&
      view.version.state !== "scheduled" &&
      view.version.state !== "published")
  ) {
    return null;
  }
  const imageSlots =
    view.imageSet?.slots.map((slot) => ({
      deliveryStatus: slot.deliveryStatus,
      imageSlot: slot.imageSlot,
      servedCoverAssetId: slot.servedCoverAssetId,
    })) ?? [];
  return {
    contentVersion: view.version.contentVersion,
    createdAt: view.version.createdAt,
    effectiveFrom: view.version.effectiveFrom,
    effectiveTo: view.version.effectiveTo,
    imageSlots,
    preview:
      view.imageSet === null
        ? null
        : projectDailyContentSnapshot(view.version, view.imageSet, new Set([view.version.state])),
    state: view.version.state,
  };
}

export class PostgresAdminOperationsStore implements AdminOperationsStore {
  private readonly readers: AdminOperationsReaders | null;

  constructor(
    private readonly pool: Pool,
    private readonly dateResolver: AdminOperationsDateResolver,
    readers?: AdminOperationsReaders,
  ) {
    this.readers = readers ?? null;
  }

  async readDays(fortuneDates: readonly string[]): Promise<AdminOperationsStoredDay[]> {
    const dates = [...new Set(fortuneDates)];
    if (dates.length === 0) return [];
    if (this.readers !== null) return this.readDaysWithInjectedReaders(dates, this.readers);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const snapshot = await readAdminOperationsPostgresSnapshot(client, dates);
      const days = dates.map((fortuneDate) => {
        const production = snapshot.productionsByDate.get(fortuneDate) ?? null;
        const versionList = snapshot.versionListsByDate.get(fortuneDate) ?? {
          projection: null,
          versions: [],
        };
        return this.buildDay(
          fortuneDate,
          production,
          [],
          versionList,
          snapshot.releaseProjectionsByDate.get(fortuneDate) ?? null,
          snapshot.releaseEventsByDate.get(fortuneDate) ?? [],
          production === null ? null : (snapshot.draftViewsById.get(production.draftId) ?? null),
          snapshot.versionViewsById,
        );
      });
      await client.query("COMMIT");
      return days;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readDaysWithInjectedReaders(
    dates: readonly string[],
    readers: AdminOperationsReaders,
  ): Promise<AdminOperationsStoredDay[]> {
    const [productions, jobResult] = await Promise.all([
      readers.production.listProductions(),
      this.pool.query<ImageJobRow>(
        `SELECT current.fortune_date, current.image_slot, job.status
           FROM daily_content_image_slot_currents AS current
           JOIN daily_content_image_jobs AS job
             ON job.job_id = current.current_job_id
            AND job.fortune_date = current.fortune_date
            AND job.image_slot = current.image_slot
            AND job.generation_revision = current.generation_revision
          WHERE current.fortune_date = ANY($1::date[])
          ORDER BY current.fortune_date, current.image_slot`,
        [dates],
      ),
    ]);
    const productionByDate = new Map(
      productions
        .filter((production) => dates.includes(production.fortuneDate))
        .map((production) => [production.fortuneDate, production]),
    );
    const jobsByDate = new Map<string, ImageJobRow[]>();
    for (const row of jobResult.rows) {
      const fortuneDate = fortuneDateValue(row.fortune_date, this.dateResolver);
      const jobs = jobsByDate.get(fortuneDate) ?? [];
      jobs.push(row);
      jobsByDate.set(fortuneDate, jobs);
    }

    return Promise.all(
      dates.map((fortuneDate) =>
        this.readDayWithInjectedReaders(
          fortuneDate,
          productionByDate.get(fortuneDate) ?? null,
          jobsByDate.get(fortuneDate) ?? [],
          readers,
        ),
      ),
    );
  }

  private async readDayWithInjectedReaders(
    fortuneDate: string,
    production: OperationsProduction | null,
    jobs: readonly ImageJobRow[],
    readers: AdminOperationsReaders,
  ): Promise<AdminOperationsStoredDay> {
    const [versionList, releaseProjection, releaseEvents, draftView] = await Promise.all([
      readers.lifecycle.readVersionListView(fortuneDate),
      readers.release.readProjection(fortuneDate),
      readers.release.listReleaseEvents(fortuneDate),
      production === null
        ? Promise.resolve(null)
        : readers.lifecycle.readDraftImageAssetView(production.draftId),
    ]);
    const activeContentVersion = releaseProjection?.activeContentVersion ?? null;
    const scheduledContentVersion = releaseProjection?.scheduledContentVersion ?? null;
    const approvedContentVersion =
      versionList.versions.find((version) => version.state === "approved")?.contentVersion ?? null;
    const wantedVersions = [
      ...new Set(
        [activeContentVersion, scheduledContentVersion, approvedContentVersion].filter(
          (value): value is string => value !== null,
        ),
      ),
    ];
    const views = await Promise.all(
      wantedVersions.map((contentVersion) => readers.lifecycle.readVersionView(contentVersion)),
    );
    const byVersion = new Map(
      views
        .filter((view): view is ContentVersionReadView => view !== null)
        .map((view) => [view.version.contentVersion, view]),
    );
    return this.buildDay(
      fortuneDate,
      production,
      jobs,
      versionList,
      releaseProjection,
      releaseEvents,
      draftView,
      byVersion,
    );
  }

  private buildDay(
    fortuneDate: string,
    production: OperationsProduction | null,
    jobs: readonly ImageJobRow[],
    versionList: ContentVersionListReadView,
    releaseProjection: ContentReleaseProjection | null,
    releaseEvents: readonly StoredContentReleaseEvent[],
    draftView: DraftImageAssetReadView | null,
    byVersion: ReadonlyMap<string, ContentVersionReadView>,
  ): AdminOperationsStoredDay {
    const activeContentVersion = releaseProjection?.activeContentVersion ?? null;
    const scheduledContentVersion = releaseProjection?.scheduledContentVersion ?? null;
    const approvedContentVersion =
      versionList.versions.find((version) => version.state === "approved")?.contentVersion ?? null;
    const activeView =
      activeContentVersion === null ? null : (byVersion.get(activeContentVersion) ?? null);
    const scheduledView =
      scheduledContentVersion === null ? null : (byVersion.get(scheduledContentVersion) ?? null);
    const approvedView =
      approvedContentVersion === null ? null : (byVersion.get(approvedContentVersion) ?? null);
    const active = toStoredVersion(activeView);
    const scheduled = toStoredVersion(scheduledView);
    const approved = toStoredVersion(approvedView);
    const lifecycleProjection = versionList.projection;
    const invariantBroken =
      (lifecycleProjection?.activeContentVersion ?? null) !== activeContentVersion ||
      (activeView !== null && activeView.version.fortuneDate !== fortuneDate) ||
      (scheduledView !== null && scheduledView.version.fortuneDate !== fortuneDate) ||
      (approvedView !== null && approvedView.version.fortuneDate !== fortuneDate) ||
      (activeContentVersion !== null && (active === null || active.state !== "published")) ||
      (scheduledContentVersion !== null &&
        (scheduled === null || scheduled.state !== "scheduled")) ||
      versionList.versions.filter((version) => version.state === "published").length > 1;
    // A correction workflow can create another draft for the same date. The
    // operations overview must describe the automatic production it is
    // monitoring, not whichever same-day draft happens to sort first.
    const draft =
      production === null ||
      draftView === null ||
      draftView.draft.draftId !== production.draftId ||
      draftView.draft.fortuneDate !== fortuneDate
        ? null
        : {
            draftId: draftView.draft.draftId,
            draftRevision: draftView.draft.draftRevision,
            imageCandidates: structuredClone(draftView.candidates),
            modules: structuredClone(draftView.draft.modules),
            updatedAt: draftView.draft.updatedAt,
          };

    return {
      active,
      approved,
      draft:
        draft === null
          ? null
          : {
              draftId: draft.draftId,
              draftRevision: draft.draftRevision,
              imageCandidates: draft.imageCandidates,
              modules: draft.modules,
              updatedAt: draft.updatedAt,
            },
      fortuneDate,
      invariantBroken,
      lifecycleRevision: releaseProjection?.lifecycleRevision ?? lifecycleProjection?.revision ?? 0,
      publicationFailure: resolveCurrentPublicationFailure(releaseEvents),
      production:
        production === null
          ? null
          : {
              lastError: production.lastError,
              optionalJobStatus: optionalProductionStatus(production, jobs),
              requiredJobs:
                production.imageSlots?.flatMap((slot) =>
                  slot.imageSlot === "optional"
                    ? []
                    : [
                        {
                          deliveryReady: slot.deliveryReady,
                          imageSlot: slot.imageSlot,
                          lastError: slot.lastError,
                          status: slot.status,
                        },
                      ],
                ) ??
                jobs
                  .filter(
                    (
                      job,
                    ): job is ImageJobRow & {
                      image_slot: "required_alternative" | "required_primary";
                    } => job.image_slot !== "optional",
                  )
                  .map((job) => ({
                    deliveryReady: job.status === "completed",
                    imageSlot: job.image_slot,
                    lastError: null,
                    status: jobStatus(job.status),
                  })),
              status: production.status,
              updatedAt: production.updatedAt,
            },
      scheduled,
      scheduleSlotRevision: releaseProjection?.scheduleSlotRevision ?? 0,
    };
  }
}
