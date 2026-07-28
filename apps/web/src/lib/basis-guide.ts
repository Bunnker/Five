import type { AttentionGroupData, DecisionCardData, TodayBasisData, TodayPageData } from "./today";

export type BasisTierData = AttentionGroupData | DecisionCardData;

export interface BasisGuideData {
  basis: TodayBasisData;
  contentVersion: string;
  dayElementLabel: string;
  steps: [
    {
      description: string;
      label: "今日干支";
      value: string;
    },
    {
      description: string;
      label: "日柱地支";
      value: string;
    },
    {
      description: string;
      label: "当日五行";
      value: string;
    },
  ];
  tiers: [
    DecisionCardData,
    DecisionCardData,
    DecisionCardData,
    AttentionGroupData,
    AttentionGroupData,
  ];
}

export function toBasisGuideData(today: TodayPageData | null): BasisGuideData | null {
  if (
    today === null ||
    today.basis === null ||
    today.basis === undefined ||
    today.daJiCard === null ||
    today.ciJiCard === null ||
    today.pingCard === null ||
    today.attentionSection === null ||
    today.basis.steps.length !== 3
  ) {
    return null;
  }

  const { branch, dayElementLabel, ganzhiDay } = today.content.calendar;
  const versions = [
    today.basis.contentVersion,
    today.daJiCard.contentVersion,
    today.ciJiCard.contentVersion,
    today.pingCard.contentVersion,
    today.attentionSection.contentVersion,
  ];
  if (
    !versions.every((version) => version === versions[0]) ||
    !today.basis.steps[0].includes(ganzhiDay) ||
    !today.basis.steps[1].includes(branch) ||
    !today.basis.steps[2].includes(branch) ||
    !today.basis.steps[2].includes(dayElementLabel)
  ) {
    return null;
  }

  return {
    basis: today.basis,
    contentVersion: today.basis.contentVersion,
    dayElementLabel,
    steps: [
      {
        description: today.basis.steps[0],
        label: "今日干支",
        value: `${ganzhiDay}日`,
      },
      {
        description: today.basis.steps[1],
        label: "日柱地支",
        value: branch,
      },
      {
        description: today.basis.steps[2],
        label: "当日五行",
        value: `${dayElementLabel}日`,
      },
    ],
    tiers: [
      today.daJiCard,
      today.ciJiCard,
      today.pingCard,
      today.attentionSection.groups[0],
      today.attentionSection.groups[1],
    ],
  };
}
