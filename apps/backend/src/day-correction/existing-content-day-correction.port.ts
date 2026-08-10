import type {
  ContentLifecycleStore,
  DraftModuleByCode,
  ModuleCode,
} from "../content-lifecycle/content-lifecycle.store";
import { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import { ContentReleaseService } from "../content-release/content-release.service";
import type { ContentReleaseStore } from "../content-release/content-release.store";
import type { ContentProductionStore } from "../content-production/content-production.store";
import type { DayCorrectionContentPort } from "./day-correction.workflow";

export class ExistingContentDayCorrectionPort implements DayCorrectionContentPort {
  constructor(
    private readonly lifecycle: ContentLifecycleService,
    private readonly release: ContentReleaseService,
    private readonly releaseStore: ContentReleaseStore,
    private readonly lifecycleStore: ContentLifecycleStore,
    private readonly productionStore: Pick<ContentProductionStore, "listProductions"> = {
      listProductions: () => Promise.resolve([]),
    },
  ) {}

  createDraft(input: Parameters<ContentLifecycleService["createDraft"]>[0]) {
    return this.lifecycle.createDraft(input);
  }

  publish(input: Parameters<ContentReleaseService["publish"]>[0]) {
    return this.release.publish(input);
  }

  readDraft(draftId: string) {
    return this.lifecycle.getDraft(draftId);
  }

  async readDraftImageCandidate(draftId: string, assetId: string) {
    const view = await this.lifecycleStore.readDraftImageAssetView(draftId);
    const candidate = view?.candidates.find(
      (item) => item.draftId === draftId && item.asset.assetId === assetId,
    );
    return candidate === undefined
      ? null
      : {
          asset: structuredClone(candidate.asset),
          draftId: candidate.draftId,
          fortuneDate: candidate.fortuneDate,
          imageSlot: candidate.imageSlot ?? null,
        };
  }

  async resolveBaseline(fortuneDate: string) {
    const [projection, versions, productions] = await Promise.all([
      this.releaseStore.readProjection(fortuneDate),
      this.lifecycle.listVersions(fortuneDate),
      this.productionStore.listProductions(),
    ]);
    const fallbackApproved =
      "items" in versions
        ? (versions.items.find((version) => version.state === "approved")?.contentVersion ?? null)
        : null;
    const copySourceContentVersion =
      projection?.scheduledContentVersion ?? projection?.activeContentVersion ?? fallbackApproved;
    const productionDraftId =
      productions.find((production) => production.fortuneDate === fortuneDate)?.draftId ?? null;
    return {
      activeContentVersion: projection?.activeContentVersion ?? null,
      copySourceContentVersion,
      ...(copySourceContentVersion === null && productionDraftId !== null
        ? { copySourceDraftId: productionDraftId }
        : {}),
      lifecycleRevision:
        projection?.lifecycleRevision ??
        ("items" in versions ? (versions.items[0]?.lifecycleRevision ?? 0) : 0),
    };
  }

  schedule(input: Parameters<ContentReleaseService["schedule"]>[0]) {
    return this.release.schedule(input);
  }

  submitCorrectionDraft(input: Parameters<ContentLifecycleService["submitCorrectionDraft"]>[0]) {
    return this.lifecycle.submitCorrectionDraft(input);
  }

  updateDraftModule<C extends ModuleCode>(input: {
    readonly actorId: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly module: DraftModuleByCode[C];
    readonly moduleCode: C;
    readonly requestId: string;
  }) {
    return this.lifecycle.updateDraftModule(input);
  }
}
