import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { components } from "@five/api-contract";
import { isImageAssetUploadMetadata } from "@five/api-contract/runtime";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { DeterministicDraftGenerator } from "../src/content-production/deterministic-draft.generator";
import { prepareImmediatePublicationModules } from "../src/content-lifecycle/immediate-publication-modules";
import type { StoredDraftImageAsset } from "../src/daily-images/daily-image-asset.store";
import {
  importProductionBatchViaAdmin,
  validateProductionBatch,
} from "./production-batch-admin-import";

const FORTUNE_DATE = "2026-08-10";

type FixtureImageSlot = "optional" | "required_alternative" | "required_primary";
type ImageAssetUploadMetadata = components["schemas"]["ImageAssetUploadMetadata"];

function fixtureUploadMetadata(imageSlot: FixtureImageSlot): ImageAssetUploadMetadata {
  return {
    aiLabelStatus: "pending",
    altText:
      imageSlot === "required_primary"
        ? "红色通勤模特穿搭"
        : imageSlot === "required_alternative"
          ? "绿色日常模特穿搭"
          : "可选模特穿搭",
    declaredModel: "fixture-image-model",
    generatedAt: "2026-08-10T00:00:00.000Z",
    generationMethod: "external_tool",
    promptVersion: "fixture-prompt-v1",
    reproductionReference: "fixture-reproduction-reference",
    rightsRecordIds: ["fixture-rights-record"],
    sourceMaterialReferences: ["fixture-source"],
    sourceType: "ai_generated",
  };
}

function fixtureAdminImageAsset(
  imageSlot: FixtureImageSlot,
  imageSha: string,
  metadataOverride: Partial<ImageAssetUploadMetadata> = {},
): components["schemas"]["AdminImageAsset"] {
  const metadata: unknown = {
    ...fixtureUploadMetadata(imageSlot),
    ...metadataOverride,
  };
  if (!isImageAssetUploadMetadata(metadata)) {
    throw new Error("fixture image metadata is invalid");
  }
  return {
    ...metadata,
    assetId: `asset-${imageSlot}`,
    fileUrl: null,
    height: 12,
    manualReview: null,
    mediaType: "image/png",
    reviewStatus: "pending",
    rightsStatus: "pending",
    sha256: imageSha,
    width: 8,
  };
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function finalizedModules(
  generated: ReturnType<DeterministicDraftGenerator["generate"]>,
  selected: ReadonlyMap<"optional" | "required_alternative" | "required_primary", string>,
  includeOptional = false,
  metadataOverrides: ReadonlyMap<FixtureImageSlot, Partial<ImageAssetUploadMetadata>> = new Map(),
) {
  const slots = includeOptional
    ? (["required_primary", "required_alternative", "optional"] as const)
    : (["required_primary", "required_alternative"] as const);
  const candidates = slots.map((imageSlot, index): StoredDraftImageAsset => ({
    asset: {
      ...fixtureAdminImageAsset(
        imageSlot,
        selected.get(imageSlot)!,
        metadataOverrides.get(imageSlot),
      ),
      assetId: `asset-${index + 1}`,
      fileUrl: `https://assets.example.test/asset-${index + 1}.png`,
    },
    draftId: "draft-import-test",
    fortuneDate: FORTUNE_DATE,
    imageSlot,
    reviewLocked: false,
    selectedForSlot: true,
    selectionSource: "manual_upload",
    storageKey: `fixture/${imageSlot}.png`,
    uploadedAt: "2026-08-10T00:00:00.000Z",
  }));
  const prepared = prepareImmediatePublicationModules(generated, candidates);
  if (prepared === null) throw new Error("failed to prepare finalized fixture modules");
  return prepared;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createBatchFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "five-production-batch-"));
  const imageDirectory = join(root, "images");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(imageDirectory));
  const primary = await sharp({
    create: { background: "#d14a3a", channels: 3, height: 12, width: 8 },
  })
    .png()
    .toBuffer();
  const alternative = await sharp({
    create: { background: "#577f5f", channels: 3, height: 12, width: 8 },
  })
    .png()
    .toBuffer();
  await writeFile(join(imageDirectory, "primary.png"), primary);
  await writeFile(join(imageDirectory, "alternative.png"), alternative);

  const generated = new DeterministicDraftGenerator().generate(FORTUNE_DATE);
  const algorithms = {
    days: [
      {
        fortuneDate: FORTUNE_DATE,
        modules: generated,
      },
    ],
    range: {
      dayCount: 1,
      endFortuneDate: FORTUNE_DATE,
      startFortuneDate: FORTUNE_DATE,
      timeZone: "Asia/Shanghai",
    },
    schemaVersion: "five-production-algorithms-v1",
    source: { generator: "DeterministicDraftGenerator", note: "test fixture" },
  };
  const dateImageMap = {
    dateMappings: [
      {
        dayElement: generated.calendar_algorithm?.calendar.dayElement,
        fortuneDate: FORTUNE_DATE,
        images: {
          required_alternative: "look-alternative",
          required_primary: "look-primary",
        },
        optionalImage: "not_requested",
        requiredImageCount: 2,
      },
    ],
    dayCount: 1,
    requiredReferenceCount: 2,
    schemaVersion: "five-date-image-map-v1",
  };
  const commonMetadata = {
    ...fixtureUploadMetadata("required_primary"),
    altText: undefined,
  };
  const outfitLibrary = {
    assetCount: 2,
    assets: [
      {
        ...commonMetadata,
        aiLabelStatus: "pending",
        assetId: "look-primary",
        colors: ["红色"],
        dayElement: generated.calendar_algorithm?.calendar.dayElement,
        fileName: "primary.png",
        filePath: "images/primary.png",
        height: 12,
        items: ["上衣"],
        manualVisualReview: "passed",
        mediaType: "image/png",
        rightsRecordStatus: "pending",
        sha256: sha256(primary),
        slot: "required_primary",
        style: "通勤",
        variant: 0,
        width: 8,
      },
      {
        ...commonMetadata,
        aiLabelStatus: "pending",
        assetId: "look-alternative",
        colors: ["绿色"],
        dayElement: generated.calendar_algorithm?.calendar.dayElement,
        fileName: "alternative.png",
        filePath: "images/alternative.png",
        height: 12,
        items: ["下装"],
        manualVisualReview: "passed",
        mediaType: "image/png",
        rightsRecordStatus: "pending",
        sha256: sha256(alternative),
        slot: "required_alternative",
        style: "日常",
        variant: 0,
        width: 8,
      },
    ],
    schemaVersion: "five-outfit-library-v1",
  };
  const serverUploadPlan = {
    dayCount: 1,
    rightsReference: "fixture-rights-record",
    schemaVersion: "five-server-upload-plan-v1",
    uploadCount: 2,
    uploadRequests: [
      {
        ensureProduction: {
          body: { fortuneDate: FORTUNE_DATE },
          idempotencyKey: `prepare-${FORTUNE_DATE}`,
          method: "POST",
          path: "/admin/api/v1/daily-content-productions",
        },
        fortuneDate: FORTUNE_DATE,
        uploads: [
          {
            filePath: "images/primary.png",
            idempotencyKey: `upload-${FORTUNE_DATE}-required-primary-fixture`,
            imageSlot: "required_primary",
            metadata: fixtureUploadMetadata("required_primary"),
          },
          {
            filePath: "images/alternative.png",
            idempotencyKey: `upload-${FORTUNE_DATE}-required-alternative-fixture`,
            imageSlot: "required_alternative",
            metadata: fixtureUploadMetadata("required_alternative"),
          },
        ],
      },
    ],
  };

  await writeJson(join(root, "algorithms.json"), algorithms);
  await writeJson(join(root, "date-image-map.json"), dateImageMap);
  await writeJson(join(root, "outfit-library.json"), outfitLibrary);
  await writeJson(join(root, "server-upload-plan.json"), serverUploadPlan);

  const manifestPaths = [
    "algorithms.json",
    "date-image-map.json",
    "outfit-library.json",
    "server-upload-plan.json",
    "images/primary.png",
    "images/alternative.png",
  ];
  const manifestLines = await Promise.all(
    manifestPaths.map(async (relativePath) => {
      const bytes = await readFile(join(root, relativePath));
      return `${sha256(bytes)}  ${relativePath}`;
    }),
  );
  await writeFile(join(root, "MANIFEST.sha256"), `${manifestLines.join("\n")}\n`, "utf8");
  return root;
}

describe("production batch admin import", () => {
  it("accepts a manifest-complete deterministic batch", async () => {
    const batchRoot = await createBatchFixture();

    const batch = await validateProductionBatch(batchRoot, { expectedDayCount: 1 });

    expect(batch.days).toHaveLength(1);
    expect(batch.days[0]).toMatchObject({
      fortuneDate: FORTUNE_DATE,
      uploads: [{ imageSlot: "required_primary" }, { imageSlot: "required_alternative" }],
    });
  });

  it("stages an empty day through protected Admin HTTP operations without calling standard submit", async () => {
    const batchRoot = await createBatchFixture();
    const ledgerPath = join(batchRoot, "test-import-ledger.json");
    const generated = new DeterministicDraftGenerator().generate(FORTUNE_DATE);
    let production:
      | {
          draftId: string;
          draftRevision: number;
          fortuneDate: string;
          status: "generating";
        }
      | undefined;
    const workerState: { contentVersion?: string } = {};
    const selected = new Map<"optional" | "required_alternative" | "required_primary", string>();
    const calls: Array<{ headers: Headers; method: string; path: string }> = [];

    const fetchMock: typeof fetch = async (input, init = {}) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
      const method = init.method ?? "GET";
      const headers = new Headers(init.headers);
      calls.push({ headers, method, path: url.pathname });
      const json = (status: number, body: unknown, responseHeaders?: Record<string, string>) =>
        new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json", ...responseHeaders },
          status,
        });
      if (url.pathname === "/admin/api/v1/auth/sessions" && method === "POST") {
        return json(
          201,
          {
            absoluteExpiresAt: "2026-08-10T12:00:00.000Z",
            credentialRevision: 1,
            csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
            idleExpiresAt: "2026-08-10T00:30:00.000Z",
            issuedAt: "2026-08-10T00:00:00.000Z",
            username: "admin",
          },
          { "Set-Cookie": "five_admin_session=opaque-test-session; HttpOnly; Secure; Path=/admin" },
        );
      }
      if (headers.get("Cookie") !== "five_admin_session=opaque-test-session") {
        return json(401, { error: { code: "UNAUTHENTICATED", requestId: "req-test" } });
      }
      if (url.pathname === "/admin/api/v1/auth/session" && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/admin/api/v1/daily-content-productions" && method === "GET") {
        return json(200, { items: production === undefined ? [] : [{ ...production }] });
      }
      if (url.pathname === `/admin/api/v1/operations/days/${FORTUNE_DATE}` && method === "GET") {
        return json(200, {
          concurrency: { activeContentVersion: null },
          previewSource:
            workerState.contentVersion === undefined
              ? production === undefined
                ? "none"
                : "draft"
              : "scheduled",
        });
      }
      if (url.pathname === "/admin/api/v1/daily-content-versions" && method === "GET") {
        return json(200, {
          items:
            workerState.contentVersion === undefined
              ? []
              : [{ contentVersion: workerState.contentVersion, state: "scheduled" }],
        });
      }
      if (url.pathname === "/admin/api/v1/daily-content-drafts" && method === "GET") {
        return json(200, {
          items:
            production === undefined || workerState.contentVersion !== undefined
              ? []
              : [
                  {
                    draftId: production.draftId,
                    draftRevision: production.draftRevision,
                    fortuneDate: production.fortuneDate,
                  },
                ],
        });
      }
      if (
        workerState.contentVersion !== undefined &&
        url.pathname === `/admin/api/v1/daily-content-versions/${workerState.contentVersion}` &&
        method === "GET"
      ) {
        return json(200, {
          contentVersion: workerState.contentVersion,
          fortuneDate: FORTUNE_DATE,
          snapshot: finalizedModules(generated, selected),
          state: "scheduled",
        });
      }
      if (url.pathname === "/admin/api/v1/daily-content-productions" && method === "POST") {
        production = {
          draftId: "draft-import-test",
          draftRevision: 1,
          fortuneDate: FORTUNE_DATE,
          status: "generating",
        };
        return json(202, {
          ...production,
          completedImageSlots: 0,
          imageSlots: [],
          lastError: null,
          optionalImageStatus: "not_requested",
          pendingImageSlots: 2,
          requiredGenerationComplete: false,
          requiredImagesReady: false,
          status: "generating",
          updatedAt: "2026-08-10T00:00:00.000Z",
        });
      }
      if (url.pathname === "/admin/api/v1/daily-content-drafts/draft-import-test") {
        return json(
          200,
          {
            draftId: "draft-import-test",
            draftRevision: production?.draftRevision,
            fortuneDate: FORTUNE_DATE,
            modules: generated,
            state: "draft",
          },
          { ETag: `"draft:${production?.draftRevision ?? 1}"` },
        );
      }
      if (
        url.pathname === "/admin/api/v1/daily-content-drafts/draft-import-test/image-assets" &&
        method === "GET"
      ) {
        return json(
          200,
          {
            draftId: "draft-import-test",
            draftRevision: production?.draftRevision,
            fortuneDate: FORTUNE_DATE,
            items: [...selected].map(([imageSlot, imageSha]) => ({
              asset: fixtureAdminImageAsset(imageSlot, imageSha),
              imageSlot,
              selectedForSlot: true,
            })),
          },
          { ETag: `"draft:${production?.draftRevision ?? 1}"` },
        );
      }
      if (
        url.pathname === "/admin/api/v1/daily-content-drafts/draft-import-test/image-assets" &&
        method === "POST"
      ) {
        const body = init.body;
        if (!(body instanceof FormData)) throw new Error("expected multipart FormData");
        const imageSlot = body.get("imageSlot");
        const file = body.get("file");
        if (
          (imageSlot !== "required_primary" && imageSlot !== "required_alternative") ||
          !(file instanceof Blob)
        ) {
          throw new Error("invalid multipart fixture request");
        }
        const imageSha = sha256(Buffer.from(await file.arrayBuffer()));
        selected.set(imageSlot, imageSha);
        production = { ...production!, draftRevision: production!.draftRevision + 1 };
        return json(
          201,
          {
            asset: { assetId: `asset-${selected.size}`, sha256: imageSha },
            draftId: production.draftId,
            draftRevision: production.draftRevision,
            fortuneDate: FORTUNE_DATE,
            imageSlot,
            selectedForSlot: true,
          },
          { ETag: `"draft:${production.draftRevision}"` },
        );
      }
      return json(404, { error: { code: "RESOURCE_NOT_FOUND", requestId: "req-test" } });
    };

    const summary = await importProductionBatchViaAdmin({
      baseUrl: "https://five.example.test",
      batchRoot,
      confirmWorkerStopped: true,
      expectedDayCount: 1,
      fetchImpl: fetchMock,
      ledgerPath,
      origin: "https://five.example.test",
      password: "password-not-logged",
      username: "admin",
    });

    expect(summary).toEqual({
      adoptedExistingProductions: 0,
      failed: 0,
      imagesVerified: 1,
      skippedExisting: 0,
      skippedExistingVersions: 0,
      staged: 1,
      total: 1,
      workerFinalized: 0,
    });
    expect(selected.size).toBe(2);
    const contentWrites = calls.filter(
      ({ method, path }) => method === "POST" && !path.endsWith("/auth/sessions"),
    );
    expect(contentWrites).toHaveLength(3);
    expect(calls.some(({ path }) => path.endsWith("/submit"))).toBe(false);
    expect(contentWrites.every(({ headers }) => headers.has("Idempotency-Key"))).toBe(true);
    expect(
      contentWrites
        .filter(({ path }) => path !== "/admin/api/v1/daily-content-productions")
        .every(({ headers }) => headers.has("If-Match")),
    ).toBe(true);
    expect(contentWrites.every(({ headers }) => headers.has("X-CSRF-Token"))).toBe(true);
    expect(
      contentWrites.every(({ headers }) => headers.get("Origin") === "https://five.example.test"),
    ).toBe(true);
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      days: Record<string, { contentVersion: string | null; status: string }>;
    };
    expect(ledger.days[FORTUNE_DATE]).toMatchObject({
      contentVersion: null,
      status: "images_verified",
    });

    const writesBeforeRepeat = calls.filter(
      ({ method, path }) => method === "POST" && !path.endsWith("/auth/sessions"),
    ).length;
    selected.set("optional", "c".repeat(64));
    production = { ...production!, draftRevision: production!.draftRevision + 1 };
    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath,
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).rejects.toThrow("optional image must remain not_requested");
    selected.delete("optional");

    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath,
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).resolves.toEqual({
      adoptedExistingProductions: 0,
      failed: 0,
      imagesVerified: 1,
      skippedExisting: 0,
      skippedExistingVersions: 0,
      staged: 1,
      total: 1,
      workerFinalized: 0,
    });
    expect(
      calls.filter(({ method, path }) => method === "POST" && !path.endsWith("/auth/sessions")),
    ).toHaveLength(writesBeforeRepeat);

    workerState.contentVersion = "content-worker-finalized";
    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath,
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).resolves.toEqual({
      adoptedExistingProductions: 0,
      failed: 0,
      imagesVerified: 1,
      skippedExisting: 0,
      skippedExistingVersions: 0,
      staged: 1,
      total: 1,
      workerFinalized: 1,
    });
    expect(
      calls.filter(({ method, path }) => method === "POST" && !path.endsWith("/auth/sessions")),
    ).toHaveLength(writesBeforeRepeat);
    const finalizedLedger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      days: Record<string, { contentVersion: string | null; status: string }>;
    };
    expect(finalizedLedger.days[FORTUNE_DATE]).toMatchObject({
      contentVersion: "content-worker-finalized",
      status: "worker_finalized",
    });
  });

  it("recovers an images_verified ledger after one-shot Worker finalization without uploads or submit", async () => {
    const batchRoot = await createBatchFixture();
    const batch = await validateProductionBatch(batchRoot, { expectedDayCount: 1 });
    const batchDay = batch.days[0]!;
    const ledgerPath = join(batchRoot, "worker-finalized-ledger.json");
    await writeJson(ledgerPath, {
      batchManifestSha256: batch.manifestSha256,
      createdAt: "2026-08-10T00:00:00.000Z",
      days: {
        [FORTUNE_DATE]: {
          completedSlots: {
            required_alternative: batchDay.uploads[1].sha256,
            required_primary: batchDay.uploads[0].sha256,
          },
          contentVersion: null,
          draftId: "draft-import-test",
          lastError: null,
          productionOwnership: "adopted_existing_production",
          skipReason: null,
          status: "images_verified",
          updatedAt: "2026-08-10T00:00:00.000Z",
        },
      },
      schemaVersion: "five-admin-batch-import-ledger-v1",
      updatedAt: "2026-08-10T00:00:00.000Z",
    });
    const generated = new DeterministicDraftGenerator().generate(FORTUNE_DATE);
    const selected = new Map([
      ["required_primary" as const, batchDay.uploads[0].sha256],
      ["required_alternative" as const, batchDay.uploads[1].sha256],
      ["optional" as const, "d".repeat(64)],
    ]);
    let includeOptional = true;
    const finalizedMetadataOverrides = new Map<
      FixtureImageSlot,
      Partial<ImageAssetUploadMetadata>
    >();
    const calls: Array<{ method: string; path: string }> = [];
    const json = (status: number, body: unknown, responseHeaders?: Record<string, string>) =>
      new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json", ...responseHeaders },
        status,
      });
    const fetchMock: typeof fetch = async (input, init = {}) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
      const method = init.method ?? "GET";
      calls.push({ method, path: url.pathname });
      if (url.pathname === "/admin/api/v1/auth/sessions" && method === "POST") {
        return json(
          201,
          { csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters" },
          {
            "Set-Cookie": "five_admin_session=opaque-final-session; HttpOnly; Secure; Path=/admin",
          },
        );
      }
      if (url.pathname === "/admin/api/v1/auth/session" && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/admin/api/v1/daily-content-productions") {
        return json(200, {
          items: [
            {
              draftId: "draft-import-test",
              draftRevision: 6,
              fortuneDate: FORTUNE_DATE,
              status: "awaiting_review",
            },
          ],
        });
      }
      if (url.pathname === `/admin/api/v1/operations/days/${FORTUNE_DATE}`) {
        return json(200, {
          concurrency: { activeContentVersion: null },
          previewSource: "scheduled",
        });
      }
      if (url.pathname === "/admin/api/v1/daily-content-versions") {
        return json(200, {
          items: [{ contentVersion: "content-worker-finalized", state: "scheduled" }],
        });
      }
      if (url.pathname === "/admin/api/v1/daily-content-drafts") {
        return json(200, { items: [] });
      }
      if (url.pathname === "/admin/api/v1/daily-content-versions/content-worker-finalized") {
        return json(200, {
          contentVersion: "content-worker-finalized",
          fortuneDate: FORTUNE_DATE,
          snapshot: finalizedModules(
            generated,
            selected,
            includeOptional,
            finalizedMetadataOverrides,
          ),
          state: "scheduled",
        });
      }
      return json(404, { error: { code: "RESOURCE_NOT_FOUND" } });
    };

    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath,
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).rejects.toThrow("exactly two required image looks");
    includeOptional = false;

    finalizedMetadataOverrides.set("required_alternative", {
      reproductionReference: "wrong-worker-finalized-reference",
    });
    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath,
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).rejects.toThrow("image SHA or metadata does not match the batch");
    finalizedMetadataOverrides.clear();

    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath,
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).resolves.toEqual({
      adoptedExistingProductions: 1,
      failed: 0,
      imagesVerified: 1,
      skippedExisting: 0,
      skippedExistingVersions: 0,
      staged: 1,
      total: 1,
      workerFinalized: 1,
    });
    expect(
      calls.some(
        ({ method, path }) =>
          method === "POST" && (path.endsWith("/image-assets") || path.endsWith("/submit")),
      ),
    ).toBe(false);
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      days: Record<string, { contentVersion: string; status: string }>;
    };
    expect(ledger.days[FORTUNE_DATE]).toMatchObject({
      contentVersion: "content-worker-finalized",
      status: "worker_finalized",
    });
  });

  it("strictly adopts one existing unsubmitted deterministic production and records its origin", async () => {
    const batchRoot = await createBatchFixture();
    const ledgerPath = join(batchRoot, "adopt-ledger.json");
    const generated = new DeterministicDraftGenerator().generate(FORTUNE_DATE);
    let draftRevision = 4;
    const selected = new Map<"optional" | "required_alternative" | "required_primary", string>();
    const metadataOverrides = new Map<FixtureImageSlot, Partial<ImageAssetUploadMetadata>>();
    let failDraftRead = false;
    const calls: Array<{ method: string; path: string }> = [];
    const json = (status: number, body: unknown, responseHeaders?: Record<string, string>) =>
      new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json", ...responseHeaders },
        status,
      });
    const fetchMock: typeof fetch = async (input, init = {}) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
      const method = init.method ?? "GET";
      calls.push({ method, path: url.pathname });
      if (url.pathname === "/admin/api/v1/auth/sessions" && method === "POST") {
        return json(
          201,
          { csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters" },
          {
            "Set-Cookie": "five_admin_session=opaque-adopt-session; HttpOnly; Secure; Path=/admin",
          },
        );
      }
      if (url.pathname === "/admin/api/v1/auth/session" && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/admin/api/v1/daily-content-productions" && method === "GET") {
        return json(200, {
          items: [
            {
              draftId: "draft-import-test",
              draftRevision,
              fortuneDate: FORTUNE_DATE,
              status: "generating",
            },
          ],
        });
      }
      if (url.pathname === `/admin/api/v1/operations/days/${FORTUNE_DATE}`) {
        return json(200, {
          concurrency: { activeContentVersion: null },
          previewSource: "draft",
        });
      }
      if (url.pathname === "/admin/api/v1/daily-content-versions") {
        return json(200, { items: [] });
      }
      if (url.pathname === "/admin/api/v1/daily-content-drafts" && method === "GET") {
        return json(200, {
          items: [
            {
              draftId: "draft-import-test",
              draftRevision,
              fortuneDate: FORTUNE_DATE,
            },
          ],
        });
      }
      if (url.pathname === "/admin/api/v1/daily-content-drafts/draft-import-test") {
        if (failDraftRead) {
          return json(500, { error: { code: "INTERNAL_ERROR" } });
        }
        return json(200, {
          draftId: "draft-import-test",
          draftRevision,
          fortuneDate: FORTUNE_DATE,
          modules: generated,
          state: "draft",
        });
      }
      if (
        url.pathname === "/admin/api/v1/daily-content-drafts/draft-import-test/image-assets" &&
        method === "GET"
      ) {
        return json(
          200,
          {
            draftId: "draft-import-test",
            draftRevision,
            fortuneDate: FORTUNE_DATE,
            items: [...selected].map(([imageSlot, imageSha]) => ({
              asset: fixtureAdminImageAsset(imageSlot, imageSha, metadataOverrides.get(imageSlot)),
              imageSlot,
              selectedForSlot: true,
            })),
          },
          { ETag: `"draft:${draftRevision}"` },
        );
      }
      if (
        url.pathname === "/admin/api/v1/daily-content-drafts/draft-import-test/image-assets" &&
        method === "POST"
      ) {
        const body = init.body;
        if (!(body instanceof FormData)) throw new Error("expected multipart FormData");
        const imageSlot = body.get("imageSlot");
        const file = body.get("file");
        if (
          (imageSlot !== "required_primary" && imageSlot !== "required_alternative") ||
          !(file instanceof Blob)
        ) {
          throw new Error("invalid multipart fixture request");
        }
        selected.set(imageSlot, sha256(Buffer.from(await file.arrayBuffer())));
        draftRevision += 1;
        return json(201, {
          asset: { assetId: `asset-${selected.size}`, sha256: selected.get(imageSlot) },
          draftId: "draft-import-test",
          draftRevision,
          fortuneDate: FORTUNE_DATE,
          imageSlot,
          selectedForSlot: true,
        });
      }
      return json(404, { error: { code: "RESOURCE_NOT_FOUND" } });
    };

    failDraftRead = true;
    const redactedLedgerPath = join(batchRoot, "redacted-error-ledger.json");
    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath: redactedLedgerPath,
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).rejects.toThrow("/daily-content-drafts/{draftId}");
    const redactedLedger = JSON.parse(await readFile(redactedLedgerPath, "utf8")) as {
      days: Record<string, { lastError: string; status: string }>;
    };
    expect(redactedLedger.days[FORTUNE_DATE]?.lastError).toContain(
      "/daily-content-drafts/{draftId}",
    );
    expect(redactedLedger.days[FORTUNE_DATE]?.lastError).not.toContain("draft-import-test");
    expect(redactedLedger.days[FORTUNE_DATE]?.status).toBe("pending");
    failDraftRead = false;
    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath: redactedLedgerPath,
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).resolves.toMatchObject({ adoptedExistingProductions: 1, imagesVerified: 1 });

    const writesBeforeMetadataMismatch = calls.filter(
      ({ method, path }) => method === "POST" && !path.endsWith("/auth/sessions"),
    ).length;
    metadataOverrides.set("required_primary", { altText: "同一图片但来源元数据不匹配" });
    const metadataMismatchLedgerPath = join(batchRoot, "metadata-mismatch-ledger.json");
    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath: metadataMismatchLedgerPath,
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).resolves.toMatchObject({
      adoptedExistingProductions: 0,
      imagesVerified: 0,
      skippedExisting: 1,
    });
    expect(
      calls.filter(({ method, path }) => method === "POST" && !path.endsWith("/auth/sessions")),
    ).toHaveLength(writesBeforeMetadataMismatch);
    const metadataMismatchLedger = JSON.parse(
      await readFile(metadataMismatchLedgerPath, "utf8"),
    ) as {
      days: Record<string, { lastError: string; status: string }>;
    };
    expect(metadataMismatchLedger.days[FORTUNE_DATE]).toMatchObject({
      status: "skipped_existing",
    });
    expect(metadataMismatchLedger.days[FORTUNE_DATE]?.lastError).toContain(
      "metadata does not match",
    );
    metadataOverrides.clear();

    selected.set("optional", "e".repeat(64));
    const optionalLedgerPath = join(batchRoot, "optional-adoption-ledger.json");
    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath: optionalLedgerPath,
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).resolves.toMatchObject({ adoptedExistingProductions: 0, skippedExisting: 1 });
    selected.delete("optional");

    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath,
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).resolves.toEqual({
      adoptedExistingProductions: 1,
      failed: 0,
      imagesVerified: 1,
      skippedExisting: 0,
      skippedExistingVersions: 0,
      staged: 1,
      total: 1,
      workerFinalized: 0,
    });
    expect(
      calls.some(
        ({ method, path }) =>
          method === "POST" && path === "/admin/api/v1/daily-content-productions",
      ),
    ).toBe(false);
    expect(calls.some(({ path }) => path.endsWith("/submit"))).toBe(false);
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      days: Record<string, { productionOwnership: string; status: string }>;
    };
    expect(ledger.days[FORTUNE_DATE]).toMatchObject({
      productionOwnership: "adopted_existing_production",
      status: "images_verified",
    });
  });

  it("rejects a tampered image before any Admin HTTP request", async () => {
    const batchRoot = await createBatchFixture();
    await writeFile(join(batchRoot, "images/primary.png"), Buffer.from("tampered"));
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath: join(batchRoot, "ledger.json"),
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).rejects.toThrow("SHA-256 mismatch for images/primary.png");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records and skips a day that already has server content", async () => {
    const batchRoot = await createBatchFixture();
    const ledgerPath = join(batchRoot, "skip-ledger.json");
    const calls: Array<{ method: string; path: string }> = [];
    const json = (status: number, body: unknown, responseHeaders?: Record<string, string>) =>
      new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json", ...responseHeaders },
        status,
      });
    const fetchMock: typeof fetch = async (input, init = {}) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
      const method = init.method ?? "GET";
      calls.push({ method, path: url.pathname });
      if (url.pathname === "/admin/api/v1/auth/sessions") {
        return json(
          201,
          { csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters" },
          { "Set-Cookie": "five_admin_session=opaque-test-session; HttpOnly; Secure; Path=/admin" },
        );
      }
      if (url.pathname === "/admin/api/v1/auth/session" && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/admin/api/v1/daily-content-productions") {
        return json(200, {
          items: [
            {
              draftId: "draft-existing",
              draftRevision: 5,
              fortuneDate: FORTUNE_DATE,
              status: "awaiting_review",
            },
          ],
        });
      }
      if (url.pathname.startsWith("/admin/api/v1/operations/days/")) {
        return json(200, {
          concurrency: { activeContentVersion: "content-existing" },
          previewSource: "published",
        });
      }
      if (url.pathname === "/admin/api/v1/daily-content-versions") {
        return json(200, {
          items: [{ contentVersion: "content-existing", state: "published" }],
        });
      }
      if (url.pathname === "/admin/api/v1/daily-content-drafts") {
        return json(200, { items: [] });
      }
      return json(404, { error: { code: "RESOURCE_NOT_FOUND" } });
    };

    await expect(
      importProductionBatchViaAdmin({
        baseUrl: "https://five.example.test",
        batchRoot,
        confirmWorkerStopped: true,
        expectedDayCount: 1,
        fetchImpl: fetchMock,
        ledgerPath,
        origin: "https://five.example.test",
        password: "password-not-logged",
        username: "admin",
      }),
    ).resolves.toEqual({
      adoptedExistingProductions: 0,
      failed: 0,
      imagesVerified: 0,
      skippedExisting: 1,
      skippedExistingVersions: 1,
      staged: 0,
      total: 1,
      workerFinalized: 0,
    });
    expect(
      calls.some(
        ({ method, path }) =>
          method === "POST" && path === "/admin/api/v1/daily-content-productions",
      ),
    ).toBe(false);
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as {
      days: Record<string, { status: string }>;
    };
    expect(ledger.days[FORTUNE_DATE]?.status).toBe("skipped_existing");
  });
});
