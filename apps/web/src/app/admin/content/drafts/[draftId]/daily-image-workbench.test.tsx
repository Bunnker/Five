import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminJsonResponse } from "../../../admin-test-responses";
import { DailyImageWorkbench } from "./daily-image-workbench";

const csrfToken = "csrf-token-that-is-longer-than-thirty-two-characters";

const pendingAsset = {
  aiLabelStatus: "pending" as const,
  altText: "墨绿外套日常穿搭",
  assetId: "asset-primary",
  declaredModel: "gpt-image-2",
  fileUrl: null,
  generatedAt: "2026-08-01T02:00:00.000Z",
  generationMethod: "codex" as const,
  height: 1600,
  manualReview: null,
  mediaType: "image/webp" as const,
  promptVersion: "prompt-v3",
  reproductionReference: "job-image-001",
  reviewStatus: "pending" as const,
  rightsRecordIds: ["rights-ai-001"],
  rightsStatus: "pending" as const,
  sha256: "a".repeat(64),
  sourceMaterialReferences: ["brief:2026-08-01"],
  sourceType: "ai_generated" as const,
  width: 1200,
};

const candidateList = {
  draftId: "draft-31",
  draftRevision: 1,
  fortuneDate: "2026-08-01",
  items: [
    {
      asset: pendingAsset,
      previewUrl: "/admin/api/v1/image-assets/asset-primary/preview",
      reviewLocked: false,
    },
  ],
};

const visualModule = {
  assetManifestVersion: "assets-v1",
  assets: [pendingAsset, { ...pendingAsset, assetId: "asset-alt", sha256: "b".repeat(64) }],
  looks: [
    {
      alternatives: [],
      audience: { code: "all", label: "通用" },
      coverAssetId: "asset-primary",
      detailAssetIds: [],
      fallbackAssetId: "asset-fallback",
      formulaId: "formula-1",
      imageSlot: "required_primary" as const,
      items: [
        {
          category: "top" as const,
          categoryLabel: "上装",
          colorCode: "color-green",
          description: "墨绿外套",
        },
      ],
      lookId: "look-1",
      requiredForPublish: true as const,
      scenario: { code: "daily", label: "日常" },
      sortOrder: 1,
      title: "日常主图",
    },
    {
      alternatives: [],
      audience: { code: "all", label: "通用" },
      coverAssetId: "asset-alt",
      detailAssetIds: [],
      fallbackAssetId: "asset-fallback-alt",
      formulaId: "formula-2",
      imageSlot: "required_alternative" as const,
      items: [
        {
          category: "top" as const,
          categoryLabel: "上装",
          colorCode: "color-green",
          description: "墨绿针织衫",
        },
      ],
      lookId: "look-2",
      requiredForPublish: true as const,
      scenario: { code: "daily", label: "日常" },
      sortOrder: 2,
      title: "日常备选图",
    },
  ],
  rightsRecords: [],
};

const defaultProps = {
  csrfToken,
  disabled: false,
  draftId: "draft-31",
  draftRevision: 1,
  etag: '"draft:1"',
  fortuneDate: "2026-08-01",
  onConflict: vi.fn(),
  onRevisionChange: vi.fn(),
  onUnauthorized: vi.fn(),
  visualModule,
};

describe("DailyImageWorkbench", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.clear();
    sessionStorage.clear();
    defaultProps.onConflict.mockReset();
    defaultProps.onRevisionChange.mockReset();
    defaultProps.onUnauthorized.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("restores uploaded candidates from the server and shows the configured cover slots", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createAdminJsonResponse(candidateList, { headers: { ETag: '"draft:1"' } }),
    );

    render(<DailyImageWorkbench {...defaultProps} />);

    expect(await screen.findByRole("img", { name: "墨绿外套日常穿搭" })).toHaveAttribute(
      "src",
      "/admin/api/v1/image-assets/asset-primary/preview",
    );
    expect(screen.getByText("必备主图")).toBeInTheDocument();
    expect(screen.getByText("必备备选图")).toBeInTheDocument();
    expect(screen.getByText("可选图未配置")).toBeInTheDocument();
    expect(screen.getByText("asset-fallback")).toBeInTheDocument();
    expect(screen.getAllByText("降级素材尚未审核安全")).toHaveLength(2);
    expect(screen.getAllByText("等待人工检查").length).toBeGreaterThanOrEqual(2);
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith(
      "/admin/api/v1/daily-content-drafts/draft-31/image-assets",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("does not label an approved asset safe when the file or full evidence is missing", async () => {
    const manualReview = {
      aiLabelCompliance: "passed" as const,
      colorAndCopyConsistency: "passed" as const,
      garmentAndPersonIntegrity: "passed" as const,
      mobileAndWechatPreview: "passed" as const,
      notes: "已复核",
      reviewId: "review-incomplete",
      reviewedAt: "2026-08-01T03:00:00.000Z",
      reviewerAccountId: "maintainer",
      rightsAndIdentityRisk: "passed" as const,
      scenarioAndImitability: "passed" as const,
    };
    const incompleteAsset = {
      ...pendingAsset,
      aiLabelStatus: "complete" as const,
      manualReview,
      reviewStatus: "approved" as const,
      rightsStatus: "cleared" as const,
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      createAdminJsonResponse(
        {
          ...candidateList,
          items: [
            {
              asset: incompleteAsset,
              previewUrl: "/admin/api/v1/image-assets/asset-primary/preview",
              reviewLocked: true,
            },
          ],
        },
        { headers: { ETag: '"draft:1"' } },
      ),
    );

    render(
      <DailyImageWorkbench
        {...defaultProps}
        visualModule={{ ...visualModule, assets: [incompleteAsset, visualModule.assets[1]] }}
      />,
    );

    await screen.findByRole("img", { name: "墨绿外套日常穿搭" });
    expect(screen.queryByText("已审核安全")).not.toBeInTheDocument();
    expect(screen.getAllByText("等待人工检查").length).toBeGreaterThan(0);
  });

  it("reports a conflict instead of adopting a newer draft revision from a candidate refresh", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createAdminJsonResponse(
        { ...candidateList, draftRevision: 2 },
        { headers: { ETag: '"draft:2"' } },
      ),
    );

    render(<DailyImageWorkbench {...defaultProps} />);

    await screen.findByRole("img", { name: "墨绿外套日常穿搭" });
    expect(defaultProps.onConflict).toHaveBeenCalledWith(
      "其他页面已更新草稿，请重新载入后再继续图片操作。",
    );
    expect(defaultProps.onRevisionChange).not.toHaveBeenCalled();
  });

  it("prevents review requests for a candidate copied from a frozen snapshot", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createAdminJsonResponse(
        {
          ...candidateList,
          items: candidateList.items.map((candidate) => ({
            ...candidate,
            reviewLocked: true,
          })),
        },
        { headers: { ETag: '"draft:1"' } },
      ),
    );

    render(<DailyImageWorkbench {...defaultProps} />);

    await screen.findByRole("img", { name: "墨绿外套日常穿搭" });
    expect(screen.getByText("复制素材审核已冻结；如需调整请上传新素材")).toBeInTheDocument();
    for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).toBeDisabled();
    expect(screen.getByLabelText("asset-primary 权利状态")).toBeDisabled();
    expect(screen.getByLabelText("asset-primary AI 标识状态")).toBeDisabled();
    expect(screen.getByLabelText("asset-primary 审核备注")).toBeDisabled();
    const approve = screen.getByRole("button", { name: "批准 asset-primary" });
    const reject = screen.getByRole("button", { name: "拒绝 asset-primary" });
    expect(approve).toBeDisabled();
    expect(reject).toBeDisabled();

    fireEvent.click(approve);
    fireEvent.click(reject);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uploads AI metadata and preserves the response review lock", async () => {
    const uploadedList = {
      asset: pendingAsset,
      draftId: "draft-31",
      draftRevision: 2,
      fortuneDate: "2026-08-01",
      previewUrl: "/admin/api/v1/image-assets/asset-primary/preview",
      reviewLocked: true,
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          { ...candidateList, items: [] },
          { headers: { ETag: '"draft:1"' } },
        ),
      )
      .mockResolvedValueOnce(
        createAdminJsonResponse(uploadedList, {
          headers: { ETag: '"draft:2"' },
          status: 201,
        }),
      );

    render(<DailyImageWorkbench {...defaultProps} visualModule={null} />);

    expect(await screen.findByLabelText("图片来源")).toHaveValue("licensed");
    expect(screen.queryByLabelText("声明模型")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("图片来源"), { target: { value: "ai_generated" } });
    expect(screen.getByLabelText("声明模型")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("选择图片文件"), {
      target: { files: [new File(["image"], "outfit.webp", { type: "image/webp" })] },
    });
    fireEvent.change(screen.getByLabelText("图片替代文字"), {
      target: { value: "墨绿外套日常穿搭" },
    });
    fireEvent.change(screen.getByLabelText("声明模型"), { target: { value: "gpt-image-2" } });
    fireEvent.change(screen.getByLabelText("提示词版本"), { target: { value: "prompt-v3" } });
    fireEvent.change(screen.getByLabelText("生成时间"), {
      target: { value: "2026-08-01T10:00" },
    });
    fireEvent.change(screen.getByLabelText("重现引用"), {
      target: { value: "job-image-001" },
    });
    fireEvent.change(screen.getByLabelText("来源材料（每行一条）"), {
      target: { value: "brief:2026-08-01" },
    });
    fireEvent.change(screen.getByLabelText("权利记录编号（每行一条）"), {
      target: { value: "rights-ai-001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "上传图片候选" }));

    expect(await screen.findByRole("img", { name: "墨绿外套日常穿搭" })).toBeInTheDocument();
    expect(screen.getByText("复制素材审核已冻结；如需调整请上传新素材")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批准 asset-primary" })).toBeDisabled();
    expect(defaultProps.onRevisionChange).toHaveBeenCalledWith({
      draftRevision: 2,
      etag: '"draft:2"',
    });
    expect(screen.getByLabelText("选择图片文件")).toHaveValue("");
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const body = request.body as FormData;
    expect(body.get("file")).toBeInstanceOf(File);
    const metadataPart = body.get("metadata");
    expect(typeof metadataPart).toBe("string");
    const metadata = JSON.parse(String(metadataPart));
    expect(metadata).toEqual(
      expect.objectContaining({
        aiLabelStatus: "pending",
        declaredModel: "gpt-image-2",
        generationMethod: "codex",
        promptVersion: "prompt-v3",
        reproductionReference: "job-image-001",
        sourceType: "ai_generated",
      }),
    );
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("freezes an uncertain upload intent and retries the same file, metadata, and key", async () => {
    const uploadedList = {
      asset: pendingAsset,
      draftId: "draft-31",
      draftRevision: 2,
      fortuneDate: "2026-08-01",
      previewUrl: "/admin/api/v1/image-assets/asset-primary/preview",
      reviewLocked: false,
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          { ...candidateList, items: [] },
          { headers: { ETag: '"draft:1"' } },
        ),
      )
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(
        createAdminJsonResponse(uploadedList, {
          headers: { ETag: '"draft:2"' },
          status: 201,
        }),
      );
    const originalFile = new File(["original-image"], "original.webp", {
      type: "image/webp",
    });

    render(<DailyImageWorkbench {...defaultProps} visualModule={null} />);
    await screen.findByLabelText("选择图片文件");
    fireEvent.change(screen.getByLabelText("选择图片文件"), {
      target: { files: [originalFile] },
    });
    fireEvent.change(screen.getByLabelText("图片替代文字"), {
      target: { value: "首次请求的墨绿外套" },
    });
    fireEvent.change(screen.getByLabelText("来源材料（每行一条）"), {
      target: { value: "brief:locked" },
    });
    fireEvent.change(screen.getByLabelText("权利记录编号（每行一条）"), {
      target: { value: "rights-locked" },
    });
    fireEvent.click(screen.getByRole("button", { name: "上传图片候选" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("上传结果暂时无法确认");
    expect(screen.getByLabelText("选择图片文件")).toBeDisabled();
    expect(screen.getByLabelText("图片替代文字")).toBeDisabled();
    expect(screen.getByRole("button", { name: "重试原上传" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("图片替代文字"), {
      target: { value: "不得进入旧幂等键的新文案" },
    });
    fireEvent.change(screen.getByLabelText("选择图片文件"), {
      target: { files: [new File(["changed"], "changed.webp", { type: "image/webp" })] },
    });
    expect(screen.getByLabelText("图片替代文字")).toHaveValue("首次请求的墨绿外套");
    fireEvent.click(screen.getByRole("button", { name: "重试原上传" }));

    await screen.findByRole("img", { name: "墨绿外套日常穿搭" });
    const firstRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const retryRequest = fetchMock.mock.calls[2]?.[1] as RequestInit;
    const firstBody = firstRequest.body as FormData;
    const retryBody = retryRequest.body as FormData;
    expect(firstBody.get("file")).toBe(originalFile);
    expect(retryBody.get("file")).toBe(originalFile);
    expect(retryBody.get("metadata")).toBe(firstBody.get("metadata"));
    expect(JSON.parse(String(retryBody.get("metadata")))).toEqual(
      expect.objectContaining({ altText: "首次请求的墨绿外套" }),
    );
    expect(new Headers(retryRequest.headers).get("Idempotency-Key")).toBe(
      new Headers(firstRequest.headers).get("Idempotency-Key"),
    );
    expect(new Headers(retryRequest.headers).get("If-Match")).toBe(
      new Headers(firstRequest.headers).get("If-Match"),
    );
  });

  it("reviews an unlocked candidate and preserves the response review lock", async () => {
    const approvedAsset = {
      ...pendingAsset,
      aiLabelStatus: "complete" as const,
      manualReview: {
        aiLabelCompliance: "passed" as const,
        colorAndCopyConsistency: "passed" as const,
        garmentAndPersonIntegrity: "passed" as const,
        mobileAndWechatPreview: "passed" as const,
        notes: "手机与微信内已复核",
        reviewId: "review-1",
        reviewedAt: "2026-08-01T03:00:00.000Z",
        reviewerAccountId: "maintainer",
        rightsAndIdentityRisk: "passed" as const,
        scenarioAndImitability: "passed" as const,
      },
      reviewStatus: "approved" as const,
      rightsStatus: "cleared" as const,
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        createAdminJsonResponse(candidateList, { headers: { ETag: '"draft:1"' } }),
      )
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            asset: approvedAsset,
            draftId: "draft-31",
            draftRevision: 2,
            fortuneDate: "2026-08-01",
            previewUrl: "/admin/api/v1/image-assets/asset-primary/preview",
            reviewLocked: true,
          },
          { headers: { ETag: '"draft:2"' } },
        ),
      );

    render(<DailyImageWorkbench {...defaultProps} />);

    await screen.findByRole("img", { name: "墨绿外套日常穿搭" });
    for (const label of [
      "颜色与文案一致",
      "人物与服装无错误",
      "商标、肖像与权利风险已排除",
      "场景可模仿且无误导",
      "手机与微信预览通过",
      "AI 标识符合要求",
    ]) {
      fireEvent.click(screen.getByRole("checkbox", { name: label }));
    }
    fireEvent.change(screen.getByLabelText("asset-primary 权利状态"), {
      target: { value: "cleared" },
    });
    fireEvent.change(screen.getByLabelText("asset-primary AI 标识状态"), {
      target: { value: "complete" },
    });
    fireEvent.change(screen.getByLabelText("asset-primary 审核备注"), {
      target: { value: "手机与微信内已复核" },
    });
    fireEvent.click(screen.getByRole("button", { name: "批准 asset-primary" }));

    expect(await screen.findByRole("status")).toHaveTextContent("人工检查已批准");
    expect(screen.getByText("复制素材审核已冻结；如需调整请上传新素材")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝 asset-primary" })).toBeDisabled();
    expect(defaultProps.onRevisionChange).toHaveBeenCalledWith({
      draftRevision: 2,
      etag: '"draft:2"',
    });
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      aiLabelCompliance: "passed",
      aiLabelStatus: "complete",
      colorAndCopyConsistency: "passed",
      decision: "approved",
      garmentAndPersonIntegrity: "passed",
      mobileAndWechatPreview: "passed",
      notes: "手机与微信内已复核",
      rightsAndIdentityRisk: "passed",
      rightsStatus: "cleared",
      scenarioAndImitability: "passed",
    });
  });

  it("keeps review inputs after a server rejection", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        createAdminJsonResponse(candidateList, { headers: { ETag: '"draft:1"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 422 }));

    render(<DailyImageWorkbench {...defaultProps} />);
    await screen.findByRole("img", { name: "墨绿外套日常穿搭" });
    fireEvent.change(screen.getByLabelText("asset-primary 审核备注"), {
      target: { value: "保留这段人工判断" },
    });
    fireEvent.click(screen.getByRole("button", { name: "拒绝 asset-primary" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("尚未满足要求");
    expect(screen.getByLabelText("asset-primary 审核备注")).toHaveValue("保留这段人工判断");
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("freezes an uncertain review decision and retries the same body and key", async () => {
    const rejectedAsset = { ...pendingAsset, reviewStatus: "rejected" as const };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        createAdminJsonResponse(candidateList, { headers: { ETag: '"draft:1"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            asset: rejectedAsset,
            draftId: "draft-31",
            draftRevision: 2,
            fortuneDate: "2026-08-01",
            previewUrl: "/admin/api/v1/image-assets/asset-primary/preview",
            reviewLocked: false,
          },
          { headers: { ETag: '"draft:2"' } },
        ),
      );

    render(<DailyImageWorkbench {...defaultProps} />);
    await screen.findByRole("img", { name: "墨绿外套日常穿搭" });
    fireEvent.change(screen.getByLabelText("asset-primary 审核备注"), {
      target: { value: "首次拒绝请求的固定理由" },
    });
    fireEvent.click(screen.getByRole("button", { name: "拒绝 asset-primary" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("检查结果暂时无法确认");
    expect(screen.getByLabelText("asset-primary 审核备注")).toBeDisabled();
    expect(screen.getByRole("button", { name: "批准 asset-primary" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重试拒绝 asset-primary" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("asset-primary 审核备注"), {
      target: { value: "不得进入旧幂等键的新理由" },
    });
    fireEvent.click(screen.getByRole("button", { name: "批准 asset-primary" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "重试拒绝 asset-primary" }));

    expect(await screen.findByRole("button", { name: "拒绝 asset-primary" })).toBeInTheDocument();
    const firstRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const retryRequest = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(retryRequest.body).toBe(firstRequest.body);
    expect(JSON.parse(String(retryRequest.body))).toEqual(
      expect.objectContaining({ decision: "rejected", notes: "首次拒绝请求的固定理由" }),
    );
    expect(new Headers(retryRequest.headers).get("Idempotency-Key")).toBe(
      new Headers(firstRequest.headers).get("Idempotency-Key"),
    );
    expect(new Headers(retryRequest.headers).get("If-Match")).toBe(
      new Headers(firstRequest.headers).get("If-Match"),
    );
  });
});
