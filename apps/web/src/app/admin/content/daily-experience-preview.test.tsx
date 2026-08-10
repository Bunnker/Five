import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AdminImageAsset, ContentDraft } from "../admin-api";
import { AdminCorrectionPhonePreview, DailyExperiencePreview } from "./daily-experience-preview";

const modules = {
  calendar_algorithm: {
    algorithmVersion: "algorithm-v1",
    calendar: {
      branch: "酉",
      dayElement: "metal",
      dayElementLabel: "金",
      ganzhiDay: "己酉",
      lunarDateText: "六月廿一",
      weekdayText: "星期一",
    },
    calendarDataVersion: "data-v1",
    calendarRuleVersion: "rule-v1",
    tiers: [
      {
        algorithmLabel: "大吉",
        colors: [{ colorCode: "black", name: "黑色" }],
        displayLabel: "今日优先",
        displaySection: "primary",
        element: "water",
        elementLabel: "水",
        explanation: "今天优先参考水色。",
        rank: 1,
        relationText: "金生水",
        tierCode: "da_ji",
      },
      {
        algorithmLabel: "次吉",
        colors: [{ colorCode: "white", name: "白色" }],
        displayLabel: "稳妥选择",
        displaySection: "primary",
        element: "metal",
        elementLabel: "金",
        explanation: "同类颜色可作为稳妥选择。",
        rank: 2,
        relationText: "金与金同类",
        tierCode: "ci_ji",
      },
      {
        algorithmLabel: "平",
        colors: [{ colorCode: "red", name: "红色" }],
        displayLabel: "日常可穿",
        displaySection: "primary",
        element: "fire",
        elementLabel: "火",
        explanation: "适合作为日常穿搭参考。",
        rank: 3,
        relationText: "火克金",
        tierCode: "ping",
      },
      {
        algorithmLabel: "较差",
        colors: [{ colorCode: "yellow", name: "黄色" }],
        displayLabel: "注意",
        displaySection: "attention",
        element: "earth",
        elementLabel: "土",
        explanation: "今天建议降低土色的大面积使用比例。",
        rank: 4,
        relationText: "土生金",
        tierCode: "jiao_cha",
      },
      {
        algorithmLabel: "不利",
        colors: [{ colorCode: "green", name: "绿色" }],
        displayLabel: "注意",
        displaySection: "attention",
        element: "wood",
        elementLabel: "木",
        explanation: "今天建议减少大面积使用木色。",
        rank: 5,
        relationText: "金克木",
        tierCode: "bu_li",
      },
    ],
  },
  copy_and_formula: {
    balanceSuggestion: {
      accessoryExamples: ["丝巾", "包"],
      description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
      preferredTierCode: "da_ji",
      title: "已经穿了注意色",
    },
    basis: {
      disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
      steps: ["今日干支为己酉", "酉属金，因此今日为金日"],
    },
    copyVersion: "copy-v1",
    outfitFormulas: [
      {
        audience: { code: "all", label: "通用" },
        disclaimer: "同色系穿搭参考。",
        formulaId: "formula-mono",
        kind: "mono",
        lookIds: ["look-mono"],
        scenario: { code: "daily", label: "日常" },
        slots: [
          {
            colorCodes: ["black"],
            garmentParts: ["上衣", "下装"],
            ratioPercent: 100,
            role: "primary",
            roleLabel: "主色",
            tierCode: "da_ji",
          },
        ],
        title: "黑色同色系",
      },
      {
        audience: { code: "all", label: "通用" },
        disclaimer: "双色穿搭参考。",
        formulaId: "formula-dual",
        kind: "dual",
        lookIds: ["look-dual"],
        scenario: { code: "daily", label: "日常" },
        slots: [
          {
            colorCodes: ["black"],
            garmentParts: ["上衣"],
            ratioPercent: 60,
            role: "primary",
            roleLabel: "主色",
            tierCode: "da_ji",
          },
          {
            colorCodes: ["white"],
            garmentParts: ["下装"],
            ratioPercent: 40,
            role: "secondary",
            roleLabel: "辅助色",
            tierCode: "ci_ji",
          },
        ],
        title: "黑色与白色",
      },
      {
        audience: { code: "all", label: "通用" },
        disclaimer: "三色穿搭参考。",
        formulaId: "formula-triple",
        kind: "triple",
        lookIds: ["look-triple"],
        scenario: { code: "commute", label: "通勤" },
        slots: [
          {
            colorCodes: ["black"],
            garmentParts: ["上衣"],
            ratioPercent: 60,
            role: "primary",
            roleLabel: "主色",
            tierCode: "da_ji",
          },
          {
            colorCodes: ["white"],
            garmentParts: ["下装"],
            ratioPercent: 30,
            role: "secondary",
            roleLabel: "辅助色",
            tierCode: "ci_ji",
          },
          {
            colorCodes: ["red"],
            garmentParts: ["配饰"],
            ratioPercent: 10,
            role: "accent",
            roleLabel: "点缀色",
            tierCode: "ping",
          },
        ],
        title: "通勤三色搭配",
      },
    ],
    outfitVersion: "outfit-v1",
    share: {
      copyText: "今日金日穿搭参考。",
      posterJobEndpoint: "/api/v1/poster-jobs",
      posterTemplateVersion: "poster-v1",
      summaryText: "今日优先参考黑色。",
    },
  },
  poster_consistency: null,
  visual_and_rights: null,
} satisfies ContentDraft["modules"];

describe("DailyExperiencePreview", () => {
  it("renders the draft through the same public-facing cards before technical JSON", () => {
    render(
      <DailyExperiencePreview
        fortuneDate="2026-08-03"
        images={[]}
        mode="draft"
        modules={modules}
        revisionLabel="draft-1"
      />,
    );

    expect(screen.getByRole("heading", { name: "先看用户最终会看到什么" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "当日金日" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "今日优先" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "当日怎么搭" })).toBeInTheDocument();
    expect(screen.getByText("黑色同色系")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "等待至少一张候选图" })).toBeInTheDocument();

    const daJi = screen.getByRole("article", { name: "今日优先" });
    expect(within(daJi).getByText("水", { selector: "strong" })).toBeVisible();
    expect(within(daJi).queryByText("金生水")).not.toBeInTheDocument();
    expect(within(daJi).getByText("今天优先参考水色。")).toBeVisible();
  });

  it("keeps missing image slots clickable and only previews explicit selections in canonical order", () => {
    const asset = (assetId: string): AdminImageAsset => ({
      aiLabelStatus: "not_applicable",
      altText: `${assetId} 模特穿搭`,
      assetId,
      declaredModel: null,
      fileUrl: null,
      generatedAt: null,
      generationMethod: "owned_upload",
      height: 1200,
      manualReview: null,
      mediaType: "image/png",
      promptVersion: null,
      reproductionReference: null,
      reviewStatus: "pending",
      rightsRecordIds: [],
      rightsStatus: "pending",
      sha256: assetId.padEnd(64, "0").slice(0, 64),
      sourceMaterialReferences: [`source:${assetId}`],
      sourceType: "licensed",
      width: 960,
    });

    const { container } = render(
      <AdminCorrectionPhonePreview
        fortuneDate="2026-08-03"
        images={[
          {
            asset: asset("optional-selected"),
            imageSlot: "optional",
            previewUrl: "/optional.png",
            selectedForSlot: true,
          },
          {
            asset: asset("primary-history"),
            imageSlot: "required_primary",
            previewUrl: "/history.png",
            selectedForSlot: false,
          },
          {
            asset: asset("primary-selected"),
            imageSlot: "required_primary",
            previewUrl: "/primary.png",
            selectedForSlot: true,
          },
        ]}
        modules={modules}
        onSelectionChange={() => undefined}
        revisionLabel="draft-2"
      />,
    );

    const placements = Array.from(container.querySelectorAll("[data-image-placement]")).map(
      (element) => element.getAttribute("data-image-placement"),
    );
    expect(placements).toEqual(["primary", "supplemental"]);
    expect(screen.queryByAltText("primary-history 模特穿搭")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /补充备选图/u })).toHaveAttribute(
      "data-admin-selection-key",
      "image.required_alternative",
    );
  });
});
