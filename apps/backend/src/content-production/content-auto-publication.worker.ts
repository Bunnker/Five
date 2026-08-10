import type { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import { prepareImmediatePublicationModules } from "../content-lifecycle/immediate-publication-modules";
import type { ContentLifecycleStore } from "../content-lifecycle/content-lifecycle.store";
import type { ContentReleaseService } from "../content-release/content-release.service";
import type {
  ContentReleaseStore,
  StoredContentReleaseEvent,
} from "../content-release/content-release.store";
import type { ContentProductionService } from "./content-production.service";
import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import { RequestContextResolver } from "../request-context/request-context-resolver";

interface AutoPublicationClock {
  now(): Date;
}

export interface AutoPublicationCorrectionCoordinator {
  hasOpenOwnership(fortuneDate: string, now: Date): Promise<boolean>;
  withOpenFortuneDateLock<T>(fortuneDate: string, work: () => Promise<T>): Promise<T>;
}

const NO_CORRECTION_COORDINATOR: AutoPublicationCorrectionCoordinator = {
  hasOpenOwnership: () => Promise.resolve(false),
  withOpenFortuneDateLock: (_fortuneDate, work) => work(),
};

export interface ContentAutoPublicationResult {
  readonly failed: number;
  readonly published: number;
  readonly scheduled: number;
  readonly waiting: number;
}

const AUTO_PUBLICATION_ACTOR = "system:auto-publication-worker";

function automaticReleaseEvent(
  events: readonly StoredContentReleaseEvent[],
  contentVersion: string,
): StoredContentReleaseEvent | undefined {
  return events.find(
    (event) =>
      event.contentVersion === contentVersion &&
      event.actorId === AUTO_PUBLICATION_ACTOR &&
      (event.action === "schedule" || event.action === "publish") &&
      event.idempotencyKey === `automatic-${event.action}:${contentVersion}:v1`,
  );
}

/** Freezes and releases generated drafts once the minimum text and image inputs exist. */
export class ContentAutoPublicationWorker {
  constructor(
    private readonly store: ContentLifecycleStore,
    private readonly lifecycle: ContentLifecycleService,
    private readonly release: ContentReleaseService,
    private readonly releaseStore: Pick<
      ContentReleaseStore,
      "listReleaseEvents" | "readProjection"
    >,
    private readonly production: Pick<ContentProductionService, "list">,
    private readonly clock: AutoPublicationClock,
    private readonly corrections: AutoPublicationCorrectionCoordinator = NO_CORRECTION_COORDINATOR,
    private readonly publicContentContextResolver = new PublicContentContextResolver(),
  ) {}

  async runWindow(): Promise<ContentAutoPublicationResult> {
    const windowNow = this.clock.now();
    const requestContext = new RequestContextResolver({ now: () => windowNow }).resolve();
    const currentFortuneDate =
      this.publicContentContextResolver.resolve(requestContext).servedFortuneDate;
    const productions = (await this.production.list()).items.filter(
      (production) => production.fortuneDate >= currentFortuneDate,
    );
    const result = { failed: 0, published: 0, scheduled: 0, waiting: 0 };

    for (const production of productions) {
      try {
        await this.corrections.withOpenFortuneDateLock(production.fortuneDate, async () => {
          if (await this.corrections.hasOpenOwnership(production.fortuneDate, windowNow)) {
            result.waiting += 1;
            return;
          }
          const [versionList, releaseProjection, releaseEvents] = await Promise.all([
            this.store.readVersionListView(production.fortuneDate),
            this.releaseStore.readProjection(production.fortuneDate),
            this.releaseStore.listReleaseEvents(production.fortuneDate),
          ]);
          let version = versionList.versions.find(
            (candidate) => candidate.draftId === production.draftId,
          );

          const autoRelease =
            version === undefined
              ? undefined
              : automaticReleaseEvent(releaseEvents, version.contentVersion);
          if (
            version !== undefined &&
            releaseProjection?.activeContentVersion === version.contentVersion
          ) {
            result.published += 1;
            return;
          }
          if (
            version !== undefined &&
            releaseProjection?.scheduledContentVersion === version.contentVersion
          ) {
            result.scheduled += 1;
            return;
          }
          if (autoRelease !== undefined) {
            result.waiting += 1;
            return;
          }

          if (version?.state === "scheduled") {
            result.failed += 1;
            return;
          }
          if (version?.state === "published") {
            result.failed += 1;
            return;
          }

          const releaseOwnedByAnotherVersion =
            releaseProjection !== null &&
            ((releaseProjection.scheduledContentVersion !== null &&
              releaseProjection.scheduledContentVersion !== version?.contentVersion) ||
              (releaseProjection.activeContentVersion !== null &&
                releaseProjection.activeContentVersion !== version?.contentVersion));
          if (releaseOwnedByAnotherVersion) {
            result.waiting += 1;
            return;
          }

          if (version === undefined) {
            const [draft, candidates] = await Promise.all([
              this.store.findDraft(production.draftId),
              this.store.listDraftImageAssets(production.draftId),
            ]);
            if (
              draft === null ||
              prepareImmediatePublicationModules(draft.modules, candidates) === null
            ) {
              result.waiting += 1;
              return;
            }

            const submitted = await this.lifecycle.submitAutomaticProductionDraft({
              actorId: AUTO_PUBLICATION_ACTOR,
              draftId: production.draftId,
              expectedDraftRevision: draft.draftRevision,
              idempotencyKey: `automatic-submit:${production.draftId}:v1`,
              requestId: `worker-auto-submit-${production.draftId}`,
            });
            if (
              (submitted.kind !== "submitted" && submitted.kind !== "existing") ||
              submitted.result.state !== "approved"
            ) {
              result.failed += 1;
              return;
            }
            const submittedView = await this.store.readVersionView(submitted.result.contentVersion);
            version = submittedView?.version;
          }

          if (version?.state !== "approved") {
            result.failed += 1;
            return;
          }
          const view = await this.store.readVersionView(version.contentVersion);
          if (
            view === null ||
            view.version.effectiveFrom === null ||
            view.version.effectiveTo === null
          ) {
            result.failed += 1;
            return;
          }

          const common = {
            actorId: AUTO_PUBLICATION_ACTOR,
            contentVersion: version.contentVersion,
            expectedActiveContentVersion: view.projection.activeContentVersion,
            expectedLifecycleRevision: view.projection.revision,
            reason: "自动内容生成完成，先发布供用户查看；发现问题后创建新版本替换。",
            requestId: `worker-auto-release-${version.contentVersion}`,
          } as const;
          const now = windowNow.getTime();
          const effectiveFrom = Date.parse(view.version.effectiveFrom);
          const effectiveTo = Date.parse(view.version.effectiveTo);

          if (now < effectiveFrom) {
            const scheduled = await this.release.schedule({
              ...common,
              effectiveFrom: view.version.effectiveFrom,
              idempotencyKey: `automatic-schedule:${version.contentVersion}:v1`,
            });
            if (scheduled.kind === "applied" || scheduled.kind === "existing") {
              result.scheduled += 1;
            } else {
              result.failed += 1;
            }
            return;
          }

          if (now >= effectiveTo) {
            result.failed += 1;
            return;
          }
          const published = await this.release.publish({
            ...common,
            idempotencyKey: `automatic-publish:${version.contentVersion}:v1`,
          });
          if (published.kind === "applied" || published.kind === "existing") {
            result.published += 1;
          } else {
            result.failed += 1;
          }
        });
      } catch {
        result.failed += 1;
      }
    }

    return result;
  }
}
