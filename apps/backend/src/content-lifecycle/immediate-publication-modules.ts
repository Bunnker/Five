import type { components } from "@five/api-contract";

import type { StoredDraftImageAsset } from "../daily-images/daily-image-asset.store";
import type { DraftModules } from "./content-lifecycle.store";

type CopyAndFormulaModule = components["schemas"]["CopyAndFormulaModule"];
type DailyImageSlot = components["schemas"]["DailyImageSlot"];
type LookDraft = components["schemas"]["LookDraft"];

const IMAGE_SLOTS = ["required_primary", "required_alternative", "optional"] as const;
const REQUIRED_IMAGE_SLOTS = ["required_primary", "required_alternative"] as const;
const FORMULA_KIND_BY_IMAGE_SLOT: Readonly<Record<DailyImageSlot, "dual" | "mono" | "triple">> = {
  optional: "triple",
  required_alternative: "dual",
  required_primary: "mono",
};

function lookItems(formula: CopyAndFormulaModule["outfitFormulas"][number]): LookDraft["items"] {
  return formula.slots.map((slot, index) => ({
    category: index === 0 ? "top" : index === 1 ? "bottom" : "accessory",
    categoryLabel: slot.garmentParts[0] ?? slot.roleLabel,
    colorCode: slot.colorCodes[0] ?? "unspecified",
    description: `${slot.roleLabel}：${slot.garmentParts.join("、")}`,
  }));
}

/**
 * Turns generated candidates into the first immutable public snapshot. Human review metadata is
 * deliberately preserved on each asset, but no longer blocks initial publication (Issue #39).
 */
export function prepareImmediatePublicationModules(
  modules: DraftModules,
  candidates: readonly StoredDraftImageAsset[],
): DraftModules | null {
  const copy = modules.copy_and_formula;
  if (modules.calendar_algorithm === null || copy === null) return null;

  const candidatesBySlot = new Map<DailyImageSlot, StoredDraftImageAsset>();
  for (const candidate of candidates) {
    if (candidate.imageSlot === null || candidate.selectedForSlot === false) continue;
    if (candidatesBySlot.has(candidate.imageSlot)) return null;
    candidatesBySlot.set(candidate.imageSlot, candidate);
  }
  const selected = IMAGE_SLOTS.flatMap((imageSlot) => {
    const candidate = candidatesBySlot.get(imageSlot);
    return candidate === undefined ? [] : [{ candidate, imageSlot }];
  });

  const visual =
    modules.visual_and_rights ??
    (() => {
      const requiredCandidates = REQUIRED_IMAGE_SLOTS.map((imageSlot) =>
        candidatesBySlot.get(imageSlot),
      );
      if (requiredCandidates.some((candidate) => candidate === undefined)) return null;
      const requiredAssets = requiredCandidates.filter(
        (candidate): candidate is StoredDraftImageAsset => candidate !== undefined,
      );
      if (
        new Set(requiredAssets.map((candidate) => candidate.asset.assetId)).size !== 2 ||
        new Set(requiredAssets.map((candidate) => candidate.asset.sha256)).size !== 2
      ) {
        return null;
      }
      const looks = selected.map(({ candidate, imageSlot }, index): LookDraft | null => {
        const formula = copy.outfitFormulas.find(
          ({ kind }) => kind === FORMULA_KIND_BY_IMAGE_SLOT[imageSlot],
        );
        if (formula === undefined) return null;
        const fallbackCandidate =
          imageSlot === "required_primary"
            ? candidatesBySlot.get("required_alternative")
            : candidatesBySlot.get("required_primary");
        return {
          alternatives: [],
          audience: structuredClone(formula.audience),
          coverAssetId: candidate.asset.assetId,
          detailAssetIds: [],
          fallbackAssetId:
            imageSlot === "optional"
              ? null
              : (fallbackCandidate?.asset.assetId ?? candidate.asset.assetId),
          formulaId: formula.formulaId,
          imageSlot,
          items: lookItems(formula),
          lookId: formula.lookIds[0] ?? `automatic-look-${index + 1}`,
          requiredForPublish: imageSlot !== "optional",
          scenario: structuredClone(formula.scenario),
          sortOrder: index + 1,
          title: formula.title,
        } as LookDraft;
      });
      if (looks.some((look) => look === null)) return null;
      const rightsRecords = new Map<string, components["schemas"]["RightsRecord"]>();
      for (const { candidate } of selected) {
        for (const rightsRecordId of candidate.asset.rightsRecordIds) {
          rightsRecords.set(rightsRecordId, {
            kind: "internal_record",
            recordedAt: candidate.uploadedAt,
            reference: `发布后补充：${candidate.asset.assetId}`,
            rightsRecordId,
          });
        }
      }
      return {
        assetManifestVersion: "automatic-first-publication-v1",
        assets: selected.map(({ candidate }) => structuredClone(candidate.asset)),
        looks: looks as LookDraft[],
        rightsRecords: [...rightsRecords.values()],
      };
    })();
  if (visual === null) return null;
  const requiredLooks = visual.looks.filter((look) => look.imageSlot !== "optional");
  const requiredVisualAssets = requiredLooks
    .map((look) => visual.assets.find((asset) => asset.assetId === look.coverAssetId))
    .filter((asset): asset is components["schemas"]["AdminImageAsset"] => asset !== undefined);
  if (
    requiredLooks.length !== 2 ||
    requiredVisualAssets.length !== 2 ||
    new Set(requiredVisualAssets.map((asset) => asset.assetId)).size !== 2 ||
    new Set(requiredVisualAssets.map((asset) => asset.sha256)).size !== 2
  ) {
    return null;
  }

  return {
    ...structuredClone(modules),
    poster_consistency: modules.poster_consistency ?? {
      posterTemplateVersion: copy.share.posterTemplateVersion,
      sampleAssetId: visual.assets[0]?.assetId ?? "missing-poster-sample",
      templateId: "automatic-poster-template",
    },
    visual_and_rights: visual,
  };
}
