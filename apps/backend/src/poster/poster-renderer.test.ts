import type { components } from "@five/api-contract";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import {
  FixedSvgPosterRenderer,
  LEGACY_AUTOMATIC_POSTER_TEMPLATE_VERSION,
  PublicWebPosterImageOriginPolicy,
  StrictPosterImageOriginPolicy,
} from "./poster-renderer";

type DailyContent = components["schemas"]["DailyContent"];

const SOURCE_IMAGE_BYTES = Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=",
  "base64",
);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function reviewedImageResponse(
  body: string | Uint8Array = SOURCE_IMAGE_BYTES,
  headers: Record<string, string> = {
    "content-length": String(SOURCE_IMAGE_BYTES.byteLength),
    "content-type": "image/webp",
  },
  url = "https://cdn.example.com/reviewed-look-01.webp?approved=true&kind=cover",
  redirected = false,
): Response {
  const response = new Response(body, { headers, status: 200 });
  Object.defineProperties(response, {
    redirected: { value: redirected },
    url: { value: url },
  });
  return response;
}

const ALLOWED_IMAGE_ORIGINS = new StrictPosterImageOriginPolicy(["https://cdn.example.com"]);

function createRenderer(
  fetchImage: (url: string, init: RequestInit) => Promise<Response> = async () =>
    reviewedImageResponse(),
): FixedSvgPosterRenderer {
  return new FixedSvgPosterRenderer(fetchImage, ALLOWED_IMAGE_ORIGINS);
}

function fixtureContent(overrides: Partial<DailyContent> = {}): DailyContent {
  return {
    balanceSuggestion: {
      accessoryExamples: ["丝巾"],
      description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
      preferredTierCode: "da_ji",
      title: "已经穿了注意色",
    },
    basis: {
      disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
      steps: ["今日干支为庚寅", "日柱地支取寅", "寅属木，因此今日为木日"],
    },
    calendar: {
      branch: "寅",
      dayElement: "wood",
      dayElementLabel: "木",
      ganzhiDay: "庚寅",
      lunarDateText: "六月初二",
      weekdayText: "星期三",
    },
    effectiveFrom: "2026-07-14T23:00:00+08:00",
    effectiveTo: "2026-07-15T23:00:00+08:00",
    fortuneDate: "2026-07-15",
    looks: [
      {
        alternatives: [],
        audience: { code: "all", label: "通用" },
        coverImage: {
          aiDisclosure: "AI 生成穿搭示意图",
          aiGenerated: true,
          altText: "绿色与青色通勤穿搭",
          assetId: "reviewed-look-01",
          height: 1600,
          mediaType: "image/webp",
          url: "https://cdn.example.com/reviewed-look-01.webp?approved=true&kind=cover",
          width: 1200,
        },
        detailImages: [],
        formulaId: "formula-triple",
        items: [
          {
            category: "top",
            categoryLabel: "上衣",
            colorCode: "green",
            description: "绿色通勤上衣",
          },
          {
            category: "bottom",
            categoryLabel: "下装",
            colorCode: "cyan",
            description: "青色简洁下装",
          },
        ],
        lookId: "look-01",
        requiredForPublish: true,
        scenario: { code: "commute", label: "通勤" },
        sortOrder: 1,
        title: "今日通勤三色方案",
      },
    ],
    outfitFormulas: [
      {
        audience: { code: "all", label: "通用" },
        disclaimer: "60/30/10 为穿搭参考，不是五行推算规则。",
        formulaId: "formula-triple",
        kind: "triple",
        lookIds: ["look-01"],
        scenario: { code: "commute", label: "通勤" },
        slots: [
          {
            colorCodes: ["green"],
            garmentParts: ["上衣"],
            ratioPercent: 60,
            role: "primary",
            roleLabel: "主色",
            tierCode: "da_ji",
          },
          {
            colorCodes: ["cyan"],
            garmentParts: ["下装"],
            ratioPercent: 30,
            role: "secondary",
            roleLabel: "辅助色",
            tierCode: "ci_ji",
          },
          {
            colorCodes: ["red"],
            garmentParts: ["鞋包", "配饰"],
            ratioPercent: 10,
            role: "accent",
            roleLabel: "点缀色",
            tierCode: "ping",
          },
        ],
        title: "今日通勤三色搭配",
      },
    ],
    share: {
      copyText: "今日木日穿搭参考。",
      posterJobEndpoint: "/api/v1/poster-jobs",
      posterTemplateVersion: "poster-template-v3",
      summaryText: "今日木日，优先参考绿色。",
    },
    tiers: [
      {
        algorithmLabel: "大吉",
        colors: [{ colorCode: "green", name: "绿色" }],
        displayLabel: "今日优先",
        displaySection: "primary",
        element: "wood",
        elementLabel: "木",
        explanation: "今天优先参考木色。",
        rank: 1,
        relationText: "木生火",
        tierCode: "da_ji",
      },
      {
        algorithmLabel: "次吉",
        colors: [{ colorCode: "cyan", name: "青色" }],
        displayLabel: "稳妥选择",
        displaySection: "primary",
        element: "wood",
        elementLabel: "木",
        explanation: "青色可作为稳妥选择。",
        rank: 2,
        relationText: "木与木同类",
        tierCode: "ci_ji",
      },
      {
        algorithmLabel: "平",
        colors: [{ colorCode: "red", name: "红色" }],
        displayLabel: "日常可穿",
        displaySection: "primary",
        element: "fire",
        elementLabel: "火",
        explanation: "红色适合作为日常穿搭参考。",
        rank: 3,
        relationText: "火克木",
        tierCode: "ping",
      },
      {
        algorithmLabel: "较差",
        colors: [{ colorCode: "navy", name: "藏青" }],
        displayLabel: "注意",
        displaySection: "attention",
        element: "water",
        elementLabel: "水",
        explanation: "今天建议降低水色的大面积使用比例。",
        rank: 4,
        relationText: "水生木",
        tierCode: "jiao_cha",
      },
      {
        algorithmLabel: "不利",
        colors: [{ colorCode: "khaki", name: "卡其" }],
        displayLabel: "注意",
        displaySection: "attention",
        element: "earth",
        elementLabel: "土",
        explanation: "今天建议减少大面积使用土色。",
        rank: 5,
        relationText: "木克土",
        tierCode: "bu_li",
      },
    ],
    versions: {
      algorithmVersion: "algorithm-v1",
      assetManifestVersion: "assets-v1",
      calendarDataVersion: "calendar-data-v1",
      calendarRuleVersion: "calendar-rule-v1",
      contentVersion: "fd-20260715-r3",
      copyVersion: "copy-v1",
      outfitVersion: "outfit-v1",
      posterTemplateVersion: "poster-template-v3",
    },
    ...overrides,
  };
}

const input = {
  landingUrl:
    "https://five.example.com/daily/2026-07-15?channelId=organic&expectedContentVersion=fd-20260715-r3",
  posterTemplateVersion: "poster-template-v3",
  sourceContentVersion: "fd-20260715-r3",
};

describe("FixedSvgPosterRenderer", () => {
  it("renders the reviewed published image and complete content as a shareable PNG", async () => {
    const fetchImage = vi.fn(async () => reviewedImageResponse());
    const renderer = createRenderer(fetchImage);
    const rendered = await renderer.render({ content: fixtureContent(), ...input });
    const metadata = await sharp(rendered.body).metadata();

    expect(rendered.mediaType).toBe("image/png");
    expect(rendered.body.subarray(0, PNG_SIGNATURE.byteLength)).toEqual(PNG_SIGNATURE);
    expect(metadata).toMatchObject({ format: "png", height: 1440, width: 1080 });
    expect(fetchImage).toHaveBeenCalledOnce();
    expect(fetchImage).toHaveBeenCalledWith(
      "https://cdn.example.com/reviewed-look-01.webp?approved=true&kind=cover",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it.each([
    {
      posterTemplateVersion: "poster-template-v3",
    },
    {
      posterTemplateVersion: "demo-poster-v1",
    },
    {
      posterTemplateVersion: LEGACY_AUTOMATIC_POSTER_TEMPLATE_VERSION,
    },
  ])(
    "dispatches the supported $posterTemplateVersion template as the fixed portrait PNG",
    async ({ posterTemplateVersion }) => {
      const content = fixtureContent({
        share: { ...fixtureContent().share, posterTemplateVersion },
        versions: { ...fixtureContent().versions, posterTemplateVersion },
      });
      const renderer = createRenderer();

      const rendered = await renderer.render({
        ...input,
        content,
        posterTemplateVersion,
      });

      expect(rendered.mediaType).toBe("image/png");
      await expect(sharp(rendered.body).metadata()).resolves.toMatchObject({
        format: "png",
        height: 1440,
        width: 1080,
      });
    },
  );

  it("maps the legacy automatic snapshot version to the contract layout pixels", async () => {
    const renderer = createRenderer();
    const contract = await renderer.render({ content: fixtureContent(), ...input });
    const legacyContent = fixtureContent({
      share: {
        ...fixtureContent().share,
        posterTemplateVersion: LEGACY_AUTOMATIC_POSTER_TEMPLATE_VERSION,
      },
      versions: {
        ...fixtureContent().versions,
        posterTemplateVersion: LEGACY_AUTOMATIC_POSTER_TEMPLATE_VERSION,
      },
    });
    const legacy = await renderer.render({
      ...input,
      content: legacyContent,
      posterTemplateVersion: LEGACY_AUTOMATIC_POSTER_TEMPLATE_VERSION,
    });

    const [contractPixels, legacyPixels] = await Promise.all([
      sharp(contract.body).raw().toBuffer(),
      sharp(legacy.body).raw().toBuffer(),
    ]);
    expect(legacyPixels).toEqual(contractPixels);
  }, 15_000);

  it("fails closed when a legacy job does not match the frozen content template", async () => {
    const fetchImage = vi.fn(async () => reviewedImageResponse());
    const renderer = createRenderer(fetchImage);

    await expect(
      renderer.render({
        ...input,
        content: fixtureContent(),
        posterTemplateVersion: LEGACY_AUTOMATIC_POSTER_TEMPLATE_VERSION,
      }),
    ).rejects.toThrow("Poster source version does not match the frozen published content");
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("rejects an unknown template before fetching any image", async () => {
    const fetchImage = vi.fn(async () => reviewedImageResponse());
    const renderer = createRenderer(fetchImage);
    const content = fixtureContent({
      share: { ...fixtureContent().share, posterTemplateVersion: "unknown-template" },
      versions: { ...fixtureContent().versions, posterTemplateVersion: "unknown-template" },
    });

    await expect(
      renderer.render({
        ...input,
        content,
        posterTemplateVersion: "unknown-template",
      }),
    ).rejects.toThrow("Unsupported poster template version");
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("fails closed before fetching when no published image origins are configured", async () => {
    const fetchImage = vi.fn(async () => reviewedImageResponse());
    const renderer = new FixedSvgPosterRenderer(fetchImage);

    await expect(renderer.render({ content: fixtureContent(), ...input })).rejects.toThrow(
      "origin is not allowed",
    );
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("renders a reviewed relative image through the trusted public image endpoint", async () => {
    const publicImageUrl = "http://127.0.0.1:3000/api/v1/image-assets/asset-reviewed-01";
    const fetchImage = vi.fn(async () =>
      reviewedImageResponse(
        SOURCE_IMAGE_BYTES,
        {
          "content-length": String(SOURCE_IMAGE_BYTES.byteLength),
          "content-type": "image/webp",
        },
        publicImageUrl,
      ),
    );
    const base = fixtureContent();
    const firstLook = base.looks[0];
    if (firstLook === undefined) {
      throw new Error("Fixture must contain a reviewed look");
    }
    const renderer = new FixedSvgPosterRenderer(
      fetchImage,
      new PublicWebPosterImageOriginPolicy("http://127.0.0.1:3000", ["https://cdn.example.com"]),
    );

    const rendered = await renderer.render({
      ...input,
      content: fixtureContent({
        looks: [
          {
            ...firstLook,
            coverImage: {
              ...firstLook.coverImage,
              assetId: "asset-reviewed-01",
              url: "/api/v1/image-assets/asset-reviewed-01",
            },
          },
        ],
      }),
    });

    expect(fetchImage).toHaveBeenCalledWith(
      publicImageUrl,
      expect.objectContaining({ redirect: "error" }),
    );
    expect(rendered.mediaType).toBe("image/png");
    expect(rendered.body.subarray(0, PNG_SIGNATURE.byteLength)).toEqual(PNG_SIGNATURE);
  });

  it.each([
    "https://127.0.0.1",
    "https://localhost.",
    "https://10.20.30.40",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://169.254.169.254",
  ])("rejects loopback or private configured origin %s", (origin) => {
    expect(() => new StrictPosterImageOriginPolicy([origin])).toThrow("private or local network");
  });

  it("rejects a published image from an origin outside the strict allowlist", async () => {
    const fetchImage = vi.fn(async () => reviewedImageResponse());
    const base = fixtureContent();
    const firstLook = base.looks[0];
    if (firstLook === undefined) {
      throw new Error("Fixture must contain a reviewed look");
    }
    const renderer = createRenderer(fetchImage);

    await expect(
      renderer.render({
        ...input,
        content: fixtureContent({
          looks: [
            {
              ...firstLook,
              coverImage: {
                ...firstLook.coverImage,
                url: "https://unapproved.example.net/reviewed-look-01.webp",
              },
            },
          ],
        }),
      }),
    ).rejects.toThrow("origin is not allowed");
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("rejects a fetch implementation that follows an allowed URL to a private redirect target", async () => {
    const fetchImage = vi.fn(async () =>
      reviewedImageResponse(
        SOURCE_IMAGE_BYTES,
        {
          "content-length": String(SOURCE_IMAGE_BYTES.byteLength),
          "content-type": "image/webp",
        },
        "https://127.0.0.1/internal-image.webp",
        true,
      ),
    );
    const renderer = createRenderer(fetchImage);

    await expect(renderer.render({ content: fixtureContent(), ...input })).rejects.toThrow(
      "redirect",
    );
    expect(fetchImage).toHaveBeenCalledWith(
      "https://cdn.example.com/reviewed-look-01.webp?approved=true&kind=cover",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it.each([
    {
      headers: { "content-length": "8", "content-type": "image/svg+xml" },
      label: "unapproved response media type",
    },
    {
      headers: { "content-length": String(12 * 1024 * 1024), "content-type": "image/webp" },
      label: "oversized response",
    },
  ])("rejects an $label", async ({ headers }) => {
    const renderer = createRenderer(async () => reviewedImageResponse(SOURCE_IMAGE_BYTES, headers));

    await expect(renderer.render({ content: fixtureContent(), ...input })).rejects.toThrow(
      /reviewed image/u,
    );
  });

  it("enforces the source limit while streaming when content-length is absent", async () => {
    const oversizedBytes = new Uint8Array(6 * 1024 * 1024 + 1);
    const renderer = createRenderer(async () =>
      reviewedImageResponse(oversizedBytes, { "content-type": "image/webp" }),
    );

    await expect(renderer.render({ content: fixtureContent(), ...input })).rejects.toThrow(
      "reviewed image exceeds",
    );
  });

  it("keeps a maximum-size accepted source below the web download ceiling", async () => {
    const maximumSourceBytes = new Uint8Array(6 * 1024 * 1024);
    const renderer = createRenderer(async () =>
      reviewedImageResponse(maximumSourceBytes, {
        "content-length": String(maximumSourceBytes.byteLength),
        "content-type": "image/webp",
      }),
    );

    const rendered = await renderer.render({ content: fixtureContent(), ...input });

    expect(rendered.body.byteLength).toBeLessThan(10 * 1024 * 1024);
  });

  it("renders bounded PNG output when published copy requires wrapping and escaping", async () => {
    const longSummary = `<unsafe>${"很长的摘要内容".repeat(45)}</unsafe>`;
    const longDisclaimer = `传统文化参考${"请理性阅读".repeat(60)}`;
    const longAiDisclosure = `AI 图片说明${"仅为穿搭示意".repeat(30)}`;
    const base = fixtureContent();
    const firstLook = base.looks[0];
    if (firstLook === undefined) {
      throw new Error("Fixture must contain a reviewed look");
    }
    const renderer = createRenderer();
    const rendered = await renderer.render({
      ...input,
      content: fixtureContent({
        basis: { ...base.basis, disclaimer: longDisclaimer },
        looks: [
          {
            ...firstLook,
            coverImage: { ...firstLook.coverImage, aiDisclosure: longAiDisclosure },
          },
        ],
        share: { ...base.share, summaryText: longSummary },
      }),
    });
    const metadata = await sharp(rendered.body).metadata();

    expect(metadata).toMatchObject({ format: "png", height: 1440, width: 1080 });
    expect(rendered.body.byteLength).toBeLessThan(10 * 1024 * 1024);
  });
});
