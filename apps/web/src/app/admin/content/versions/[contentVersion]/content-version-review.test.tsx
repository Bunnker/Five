import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminSessionProvider } from "../../../admin-session-context";
import { createAdminJsonResponse } from "../../../admin-test-responses";
import { ContentVersionReview } from "./content-version-review";

const now = Date.now();
const session = {
  absoluteExpiresAt: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
  credentialRevision: 1,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
  issuedAt: new Date(now).toISOString(),
  username: "maintainer",
};
const version = {
  activeContentVersion: null,
  contentVersion: "fd-20260801-r1",
  fortuneDate: "2026-08-01",
  lifecycleRevision: 1,
  masterReviewEvidence: [],
  preflightChecks: [
    { code: "master_review_evidence", message: "等待登记大师凭证", status: "pending" },
  ],
  snapshot: {
    calendar_algorithm: null,
    copy_and_formula: null,
    poster_consistency: null,
    visual_and_rights: null,
  },
  state: "in_review",
};

describe("ContentVersionReview", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records external master evidence with at least one reference", async () => {
    const evidenceVersion = {
      ...version,
      lifecycleRevision: 2,
      masterReviewEvidence: [
        {
          conclusion: "confirmed",
          evidenceId: "evidence-1",
          notes: "已逐项确认",
          references: [{ kind: "message_link", reference: "https://example.com/message/1" }],
          reviewedAt: "2026-07-31T12:00:00.000Z",
          reviewerDisplayName: "林老师",
        },
      ],
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(
        createAdminJsonResponse(version, { headers: { ETag: '"lifecycle:1"' } }),
      )
      .mockResolvedValueOnce(
        createAdminJsonResponse(evidenceVersion, { headers: { ETag: '"lifecycle:2"' } }),
      );

    render(
      <AdminSessionProvider>
        <ContentVersionReview contentVersion="fd-20260801-r1" />
      </AdminSessionProvider>,
    );

    fireEvent.change(await screen.findByLabelText("大师称呼"), { target: { value: "林老师" } });
    fireEvent.change(screen.getByLabelText("核对时间"), {
      target: { value: "2026-07-31T20:00" },
    });
    fireEvent.change(screen.getByLabelText("结论"), { target: { value: "confirmed" } });
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "已逐项确认" } });
    fireEvent.change(screen.getByLabelText("凭证引用"), {
      target: { value: "https://example.com/message/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登记核对凭证" }));

    expect(await screen.findByText("林老师")).toBeInTheDocument();
    const headers = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(headers.get("If-Match")).toBe('"lifecycle:1"');
    expect(headers.get("Idempotency-Key")).toMatch(/^[a-f0-9]{32}$/u);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual(
      expect.objectContaining({
        conclusion: "confirmed",
        references: [{ kind: "message_link", reference: "https://example.com/message/1" }],
        reviewedAt: "2026-07-31T12:00:00.000Z",
        reviewerDisplayName: "林老师",
      }),
    );
  });

  it("reuses the evidence idempotency key after an ambiguous network result", async () => {
    const evidenceVersion = {
      ...version,
      lifecycleRevision: 2,
      masterReviewEvidence: [
        {
          conclusion: "confirmed",
          evidenceId: "evidence-retry",
          notes: "已确认",
          references: [{ kind: "note", reference: "线下记录-1" }],
          reviewedAt: "2026-07-31T12:00:00.000Z",
          reviewerDisplayName: "林老师",
        },
      ],
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(
        createAdminJsonResponse(version, { headers: { ETag: '"lifecycle:1"' } }),
      )
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(
        createAdminJsonResponse(evidenceVersion, { headers: { ETag: '"lifecycle:2"' } }),
      );

    render(
      <AdminSessionProvider>
        <ContentVersionReview contentVersion="fd-20260801-r1" />
      </AdminSessionProvider>,
    );
    fireEvent.change(await screen.findByLabelText("大师称呼"), { target: { value: "林老师" } });
    fireEvent.change(screen.getByLabelText("核对时间"), {
      target: { value: "2026-07-31T20:00" },
    });
    fireEvent.change(screen.getByLabelText("凭证类型"), { target: { value: "note" } });
    fireEvent.change(screen.getByLabelText("凭证引用"), { target: { value: "线下记录-1" } });

    fireEvent.click(screen.getByRole("button", { name: "登记核对凭证" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("结果暂时无法确认");
    fireEvent.click(screen.getByRole("button", { name: "登记核对凭证" }));

    expect(await screen.findByText("林老师")).toBeInTheDocument();
    const firstKey = new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("Idempotency-Key");
    const retryKey = new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get("Idempotency-Key");
    expect(firstKey).toMatch(/^[a-f0-9]{32}$/u);
    expect(retryKey).toBe(firstKey);
  });

  it("does not approve without evidence and surfaces the stable 422 review error", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(
        createAdminJsonResponse(version, { headers: { ETag: '"lifecycle:1"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 422 }));

    render(
      <AdminSessionProvider>
        <ContentVersionReview contentVersion="fd-20260801-r1" />
      </AdminSessionProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "批准内容" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("必审检查或大师凭证尚未通过");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("requires a reason and returns the immutable version for changes", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(
        createAdminJsonResponse(version, { headers: { ETag: '"lifecycle:1"' } }),
      )
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            activeContentVersion: null,
            auditEventId: "audit-review-1",
            contentVersion: "fd-20260801-r1",
            fortuneDate: "2026-08-01",
            lifecycleRevision: 2,
            state: "changes_requested",
            transitions: [
              {
                contentVersion: "fd-20260801-r1",
                fromState: "in_review",
                toState: "changes_requested",
              },
            ],
          },
          { headers: { ETag: '"lifecycle:2"' } },
        ),
      );

    render(
      <AdminSessionProvider>
        <ContentVersionReview contentVersion="fd-20260801-r1" />
      </AdminSessionProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "退回修改" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请填写退回原因");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.change(screen.getByLabelText("退回原因"), {
      target: { value: "次吉档说明与大师原意不一致" },
    });
    fireEvent.click(screen.getByRole("button", { name: "退回修改" }));

    expect(await screen.findByText("需要修改")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制为新草稿" })).toBeInTheDocument();
    const request = fetchMock.mock.calls[2]?.[1];
    const headers = new Headers(request?.headers);
    expect(headers.get("If-Match")).toBe('"lifecycle:1"');
    expect(headers.get("Idempotency-Key")).toMatch(/^[a-f0-9]{32}$/u);
    expect(JSON.parse(String(request?.body))).toEqual({
      decision: "changes_requested",
      reason: "次吉档说明与大师原意不一致",
    });
  });

  it("reuses the review-decision idempotency key after an ambiguous network result", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(
        createAdminJsonResponse(version, { headers: { ETag: '"lifecycle:1"' } }),
      )
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            activeContentVersion: null,
            auditEventId: "audit-approved-retry",
            contentVersion: "fd-20260801-r1",
            fortuneDate: "2026-08-01",
            lifecycleRevision: 2,
            state: "approved",
            transitions: [
              {
                contentVersion: "fd-20260801-r1",
                fromState: "in_review",
                toState: "approved",
              },
            ],
          },
          { headers: { ETag: '"lifecycle:2"' } },
        ),
      );

    render(
      <AdminSessionProvider>
        <ContentVersionReview contentVersion="fd-20260801-r1" />
      </AdminSessionProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "批准内容" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("结果暂时无法确认");
    fireEvent.click(screen.getByRole("button", { name: "批准内容" }));

    expect(await screen.findByText("可以发布")).toBeInTheDocument();
    const firstKey = new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("Idempotency-Key");
    const retryKey = new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get("Idempotency-Key");
    expect(firstKey).toMatch(/^[a-f0-9]{32}$/u);
    expect(retryKey).toBe(firstKey);
  });

  it("copies a changes-requested immutable version into a new editable draft", async () => {
    const changesRequested = { ...version, state: "changes_requested" };
    const copiedDraft = {
      createdAt: "2026-07-31T13:00:00+08:00",
      draftId: "draft-copy",
      draftRevision: 1,
      fortuneDate: "2026-08-01",
      modules: version.snapshot,
      state: "draft",
      updatedAt: "2026-07-31T13:00:00+08:00",
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(
        createAdminJsonResponse(changesRequested, { headers: { ETag: '"lifecycle:1"' } }),
      )
      .mockResolvedValueOnce(
        createAdminJsonResponse(copiedDraft, {
          headers: { ETag: '"draft:1"' },
          status: 201,
        }),
      );

    render(
      <AdminSessionProvider>
        <ContentVersionReview contentVersion="fd-20260801-r1" />
      </AdminSessionProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "复制为新草稿" }));

    expect(await screen.findByRole("link", { name: "编辑复制的草稿" })).toHaveAttribute(
      "href",
      "/admin/content/drafts/draft-copy",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      copyFromContentVersion: "fd-20260801-r1",
      fortuneDate: "2026-08-01",
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("does not repeat an explicit copy when the create result is ambiguous", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          { ...version, state: "changes_requested" },
          { headers: { ETag: '"lifecycle:1"' } },
        ),
      )
      .mockRejectedValueOnce(new TypeError("connection closed"));

    render(
      <AdminSessionProvider>
        <ContentVersionReview contentVersion="fd-20260801-r1" />
      </AdminSessionProvider>,
    );

    const copyButton = await screen.findByRole("button", { name: "复制为新草稿" });
    fireEvent.click(copyButton);

    expect(await screen.findByRole("alert")).toHaveTextContent("不要重复复制");
    expect(copyButton).toBeDisabled();
    fireEvent.click(copyButton);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("link", { name: "检查草稿队列" })).toHaveAttribute(
      "href",
      "/admin/content",
    );
  });
});
