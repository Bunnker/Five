import { describe, expect, it } from "vitest";

import {
  initialImageSlotProduction,
  projectImageSlotProduction,
} from "./content-production.status";

type Production = Parameters<typeof projectImageSlotProduction>[0];
type ImageSlots = Parameters<typeof projectImageSlotProduction>[1];
type ImageSlot = ImageSlots[number];

const UPDATED_AT = "2026-08-02T10:00:00.000Z";
const THREE_SLOT_ORDERS: readonly (readonly ImageSlot["imageSlot"][])[] = [
  ["required_primary", "required_alternative", "optional"],
  ["required_primary", "optional", "required_alternative"],
  ["required_alternative", "required_primary", "optional"],
  ["required_alternative", "optional", "required_primary"],
  ["optional", "required_primary", "required_alternative"],
  ["optional", "required_alternative", "required_primary"],
];

function production(): Production {
  return {
    completedImageSlots: 0,
    draftId: "draft-status-projection",
    draftRevision: 1,
    fortuneDate: "2026-08-03",
    imageSlots: initialImageSlotProduction(UPDATED_AT),
    lastError: null,
    optionalImageStatus: "not_requested",
    pendingImageSlots: 2,
    requiredGenerationComplete: false,
    requiredImagesReady: false,
    status: "generating",
    updatedAt: UPDATED_AT,
  };
}

function imageSlot(imageSlot: ImageSlot["imageSlot"], changes: Partial<ImageSlot> = {}): ImageSlot {
  const initial = initialImageSlotProduction(UPDATED_AT).find(
    (candidate) => candidate.imageSlot === imageSlot,
  );
  if (initial === undefined) throw new Error(`Missing ${imageSlot} fixture`);
  return { ...initial, ...changes, imageSlot } as ImageSlot;
}

function imageSlots(...slots: ImageSlot[]): ImageSlots {
  return slots as unknown as ImageSlots;
}

function completedSlot(imageSlotName: ImageSlot["imageSlot"]): ImageSlot {
  return imageSlot(
    imageSlotName,
    imageSlotName === "optional"
      ? { lastError: "可选图生成失败", status: "failed" }
      : { deliveryReady: true, nextAttemptAt: null, status: "ready" },
  );
}

describe("content production status projection", () => {
  it.each(THREE_SLOT_ORDERS)(
    "projects named image slots independently of input order %j",
    (...order) => {
      const projected = projectImageSlotProduction(
        production(),
        imageSlots(...order.map(completedSlot)),
        UPDATED_AT,
      );

      expect(projected).toMatchObject({
        completedImageSlots: 2,
        lastError: null,
        optionalImageStatus: "failed",
        pendingImageSlots: 0,
        requiredGenerationComplete: true,
        requiredImagesReady: true,
        status: "awaiting_review",
      });
      expect(projected.imageSlots.map(({ imageSlot }) => imageSlot)).toEqual([
        "required_primary",
        "required_alternative",
        "optional",
      ]);
    },
  );

  it("rejects a duplicate named slot as a broken internal projection invariant", () => {
    expect(() =>
      projectImageSlotProduction(
        production(),
        imageSlots(
          imageSlot("required_primary"),
          imageSlot("required_primary", { status: "failed" }),
          imageSlot("optional"),
        ),
        UPDATED_AT,
      ),
    ).toThrowError(
      "Content production image slot projection must contain each daily image slot exactly once",
    );
  });

  it("rejects a missing named slot as a broken internal projection invariant", () => {
    expect(() =>
      projectImageSlotProduction(
        production(),
        imageSlots(imageSlot("required_alternative"), imageSlot("required_primary")),
        UPDATED_AT,
      ),
    ).toThrowError(
      "Content production image slot projection must contain each daily image slot exactly once",
    );
  });
});
