import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminJsonResponse } from "../../../admin-test-responses";
import { AdminDailyImageSetPanel } from "./admin-daily-image-set";

const csrfToken = "csrf-token-that-is-longer-than-thirty-two-characters";

function approvedAsset(assetId: string, altText: string) {
  return {
    aiLabelStatus: "not_applicable" as const,
    altText,
    assetId,
    declaredModel: null,
    fileUrl: `https://private.example.test/${assetId}.webp`,
    generatedAt: null,
    generationMethod: "licensed_upload" as const,
    height: 1600,
    manualReview: {
      aiLabelCompliance: "passed" as const,
      colorAndCopyConsistency: "passed" as const,
      garmentAndPersonIntegrity: "passed" as const,
      mobileAndWechatPreview: "passed" as const,
      notes: "微信内置浏览器与权利材料均已复核",
      reviewId: `review-${assetId}`,
      reviewedAt: "2026-08-01T02:30:00.000Z",
      reviewerAccountId: "maintainer",
      rightsAndIdentityRisk: "passed" as const,
      scenarioAndImitability: "passed" as const,
    },
    mediaType: "image/webp" as const,
    promptVersion: null,
    reproductionReference: null,
    reviewStatus: "approved" as const,
    rightsRecordIds: [`rights-${assetId}`],
    rightsStatus: "cleared" as const,
    sha256: assetId.charCodeAt(0).toString(16).padStart(2, "0").repeat(32),
    sourceMaterialReferences: [`source:${assetId}`],
    sourceType: "licensed" as const,
    width: 1200,
  };
}

const primaryAsset = approvedAsset("primary-cover", "墨绿外套主图");
const primaryFallback = approvedAsset("primary-fallback", "墨绿配色降级图");
const alternativeAsset = approvedAsset("alternative-cover", "藏青针织备选图");
const alternativeFallback = approvedAsset("alternative-fallback", "藏青配色降级图");
const optionalAsset = approvedAsset("optional-cover", "周末场景可选图");
const primaryDetail = approvedAsset("primary-detail", "墨绿外套细节图");

const activeSet = {
  assets: [primaryAsset, primaryFallback, alternativeAsset, alternativeFallback, optionalAsset],
  contentVersion: "2026-08-01.v1",
  fortuneDate: "2026-08-01",
  lifecycleRevision: 3,
  slots: [
    {
      coverAssetId: "primary-cover",
      deliveryStatus: "active" as const,
      detailAssetIds: [],
      fallbackAssetId: "primary-fallback",
      imageSlot: "required_primary" as const,
      lookId: "look-primary",
      servedCoverAssetId: "primary-cover",
      servedDetailAssetIds: [],
    },
    {
      coverAssetId: "alternative-cover",
      deliveryStatus: "active" as const,
      detailAssetIds: [],
      fallbackAssetId: "alternative-fallback",
      imageSlot: "required_alternative" as const,
      lookId: "look-alternative",
      servedCoverAssetId: "alternative-cover",
      servedDetailAssetIds: [],
    },
    {
      coverAssetId: "optional-cover",
      deliveryStatus: "active" as const,
      detailAssetIds: [],
      fallbackAssetId: null,
      imageSlot: "optional" as const,
      lookId: "look-optional",
      servedCoverAssetId: "optional-cover",
      servedDetailAssetIds: [],
    },
  ],
  withdrawalEvents: [],
};

const fallbackSet = {
  ...activeSet,
  lifecycleRevision: 4,
  slots: [
    {
      ...activeSet.slots[0],
      deliveryStatus: "fallback" as const,
      servedCoverAssetId: "primary-fallback",
    },
    activeSet.slots[1],
    activeSet.slots[2],
  ],
  withdrawalEvents: [
    {
      assetId: "primary-cover",
      auditEventId: "audit-withdraw-primary",
      reason: "人物手部存在明显生成瑕疵",
      withdrawalEventId: "withdraw-primary",
      withdrawnAt: "2026-08-01T03:00:00.000Z",
    },
  ],
};

const defaultProps = {
  activeContentVersion: "2026-08-01.v1",
  contentVersion: "2026-08-01.v1",
  csrfToken,
  onLifecycleChange: vi.fn(),
  onUnauthorized: vi.fn(),
  versionState: "published" as const,
};

describe("AdminDailyImageSetPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    defaultProps.onLifecycleChange.mockReset();
    defaultProps.onUnauthorized.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the server delivery projection and activates a reviewed fallback after withdrawal", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        createAdminJsonResponse(activeSet, { headers: { ETag: '"lifecycle:3"' } }),
      )
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            assetId: "primary-cover",
            auditEventId: "audit-withdraw-primary",
            dailyImageSet: fallbackSet,
            deliveryAction: "fallback_activated",
            lifecycleRevision: 4,
          },
          { headers: { ETag: '"lifecycle:4"' } },
        ),
      );

    render(<AdminDailyImageSetPanel {...defaultProps} />);

    expect(await screen.findAllByText("当前交付：原图")).toHaveLength(3);
    expect(screen.getByRole("img", { name: "墨绿外套主图" })).toHaveAttribute(
      "src",
      "/admin/api/v1/image-assets/primary-cover/preview",
    );
    expect(screen.queryByRole("img", { name: "墨绿外套主图" })).not.toHaveAttribute(
      "src",
      primaryAsset.fileUrl,
    );

    fireEvent.change(screen.getByLabelText("primary-cover 下线原因"), {
      target: { value: "人物手部存在明显生成瑕疵" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下线素材 primary-cover" }));

    expect(await screen.findByText("当前交付：已切换审核降级图")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "墨绿配色降级图" })).toHaveAttribute(
      "src",
      "/admin/api/v1/image-assets/primary-fallback/preview",
    );
    expect(defaultProps.onLifecycleChange).toHaveBeenCalledWith({
      etag: '"lifecycle:4"',
      lifecycleRevision: 4,
    });

    const request = vi.mocked(fetch).mock.calls[1];
    expect(request?.[0]).toBe(
      "/admin/api/v1/daily-content-versions/2026-08-01.v1/image-assets/primary-cover/withdraw",
    );
    expect(request?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          expectedActiveContentVersion: "2026-08-01.v1",
          reason: "人物手部存在明显生成瑕疵",
        }),
        method: "POST",
      }),
    );
    expect(new Headers(request?.[1]?.headers).get("If-Match")).toBe('"lifecycle:3"');
  });

  it("freezes an uncertain withdrawal reason and retries the same body and key", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        createAdminJsonResponse(activeSet, { headers: { ETag: '"lifecycle:3"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            assetId: "primary-cover",
            auditEventId: "audit-withdraw-primary",
            dailyImageSet: fallbackSet,
            deliveryAction: "fallback_activated",
            lifecycleRevision: 4,
          },
          { headers: { ETag: '"lifecycle:4"' } },
        ),
      );

    render(<AdminDailyImageSetPanel {...defaultProps} />);
    await screen.findByLabelText("primary-cover 下线原因");
    fireEvent.change(screen.getByLabelText("primary-cover 下线原因"), {
      target: { value: "首次请求锁定的权利风险" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下线素材 primary-cover" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("下线结果暂时无法确认");
    expect(screen.getByLabelText("primary-cover 下线原因")).toBeDisabled();
    expect(screen.getByRole("button", { name: "重试下线素材 primary-cover" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下线素材 primary-fallback" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("primary-cover 下线原因"), {
      target: { value: "不得进入旧幂等键的新理由" },
    });
    expect(screen.getByLabelText("primary-cover 下线原因")).toHaveValue("首次请求锁定的权利风险");
    fireEvent.click(screen.getByRole("button", { name: "重试下线素材 primary-cover" }));

    expect(
      await screen.findByText("问题图片已下线，公开交付已切换到审核通过的降级图。"),
    ).toBeInTheDocument();
    const firstRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const retryRequest = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(retryRequest.body).toBe(firstRequest.body);
    expect(JSON.parse(String(retryRequest.body))).toEqual({
      expectedActiveContentVersion: "2026-08-01.v1",
      reason: "首次请求锁定的权利风险",
    });
    expect(new Headers(retryRequest.headers).get("Idempotency-Key")).toBe(
      new Headers(firstRequest.headers).get("Idempotency-Key"),
    );
    expect(new Headers(retryRequest.headers).get("If-Match")).toBe(
      new Headers(firstRequest.headers).get("If-Match"),
    );
  });

  it("renders an omitted optional slot without exposing a withdrawal action", async () => {
    const omittedSet = {
      ...activeSet,
      lifecycleRevision: 4,
      slots: [
        activeSet.slots[0],
        activeSet.slots[1],
        {
          ...activeSet.slots[2],
          deliveryStatus: "omitted" as const,
          servedCoverAssetId: null,
        },
      ],
      withdrawalEvents: [
        {
          assetId: "optional-cover",
          auditEventId: "audit-withdraw-optional",
          reason: "可选场景图片光影异常",
          withdrawalEventId: "withdraw-optional",
          withdrawnAt: "2026-08-01T03:00:00.000Z",
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      createAdminJsonResponse(omittedSet, { headers: { ETag: '"lifecycle:4"' } }),
    );

    render(<AdminDailyImageSetPanel {...defaultProps} versionState="superseded" />);

    expect(await screen.findByText("当前交付：已省略可选图")).toBeInTheDocument();
    expect(screen.queryByLabelText("optional-cover 下线原因")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "下线素材 optional-cover" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });

  it("keeps unwithdrawn assets actionable on a superseded version for safe-restore checks", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createAdminJsonResponse(activeSet, { headers: { ETag: '"lifecycle:3"' } }),
    );

    render(<AdminDailyImageSetPanel {...defaultProps} versionState="superseded" />);

    expect(
      await screen.findByRole("button", { name: "下线素材 primary-cover" }),
    ).toBeInTheDocument();
  });

  it("keeps unwithdrawn assets actionable after the version itself is withdrawn", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createAdminJsonResponse(activeSet, { headers: { ETag: '"lifecycle:3"' } }),
    );

    render(<AdminDailyImageSetPanel {...defaultProps} versionState="withdrawn" />);

    expect(
      await screen.findByRole("button", { name: "下线素材 primary-cover" }),
    ).toBeInTheDocument();
  });

  it("renders a non-active required slot with no safe image as unavailable", async () => {
    const unavailableSet = {
      ...activeSet,
      lifecycleRevision: 5,
      slots: [
        {
          ...activeSet.slots[0],
          deliveryStatus: "unavailable" as const,
          servedCoverAssetId: null,
        },
        activeSet.slots[1],
        activeSet.slots[2],
      ],
      withdrawalEvents: [
        {
          assetId: "primary-cover",
          auditEventId: "audit-withdraw-primary",
          reason: "原图权利已撤销",
          withdrawalEventId: "withdraw-primary",
          withdrawnAt: "2026-08-01T03:00:00.000Z",
        },
        {
          assetId: "primary-fallback",
          auditEventId: "audit-withdraw-primary-fallback",
          reason: "降级图权利已撤销",
          withdrawalEventId: "withdraw-primary-fallback",
          withdrawnAt: "2026-08-01T03:10:00.000Z",
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce(
      createAdminJsonResponse(unavailableSet, { headers: { ETag: '"lifecycle:5"' } }),
    );

    render(<AdminDailyImageSetPanel {...defaultProps} versionState="withdrawn" />);

    expect(await screen.findByText("当前交付：必备图不可用")).toBeInTheDocument();
    expect(screen.getByText("该必备槽位当前没有可安全交付的图片。")).toBeInTheDocument();
  });

  it("records an unserved fallback withdrawal without changing the public projection", async () => {
    const fallbackWithdrawalSet = {
      ...activeSet,
      lifecycleRevision: 4,
      withdrawalEvents: [
        {
          assetId: "primary-fallback",
          auditEventId: "audit-withdraw-unserved-fallback",
          reason: "降级模板中的色名排版错误",
          withdrawalEventId: "withdraw-unserved-fallback",
          withdrawnAt: "2026-08-01T03:00:00.000Z",
        },
      ],
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        createAdminJsonResponse(activeSet, { headers: { ETag: '"lifecycle:3"' } }),
      )
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            assetId: "primary-fallback",
            auditEventId: "audit-withdraw-unserved-fallback",
            dailyImageSet: fallbackWithdrawalSet,
            deliveryAction: "no_public_change",
            lifecycleRevision: 4,
          },
          { headers: { ETag: '"lifecycle:4"' } },
        ),
      );

    render(<AdminDailyImageSetPanel {...defaultProps} />);

    expect(await screen.findByLabelText("primary-fallback 素材角色")).toHaveTextContent(
      "必备主图 · 降级素材",
    );
    fireEvent.change(screen.getByLabelText("primary-fallback 下线原因"), {
      target: { value: "降级模板中的色名排版错误" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下线素材 primary-fallback" }));

    expect(
      await screen.findByText("图片下线事件已记录，当前公开交付未发生变化。"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("primary-fallback 下线原因")).not.toBeInTheDocument();
    expect(screen.getByLabelText("primary-fallback 素材角色")).toHaveTextContent("已撤");
  });

  it("omits one withdrawn detail image while keeping its frozen asset metadata", async () => {
    const detailActiveSet = {
      ...activeSet,
      assets: [...activeSet.assets, primaryDetail],
      slots: [
        {
          ...activeSet.slots[0],
          detailAssetIds: ["primary-detail"],
          servedDetailAssetIds: ["primary-detail"],
        },
        activeSet.slots[1],
        activeSet.slots[2],
      ],
    };
    const detailOmittedSet = {
      ...detailActiveSet,
      lifecycleRevision: 4,
      slots: [
        {
          ...detailActiveSet.slots[0],
          servedDetailAssetIds: [],
        },
        detailActiveSet.slots[1],
        detailActiveSet.slots[2],
      ],
      withdrawalEvents: [
        {
          assetId: "primary-detail",
          auditEventId: "audit-withdraw-detail",
          reason: "纽扣细节与实物不一致",
          withdrawalEventId: "withdraw-detail",
          withdrawnAt: "2026-08-01T03:00:00.000Z",
        },
      ],
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        createAdminJsonResponse(detailActiveSet, { headers: { ETag: '"lifecycle:3"' } }),
      )
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            assetId: "primary-detail",
            auditEventId: "audit-withdraw-detail",
            dailyImageSet: detailOmittedSet,
            deliveryAction: "detail_omitted",
            lifecycleRevision: 4,
          },
          { headers: { ETag: '"lifecycle:4"' } },
        ),
      );

    render(<AdminDailyImageSetPanel {...defaultProps} />);

    expect(await screen.findByLabelText("primary-detail 素材角色")).toHaveTextContent(
      "必备主图 · 当前细节",
    );
    fireEvent.change(screen.getByLabelText("primary-detail 下线原因"), {
      target: { value: "纽扣细节与实物不一致" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下线素材 primary-detail" }));

    expect(await screen.findByText("问题细节图已从公开交付中省略。")).toBeInTheDocument();
    expect(screen.getByLabelText("primary-detail 素材角色")).toHaveTextContent("已撤");
    expect(screen.getByRole("img", { name: "墨绿外套细节图" })).toHaveAttribute(
      "src",
      "/admin/api/v1/image-assets/primary-detail/preview",
    );
  });
});
