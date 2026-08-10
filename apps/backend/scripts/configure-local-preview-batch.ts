import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { components } from "@five/api-contract";
import { isImageAssetUploadMetadata } from "@five/api-contract/runtime";
import { Pool } from "pg";

import type { ContentDraft } from "../src/content-lifecycle/content-lifecycle.store";
import { ContentLifecycleService } from "../src/content-lifecycle/content-lifecycle.service";
import { prepareImmediatePublicationModules } from "../src/content-lifecycle/immediate-publication-modules";
import { PostgresContentLifecycleStore } from "../src/content-lifecycle/postgres-content-lifecycle.store";
import { ContentReleaseService } from "../src/content-release/content-release.service";
import { PostgresContentReleaseStore } from "../src/content-release/postgres-content-release.store";
import { AutomaticContentProductionService } from "../src/content-production/content-production.service";
import { DeterministicDraftGenerator } from "../src/content-production/deterministic-draft.generator";
import { PostgresContentProductionStore } from "../src/content-production/postgres-content-production.store";
import { DailyImageAssetService } from "../src/daily-images/daily-image-asset.service";
import type { ImageAssetUploadMetadata } from "../src/daily-images/daily-image-asset.store";
import { LocalBinaryImageAssetStore } from "../src/daily-images/local-binary-image-asset.store";
import { DayCorrectionImageJobService } from "../src/day-correction/day-correction-image-job.service";
import { DayCorrectionImageWorkflow } from "../src/day-correction/day-correction-image.workflow";
import { ExistingContentDayCorrectionPort } from "../src/day-correction/existing-content-day-correction.port";
import { PostgresCorrectionImageLibrary } from "../src/day-correction/postgres-correction-image-library";
import { PostgresDayCorrectionImageActionIdempotencyStore } from "../src/day-correction/postgres-day-correction-image-action-idempotency.store";
import { PostgresDayCorrectionImageJobStore } from "../src/day-correction/postgres-day-correction-image-job.store";
import { PostgresDayCorrectionStore } from "../src/day-correction/postgres-day-correction.store";
import { DayCorrectionWorkflow } from "../src/day-correction/day-correction.workflow";
import { RequestContextResolver } from "../src/request-context/request-context-resolver";
import { SystemClock } from "../src/request-context/system-clock";

type DraftModules = components["schemas"]["DraftModules"];
type DailyImageSlot = components["schemas"]["DailyImageSlot"];

const FORTUNE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const REQUIRED_SLOTS = ["required_primary", "required_alternative"] as const;
const PREVIEW_DATABASE_PORT = "55432";
const PREVIEW_DATABASE_NAME = "/five";
const ACTOR_ID = "local-preview-batch-import";

interface ValidatedUpload {
  readonly filePath: string;
  readonly idempotencyKey: string;
  readonly imageSlot: (typeof REQUIRED_SLOTS)[number];
  readonly metadata: unknown;
}

export interface ValidatedBatchDay {
  readonly ensureIdempotencyKey: string;
  readonly fortuneDate: string;
  readonly modules: unknown;
  readonly uploads: readonly ValidatedUpload[];
}

interface PreparedBatchDay extends Omit<ValidatedBatchDay, "modules" | "uploads"> {
  readonly modules: DraftModules;
  readonly uploads: readonly (Omit<ValidatedUpload, "metadata"> & {
    readonly absoluteFilePath: string;
    readonly metadata: ImageAssetUploadMetadata;
  })[];
}

interface BatchSummary {
  readonly appliedCorrectionDays: number;
  readonly configuredDays: number;
  readonly correctionDraftDays: number;
  readonly productionDraftDays: number;
  readonly scheduledCorrectionDays: number;
  readonly skippedImages: number;
  readonly uploadedImages: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Batch field ${key} must be a non-empty string`);
  }
  return value;
}

function requiredRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`Batch field ${key} must be an object`);
  return value;
}

function requiredArray(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`Batch field ${key} must be an array`);
  return value;
}

function validatedRequiredSlot(value: string): (typeof REQUIRED_SLOTS)[number] {
  if (value === "required_primary" || value === "required_alternative") return value;
  throw new Error(`Unsupported image slot in local preview batch: ${value}`);
}

export function assertAuthorizedPreviewDatabaseUrl(
  databaseUrl: string,
  explicitAuthorization: string | undefined,
): void {
  if (explicitAuthorization !== "1") {
    throw new Error("Set FIVE_ALLOW_LOCAL_PREVIEW_IMPORT=1 to authorize this local-only import");
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL");
  }
  const localHost = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  const postgresProtocol = parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
  if (
    !postgresProtocol ||
    !localHost ||
    parsed.port !== PREVIEW_DATABASE_PORT ||
    parsed.pathname !== PREVIEW_DATABASE_NAME
  ) {
    throw new Error(
      `Local batch import is restricted to the isolated preview database on port ${PREVIEW_DATABASE_PORT}`,
    );
  }
}

export function validateLocalPreviewBatch(input: {
  readonly algorithms: unknown;
  readonly uploadPlan: unknown;
}): ValidatedBatchDay[] {
  if (!isRecord(input.algorithms) || !isRecord(input.uploadPlan)) {
    throw new Error("Batch documents must be JSON objects");
  }
  const rawAlgorithmDays = requiredArray(input.algorithms, "days");
  const rawUploadRequests = requiredArray(input.uploadPlan, "uploadRequests");
  if (rawAlgorithmDays.length === 0) throw new Error("Batch must contain at least one date");

  const algorithmsByDate = new Map<string, unknown>();
  for (const item of rawAlgorithmDays) {
    if (!isRecord(item)) throw new Error("Each algorithm day must be an object");
    const fortuneDate = requiredString(item, "fortuneDate");
    if (!FORTUNE_DATE_PATTERN.test(fortuneDate))
      throw new Error(`Invalid fortuneDate: ${fortuneDate}`);
    if (algorithmsByDate.has(fortuneDate))
      throw new Error(`Duplicate algorithm date: ${fortuneDate}`);
    const modules = requiredRecord(item, "modules");
    requiredRecord(modules, "calendar_algorithm");
    requiredRecord(modules, "copy_and_formula");
    algorithmsByDate.set(fortuneDate, modules);
  }

  const seenUploadDates = new Set<string>();
  const validated = rawUploadRequests.map((item): ValidatedBatchDay => {
    if (!isRecord(item)) throw new Error("Each upload request must be an object");
    const fortuneDate = requiredString(item, "fortuneDate");
    if (seenUploadDates.has(fortuneDate)) throw new Error(`Duplicate upload date: ${fortuneDate}`);
    seenUploadDates.add(fortuneDate);
    const modules = algorithmsByDate.get(fortuneDate);
    if (modules === undefined)
      throw new Error(`Upload date has no algorithm entry: ${fortuneDate}`);
    const ensureProduction = requiredRecord(item, "ensureProduction");
    const uploads = requiredArray(item, "uploads").map((raw): ValidatedUpload => {
      if (!isRecord(raw)) throw new Error("Each image upload must be an object");
      return {
        filePath: requiredString(raw, "filePath"),
        idempotencyKey: requiredString(raw, "idempotencyKey"),
        imageSlot: validatedRequiredSlot(requiredString(raw, "imageSlot")),
        metadata: requiredRecord(raw, "metadata"),
      };
    });
    const slots = new Set(uploads.map((upload) => upload.imageSlot));
    if (uploads.length !== 2 || !REQUIRED_SLOTS.every((slot) => slots.has(slot))) {
      throw new Error(`${fortuneDate} must contain exactly two required uploads`);
    }
    return {
      ensureIdempotencyKey: requiredString(ensureProduction, "idempotencyKey"),
      fortuneDate,
      modules,
      uploads,
    };
  });

  if (validated.length !== algorithmsByDate.size) {
    throw new Error("Algorithm dates and upload dates must match exactly");
  }
  return validated.sort((left, right) => left.fortuneDate.localeCompare(right.fortuneDate));
}

function safeBatchFile(batchRoot: string, filePath: string): string {
  const absolute = resolve(batchRoot, filePath);
  const fromRoot = relative(batchRoot, absolute);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Batch image path escapes its root: ${filePath}`);
  }
  return absolute;
}

async function prepareBatch(batchRoot: string): Promise<PreparedBatchDay[]> {
  const [algorithmsSource, uploadPlanSource] = await Promise.all([
    readFile(resolve(batchRoot, "algorithms.json"), "utf8"),
    readFile(resolve(batchRoot, "server-upload-plan.json"), "utf8"),
  ]);
  const validated = validateLocalPreviewBatch({
    algorithms: JSON.parse(algorithmsSource) as unknown,
    uploadPlan: JSON.parse(uploadPlanSource) as unknown,
  });
  const generator = new DeterministicDraftGenerator();
  return validated.map((day): PreparedBatchDay => {
    const generated = generator.generate(day.fortuneDate);
    if (!isDeepStrictEqual(generated, day.modules)) {
      throw new Error(`${day.fortuneDate} algorithm snapshot differs from the current generator`);
    }
    return {
      ensureIdempotencyKey: day.ensureIdempotencyKey,
      fortuneDate: day.fortuneDate,
      modules: generated,
      uploads: day.uploads.map((upload) => {
        if (!isImageAssetUploadMetadata(upload.metadata)) {
          throw new Error(`${day.fortuneDate} ${upload.imageSlot} has invalid image metadata`);
        }
        return {
          ...upload,
          absoluteFilePath: safeBatchFile(batchRoot, upload.filePath),
          metadata: upload.metadata,
        };
      }),
    };
  });
}

async function updateGeneratedModules(
  lifecycle: ContentLifecycleService,
  initialDraft: ContentDraft,
  generated: DraftModules,
  requestPrefix: string,
): Promise<ContentDraft> {
  let draft = initialDraft;
  if (generated.calendar_algorithm === null || generated.copy_and_formula === null) {
    throw new Error(`${initialDraft.fortuneDate} generated modules are incomplete`);
  }
  if (!isDeepStrictEqual(draft.modules.calendar_algorithm, generated.calendar_algorithm)) {
    const updated = await lifecycle.updateDraftModule<"calendar_algorithm">({
      actorId: ACTOR_ID,
      draftId: draft.draftId,
      expectedDraftRevision: draft.draftRevision,
      module: generated.calendar_algorithm,
      moduleCode: "calendar_algorithm",
      requestId: `${requestPrefix}-calendar`,
    });
    if (updated.kind !== "updated") {
      throw new Error(`${draft.fortuneDate} calendar update failed: ${updated.kind}`);
    }
    draft = {
      ...draft,
      draftRevision: updated.result.draftRevision,
      modules: { ...draft.modules, calendar_algorithm: generated.calendar_algorithm },
    };
  }
  if (!isDeepStrictEqual(draft.modules.copy_and_formula, generated.copy_and_formula)) {
    const updated = await lifecycle.updateDraftModule<"copy_and_formula">({
      actorId: ACTOR_ID,
      draftId: draft.draftId,
      expectedDraftRevision: draft.draftRevision,
      module: generated.copy_and_formula,
      moduleCode: "copy_and_formula",
      requestId: `${requestPrefix}-copy`,
    });
    if (updated.kind !== "updated") {
      throw new Error(`${draft.fortuneDate} copy update failed: ${updated.kind}`);
    }
    draft = {
      ...draft,
      draftRevision: updated.result.draftRevision,
      modules: { ...draft.modules, copy_and_formula: generated.copy_and_formula },
    };
  }
  return draft;
}

async function rebuildVisualFromRequiredSelections(
  lifecycle: ContentLifecycleService,
  lifecycleStore: PostgresContentLifecycleStore,
  initialDraft: ContentDraft,
): Promise<ContentDraft> {
  let draft = (await lifecycle.getDraft(initialDraft.draftId)) ?? initialDraft;
  const imageView = await lifecycleStore.readDraftImageAssetView(draft.draftId);
  if (imageView === null) throw new Error(`${draft.fortuneDate} image view is missing`);
  const requiredCandidates = imageView.candidates.filter(
    (candidate) =>
      candidate.selectedForSlot &&
      (candidate.imageSlot === "required_primary" ||
        candidate.imageSlot === "required_alternative"),
  );
  const prepared = prepareImmediatePublicationModules(
    { ...draft.modules, poster_consistency: null, visual_and_rights: null },
    requiredCandidates,
  );
  if (
    prepared === null ||
    prepared.visual_and_rights === null ||
    prepared.poster_consistency === null
  ) {
    throw new Error(`${draft.fortuneDate} required selections cannot build a public visual model`);
  }
  if (!isDeepStrictEqual(draft.modules.visual_and_rights, prepared.visual_and_rights)) {
    const updated = await lifecycle.updateDraftModule<"visual_and_rights">({
      actorId: ACTOR_ID,
      draftId: draft.draftId,
      expectedDraftRevision: draft.draftRevision,
      module: prepared.visual_and_rights,
      moduleCode: "visual_and_rights",
      requestId: `local-preview-visual-${draft.fortuneDate}`,
    });
    if (updated.kind !== "updated") {
      throw new Error(`${draft.fortuneDate} visual rebuild failed: ${updated.kind}`);
    }
    draft = {
      ...draft,
      draftRevision: updated.result.draftRevision,
      modules: { ...draft.modules, visual_and_rights: prepared.visual_and_rights },
    };
  }
  if (!isDeepStrictEqual(draft.modules.poster_consistency, prepared.poster_consistency)) {
    const updated = await lifecycle.updateDraftModule<"poster_consistency">({
      actorId: ACTOR_ID,
      draftId: draft.draftId,
      expectedDraftRevision: draft.draftRevision,
      module: prepared.poster_consistency,
      moduleCode: "poster_consistency",
      requestId: `local-preview-poster-${draft.fortuneDate}`,
    });
    if (updated.kind !== "updated") {
      throw new Error(`${draft.fortuneDate} poster rebuild failed: ${updated.kind}`);
    }
    draft = {
      ...draft,
      draftRevision: updated.result.draftRevision,
      modules: { ...draft.modules, poster_consistency: prepared.poster_consistency },
    };
  }
  return draft;
}

async function runBatch(
  batchRoot: string,
  databaseUrl: string,
  applyOpenCorrections: boolean,
): Promise<BatchSummary> {
  const days = await prepareBatch(batchRoot);
  if (days.length !== 30)
    throw new Error(`Expected 30 local preview dates, received ${days.length}`);

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const clock = new SystemClock();
  const lifecycleStore = new PostgresContentLifecycleStore(pool);
  const lifecycle = new ContentLifecycleService(lifecycleStore, clock);
  const productionStore = new PostgresContentProductionStore(pool);
  const production = new AutomaticContentProductionService(productionStore, clock);
  const releaseStore = new PostgresContentReleaseStore(pool);
  const release = new ContentReleaseService(releaseStore, clock);
  const correctionStore = new PostgresDayCorrectionStore(pool);
  const correctionContent = new ExistingContentDayCorrectionPort(
    lifecycle,
    release,
    releaseStore,
    lifecycleStore,
    productionStore,
  );
  const corrections = new DayCorrectionWorkflow(
    correctionStore,
    correctionContent,
    new RequestContextResolver(clock),
    clock,
  );
  const images = new DailyImageAssetService(
    lifecycleStore,
    new LocalBinaryImageAssetStore(),
    clock,
  );
  const correctionImages = new DayCorrectionImageWorkflow(
    corrections,
    images,
    new DayCorrectionImageJobService(new PostgresDayCorrectionImageJobStore(pool), clock),
    new PostgresCorrectionImageLibrary(pool),
    new PostgresDayCorrectionImageActionIdempotencyStore(pool),
  );
  let correctionDraftDays = 0;
  let productionDraftDays = 0;
  let skippedImages = 0;
  let uploadedImages = 0;
  const openCorrectionIds: string[] = [];

  try {
    await pool.query("SELECT 1");
    for (const day of days) {
      const ensured = await production.ensureDay({
        actorId: ACTOR_ID,
        fortuneDate: day.fortuneDate,
        idempotencyKey: day.ensureIdempotencyKey,
        requestId: `local-preview-ensure-${day.fortuneDate}`,
      });
      if (ensured.kind !== "accepted" && ensured.kind !== "existing") {
        throw new Error(`${day.fortuneDate} production ensure failed: ${ensured.kind}`);
      }

      const existingCorrection = await correctionStore.findOpenByFortuneDate(day.fortuneDate);
      const editableDrafts = await lifecycle.listDrafts(day.fortuneDate);
      let correctionId: string | null = existingCorrection?.correctionId ?? null;
      let correctionRevision: number | null = existingCorrection?.correctionRevision ?? null;
      let draft: ContentDraft;

      if (correctionId !== null) {
        const working = await corrections.getWorkingCopy(correctionId);
        if (working.kind !== "ready") {
          throw new Error(`${day.fortuneDate} correction working copy failed: ${working.kind}`);
        }
        draft = working.draft;
        correctionRevision = working.correction.correctionRevision;
        correctionDraftDays += 1;
      } else if (editableDrafts.items.some((item) => item.draftId === ensured.production.draftId)) {
        const productionDraft = await lifecycle.getDraft(ensured.production.draftId);
        if (productionDraft === null)
          throw new Error(`${day.fortuneDate} production draft is missing`);
        draft = productionDraft;
        productionDraftDays += 1;
      } else {
        const opened = await corrections.openWorkingCopy({
          actorId: ACTOR_ID,
          fortuneDate: day.fortuneDate,
          requestId: `local-preview-correction-${day.fortuneDate}`,
        });
        if (opened.kind !== "ready") {
          throw new Error(`${day.fortuneDate} correction open failed: ${opened.kind}`);
        }
        correctionId = opened.correction.correctionId;
        correctionRevision = opened.correction.correctionRevision;
        draft = opened.draft;
        correctionDraftDays += 1;
      }

      draft = await updateGeneratedModules(
        lifecycle,
        draft,
        day.modules,
        `local-preview-modules-${day.fortuneDate}`,
      );

      for (const upload of day.uploads) {
        const bytes = await readFile(upload.absoluteFilePath);
        const currentAssets = await images.listDraftAssets(draft.draftId);
        if (currentAssets === null) throw new Error(`${day.fortuneDate} image draft is missing`);
        const desiredSha256 = await import("node:crypto").then(({ createHash }) =>
          createHash("sha256").update(bytes).digest("hex"),
        );
        const selected = currentAssets.items.find(
          (item) => item.imageSlot === upload.imageSlot && item.selectedForSlot,
        );
        if (selected?.asset.sha256 === desiredSha256) {
          draft = { ...draft, draftRevision: currentAssets.draftRevision };
          const currentCover = draft.modules.visual_and_rights?.looks.find(
            (look) => look.imageSlot === upload.imageSlot,
          )?.coverAssetId;
          if (
            correctionId !== null &&
            correctionRevision !== null &&
            currentCover !== selected.asset.assetId
          ) {
            const reconciled = await correctionImages.selectDraftCandidate({
              actorId: ACTOR_ID,
              assetId: selected.asset.assetId,
              correctionId,
              expectedRevision: {
                correctionRevision,
                draftRevision: draft.draftRevision,
              },
              idempotencyKey: `${upload.idempotencyKey}-reconcile`,
              imageSlot: upload.imageSlot,
              reason: "恢复已上传模特图与订正预览的一致选择。",
              requestId: `local-preview-reconcile-${day.fortuneDate}-${upload.imageSlot}`,
            });
            if (reconciled.kind !== "replaced" && reconciled.kind !== "existing") {
              throw new Error(
                `${day.fortuneDate} ${upload.imageSlot} reconciliation failed: ${reconciled.kind}`,
              );
            }
            correctionRevision = reconciled.correctionRevision;
            draft = { ...draft, draftRevision: reconciled.draftRevision };
          }
          skippedImages += 1;
          continue;
        }
        const priorCandidate = currentAssets.items.find(
          (item) => item.imageSlot === upload.imageSlot && item.asset.sha256 === desiredSha256,
        );
        if (priorCandidate !== undefined) {
          throw new Error(
            `${day.fortuneDate} ${upload.imageSlot} already has the batch image as an unselected candidate; preserve the manual selection and resolve it in the UI`,
          );
        }

        if (correctionId === null || correctionRevision === null) {
          const uploaded = await images.uploadDraftAsset({
            actorId: ACTOR_ID,
            bytes,
            declaredMediaType: "image/png",
            draftId: draft.draftId,
            expectedDraftRevision: draft.draftRevision,
            idempotencyKey: upload.idempotencyKey,
            imageSlot: upload.imageSlot,
            materializeImmediateVisual: true,
            metadata: upload.metadata,
            reason: "配置未来三十天的本地预览模特图。",
            requestId: `local-preview-upload-${day.fortuneDate}-${upload.imageSlot}`,
            selectForSlot: true,
          });
          if (uploaded.kind !== "uploaded" && uploaded.kind !== "existing") {
            throw new Error(
              `${day.fortuneDate} ${upload.imageSlot} upload failed: ${uploaded.kind}`,
            );
          }
          draft = { ...draft, draftRevision: uploaded.result.draftRevision };
        } else {
          const uploaded = await correctionImages.uploadAndSelect({
            actorId: ACTOR_ID,
            bytes,
            correctionId,
            declaredMediaType: "image/png",
            expectedRevision: {
              correctionRevision,
              draftRevision: draft.draftRevision,
            },
            idempotencyKey: upload.idempotencyKey,
            imageSlot: upload.imageSlot as DailyImageSlot,
            metadata: upload.metadata,
            reason: "配置未来三十天的本地预览模特图。",
            requestId: `local-preview-correction-upload-${day.fortuneDate}-${upload.imageSlot}`,
          });
          if (uploaded.kind !== "replaced" && uploaded.kind !== "existing") {
            throw new Error(
              `${day.fortuneDate} ${upload.imageSlot} correction upload failed: ${uploaded.kind}`,
            );
          }
          correctionRevision = uploaded.correctionRevision;
          draft = { ...draft, draftRevision: uploaded.draftRevision };
        }
        uploadedImages += 1;
      }
      draft = await rebuildVisualFromRequiredSelections(lifecycle, lifecycleStore, draft);
      if (correctionId !== null) openCorrectionIds.push(correctionId);
    }
    let appliedCorrectionDays = 0;
    let scheduledCorrectionDays = 0;
    if (applyOpenCorrections) {
      for (const correctionId of openCorrectionIds) {
        const working = await corrections.getWorkingCopy(correctionId);
        if (working.kind !== "ready") {
          throw new Error(`Correction apply preparation failed: ${working.kind}`);
        }
        const applied = await corrections.apply({
          actorId: ACTOR_ID,
          correctionId,
          expectedRevision: {
            correctionRevision: working.correction.correctionRevision,
            draftRevision: working.draft.draftRevision,
          },
          idempotencyKey: `local-preview-apply-${working.correction.fortuneDate}`,
          reason: "把已配置的本地预览内容按当前 18:00 公共窗口生效。",
          requestId: `local-preview-apply-${working.correction.fortuneDate}`,
        });
        if (applied.kind !== "applied" && applied.kind !== "existing") {
          throw new Error(
            `${working.correction.fortuneDate} correction apply failed: ${applied.kind}`,
          );
        }
        if (applied.mode === "immediate") appliedCorrectionDays += 1;
        else scheduledCorrectionDays += 1;
      }
    }
    return {
      appliedCorrectionDays,
      configuredDays: days.length,
      correctionDraftDays,
      productionDraftDays,
      scheduledCorrectionDays,
      skippedImages,
      uploadedImages,
    };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
  assertAuthorizedPreviewDatabaseUrl(databaseUrl, process.env.FIVE_ALLOW_LOCAL_PREVIEW_IMPORT);
  const requestedRoot = process.argv.slice(2).find((argument) => argument !== "--");
  if (requestedRoot === undefined) {
    throw new Error("Provide the absolute path to a prepared production batch");
  }
  const batchRoot = resolve(requestedRoot);
  const summary = await runBatch(
    batchRoot,
    databaseUrl,
    process.env.FIVE_LOCAL_PREVIEW_APPLY_CORRECTIONS === "1",
  );
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
