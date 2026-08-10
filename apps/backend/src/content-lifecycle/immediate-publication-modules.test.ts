import type { components } from "@five/api-contract";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DeterministicDraftGenerator } from "../content-production/deterministic-draft.generator";
import type { StoredDraftImageAsset } from "../daily-images/daily-image-asset.store";
import { prepareImmediatePublicationModules } from "./immediate-publication-modules";

type DailyImageSlot = components["schemas"]["DailyImageSlot"];

const THREE_SLOT_ORDERS: readonly (readonly DailyImageSlot[])[] = [
  ["required_primary", "required_alternative", "optional"],
  ["required_primary", "optional", "required_alternative"],
  ["required_alternative", "required_primary", "optional"],
  ["required_alternative", "optional", "required_primary"],
  ["optional", "required_primary", "required_alternative"],
  ["optional", "required_alternative", "required_primary"],
];

function candidate(
  imageSlot: DailyImageSlot | null,
  suffix = imageSlot ?? "legacy",
): StoredDraftImageAsset {
  const assetId = `asset-${suffix}`;
  const sha256 = createHash("sha256").update(suffix).digest("hex");
  return {
    asset: {
      aiLabelStatus: "pending",
      altText: `${suffix} 自动生成穿搭图`,
      assetId,
      declaredModel: "gpt-image-2",
      fileUrl: null,
      generatedAt: "2026-08-02T10:00:00.000Z",
      generationMethod: "external_tool",
      height: 1600,
      manualReview: null,
      mediaType: "image/png",
      promptVersion: "five-look-v1",
      reproductionReference: `request-${suffix}`,
      reviewStatus: "pending",
      rightsRecordIds: [`rights-${suffix}`],
      rightsStatus: "pending",
      sha256,
      sourceMaterialReferences: [`source-${suffix}`],
      sourceType: "ai_generated",
      width: 1200,
    },
    draftId: "draft-slot-freeze",
    fortuneDate: "2026-08-03",
    imageSlot,
    reviewLocked: false,
    selectionSource: "automatic_generation",
    selectedForSlot: true,
    storageKey: `${sha256.slice(0, 2)}/${sha256}.png`,
    uploadedAt: "2026-08-02T10:00:00.000Z",
  };
}

function modules() {
  return new DeterministicDraftGenerator().generate("2026-08-03");
}

describe("immediate publication named image slots", () => {
  it.each(THREE_SLOT_ORDERS)(
    "freezes each generated candidate into its declared slot for order %j",
    (...order) => {
      const prepared = prepareImmediatePublicationModules(
        modules(),
        order.map((slot) => candidate(slot)),
      );
      const looks = prepared?.visual_and_rights?.looks;

      expect(looks?.map(({ imageSlot }) => imageSlot)).toEqual([
        "required_primary",
        "required_alternative",
        "optional",
      ]);
      expect(looks?.find(({ imageSlot }) => imageSlot === "required_primary")?.coverAssetId).toBe(
        "asset-required_primary",
      );
      expect(
        looks?.find(({ imageSlot }) => imageSlot === "required_alternative")?.coverAssetId,
      ).toBe("asset-required_alternative");
      expect(looks?.find(({ imageSlot }) => imageSlot === "optional")?.coverAssetId).toBe(
        "asset-optional",
      );
    },
  );

  it("publishes when both required slots are named and optional was not requested", () => {
    const prepared = prepareImmediatePublicationModules(modules(), [
      candidate("required_alternative"),
      candidate("required_primary"),
    ]);

    expect(prepared?.visual_and_rights?.looks.map(({ imageSlot }) => imageSlot)).toEqual([
      "required_primary",
      "required_alternative",
    ]);
  });

  it("never guesses slots for historical candidates with null image_slot", () => {
    expect(
      prepareImmediatePublicationModules(modules(), [
        candidate(null, "legacy-a"),
        candidate(null, "legacy-b"),
        candidate(null, "legacy-c"),
      ]),
    ).toBeNull();
  });

  it("rejects an ambiguous duplicate named slot", () => {
    expect(
      prepareImmediatePublicationModules(modules(), [
        candidate("required_primary", "primary-a"),
        candidate("required_primary", "primary-b"),
        candidate("required_alternative"),
      ]),
    ).toBeNull();
  });

  it("ignores unselected history and freezes only the explicit candidate for each slot", () => {
    const historical = {
      ...candidate("required_primary", "primary-history"),
      selectedForSlot: false,
    };
    const prepared = prepareImmediatePublicationModules(modules(), [
      historical,
      candidate("required_primary", "primary-selected"),
      candidate("required_alternative", "alternative-selected"),
    ]);

    expect(
      prepared?.visual_and_rights?.looks.find(({ imageSlot }) => imageSlot === "required_primary")
        ?.coverAssetId,
    ).toBe("asset-primary-selected");
  });

  it("rejects two required selections with distinct ids but identical bytes", () => {
    const primary = candidate("required_primary", "primary-same-bytes");
    const alternative = candidate("required_alternative", "alternative-same-bytes");

    expect(
      prepareImmediatePublicationModules(modules(), [
        primary,
        {
          ...alternative,
          asset: { ...alternative.asset, sha256: primary.asset.sha256 },
        },
      ]),
    ).toBeNull();
  });
});
