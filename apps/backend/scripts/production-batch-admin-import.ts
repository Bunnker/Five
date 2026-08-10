import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { components } from "@five/api-contract";
import {
  isAdminImageAsset,
  isDraftModuleUpdate,
  isImageAssetUploadMetadata,
} from "@five/api-contract/runtime";
import sharp from "sharp";

import { CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN } from "../src/content-lifecycle/content-lifecycle.values";
import { DeterministicDraftGenerator } from "../src/content-production/deterministic-draft.generator";

type CalendarAlgorithmModule = components["schemas"]["CalendarAlgorithmModule"];
type CopyAndFormulaModule = components["schemas"]["CopyAndFormulaModule"];
type DailyImageSlot = components["schemas"]["DailyImageSlot"];
type ElementCode = components["schemas"]["ElementCode"];
type AdminImageAsset = components["schemas"]["AdminImageAsset"];
type ImageAssetUploadMetadata = components["schemas"]["ImageAssetUploadMetadata"];
type VisualAndRightsModule = components["schemas"]["VisualAndRightsModule"];

const REQUIRED_FILE_NAMES = [
  "algorithms.json",
  "date-image-map.json",
  "outfit-library.json",
  "server-upload-plan.json",
] as const;
const REQUIRED_IMAGE_SLOTS = ["required_primary", "required_alternative"] as const;
const MANIFEST_LINE = /^([a-f0-9]{64}) {2}([^\0\r\n]+)$/u;
const FORTUNE_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;
const SHA_256 = /^[a-f0-9]{64}$/u;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

interface JsonObject {
  readonly [key: string]: unknown;
}

interface ValidatedAlgorithmDay {
  readonly fortuneDate: string;
  readonly modules: {
    readonly calendar_algorithm: CalendarAlgorithmModule;
    readonly copy_and_formula: CopyAndFormulaModule;
  };
}

interface ValidatedOutfitAsset {
  readonly assetId: string;
  readonly dayElement: ElementCode;
  readonly filePath: string;
  readonly height: number;
  readonly sha256: string;
  readonly slot: (typeof REQUIRED_IMAGE_SLOTS)[number];
  readonly width: number;
}

export interface ValidatedBatchUpload {
  readonly bytes: Buffer;
  readonly filePath: string;
  readonly idempotencyKey: string;
  readonly imageSlot: (typeof REQUIRED_IMAGE_SLOTS)[number];
  readonly metadata: ImageAssetUploadMetadata;
  readonly sha256: string;
}

export interface ValidatedBatchDay {
  readonly algorithm: ValidatedAlgorithmDay;
  readonly ensureProductionIdempotencyKey: string;
  readonly fortuneDate: string;
  readonly uploads: readonly [ValidatedBatchUpload, ValidatedBatchUpload];
}

export interface ValidatedProductionBatch {
  readonly days: readonly ValidatedBatchDay[];
  readonly manifestSha256: string;
  readonly root: string;
}

export interface BatchValidationOptions {
  readonly expectedDayCount?: number;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function assertExactKeys(value: JsonObject, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`${label} has unexpected or missing fields`);
  }
}

function isElementCode(value: string): value is ElementCode {
  return ["wood", "fire", "earth", "metal", "water"].includes(value);
}

function isRequiredImageSlot(value: string): value is (typeof REQUIRED_IMAGE_SLOTS)[number] {
  return REQUIRED_IMAGE_SLOTS.includes(value as (typeof REQUIRED_IMAGE_SLOTS)[number]);
}

function nextFortuneDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function assertFortuneDate(value: string, label: string): void {
  if (!FORTUNE_DATE.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (date.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a real date`);
}

function assertSafeRelativePath(value: string, label: string): void {
  if (
    value.length === 0 ||
    isAbsolute(value) ||
    value.includes("\\") ||
    value
      .split("/")
      .some((component) => component === "" || component === "." || component === "..")
  ) {
    throw new Error(`${label} must be a normalized safe relative path`);
  }
}

async function readBatchFile(
  root: string,
  relativePath: string,
  maximumBytes: number,
): Promise<Buffer> {
  assertSafeRelativePath(relativePath, "batch file path");
  const target = resolve(root, relativePath);
  const relativeToRoot = relative(root, target);
  if (relativeToRoot.startsWith(`..${sep}`) || relativeToRoot === "..") {
    throw new Error(`batch file escapes root: ${relativePath}`);
  }
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`batch entry must be a regular non-symlink file: ${relativePath}`);
  }
  if (info.size < 1 || info.size > maximumBytes) {
    throw new Error(`batch file size is invalid: ${relativePath}`);
  }
  return readFile(target);
}

async function readJson(root: string, relativePath: string): Promise<unknown> {
  const bytes = await readBatchFile(root, relativePath, MAX_JSON_BYTES);
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${relativePath} is not valid JSON`);
  }
}

async function validateManifest(root: string): Promise<Map<string, string>> {
  const bytes = await readBatchFile(root, "MANIFEST.sha256", MAX_JSON_BYTES);
  const lines = bytes.toString("utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) throw new Error("MANIFEST.sha256 is empty");
  const entries = new Map<string, string>();
  for (const [index, line] of lines.entries()) {
    const match = MANIFEST_LINE.exec(line);
    if (match === null) throw new Error(`MANIFEST.sha256 line ${index + 1} is invalid`);
    const expectedSha256 = match[1]!;
    const relativePath = match[2]!;
    assertSafeRelativePath(relativePath, `MANIFEST.sha256 line ${index + 1} path`);
    if (relativePath === "MANIFEST.sha256" || entries.has(relativePath)) {
      throw new Error(`MANIFEST.sha256 contains a duplicate or self entry: ${relativePath}`);
    }
    const file = await readBatchFile(root, relativePath, MAX_JSON_BYTES);
    const actualSha256 = sha256(file);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`SHA-256 mismatch for ${relativePath}`);
    }
    entries.set(relativePath, expectedSha256);
  }
  for (const requiredFile of REQUIRED_FILE_NAMES) {
    if (!entries.has(requiredFile)) throw new Error(`MANIFEST.sha256 is missing ${requiredFile}`);
  }
  return entries;
}

function validateAlgorithmDays(value: unknown, expectedDayCount: number): ValidatedAlgorithmDay[] {
  const root = object(value, "algorithms.json");
  assertExactKeys(root, ["schemaVersion", "range", "source", "days"], "algorithms.json");
  if (root.schemaVersion !== "five-production-algorithms-v1") {
    throw new Error("algorithms.json schemaVersion is unsupported");
  }
  const range = object(root.range, "algorithms.json range");
  assertExactKeys(
    range,
    ["dayCount", "endFortuneDate", "startFortuneDate", "timeZone"],
    "algorithms.json range",
  );
  const dayCount = integer(range.dayCount, "algorithms.json range.dayCount");
  if (dayCount !== expectedDayCount || range.timeZone !== "Asia/Shanghai") {
    throw new Error("algorithms.json range does not match the required batch size or timezone");
  }
  const days = array(root.days, "algorithms.json days");
  if (days.length !== expectedDayCount)
    throw new Error("algorithms.json day count is inconsistent");
  const generator = new DeterministicDraftGenerator();
  const validated = days.map((rawDay, index): ValidatedAlgorithmDay => {
    const day = object(rawDay, `algorithms.json days[${index}]`);
    assertExactKeys(day, ["fortuneDate", "modules"], `algorithms.json days[${index}]`);
    const fortuneDate = string(day.fortuneDate, `algorithms.json days[${index}].fortuneDate`);
    assertFortuneDate(fortuneDate, `algorithms.json days[${index}].fortuneDate`);
    const modules = object(day.modules, `algorithms.json days[${index}].modules`);
    assertExactKeys(
      modules,
      ["calendar_algorithm", "copy_and_formula", "poster_consistency", "visual_and_rights"],
      `algorithms.json days[${index}].modules`,
    );
    if (modules.poster_consistency !== null || modules.visual_and_rights !== null) {
      throw new Error(`algorithms.json ${fortuneDate} must not pre-freeze visual modules`);
    }
    if (!isDraftModuleUpdate("calendar_algorithm", modules.calendar_algorithm)) {
      throw new Error(`algorithms.json ${fortuneDate} calendar_algorithm is invalid`);
    }
    if (!isDraftModuleUpdate("copy_and_formula", modules.copy_and_formula)) {
      throw new Error(`algorithms.json ${fortuneDate} copy_and_formula is invalid`);
    }
    const expected = generator.generate(fortuneDate);
    const calendarAlgorithm = modules.calendar_algorithm as CalendarAlgorithmModule;
    const copyAndFormula = modules.copy_and_formula as CopyAndFormulaModule;
    if (
      !isDeepStrictEqual(calendarAlgorithm, expected.calendar_algorithm) ||
      !isDeepStrictEqual(copyAndFormula, expected.copy_and_formula)
    ) {
      throw new Error(`algorithms.json ${fortuneDate} does not match DeterministicDraftGenerator`);
    }
    return {
      fortuneDate,
      modules: {
        calendar_algorithm: calendarAlgorithm,
        copy_and_formula: copyAndFormula,
      },
    };
  });
  for (let index = 1; index < validated.length; index += 1) {
    if (validated[index]!.fortuneDate !== nextFortuneDate(validated[index - 1]!.fortuneDate)) {
      throw new Error("algorithms.json dates must be unique, ordered, and contiguous");
    }
  }
  if (
    range.startFortuneDate !== validated[0]?.fortuneDate ||
    range.endFortuneDate !== validated.at(-1)?.fortuneDate
  ) {
    throw new Error("algorithms.json range endpoints are inconsistent");
  }
  return validated;
}

async function validateOutfitLibrary(
  root: string,
  value: unknown,
  manifest: ReadonlyMap<string, string>,
): Promise<Map<string, ValidatedOutfitAsset>> {
  const library = object(value, "outfit-library.json");
  if (library.schemaVersion !== "five-outfit-library-v1") {
    throw new Error("outfit-library.json schemaVersion is unsupported");
  }
  const assets = array(library.assets, "outfit-library.json assets");
  if (integer(library.assetCount, "outfit-library.json assetCount") !== assets.length) {
    throw new Error("outfit-library.json assetCount is inconsistent");
  }
  const byId = new Map<string, ValidatedOutfitAsset>();
  for (const [index, rawAsset] of assets.entries()) {
    const asset = object(rawAsset, `outfit-library.json assets[${index}]`);
    const assetId = string(asset.assetId, `outfit-library.json assets[${index}].assetId`);
    const dayElement = string(asset.dayElement, `outfit-library.json assets[${index}].dayElement`);
    const filePath = string(asset.filePath, `outfit-library.json assets[${index}].filePath`);
    const sha = string(asset.sha256, `outfit-library.json assets[${index}].sha256`);
    const slot = string(asset.slot, `outfit-library.json assets[${index}].slot`);
    const width = integer(asset.width, `outfit-library.json assets[${index}].width`);
    const height = integer(asset.height, `outfit-library.json assets[${index}].height`);
    if (!isElementCode(dayElement) || !isRequiredImageSlot(slot) || !SHA_256.test(sha)) {
      throw new Error(`outfit-library.json asset ${assetId} has invalid identity fields`);
    }
    if (byId.has(assetId)) throw new Error(`outfit-library.json duplicates assetId ${assetId}`);
    if (manifest.get(filePath) !== sha) {
      throw new Error(`outfit-library.json SHA does not match MANIFEST.sha256 for ${filePath}`);
    }
    const bytes = await readBatchFile(root, filePath, MAX_IMAGE_BYTES);
    const image = await sharp(bytes).metadata();
    if (image.format !== "png" || image.width !== width || image.height !== height) {
      throw new Error(`outfit-library.json image metadata does not match ${filePath}`);
    }
    byId.set(assetId, { assetId, dayElement, filePath, height, sha256: sha, slot, width });
  }
  return byId;
}

interface DateImageMapping {
  readonly dayElement: ElementCode;
  readonly fortuneDate: string;
  readonly images: Readonly<Record<(typeof REQUIRED_IMAGE_SLOTS)[number], string>>;
}

function validateDateImageMap(value: unknown, expectedDayCount: number): DateImageMapping[] {
  const map = object(value, "date-image-map.json");
  if (map.schemaVersion !== "five-date-image-map-v1") {
    throw new Error("date-image-map.json schemaVersion is unsupported");
  }
  if (
    integer(map.dayCount, "date-image-map.json dayCount") !== expectedDayCount ||
    integer(map.requiredReferenceCount, "date-image-map.json requiredReferenceCount") !==
      expectedDayCount * 2
  ) {
    throw new Error("date-image-map.json counts are inconsistent");
  }
  const mappings = array(map.dateMappings, "date-image-map.json dateMappings");
  if (mappings.length !== expectedDayCount) {
    throw new Error("date-image-map.json mapping count is inconsistent");
  }
  return mappings.map((rawMapping, index) => {
    const mapping = object(rawMapping, `date-image-map.json dateMappings[${index}]`);
    const fortuneDate = string(
      mapping.fortuneDate,
      `date-image-map.json dateMappings[${index}].fortuneDate`,
    );
    const dayElement = string(
      mapping.dayElement,
      `date-image-map.json dateMappings[${index}].dayElement`,
    );
    const images = object(mapping.images, `date-image-map.json dateMappings[${index}].images`);
    assertExactKeys(
      images,
      REQUIRED_IMAGE_SLOTS,
      `date-image-map.json dateMappings[${index}].images`,
    );
    if (
      !isElementCode(dayElement) ||
      mapping.optionalImage !== "not_requested" ||
      mapping.requiredImageCount !== 2
    ) {
      throw new Error(`date-image-map.json ${fortuneDate} has invalid status fields`);
    }
    return {
      dayElement,
      fortuneDate,
      images: {
        required_alternative: string(
          images.required_alternative,
          `date-image-map.json ${fortuneDate} required_alternative`,
        ),
        required_primary: string(
          images.required_primary,
          `date-image-map.json ${fortuneDate} required_primary`,
        ),
      },
    };
  });
}

async function validateUploadPlan(
  root: string,
  value: unknown,
  expectedDayCount: number,
  algorithms: readonly ValidatedAlgorithmDay[],
  mappings: readonly DateImageMapping[],
  assets: ReadonlyMap<string, ValidatedOutfitAsset>,
): Promise<ValidatedBatchDay[]> {
  const plan = object(value, "server-upload-plan.json");
  if (plan.schemaVersion !== "five-server-upload-plan-v1") {
    throw new Error("server-upload-plan.json schemaVersion is unsupported");
  }
  if (
    integer(plan.dayCount, "server-upload-plan.json dayCount") !== expectedDayCount ||
    integer(plan.uploadCount, "server-upload-plan.json uploadCount") !== expectedDayCount * 2
  ) {
    throw new Error("server-upload-plan.json counts are inconsistent");
  }
  const rightsReference = string(plan.rightsReference, "server-upload-plan.json rightsReference");
  const requests = array(plan.uploadRequests, "server-upload-plan.json uploadRequests");
  if (requests.length !== expectedDayCount) {
    throw new Error("server-upload-plan.json request count is inconsistent");
  }
  const usedIdempotencyKeys = new Set<string>();
  const result: ValidatedBatchDay[] = [];
  for (let index = 0; index < requests.length; index += 1) {
    const request = object(requests[index], `server-upload-plan.json uploadRequests[${index}]`);
    const fortuneDate = string(
      request.fortuneDate,
      `server-upload-plan.json uploadRequests[${index}].fortuneDate`,
    );
    const algorithm = algorithms[index];
    const mapping = mappings[index];
    if (
      algorithm === undefined ||
      mapping === undefined ||
      algorithm.fortuneDate !== fortuneDate ||
      mapping.fortuneDate !== fortuneDate ||
      mapping.dayElement !== algorithm.modules.calendar_algorithm.calendar.dayElement
    ) {
      throw new Error(`batch sources disagree for ${fortuneDate}`);
    }
    const ensure = object(request.ensureProduction, `${fortuneDate} ensureProduction`);
    const ensureBody = object(ensure.body, `${fortuneDate} ensureProduction.body`);
    const ensureKey = string(
      ensure.idempotencyKey,
      `${fortuneDate} ensureProduction.idempotencyKey`,
    );
    if (
      ensure.method !== "POST" ||
      ensure.path !== "/admin/api/v1/daily-content-productions" ||
      ensureBody.fortuneDate !== fortuneDate ||
      !CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(ensureKey)
    ) {
      throw new Error(`${fortuneDate} ensureProduction request is invalid`);
    }
    if (usedIdempotencyKeys.has(ensureKey))
      throw new Error(`duplicate idempotency key ${ensureKey}`);
    usedIdempotencyKeys.add(ensureKey);
    const uploads = array(request.uploads, `${fortuneDate} uploads`);
    if (uploads.length !== 2) throw new Error(`${fortuneDate} must have exactly two uploads`);
    const validatedUploads: ValidatedBatchUpload[] = [];
    for (let slotIndex = 0; slotIndex < REQUIRED_IMAGE_SLOTS.length; slotIndex += 1) {
      const expectedSlot = REQUIRED_IMAGE_SLOTS[slotIndex]!;
      const upload = object(uploads[slotIndex], `${fortuneDate} uploads[${slotIndex}]`);
      const imageSlot = string(upload.imageSlot, `${fortuneDate} uploads[${slotIndex}].imageSlot`);
      const filePath = string(upload.filePath, `${fortuneDate} uploads[${slotIndex}].filePath`);
      const idempotencyKey = string(
        upload.idempotencyKey,
        `${fortuneDate} uploads[${slotIndex}].idempotencyKey`,
      );
      if (
        imageSlot !== expectedSlot ||
        !isRequiredImageSlot(imageSlot) ||
        !CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
      ) {
        throw new Error(`${fortuneDate} ${expectedSlot} upload identity is invalid`);
      }
      if (usedIdempotencyKeys.has(idempotencyKey)) {
        throw new Error(`duplicate idempotency key ${idempotencyKey}`);
      }
      usedIdempotencyKeys.add(idempotencyKey);
      if (!isImageAssetUploadMetadata(upload.metadata)) {
        throw new Error(`${fortuneDate} ${expectedSlot} upload metadata is invalid`);
      }
      if (!upload.metadata.rightsRecordIds.includes(rightsReference)) {
        throw new Error(`${fortuneDate} ${expectedSlot} omits the plan rights reference`);
      }
      const mappedAssetId = mapping.images[expectedSlot];
      const asset = assets.get(mappedAssetId);
      if (
        asset === undefined ||
        asset.slot !== expectedSlot ||
        asset.dayElement !== mapping.dayElement ||
        asset.filePath !== filePath
      ) {
        throw new Error(`${fortuneDate} ${expectedSlot} disagrees with the outfit library`);
      }
      const bytes = await readBatchFile(root, filePath, MAX_IMAGE_BYTES);
      if (sha256(bytes) !== asset.sha256) {
        throw new Error(`${fortuneDate} ${expectedSlot} image SHA-256 is inconsistent`);
      }
      validatedUploads.push({
        bytes,
        filePath,
        idempotencyKey,
        imageSlot,
        metadata: upload.metadata,
        sha256: asset.sha256,
      });
    }
    if (validatedUploads[0]!.sha256 === validatedUploads[1]!.sha256) {
      throw new Error(`${fortuneDate} required images must have distinct bytes`);
    }
    result.push({
      algorithm,
      ensureProductionIdempotencyKey: ensureKey,
      fortuneDate,
      uploads: [validatedUploads[0]!, validatedUploads[1]!],
    });
  }
  return result;
}

export async function validateProductionBatch(
  batchRoot: string,
  options: BatchValidationOptions = {},
): Promise<ValidatedProductionBatch> {
  const expectedDayCount = options.expectedDayCount ?? 30;
  if (!Number.isSafeInteger(expectedDayCount) || expectedDayCount < 1 || expectedDayCount > 366) {
    throw new Error("expectedDayCount must be between 1 and 366");
  }
  const root = await realpath(resolve(batchRoot));
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("batch root must be a regular directory");
  }
  const manifestBytes = await readBatchFile(root, "MANIFEST.sha256", MAX_JSON_BYTES);
  const manifest = await validateManifest(root);
  const [algorithmValue, mapValue, libraryValue, planValue] = await Promise.all([
    readJson(root, "algorithms.json"),
    readJson(root, "date-image-map.json"),
    readJson(root, "outfit-library.json"),
    readJson(root, "server-upload-plan.json"),
  ]);
  const algorithms = validateAlgorithmDays(algorithmValue, expectedDayCount);
  const mappings = validateDateImageMap(mapValue, expectedDayCount);
  const assets = await validateOutfitLibrary(root, libraryValue, manifest);
  const days = await validateUploadPlan(
    root,
    planValue,
    expectedDayCount,
    algorithms,
    mappings,
    assets,
  );
  return { days, manifestSha256: sha256(manifestBytes), root };
}

type FetchImplementation = typeof fetch;

interface AdminSessionMaterial {
  readonly cookie: string;
  readonly csrfToken: string;
}

interface AdminProduction {
  readonly draftId: string;
  readonly draftRevision: number;
  readonly fortuneDate: string;
  readonly status: "awaiting_review" | "failed" | "generating";
}

interface AdminDraft {
  readonly draftId: string;
  readonly draftRevision: number;
  readonly fortuneDate: string;
  readonly modules: JsonObject;
}

interface AdminDraftImageItem {
  readonly assetId: string;
  readonly imageSlot: DailyImageSlot | null;
  readonly metadata: ImageAssetUploadMetadata;
  readonly selectedForSlot: boolean;
  readonly sha256: string;
}

interface AdminDraftImageList {
  readonly draftRevision: number;
  readonly etag: string;
  readonly items: readonly AdminDraftImageItem[];
}

interface AdminVersionSummary {
  readonly contentVersion: string;
  readonly state: string;
}

interface AdminVersionSnapshot extends AdminVersionSummary {
  readonly fortuneDate: string;
  readonly modules: JsonObject;
}

interface ExistingDaySnapshot {
  readonly activeContentVersion: string | null;
  readonly draftIds: readonly string[];
  readonly previewSource: string;
  readonly production: AdminProduction | null;
  readonly versions: readonly AdminVersionSummary[];
}

export type ImportDayStatus =
  | "pending"
  | "ensuring"
  | "adopted_existing_production"
  | "production_owned"
  | "images_verified"
  | "worker_finalized"
  | "skipped_existing";

type ProductionOwnership = "adopted_existing_production" | "ensured_via_admin_api" | null;

type ExistingSkipReason = "existing_state" | "existing_version" | null;

export interface ProductionBatchLedgerDay {
  readonly completedSlots: Partial<Record<(typeof REQUIRED_IMAGE_SLOTS)[number], string>>;
  readonly contentVersion: string | null;
  readonly draftId: string | null;
  readonly lastError: string | null;
  readonly productionOwnership: ProductionOwnership;
  readonly skipReason: ExistingSkipReason;
  readonly status: ImportDayStatus;
  readonly updatedAt: string;
}

export interface ProductionBatchLedger {
  readonly batchManifestSha256: string;
  readonly createdAt: string;
  readonly days: Record<string, ProductionBatchLedgerDay>;
  readonly schemaVersion: "five-admin-batch-import-ledger-v1";
  readonly updatedAt: string;
}

export interface ProductionBatchImportSummary {
  readonly failed: number;
  readonly adoptedExistingProductions: number;
  readonly imagesVerified: number;
  readonly skippedExisting: number;
  readonly skippedExistingVersions: number;
  readonly staged: number;
  readonly total: number;
  readonly workerFinalized: number;
}

export interface ProductionBatchAdminImportInput extends BatchValidationOptions {
  readonly baseUrl: string;
  readonly batchRoot: string;
  readonly confirmWorkerStopped: boolean;
  readonly fetchImpl?: FetchImplementation;
  readonly ledgerPath: string;
  readonly now?: () => Date;
  readonly origin: string;
  readonly password: string;
  readonly username: string;
}

function redactedAdminApiPath(path: string): string {
  return path
    .replace(/(\/daily-content-drafts\/)[^/?]+/gu, "$1{draftId}")
    .replace(/(\/daily-content-versions\/)[^/?]+/gu, "$1{contentVersion}")
    .replace(/(\/image-assets\/)[^/?]+/gu, "$1{assetId}");
}

class AdminApiError extends Error {
  readonly path: string;

  constructor(
    readonly method: string,
    path: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    const safePath = redactedAdminApiPath(path);
    super(
      `Admin API ${method} ${safePath} failed with ${status}${code === null ? "" : ` ${code}`}`,
    );
    this.name = "AdminApiError";
    this.path = safePath;
  }
}

class NonAdoptableProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonAdoptableProductionError";
  }
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 500);
  return "Unknown import failure";
}

function assertAdoptionInvariant(assertion: () => void): void {
  try {
    assertion();
  } catch (error) {
    throw new NonAdoptableProductionError(safeErrorMessage(error));
  }
}

function validateEndpoint(
  baseUrlValue: string,
  originValue: string,
): {
  readonly baseUrl: URL;
  readonly origin: string;
} {
  const baseUrl = new URL(baseUrlValue);
  if (
    baseUrl.username !== "" ||
    baseUrl.password !== "" ||
    baseUrl.search !== "" ||
    baseUrl.hash !== ""
  ) {
    throw new Error("baseUrl must not contain credentials, query, or fragment");
  }
  if (baseUrl.pathname !== "/") throw new Error("baseUrl must be an origin without a path");
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(baseUrl.hostname);
  if (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && loopback)) {
    throw new Error("Admin API must use HTTPS, except for explicit loopback access");
  }
  const origin = new URL(originValue);
  const originLoopback = ["127.0.0.1", "::1", "localhost"].includes(origin.hostname);
  if (
    origin.origin !== originValue ||
    origin.username !== "" ||
    origin.password !== "" ||
    (origin.protocol !== "https:" && !(origin.protocol === "http:" && originLoopback))
  ) {
    throw new Error("origin must be an exact trusted HTTPS origin");
  }
  return { baseUrl, origin: origin.origin };
}

function responseErrorCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const error = "error" in value ? (value as { readonly error?: unknown }).error : null;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return null;
  const code = "code" in error ? (error as { readonly code?: unknown }).code : null;
  return typeof code === "string" && code.length <= 100 ? code : null;
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function requiredEtag(response: Response, prefix: "draft" | "lifecycle"): string {
  const etag = response.headers.get("ETag");
  if (etag === null || !new RegExp(`^"${prefix}:[0-9]+"$`, "u").test(etag)) {
    throw new Error(`Admin API response is missing a strong ${prefix} ETag`);
  }
  return etag;
}

function selectedImageItems(value: unknown): AdminDraftImageItem[] {
  const list = object(value, "draft image list response");
  return array(list.items, "draft image list response.items").map((rawItem, index) => {
    const item = object(rawItem, `draft image list response.items[${index}]`);
    const asset = item.asset;
    if (!isAdminImageAsset(asset)) {
      throw new Error(`draft image list response.items[${index}].asset is invalid`);
    }
    const imageSlotValue = item.imageSlot;
    if (
      imageSlotValue !== null &&
      imageSlotValue !== "required_primary" &&
      imageSlotValue !== "required_alternative" &&
      imageSlotValue !== "optional"
    ) {
      throw new Error("Admin API returned an invalid image slot");
    }
    return {
      assetId: asset.assetId,
      imageSlot: imageSlotValue,
      metadata: imageUploadMetadataFromAdminAsset(asset),
      selectedForSlot: item.selectedForSlot === true,
      sha256: asset.sha256,
    };
  });
}

function imageUploadMetadataFromAdminAsset(asset: AdminImageAsset): ImageAssetUploadMetadata {
  const metadata: unknown = {
    aiLabelStatus: asset.aiLabelStatus,
    altText: asset.altText,
    declaredModel: asset.declaredModel,
    generatedAt: asset.generatedAt,
    generationMethod: asset.generationMethod,
    promptVersion: asset.promptVersion,
    reproductionReference: asset.reproductionReference,
    rightsRecordIds: asset.rightsRecordIds,
    sourceMaterialReferences: asset.sourceMaterialReferences,
    sourceType: asset.sourceType,
  };
  if (!isImageAssetUploadMetadata(metadata)) {
    throw new Error("Admin API returned invalid image source metadata");
  }
  return metadata;
}

function productionStatus(value: unknown): AdminProduction["status"] {
  if (value !== "generating" && value !== "awaiting_review" && value !== "failed") {
    throw new Error("Admin API returned an invalid production status");
  }
  return value;
}

class AdminHttpClient {
  private session: AdminSessionMaterial | null = null;

  constructor(
    private readonly baseUrl: URL,
    private readonly origin: string,
    private readonly fetchImpl: FetchImplementation,
  ) {}

  private async request(
    path: string,
    init: RequestInit,
    expectedStatus: number,
  ): Promise<{ readonly body: unknown; readonly response: Response }> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Origin", this.origin);
    if (this.session !== null) headers.set("Cookie", this.session.cookie);
    const response = await this.fetchImpl(new URL(path, this.baseUrl), {
      ...init,
      headers,
      redirect: "error",
    });
    const body = expectedStatus === 204 ? null : await readResponseJson(response);
    if (response.status !== expectedStatus) {
      throw new AdminApiError(init.method ?? "GET", path, response.status, responseErrorCode(body));
    }
    return { body, response };
  }

  private sessionHeaders(headers: Record<string, string> = {}): Headers {
    if (this.session === null) throw new Error("Admin session has not been established");
    const result = new Headers(headers);
    result.set("X-CSRF-Token", this.session.csrfToken);
    return result;
  }

  async login(username: string, password: string): Promise<void> {
    const { body, response } = await this.request(
      "/admin/api/v1/auth/sessions",
      {
        body: JSON.stringify({ password, username }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
      201,
    );
    const session = object(body, "admin session response");
    const csrfToken = string(session.csrfToken, "admin session CSRF token");
    if (csrfToken.length < 32 || csrfToken.length > 256) {
      throw new Error("Admin API returned an invalid CSRF token");
    }
    const setCookie = response.headers.get("Set-Cookie");
    const cookieMatch = setCookie?.match(/(?:^|,\s*)five_admin_session=([^;,\s]+)/u) ?? null;
    if (cookieMatch === null) throw new Error("Admin API did not establish a session cookie");
    this.session = { cookie: `five_admin_session=${cookieMatch[1]!}`, csrfToken };
  }

  async logout(): Promise<void> {
    if (this.session === null) return;
    try {
      await this.request(
        "/admin/api/v1/auth/session",
        { headers: this.sessionHeaders(), method: "DELETE" },
        204,
      );
    } finally {
      this.session = null;
    }
  }

  async listProductions(): Promise<AdminProduction[]> {
    const { body } = await this.request(
      "/admin/api/v1/daily-content-productions",
      { method: "GET" },
      200,
    );
    const root = object(body, "production list response");
    return array(root.items, "production list response.items").map((rawItem, index) => {
      const item = object(rawItem, `production list response.items[${index}]`);
      return {
        draftId: string(item.draftId, "production draftId"),
        draftRevision: integer(item.draftRevision, "production draftRevision"),
        fortuneDate: string(item.fortuneDate, "production fortuneDate"),
        status: productionStatus(item.status),
      };
    });
  }

  async inspectExistingDay(
    fortuneDate: string,
    knownProductions: readonly AdminProduction[],
  ): Promise<ExistingDaySnapshot> {
    const query = new URLSearchParams({ fortuneDate }).toString();
    const [dayResult, versionsResult, draftsResult] = await Promise.all([
      this.request(
        `/admin/api/v1/operations/days/${encodeURIComponent(fortuneDate)}`,
        { method: "GET" },
        200,
      ),
      this.request(`/admin/api/v1/daily-content-versions?${query}`, { method: "GET" }, 200),
      this.request(`/admin/api/v1/daily-content-drafts?${query}`, { method: "GET" }, 200),
    ]);
    const day = object(dayResult.body, "operations day response");
    const concurrency = object(day.concurrency, "operations day concurrency");
    const activeContentVersion = concurrency.activeContentVersion;
    if (activeContentVersion !== null && typeof activeContentVersion !== "string") {
      throw new Error("Admin API returned an invalid active content version");
    }
    const versionsRoot = object(versionsResult.body, "content version list response");
    const versions = array(versionsRoot.items, "content version list response.items").map(
      (rawVersion, index) => {
        const version = object(rawVersion, `content version list response.items[${index}]`);
        return {
          contentVersion: string(version.contentVersion, "content version id"),
          state: string(version.state, "content version state"),
        };
      },
    );
    const draftsRoot = object(draftsResult.body, "draft list response");
    const draftIds = array(draftsRoot.items, "draft list response.items").map((rawDraft) =>
      string(object(rawDraft, "draft summary").draftId, "draft id"),
    );
    return {
      activeContentVersion,
      draftIds,
      previewSource: string(day.previewSource, "operations day previewSource"),
      production: knownProductions.find((item) => item.fortuneDate === fortuneDate) ?? null,
      versions,
    };
  }

  async ensureProduction(day: ValidatedBatchDay): Promise<AdminProduction> {
    const { body } = await this.request(
      "/admin/api/v1/daily-content-productions",
      {
        body: JSON.stringify({ fortuneDate: day.fortuneDate }),
        headers: this.sessionHeaders({
          "Content-Type": "application/json",
          "Idempotency-Key": day.ensureProductionIdempotencyKey,
        }),
        method: "POST",
      },
      202,
    );
    const production = object(body, "ensure production response");
    return {
      draftId: string(production.draftId, "ensure production draftId"),
      draftRevision: integer(production.draftRevision, "ensure production draftRevision"),
      fortuneDate: string(production.fortuneDate, "ensure production fortuneDate"),
      status: productionStatus(production.status),
    };
  }

  async getDraft(draftId: string): Promise<AdminDraft> {
    const { body } = await this.request(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(draftId)}`,
      { method: "GET" },
      200,
    );
    const draft = object(body, "draft response");
    return {
      draftId: string(draft.draftId, "draft response draftId"),
      draftRevision: integer(draft.draftRevision, "draft response draftRevision"),
      fortuneDate: string(draft.fortuneDate, "draft response fortuneDate"),
      modules: object(draft.modules, "draft response modules"),
    };
  }

  async listDraftImages(draftId: string): Promise<AdminDraftImageList> {
    const { body, response } = await this.request(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(draftId)}/image-assets`,
      { method: "GET" },
      200,
    );
    const root = object(body, "draft image list response");
    return {
      draftRevision: integer(root.draftRevision, "draft image list draftRevision"),
      etag: requiredEtag(response, "draft"),
      items: selectedImageItems(root),
    };
  }

  async uploadDraftImage(
    draftId: string,
    upload: ValidatedBatchUpload,
    etag: string,
  ): Promise<void> {
    const form = new FormData();
    form.append("file", new Blob([upload.bytes], { type: "image/png" }), basename(upload.filePath));
    form.append("imageSlot", upload.imageSlot);
    form.append("metadata", JSON.stringify(upload.metadata));
    await this.request(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(draftId)}/image-assets`,
      {
        body: form,
        headers: this.sessionHeaders({
          "Idempotency-Key": upload.idempotencyKey,
          "If-Match": etag,
        }),
        method: "POST",
      },
      201,
    );
  }

  async getVersion(contentVersion: string): Promise<AdminVersionSnapshot> {
    const { body } = await this.request(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(contentVersion)}`,
      { method: "GET" },
      200,
    );
    const result = object(body, "content version response");
    return {
      contentVersion: string(result.contentVersion, "submit contentVersion"),
      fortuneDate: string(result.fortuneDate, "content version fortuneDate"),
      modules: object(result.snapshot, "content version snapshot"),
      state: string(result.state, "submit state"),
    };
  }
}

function newLedger(batch: ValidatedProductionBatch, now: string): ProductionBatchLedger {
  return {
    batchManifestSha256: batch.manifestSha256,
    createdAt: now,
    days: Object.fromEntries(
      batch.days.map((day) => [
        day.fortuneDate,
        {
          completedSlots: {},
          contentVersion: null,
          draftId: null,
          lastError: null,
          productionOwnership: null,
          skipReason: null,
          status: "pending",
          updatedAt: now,
        } satisfies ProductionBatchLedgerDay,
      ]),
    ),
    schemaVersion: "five-admin-batch-import-ledger-v1",
    updatedAt: now,
  };
}

function parseLedger(value: unknown, batch: ValidatedProductionBatch): ProductionBatchLedger {
  const ledger = object(value, "batch import ledger");
  if (
    ledger.schemaVersion !== "five-admin-batch-import-ledger-v1" ||
    ledger.batchManifestSha256 !== batch.manifestSha256
  ) {
    throw new Error("batch import ledger belongs to a different batch");
  }
  const days = object(ledger.days, "batch import ledger days");
  const resultDays: Record<string, ProductionBatchLedgerDay> = {};
  for (const batchDay of batch.days) {
    const rawDay = object(
      days[batchDay.fortuneDate],
      `batch import ledger ${batchDay.fortuneDate}`,
    );
    const status = string(rawDay.status, "batch import ledger day status") as ImportDayStatus;
    if (
      ![
        "pending",
        "ensuring",
        "adopted_existing_production",
        "production_owned",
        "images_verified",
        "worker_finalized",
        "skipped_existing",
      ].includes(status)
    ) {
      throw new Error(`batch import ledger has invalid status for ${batchDay.fortuneDate}`);
    }
    const completedSlotsRaw = object(rawDay.completedSlots, "batch import ledger completedSlots");
    const completedSlots: Partial<Record<(typeof REQUIRED_IMAGE_SLOTS)[number], string>> = {};
    for (const slot of REQUIRED_IMAGE_SLOTS) {
      const slotSha = completedSlotsRaw[slot];
      if (slotSha !== undefined) {
        if (typeof slotSha !== "string" || !SHA_256.test(slotSha)) {
          throw new Error(`batch import ledger has invalid ${slot} SHA-256`);
        }
        completedSlots[slot] = slotSha;
      }
    }
    const draftId = rawDay.draftId;
    const contentVersion = rawDay.contentVersion;
    const lastError = rawDay.lastError;
    const productionOwnership = rawDay.productionOwnership;
    const skipReason = rawDay.skipReason;
    if (
      (draftId !== null && typeof draftId !== "string") ||
      (contentVersion !== null && typeof contentVersion !== "string") ||
      (lastError !== null && typeof lastError !== "string") ||
      (productionOwnership !== null &&
        productionOwnership !== "adopted_existing_production" &&
        productionOwnership !== "ensured_via_admin_api") ||
      (skipReason !== null && skipReason !== "existing_state" && skipReason !== "existing_version")
    ) {
      throw new Error(`batch import ledger has invalid identifiers for ${batchDay.fortuneDate}`);
    }
    resultDays[batchDay.fortuneDate] = {
      completedSlots,
      contentVersion,
      draftId,
      lastError,
      productionOwnership,
      skipReason,
      status,
      updatedAt: string(rawDay.updatedAt, "batch import ledger day updatedAt"),
    };
  }
  return {
    batchManifestSha256: batch.manifestSha256,
    createdAt: string(ledger.createdAt, "batch import ledger createdAt"),
    days: resultDays,
    schemaVersion: "five-admin-batch-import-ledger-v1",
    updatedAt: string(ledger.updatedAt, "batch import ledger updatedAt"),
  };
}

async function loadLedger(
  path: string,
  batch: ValidatedProductionBatch,
  now: string,
): Promise<ProductionBatchLedger> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("batch import ledger must be a regular non-symlink file");
    }
    return parseLedger(JSON.parse(await readFile(path, "utf8")) as unknown, batch);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return newLedger(batch, now);
    throw error;
  }
}

async function saveLedger(path: string, ledger: ProductionBatchLedger): Promise<void> {
  const directory = dirname(resolve(path));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = resolve(
    directory,
    `.${basename(path)}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );
  await writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporaryPath, resolve(path));
}

function withLedgerDay(
  ledger: ProductionBatchLedger,
  fortuneDate: string,
  now: string,
  update: Partial<ProductionBatchLedgerDay>,
): ProductionBatchLedger {
  const current = ledger.days[fortuneDate];
  if (current === undefined) throw new Error(`ledger is missing ${fortuneDate}`);
  return {
    ...ledger,
    days: {
      ...ledger.days,
      [fortuneDate]: { ...current, ...update, updatedAt: now },
    },
    updatedAt: now,
  };
}

function verifyDraftAlgorithm(draft: AdminDraft, day: ValidatedBatchDay): void {
  if (draft.fortuneDate !== day.fortuneDate) throw new Error("production draft date mismatch");
  if (
    !isDeepStrictEqual(
      draft.modules.calendar_algorithm,
      day.algorithm.modules.calendar_algorithm,
    ) ||
    !isDeepStrictEqual(draft.modules.copy_and_formula, day.algorithm.modules.copy_and_formula) ||
    draft.modules.visual_and_rights !== null ||
    draft.modules.poster_consistency !== null
  ) {
    throw new Error(`${day.fortuneDate} server draft algorithm does not match the validated batch`);
  }
}

function selectedRequiredImage(
  list: AdminDraftImageList,
  upload: ValidatedBatchUpload,
): AdminDraftImageItem | null {
  const selected = list.items.filter(
    (item) => item.imageSlot === upload.imageSlot && item.selectedForSlot,
  );
  if (selected.length > 1) throw new Error(`${upload.imageSlot} has multiple selected images`);
  const item = selected[0] ?? null;
  if (item !== null && item.sha256 !== upload.sha256) {
    throw new Error(`${upload.imageSlot} already selects different image bytes`);
  }
  if (item !== null && !isDeepStrictEqual(item.metadata, upload.metadata)) {
    throw new Error(`${upload.imageSlot} selected image metadata does not match the batch`);
  }
  return item;
}

function assertOwnedUnsubmittedProduction(
  snapshot: ExistingDaySnapshot,
  fortuneDate: string,
  draftId: string,
): void {
  if (
    snapshot.activeContentVersion !== null ||
    snapshot.versions.length !== 0 ||
    snapshot.production?.fortuneDate !== fortuneDate ||
    snapshot.production.draftId !== draftId ||
    !["generating", "awaiting_review"].includes(snapshot.production.status) ||
    snapshot.previewSource !== "draft" ||
    snapshot.draftIds.length !== 1 ||
    snapshot.draftIds[0] !== draftId
  ) {
    throw new Error(`${fortuneDate} no longer has one adoptable unsubmitted production draft`);
  }
}

function assertDesiredSelectedImages(
  list: AdminDraftImageList,
  day: ValidatedBatchDay,
  requireBoth: boolean,
): void {
  if (list.items.some((item) => item.imageSlot === "optional" && item.selectedForSlot)) {
    throw new Error(`${day.fortuneDate} optional image must remain not_requested`);
  }
  const primary = selectedRequiredImage(list, day.uploads[0]);
  const alternative = selectedRequiredImage(list, day.uploads[1]);
  if (
    requireBoth &&
    (primary === null || alternative === null || primary.sha256 === alternative.sha256)
  ) {
    throw new Error(`${day.fortuneDate} does not have two distinct required selected images`);
  }
}

function verifyWorkerFinalizedVersion(version: AdminVersionSnapshot, day: ValidatedBatchDay): void {
  if (
    version.fortuneDate !== day.fortuneDate ||
    !["approved", "scheduled", "published"].includes(version.state) ||
    !isDeepStrictEqual(
      version.modules.calendar_algorithm,
      day.algorithm.modules.calendar_algorithm,
    ) ||
    !isDeepStrictEqual(version.modules.copy_and_formula, day.algorithm.modules.copy_and_formula)
  ) {
    throw new Error(`${day.fortuneDate} Worker-finalized version does not match the batch`);
  }
  const rawVisual = version.modules.visual_and_rights;
  if (!isDraftModuleUpdate("visual_and_rights", rawVisual)) {
    throw new Error(`${day.fortuneDate} Worker-finalized version has no valid visual module`);
  }
  const visual = rawVisual as VisualAndRightsModule;
  if (
    visual.looks.length !== 2 ||
    visual.assets.length !== 2 ||
    visual.looks.some(
      (look) => look.imageSlot !== "required_primary" && look.imageSlot !== "required_alternative",
    ) ||
    new Set(visual.looks.map((look) => look.imageSlot)).size !== 2 ||
    new Set(visual.looks.map((look) => look.coverAssetId)).size !== 2
  ) {
    throw new Error(
      `${day.fortuneDate} Worker-finalized version must have exactly two required image looks`,
    );
  }
  for (const upload of day.uploads) {
    const looks = visual.looks.filter((look) => look.imageSlot === upload.imageSlot);
    if (looks.length !== 1) {
      throw new Error(`${day.fortuneDate} Worker-finalized version has an invalid image slot`);
    }
    const asset = visual.assets.find((candidate) => candidate.assetId === looks[0]!.coverAssetId);
    if (
      asset?.sha256 !== upload.sha256 ||
      !isDeepStrictEqual(imageUploadMetadataFromAdminAsset(asset), upload.metadata)
    ) {
      throw new Error(
        `${day.fortuneDate} Worker-finalized version image SHA or metadata does not match the batch`,
      );
    }
  }
}

async function verifyWorkerFinalization(
  api: AdminHttpClient,
  snapshot: ExistingDaySnapshot,
  ledgerDay: ProductionBatchLedgerDay,
  day: ValidatedBatchDay,
): Promise<string> {
  if (
    ledgerDay.draftId === null ||
    snapshot.production?.draftId !== ledgerDay.draftId ||
    snapshot.production.fortuneDate !== day.fortuneDate ||
    snapshot.draftIds.length !== 0 ||
    snapshot.versions.length !== 1
  ) {
    throw new Error(
      `${day.fortuneDate} Worker finalization cannot be linked to the staged production`,
    );
  }
  const summary = snapshot.versions[0]!;
  if (
    (snapshot.activeContentVersion !== null &&
      snapshot.activeContentVersion !== summary.contentVersion) ||
    (ledgerDay.contentVersion !== null && ledgerDay.contentVersion !== summary.contentVersion)
  ) {
    throw new Error(`${day.fortuneDate} Worker finalized a different content version`);
  }
  const version = await api.getVersion(summary.contentVersion);
  if (version.state !== summary.state) {
    throw new Error(`${day.fortuneDate} content version list and detail states disagree`);
  }
  verifyWorkerFinalizedVersion(version, day);
  return summary.contentVersion;
}

function hasUnknownExistingState(snapshot: ExistingDaySnapshot): boolean {
  return (
    snapshot.production !== null ||
    snapshot.activeContentVersion !== null ||
    snapshot.versions.length > 0 ||
    snapshot.draftIds.length > 0 ||
    snapshot.previewSource !== "none"
  );
}

function assertCredentials(username: string, password: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/u.test(username)) {
    throw new Error("FIVE_ADMIN_USERNAME is invalid");
  }
  const passwordLength = [...password].length;
  if (passwordLength < 8 || passwordLength > 128) {
    throw new Error("FIVE_ADMIN_PASSWORD length is invalid");
  }
}

export async function importProductionBatchViaAdmin(
  input: ProductionBatchAdminImportInput,
): Promise<ProductionBatchImportSummary> {
  if (!input.confirmWorkerStopped) {
    throw new Error(
      "Refusing to import while Worker stop has not been confirmed; ensureProduction queues paid image jobs",
    );
  }
  assertCredentials(input.username, input.password);
  const endpoint = validateEndpoint(input.baseUrl, input.origin);
  const batch = await validateProductionBatch(input.batchRoot, {
    expectedDayCount: input.expectedDayCount,
  });
  const now = input.now ?? (() => new Date());
  let ledger = await loadLedger(input.ledgerPath, batch, now().toISOString());
  await saveLedger(input.ledgerPath, ledger);
  const api = new AdminHttpClient(endpoint.baseUrl, endpoint.origin, input.fetchImpl ?? fetch);
  let adoptedExistingProductions = 0;
  let imagesVerified = 0;
  let skippedExisting = 0;
  let skippedExistingVersions = 0;
  let staged = 0;
  let workerFinalized = 0;
  let activeDay: string | null = null;
  try {
    await api.login(input.username, input.password);
    let productions = await api.listProductions();
    for (const day of batch.days) {
      activeDay = day.fortuneDate;
      let ledgerDay = ledger.days[day.fortuneDate]!;
      let snapshot = await api.inspectExistingDay(day.fortuneDate, productions);
      if (ledgerDay.status === "skipped_existing") {
        skippedExisting += 1;
        if (ledgerDay.skipReason === "existing_version") skippedExistingVersions += 1;
        continue;
      }

      if (ledgerDay.status === "worker_finalized") {
        const contentVersion = await verifyWorkerFinalization(api, snapshot, ledgerDay, day);
        if (contentVersion !== ledgerDay.contentVersion) {
          throw new Error(`${day.fortuneDate} finalized ledger content version changed`);
        }
        staged += 1;
        imagesVerified += 1;
        workerFinalized += 1;
        if (ledgerDay.productionOwnership === "adopted_existing_production") {
          adoptedExistingProductions += 1;
        }
        continue;
      }

      if (ledgerDay.status === "images_verified" && snapshot.versions.length > 0) {
        const contentVersion = await verifyWorkerFinalization(api, snapshot, ledgerDay, day);
        ledger = withLedgerDay(ledger, day.fortuneDate, now().toISOString(), {
          contentVersion,
          lastError: null,
          status: "worker_finalized",
        });
        await saveLedger(input.ledgerPath, ledger);
        staged += 1;
        imagesVerified += 1;
        workerFinalized += 1;
        if (ledgerDay.productionOwnership === "adopted_existing_production") {
          adoptedExistingProductions += 1;
        }
        continue;
      }

      if (ledgerDay.status === "images_verified") {
        if (ledgerDay.draftId === null) {
          throw new Error(`${day.fortuneDate} images_verified ledger has no draft id`);
        }
        assertOwnedUnsubmittedProduction(snapshot, day.fortuneDate, ledgerDay.draftId);
        verifyDraftAlgorithm(await api.getDraft(ledgerDay.draftId), day);
        assertDesiredSelectedImages(await api.listDraftImages(ledgerDay.draftId), day, true);
        staged += 1;
        imagesVerified += 1;
        if (ledgerDay.productionOwnership === "adopted_existing_production") {
          adoptedExistingProductions += 1;
        }
        continue;
      }

      if (
        ledgerDay.status === "pending" &&
        (snapshot.activeContentVersion !== null || snapshot.versions.length > 0)
      ) {
        ledger = withLedgerDay(ledger, day.fortuneDate, now().toISOString(), {
          lastError: "Existing content version is protected and was not modified",
          skipReason: "existing_version",
          status: "skipped_existing",
        });
        await saveLedger(input.ledgerPath, ledger);
        skippedExisting += 1;
        skippedExistingVersions += 1;
        continue;
      }

      if (ledgerDay.status === "pending" && snapshot.production !== null) {
        try {
          assertAdoptionInvariant(() =>
            assertOwnedUnsubmittedProduction(
              snapshot,
              day.fortuneDate,
              snapshot.production!.draftId,
            ),
          );
          const draft = await api.getDraft(snapshot.production.draftId);
          assertAdoptionInvariant(() => verifyDraftAlgorithm(draft, day));
          const existingImages = await api.listDraftImages(snapshot.production.draftId);
          assertAdoptionInvariant(() => assertDesiredSelectedImages(existingImages, day, false));
          productions = await api.listProductions();
          snapshot = await api.inspectExistingDay(day.fortuneDate, productions);
          assertAdoptionInvariant(() =>
            assertOwnedUnsubmittedProduction(snapshot, day.fortuneDate, draft.draftId),
          );
          ledger = withLedgerDay(ledger, day.fortuneDate, now().toISOString(), {
            draftId: draft.draftId,
            lastError: null,
            productionOwnership: "adopted_existing_production",
            status: "adopted_existing_production",
          });
          await saveLedger(input.ledgerPath, ledger);
          ledgerDay = ledger.days[day.fortuneDate]!;
        } catch (error) {
          if (!(error instanceof NonAdoptableProductionError)) throw error;
          ledger = withLedgerDay(ledger, day.fortuneDate, now().toISOString(), {
            lastError: `Existing production was not adoptable: ${safeErrorMessage(error)}`,
            skipReason: "existing_state",
            status: "skipped_existing",
          });
          await saveLedger(input.ledgerPath, ledger);
          skippedExisting += 1;
          continue;
        }
      } else if (ledgerDay.status === "pending" && hasUnknownExistingState(snapshot)) {
        ledger = withLedgerDay(ledger, day.fortuneDate, now().toISOString(), {
          lastError: "Existing draft, preview, correction, or unknown state was not modified",
          skipReason: "existing_state",
          status: "skipped_existing",
        });
        await saveLedger(input.ledgerPath, ledger);
        skippedExisting += 1;
        continue;
      }

      ledgerDay = ledger.days[day.fortuneDate]!;
      const ownsIntent = ledgerDay.status !== "pending";
      if (
        ownsIntent &&
        snapshot.activeContentVersion !== null &&
        ledgerDay.contentVersion !== snapshot.activeContentVersion
      ) {
        throw new Error(`${day.fortuneDate} active version changed during the owned import`);
      }
      if (ownsIntent && snapshot.versions.length > 0)
        throw new Error(`${day.fortuneDate} acquired a content version before image verification`);
      if (
        ownsIntent &&
        snapshot.draftIds.some(
          (draftId) => ledgerDay.draftId !== null && draftId !== ledgerDay.draftId,
        )
      ) {
        throw new Error(
          `${day.fortuneDate} has an extra draft or open correction; refusing takeover`,
        );
      }

      if (ledgerDay.status === "pending") {
        ledger = withLedgerDay(ledger, day.fortuneDate, now().toISOString(), {
          lastError: null,
          status: "ensuring",
        });
        await saveLedger(input.ledgerPath, ledger);
        ledgerDay = ledger.days[day.fortuneDate]!;
      }

      let production: AdminProduction;
      if (ledgerDay.status === "ensuring") {
        productions = await api.listProductions();
        const beforeEnsure = await api.inspectExistingDay(day.fortuneDate, productions);
        if (
          beforeEnsure.production !== null &&
          (beforeEnsure.activeContentVersion !== null || beforeEnsure.versions.length > 0)
        ) {
          throw new Error(`${day.fortuneDate} gained a version before ensureProduction`);
        }
        production = await api.ensureProduction(day);
        productions = await api.listProductions();
        snapshot = await api.inspectExistingDay(day.fortuneDate, productions);
        assertOwnedUnsubmittedProduction(snapshot, day.fortuneDate, production.draftId);
        verifyDraftAlgorithm(await api.getDraft(production.draftId), day);
        assertDesiredSelectedImages(await api.listDraftImages(production.draftId), day, false);
      } else {
        if (ledgerDay.draftId === null || snapshot.production === null) {
          throw new Error(`${day.fortuneDate} owned production disappeared`);
        }
        assertOwnedUnsubmittedProduction(snapshot, day.fortuneDate, ledgerDay.draftId);
        production = snapshot.production;
      }
      if (
        production.fortuneDate !== day.fortuneDate ||
        (ledgerDay.draftId !== null && ledgerDay.draftId !== production.draftId) ||
        (snapshot.production !== null && snapshot.production.draftId !== production.draftId) ||
        snapshot.draftIds.some((draftId) => draftId !== production.draftId)
      ) {
        throw new Error(`${day.fortuneDate} ensureProduction returned an unexpected draft`);
      }
      ledger = withLedgerDay(ledger, day.fortuneDate, now().toISOString(), {
        draftId: production.draftId,
        lastError: null,
        productionOwnership:
          ledgerDay.productionOwnership ??
          (ledgerDay.status === "ensuring" ? "ensured_via_admin_api" : null),
        status: "production_owned",
      });
      await saveLedger(input.ledgerPath, ledger);

      const draft = await api.getDraft(production.draftId);
      verifyDraftAlgorithm(draft, day);
      let imageList = await api.listDraftImages(production.draftId);
      for (const upload of day.uploads) {
        if (selectedRequiredImage(imageList, upload) === null) {
          productions = await api.listProductions();
          snapshot = await api.inspectExistingDay(day.fortuneDate, productions);
          assertOwnedUnsubmittedProduction(snapshot, day.fortuneDate, production.draftId);
          verifyDraftAlgorithm(await api.getDraft(production.draftId), day);
          imageList = await api.listDraftImages(production.draftId);
          if (selectedRequiredImage(imageList, upload) === null) {
            await api.uploadDraftImage(production.draftId, upload, imageList.etag);
            imageList = await api.listDraftImages(production.draftId);
            if (selectedRequiredImage(imageList, upload) === null) {
              throw new Error(`${day.fortuneDate} ${upload.imageSlot} upload was not selected`);
            }
          }
        }
        const completedSlots = {
          ...ledger.days[day.fortuneDate]!.completedSlots,
          [upload.imageSlot]: upload.sha256,
        };
        ledger = withLedgerDay(ledger, day.fortuneDate, now().toISOString(), {
          completedSlots,
          lastError: null,
        });
        await saveLedger(input.ledgerPath, ledger);
      }
      assertDesiredSelectedImages(imageList, day, true);
      productions = await api.listProductions();
      snapshot = await api.inspectExistingDay(day.fortuneDate, productions);
      assertOwnedUnsubmittedProduction(snapshot, day.fortuneDate, production.draftId);
      verifyDraftAlgorithm(await api.getDraft(production.draftId), day);
      assertDesiredSelectedImages(await api.listDraftImages(production.draftId), day, true);
      ledger = withLedgerDay(ledger, day.fortuneDate, now().toISOString(), {
        lastError: null,
        status: "images_verified",
      });
      await saveLedger(input.ledgerPath, ledger);
      staged += 1;
      imagesVerified += 1;
      if (ledger.days[day.fortuneDate]!.productionOwnership === "adopted_existing_production") {
        adoptedExistingProductions += 1;
      }
    }
  } catch (error) {
    if (activeDay !== null && ledger.days[activeDay] !== undefined) {
      ledger = withLedgerDay(ledger, activeDay, now().toISOString(), {
        lastError: safeErrorMessage(error),
      });
      await saveLedger(input.ledgerPath, ledger);
    }
    throw error;
  } finally {
    await api.logout().catch(() => undefined);
  }
  return {
    adoptedExistingProductions,
    failed: 0,
    imagesVerified,
    skippedExisting,
    skippedExistingVersions,
    staged,
    total: batch.days.length,
    workerFinalized,
  };
}
