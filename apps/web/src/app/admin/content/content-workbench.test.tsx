import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminSessionProvider } from "../admin-session-context";
import { createAdminJsonResponse } from "../admin-test-responses";
import { ContentWorkbench } from "./content-workbench";

const now = Date.now();
const session = {
  absoluteExpiresAt: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
  credentialRevision: 1,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
  issuedAt: new Date(now).toISOString(),
  username: "maintainer",
};

const draft = {
  createdAt: "2026-07-31T10:00:00+08:00",
  draftId: "draft-31",
  draftRevision: 1,
  fortuneDate: "2026-08-01",
  modules: {
    calendar_algorithm: null,
    copy_and_formula: null,
    poster_consistency: null,
    visual_and_rights: null,
  },
  state: "draft",
  updatedAt: "2026-07-31T10:00:00+08:00",
};

function emptyVersionList(fortuneDate = "2026-08-03") {
  return {
    activeContentVersion: null,
    fortuneDate,
    items: [],
  };
}

describe("ContentWorkbench", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows automatically generated days as the primary review queue", async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return Promise.resolve(createAdminJsonResponse(session));
      if (url.includes("daily-content-productions")) {
        return Promise.resolve(
          createAdminJsonResponse({
            items: [
              {
                completedImageSlots: 0,
                draftId: "auto-draft-1",
                draftRevision: 1,
                fortuneDate: "2026-08-02",
                imageSlots: [
                  {
                    attemptLimit: 3,
                    attempts: 0,
                    canRetry: false,
                    deliveryReady: false,
                    imageSlot: "required_primary",
                    lastError: null,
                    nextAttemptAt: null,
                    status: "pending",
                  },
                  {
                    attemptLimit: 3,
                    attempts: 0,
                    canRetry: false,
                    deliveryReady: false,
                    imageSlot: "required_alternative",
                    lastError: null,
                    nextAttemptAt: null,
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
                ],
                lastError: null,
                optionalImageStatus: "not_requested",
                pendingImageSlots: 2,
                requiredGenerationComplete: false,
                requiredImagesReady: false,
                status: "generating",
                updatedAt: "2026-08-01T08:00:00.000Z",
              },
            ],
          }),
        );
      }
      if (url.includes("daily-content-versions")) {
        return Promise.resolve(createAdminJsonResponse(emptyVersionList()));
      }
      return Promise.resolve(createAdminJsonResponse({ items: [] }));
    });

    render(
      <AdminSessionProvider>
        <ContentWorkbench />
      </AdminSessionProvider>,
    );

    expect(await screen.findByRole("heading", { name: "自动生产明细" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "这个月每天会展示什么" })).toBeVisible();
    expect(await screen.findByText("正在生成模特图")).toBeVisible();
    expect(screen.getByRole("link", { name: "检查 2026-08-02" })).toHaveAttribute(
      "href",
      "/admin/content/drafts/auto-draft-1",
    );
  });

  it("creates an empty or copied draft and exposes its editor link", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return Promise.resolve(createAdminJsonResponse(session));
      if (url.includes("daily-content-versions")) {
        return Promise.resolve(createAdminJsonResponse(emptyVersionList()));
      }
      if (url.includes("daily-content-drafts") && init?.method === "POST") {
        return Promise.resolve(
          createAdminJsonResponse(draft, { headers: { ETag: '"draft:1"' }, status: 201 }),
        );
      }
      return Promise.resolve(createAdminJsonResponse({ items: [] }));
    });

    render(
      <AdminSessionProvider>
        <ContentWorkbench />
      </AdminSessionProvider>,
    );

    fireEvent.change(await screen.findByLabelText("内容日期"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(screen.getByLabelText("从已有版本复制（可选）"), {
      target: { value: "fd-20260731-r2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建当天内容" }));

    expect(await screen.findByRole("link", { name: "继续填写内容" })).toHaveAttribute(
      "href",
      "/admin/content/drafts/draft-31",
    );
    const request = fetchMock.mock.calls.find(
      ([input, init]) => String(input).includes("daily-content-drafts") && init?.method === "POST",
    )?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      copyFromContentVersion: "fd-20260731-r2",
      fortuneDate: "2026-08-01",
    });
  });

  it("lists immutable versions for one fortune date and supports continuing a draft by id", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return Promise.resolve(createAdminJsonResponse(session));
      if (url.includes("daily-content-productions")) {
        return Promise.resolve(createAdminJsonResponse({ items: [] }));
      }
      if (url.includes("daily-content-drafts")) {
        return Promise.resolve(
          createAdminJsonResponse({
            items: [
              {
                createdAt: draft.createdAt,
                draftId: draft.draftId,
                draftRevision: draft.draftRevision,
                fortuneDate: draft.fortuneDate,
                state: draft.state,
                updatedAt: draft.updatedAt,
              },
            ],
          }),
        );
      }
      if (url.includes("fortuneDate=2026-08-01")) {
        return Promise.resolve(
          createAdminJsonResponse({
            activeContentVersion: null,
            fortuneDate: "2026-08-01",
            items: [
              {
                contentVersion: "fd-20260801-r1",
                createdAt: "2026-07-31T12:00:00+08:00",
                effectiveFrom: null,
                effectiveTo: null,
                lifecycleRevision: 1,
                state: "in_review",
              },
            ],
          }),
        );
      }
      if (url.includes("daily-content-versions")) {
        return Promise.resolve(createAdminJsonResponse(emptyVersionList()));
      }
      return Promise.resolve(createAdminJsonResponse({ items: [] }));
    });

    render(
      <AdminSessionProvider>
        <ContentWorkbench />
      </AdminSessionProvider>,
    );

    fireEvent.change(await screen.findByLabelText("查看日期"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查看内容版本" }));

    expect(await screen.findByText("待大师核对")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /fd-20260801-r1/ })).toHaveAttribute(
      "href",
      "/admin/content/versions/fd-20260801-r1",
    );

    expect(await screen.findByRole("link", { name: /继续编辑 2026-08-01/ })).toHaveAttribute(
      "href",
      "/admin/content/drafts/draft-31",
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("fortuneDate=2026-08-01"),
        expect.any(Object),
      ),
    );
  });
});
