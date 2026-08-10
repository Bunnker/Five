import { describe, expect, it } from "vitest";

import {
  assertAuthorizedPreviewDatabaseUrl,
  validateLocalPreviewBatch,
} from "../../scripts/configure-local-preview-batch";

describe("local preview batch configuration", () => {
  it("accepts only the explicitly authorized isolated preview database", () => {
    expect(() =>
      assertAuthorizedPreviewDatabaseUrl("postgresql://five:local-only@127.0.0.1:55432/five", "1"),
    ).not.toThrow();

    expect(() =>
      assertAuthorizedPreviewDatabaseUrl("postgresql://five:local-only@127.0.0.1:5432/five", "1"),
    ).toThrow(/isolated preview database/u);
    expect(() =>
      assertAuthorizedPreviewDatabaseUrl(
        "postgresql://five:local-only@127.0.0.1:55432/five",
        undefined,
      ),
    ).toThrow(/FIVE_ALLOW_LOCAL_PREVIEW_IMPORT=1/u);
  });

  it("requires one algorithm entry and exactly two required uploads for every date", () => {
    const valid = validateLocalPreviewBatch({
      algorithms: {
        days: [
          {
            fortuneDate: "2026-08-09",
            modules: {
              calendar_algorithm: { algorithmVersion: "algorithm-v1" },
              copy_and_formula: { copyVersion: "copy-v1" },
            },
          },
        ],
      },
      uploadPlan: {
        uploadRequests: [
          {
            ensureProduction: {
              idempotencyKey: "prepare-2026-08-09",
            },
            fortuneDate: "2026-08-09",
            uploads: [
              {
                filePath: "images/primary.png",
                idempotencyKey: "upload-primary-2026-08-09",
                imageSlot: "required_primary",
                metadata: { altText: "主图" },
              },
              {
                filePath: "images/alternative.png",
                idempotencyKey: "upload-alternative-2026-08-09",
                imageSlot: "required_alternative",
                metadata: { altText: "备选图" },
              },
            ],
          },
        ],
      },
    });

    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ fortuneDate: "2026-08-09" });

    expect(() =>
      validateLocalPreviewBatch({
        algorithms: { days: [] },
        uploadPlan: { uploadRequests: [] },
      }),
    ).toThrow(/at least one date/u);
    expect(() =>
      validateLocalPreviewBatch({
        algorithms: {
          days: [
            {
              fortuneDate: "2026-08-09",
              modules: {
                calendar_algorithm: { algorithmVersion: "algorithm-v1" },
                copy_and_formula: { copyVersion: "copy-v1" },
              },
            },
          ],
        },
        uploadPlan: {
          uploadRequests: [
            {
              ensureProduction: { idempotencyKey: "prepare-2026-08-09" },
              fortuneDate: "2026-08-09",
              uploads: [
                {
                  filePath: "images/primary.png",
                  idempotencyKey: "upload-primary-2026-08-09",
                  imageSlot: "required_primary",
                  metadata: { altText: "主图" },
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(/exactly two required uploads/u);
  });
});
