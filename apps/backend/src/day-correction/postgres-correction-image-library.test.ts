import { describe, expect, it, vi } from "vitest";

import { PostgresCorrectionImageLibrary } from "./postgres-correction-image-library";

function modules(colors: readonly string[]) {
  return {
    calendar_algorithm: {
      tiers: [
        {
          colors: colors.map((colorCode) => ({ colorCode, name: colorCode })),
          tierCode: "da_ji",
        },
      ],
    },
    copy_and_formula: null,
    poster_consistency: null,
    visual_and_rights: null,
  };
}

describe("PostgresCorrectionImageLibrary", () => {
  it("returns only immutable source snapshots with the same slot color signature", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ modules: modules(["white", "silver"]) }] })
      .mockResolvedValueOnce({
        rows: [
          {
            asset_id: "asset-compatible",
            content_version: "content-compatible",
            fortune_date: "2026-08-01",
            snapshot: modules(["silver", "white"]),
          },
          {
            asset_id: "asset-other-colors",
            content_version: "content-other",
            fortune_date: "2026-07-31",
            snapshot: modules(["red"]),
          },
        ],
      });
    const library = new PostgresCorrectionImageLibrary({ query } as never);

    await expect(
      library.listEligible({
        draftId: "draft-correction",
        imageSlot: "required_primary",
        limit: 24,
      }),
    ).resolves.toEqual([
      {
        assetId: "asset-compatible",
        colorCodes: ["silver", "white"],
        imageSlot: "required_primary",
        previewUrl: "/admin/api/v1/image-assets/asset-compatible/preview",
        sourceContentVersion: "content-compatible",
        sourceFortuneDate: "2026-08-01",
      },
    ]);
    expect(String(query.mock.calls[1]?.[0])).toContain(
      "version.state IN ('published', 'superseded')",
    );
    expect(String(query.mock.calls[1]?.[0])).toContain("deliveryStatus");
    expect(String(query.mock.calls[1]?.[0])).toContain("image_asset_withdrawal_events");
  });
});
