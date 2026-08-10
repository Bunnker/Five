import type { components } from "@five/api-contract";

import type { DailyContentProduction } from "./content-production.service";

export type DailyImageSlot = components["schemas"]["DailyImageSlot"];
export type DailyImageSlotProduction = DailyContentProduction["imageSlots"][number];
export type DailyImageSlotProductionStatus =
  components["schemas"]["DailyImageSlotProductionStatus"];

export const AUTOMATIC_IMAGE_ATTEMPTS_PER_CYCLE = 3;

export const DAILY_IMAGE_SLOTS = [
  "required_primary",
  "required_alternative",
  "optional",
] as const satisfies readonly DailyImageSlot[];

export const REQUIRED_IMAGE_SLOTS = [
  "required_primary",
  "required_alternative",
] as const satisfies readonly DailyImageSlot[];

const INVALID_IMAGE_SLOT_PROJECTION =
  "Content production image slot projection must contain each daily image slot exactly once";

function requireIndexedImageSlot(
  imageSlotsByName: ReadonlyMap<DailyImageSlot, DailyImageSlotProduction>,
  imageSlot: DailyImageSlot,
): DailyImageSlotProduction {
  const slot = imageSlotsByName.get(imageSlot);
  if (slot === undefined) throw new Error(INVALID_IMAGE_SLOT_PROJECTION);
  return slot;
}

export function initialImageSlotProduction(
  availableAt: string,
): DailyContentProduction["imageSlots"] {
  return [
    {
      attemptLimit: AUTOMATIC_IMAGE_ATTEMPTS_PER_CYCLE,
      attempts: 0,
      canRetry: false,
      deliveryReady: false,
      imageSlot: "required_primary",
      lastError: null,
      nextAttemptAt: availableAt,
      status: "pending",
    },
    {
      attemptLimit: AUTOMATIC_IMAGE_ATTEMPTS_PER_CYCLE,
      attempts: 0,
      canRetry: false,
      deliveryReady: false,
      imageSlot: "required_alternative",
      lastError: null,
      nextAttemptAt: availableAt,
      status: "pending",
    },
    {
      attemptLimit: 0,
      attempts: 0,
      canRetry: false,
      deliveryReady: false,
      imageSlot: "optional",
      lastError: null,
      nextAttemptAt: null,
      status: "not_requested",
    },
  ];
}

export function projectImageSlotProduction(
  production: DailyContentProduction,
  imageSlots: DailyContentProduction["imageSlots"],
  updatedAt: string,
  draftRevision = production.draftRevision,
): DailyContentProduction {
  const imageSlotsByName = new Map<DailyImageSlot, DailyImageSlotProduction>();
  for (const slot of imageSlots) {
    if (imageSlotsByName.has(slot.imageSlot)) {
      throw new Error(INVALID_IMAGE_SLOT_PROJECTION);
    }
    imageSlotsByName.set(slot.imageSlot, slot);
  }
  if (
    imageSlotsByName.size !== DAILY_IMAGE_SLOTS.length ||
    DAILY_IMAGE_SLOTS.some((imageSlot) => !imageSlotsByName.has(imageSlot))
  ) {
    throw new Error(INVALID_IMAGE_SLOT_PROJECTION);
  }
  const required = REQUIRED_IMAGE_SLOTS.map((imageSlot) =>
    requireIndexedImageSlot(imageSlotsByName, imageSlot),
  );
  const optional = requireIndexedImageSlot(imageSlotsByName, "optional");
  const orderedImageSlots = DAILY_IMAGE_SLOTS.map((imageSlot) =>
    requireIndexedImageSlot(imageSlotsByName, imageSlot),
  ) as DailyContentProduction["imageSlots"];
  const requiredGenerationComplete = required.every((slot) => slot.status === "ready");
  const requiredGenerationFailed = required.some((slot) => slot.status === "failed");
  const requiredImagesReady = required.every((slot) => slot.deliveryReady);
  const requiredDeliveryError = required.some(
    (slot) => !slot.deliveryReady && slot.lastError !== null,
  );
  return {
    ...production,
    completedImageSlots: required.filter((slot) => slot.status === "ready").length,
    draftRevision,
    imageSlots: orderedImageSlots,
    lastError: requiredImagesReady
      ? null
      : (required.find((slot) => !slot.deliveryReady && slot.lastError !== null)?.lastError ??
        null),
    optionalImageStatus: optional.status,
    pendingImageSlots: required.filter((slot) => slot.status === "pending").length,
    requiredGenerationComplete,
    requiredImagesReady,
    status: requiredImagesReady
      ? "awaiting_review"
      : requiredGenerationFailed || requiredDeliveryError
        ? "failed"
        : "generating",
    updatedAt,
  };
}
