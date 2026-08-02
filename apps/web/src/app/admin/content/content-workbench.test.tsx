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

describe("ContentWorkbench", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates an empty or copied draft and exposes its editor link", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(createAdminJsonResponse({ items: [] }))
      .mockResolvedValueOnce(
        createAdminJsonResponse(draft, { headers: { ETag: '"draft:1"' }, status: 201 }),
      );

    render(
      <AdminSessionProvider>
        <ContentWorkbench />
      </AdminSessionProvider>,
    );

    fireEvent.change(await screen.findByLabelText("命理日"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(screen.getByLabelText("复制来源内容版本（可选）"), {
      target: { value: "fd-20260731-r2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建草稿" }));

    expect(await screen.findByRole("link", { name: "编辑新草稿" })).toHaveAttribute(
      "href",
      "/admin/content/drafts/draft-31",
    );
    const request = fetchMock.mock.calls[2]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      copyFromContentVersion: "fd-20260731-r2",
      fortuneDate: "2026-08-01",
    });
  });

  it("lists immutable versions for one fortune date and supports continuing a draft by id", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(
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
      )
      .mockResolvedValueOnce(
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

    render(
      <AdminSessionProvider>
        <ContentWorkbench />
      </AdminSessionProvider>,
    );

    fireEvent.change(await screen.findByLabelText("查询命理日"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询版本" }));

    expect(await screen.findByText("待大师核对")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /fd-20260801-r1/ })).toHaveAttribute(
      "href",
      "/admin/content/versions/fd-20260801-r1",
    );

    expect(await screen.findByRole("link", { name: /继续编辑 draft-31/ })).toHaveAttribute(
      "href",
      "/admin/content/drafts/draft-31",
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});
