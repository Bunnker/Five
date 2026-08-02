import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminContentVersion, ContentVersionList } from "../../../admin-api";
import { createAdminJsonResponse } from "../../../admin-test-responses";
import { ContentLifecycleActions } from "./content-lifecycle-actions";

const version = {
  activeContentVersion: "fd-20260801-r0",
  contentVersion: "fd-20260801-r1",
  fortuneDate: "2026-08-01",
  lifecycleRevision: 6,
  masterReviewEvidence: [],
  preflightChecks: [
    { code: "required_images", message: "两张必备图片可安全交付", status: "passed" },
  ],
  snapshot: {
    calendar_algorithm: null,
    copy_and_formula: null,
    poster_consistency: null,
    visual_and_rights: null,
  },
  state: "approved" as const,
} satisfies AdminContentVersion;

const versionList = {
  activeContentVersion: "fd-20260801-r0",
  fortuneDate: "2026-08-01",
  items: [
    {
      contentVersion: "fd-20260801-r1",
      createdAt: "2026-07-31T12:00:00+08:00",
      effectiveFrom: "2026-07-31T23:00:00+08:00",
      effectiveTo: "2026-08-01T23:00:00+08:00",
      lifecycleRevision: 6,
      state: "approved" as const,
    },
    {
      contentVersion: "fd-20260801-r0",
      createdAt: "2026-07-30T12:00:00+08:00",
      effectiveFrom: "2026-07-31T23:00:00+08:00",
      effectiveTo: "2026-08-01T23:00:00+08:00",
      lifecycleRevision: 6,
      state: "published" as const,
    },
  ],
} satisfies ContentVersionList;

describe("ContentLifecycleActions", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createAdminJsonResponse(versionList)));
  });

  const advancedRetryCases: Array<{
    actionName: string;
    advancedList: ContentVersionList;
    initialList: ContentVersionList;
    label: string;
    prepare: () => void;
    retryName: string;
    viewedVersion: AdminContentVersion;
  }> = [
    {
      actionName: "安排定时上线",
      advancedList: {
        ...versionList,
        items: versionList.items.map((item) =>
          item.contentVersion === version.contentVersion
            ? { ...item, lifecycleRevision: 8, state: "scheduled" }
            : item,
        ),
      },
      initialList: versionList,
      label: "排期",
      prepare: () => {
        fireEvent.change(screen.getByLabelText("排期原因"), {
          target: { value: "按冻结时刻上线" },
        });
        fireEvent.change(screen.getByLabelText("输入内容版本以确认排期"), {
          target: { value: version.contentVersion },
        });
      },
      retryName: "确认状态并安全重试排期",
      viewedVersion: version,
    },
    {
      actionName: "取消排期",
      advancedList: {
        ...versionList,
        items: versionList.items.map((item) =>
          item.contentVersion === version.contentVersion
            ? { ...item, lifecycleRevision: 8, state: "approved" }
            : item,
        ),
      },
      initialList: {
        ...versionList,
        items: versionList.items.map((item) =>
          item.contentVersion === version.contentVersion ? { ...item, state: "scheduled" } : item,
        ),
      },
      label: "取消排期",
      prepare: () => {
        fireEvent.change(screen.getByLabelText("取消排期原因"), {
          target: { value: "重新确认上线窗口" },
        });
        fireEvent.change(screen.getByLabelText("输入内容版本以确认取消排期"), {
          target: { value: version.contentVersion },
        });
      },
      retryName: "确认状态并安全重试取消排期",
      viewedVersion: { ...version, state: "scheduled" },
    },
    {
      actionName: "立即发布",
      advancedList: {
        ...versionList,
        activeContentVersion: version.contentVersion,
        items: versionList.items.map((item) =>
          item.contentVersion === version.contentVersion
            ? { ...item, lifecycleRevision: 8, state: "published" }
            : item,
        ),
      },
      initialList: versionList,
      label: "发布",
      prepare: () => {
        fireEvent.change(screen.getByLabelText("发布原因"), {
          target: { value: "全部检查通过" },
        });
        fireEvent.change(screen.getByLabelText("输入内容版本以确认发布"), {
          target: { value: version.contentVersion },
        });
      },
      retryName: "确认状态并安全重试发布",
      viewedVersion: version,
    },
    {
      actionName: "下线当前版本",
      advancedList: {
        ...versionList,
        activeContentVersion: "fd-20260801-r0",
        items: versionList.items.map((item) =>
          item.contentVersion === version.contentVersion
            ? { ...item, lifecycleRevision: 8, state: "withdrawn" }
            : { ...item, lifecycleRevision: 8, state: "published" },
        ),
      },
      initialList: {
        ...versionList,
        activeContentVersion: version.contentVersion,
        items: versionList.items.map((item) =>
          item.contentVersion === version.contentVersion
            ? { ...item, state: "published" }
            : { ...item, state: "superseded" },
        ),
      },
      label: "下线",
      prepare: () => {
        fireEvent.change(screen.getByLabelText("下线后恢复的安全旧版本（可选）"), {
          target: { value: "fd-20260801-r0" },
        });
        fireEvent.change(screen.getByLabelText("下线原因"), {
          target: { value: "紧急停止公开" },
        });
        fireEvent.change(screen.getByLabelText("输入内容版本以确认下线"), {
          target: { value: version.contentVersion },
        });
      },
      retryName: "确认状态并安全重试下线",
      viewedVersion: {
        ...version,
        activeContentVersion: version.contentVersion,
        state: "published",
      },
    },
    {
      actionName: "恢复这个历史版本",
      advancedList: {
        ...versionList,
        activeContentVersion: "fd-20260801-r0",
        items: versionList.items.map((item) =>
          item.contentVersion === "fd-20260801-r0"
            ? { ...item, lifecycleRevision: 8, state: "published" }
            : { ...item, lifecycleRevision: 8, state: "superseded" },
        ),
      },
      initialList: {
        ...versionList,
        activeContentVersion: version.contentVersion,
        items: versionList.items.map((item) =>
          item.contentVersion === "fd-20260801-r0"
            ? { ...item, state: "superseded" }
            : { ...item, state: "published" },
        ),
      },
      label: "恢复",
      prepare: () => {
        fireEvent.change(screen.getByLabelText("恢复原因"), {
          target: { value: "恢复经过验证的旧版" },
        });
        fireEvent.change(screen.getByLabelText("输入内容版本以确认恢复"), {
          target: { value: "fd-20260801-r0" },
        });
      },
      retryName: "确认状态并安全重试恢复",
      viewedVersion: {
        ...version,
        activeContentVersion: version.contentVersion,
        contentVersion: "fd-20260801-r0",
        state: "superseded",
      },
    },
  ];

  it.each(advancedRetryCases)(
    "does not replay the frozen $label request after a later legal revision",
    async ({ actionName, advancedList, initialList, prepare, retryName, viewedVersion }) => {
      const advancedTarget = advancedList.items.find(
        (item) => item.contentVersion === viewedVersion.contentVersion,
      );
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockReset()
        .mockResolvedValueOnce(createAdminJsonResponse(initialList))
        .mockRejectedValueOnce(new TypeError("response lost"))
        .mockResolvedValueOnce(createAdminJsonResponse(advancedList))
        .mockResolvedValueOnce(
          createAdminJsonResponse(
            {
              activeContentVersion: advancedList.activeContentVersion,
              auditEventId: "stale-intent-must-not-replay",
              contentVersion: viewedVersion.contentVersion,
              fortuneDate: viewedVersion.fortuneDate,
              lifecycleRevision: 7,
              state: advancedTarget?.state ?? viewedVersion.state,
              transitions: [],
            },
            { headers: { ETag: '"lifecycle:7"' } },
          ),
        );
      const onVersionRefresh = vi.fn().mockResolvedValue(false);
      render(
        <ContentLifecycleActions
          csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
          etag={'"lifecycle:6"'}
          onLifecycleChange={vi.fn()}
          onUnauthorized={vi.fn()}
          onVersionRefresh={onVersionRefresh}
          version={viewedVersion}
        />,
      );

      await screen.findByRole("button", { name: actionName });
      prepare();
      fireEvent.click(screen.getByRole("button", { name: actionName }));
      fireEvent.click(await screen.findByRole("button", { name: retryName }));

      await waitFor(() =>
        expect(screen.queryByRole("button", { name: retryName })).not.toBeInTheDocument(),
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
      expect(onVersionRefresh).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("stale-intent-must-not-replay")).not.toBeInTheDocument();
    },
  );

  it("offers only schedule and immediate publish for an approved server-listed version", async () => {
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={version}
      />,
    );

    expect(await screen.findByRole("heading", { name: "上线控制" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "安排定时上线" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即发布" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下线当前版本" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复这个历史版本" })).not.toBeInTheDocument();
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("publishes only after reason and exact-version confirmation, then shows the audit transition", async () => {
    const published = {
      activeContentVersion: "fd-20260801-r1",
      auditEventId: "audit-publish-001",
      contentVersion: "fd-20260801-r1",
      fortuneDate: "2026-08-01",
      lifecycleRevision: 7,
      state: "published" as const,
      transitions: [
        {
          contentVersion: "fd-20260801-r1",
          fromState: "approved" as const,
          toState: "published" as const,
        },
      ],
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(versionList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(published, { headers: { ETag: '"lifecycle:7"' } }),
      );
    const onLifecycleChange = vi.fn();
    const onUnauthorized = vi.fn();
    const view = render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={onLifecycleChange}
        onUnauthorized={onUnauthorized}
        version={version}
      />,
    );

    const publishButton = await screen.findByRole("button", { name: "立即发布" });
    expect(publishButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("发布原因"), {
      target: { value: "全部检查通过，立即上线" },
    });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认发布"), {
      target: { value: "fd-20260801-r1" },
    });
    expect(publishButton).toBeEnabled();
    fireEvent.click(publishButton);

    await waitFor(() => expect(onLifecycleChange).toHaveBeenCalledTimes(1));
    expect(onLifecycleChange).toHaveBeenCalledWith({
      etag: '"lifecycle:7"',
      result: published,
    });
    expect(await screen.findByText("fd-20260801-r1 · 可以发布 → 已上线")).toBeInTheDocument();
    expect(screen.getByText("audit-publish-001")).toBeInTheDocument();
    view.rerender(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:7"'}
        onLifecycleChange={onLifecycleChange}
        onUnauthorized={onUnauthorized}
        version={{
          ...version,
          activeContentVersion: version.contentVersion,
          lifecycleRevision: 7,
          state: "published",
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "下线当前版本" })).toBeInTheDocument();
    expect(screen.queryByText(/已不再是当前在线版本/u)).not.toBeInTheDocument();
    const request = fetchMock.mock.calls[1]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      expectedActiveContentVersion: "fd-20260801-r0",
      reason: "全部检查通过，立即上线",
    });
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("schedules with the exact effective time returned by the same-day server list", async () => {
    const serverEffectiveFrom = "2026-08-01T01:23:00+08:00";
    const serverList = {
      ...versionList,
      items: versionList.items.map((item) =>
        item.contentVersion === version.contentVersion
          ? { ...item, effectiveFrom: serverEffectiveFrom }
          : item,
      ),
    };
    const scheduled = {
      activeContentVersion: "fd-20260801-r0",
      auditEventId: "audit-schedule-001",
      contentVersion: "fd-20260801-r1",
      fortuneDate: "2026-08-01",
      lifecycleRevision: 7,
      state: "scheduled" as const,
      transitions: [
        {
          contentVersion: "fd-20260801-r1",
          fromState: "approved" as const,
          toState: "scheduled" as const,
        },
      ],
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(serverList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(scheduled, { headers: { ETag: '"lifecycle:7"' } }),
      );
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={version}
      />,
    );

    const scheduleButton = await screen.findByRole("button", { name: "安排定时上线" });
    expect(scheduleButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("排期原因"), {
      target: { value: "按服务端冻结的时间自动上线" },
    });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认排期"), {
      target: { value: version.contentVersion },
    });
    expect(scheduleButton).toBeEnabled();
    fireEvent.click(scheduleButton);

    expect(await screen.findByText("fd-20260801-r1 · 可以发布 → 已安排上线")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      effectiveFrom: serverEffectiveFrom,
      expectedActiveContentVersion: "fd-20260801-r0",
      reason: "按服务端冻结的时间自动上线",
    });
  });

  it("offers cancel and immediate publish for a scheduled version", async () => {
    const scheduledVersion = { ...version, state: "scheduled" as const };
    const scheduledList = {
      ...versionList,
      items: versionList.items.map((item) =>
        item.contentVersion === version.contentVersion
          ? { ...item, state: "scheduled" as const }
          : item,
      ),
    };
    vi.mocked(fetch).mockReset().mockResolvedValue(createAdminJsonResponse(scheduledList));

    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={scheduledVersion}
      />,
    );

    expect(await screen.findByRole("button", { name: "取消排期" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即发布" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "安排定时上线" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下线当前版本" })).not.toBeInTheDocument();
  });

  it("cancels a schedule only after an exact confirmation", async () => {
    const scheduledVersion = { ...version, state: "scheduled" as const };
    const scheduledList = {
      ...versionList,
      items: versionList.items.map((item) =>
        item.contentVersion === version.contentVersion
          ? { ...item, state: "scheduled" as const }
          : item,
      ),
    };
    const cancelled = {
      activeContentVersion: "fd-20260801-r0",
      auditEventId: "audit-cancel-001",
      contentVersion: "fd-20260801-r1",
      fortuneDate: "2026-08-01",
      lifecycleRevision: 7,
      state: "approved" as const,
      transitions: [
        {
          contentVersion: "fd-20260801-r1",
          fromState: "scheduled" as const,
          toState: "approved" as const,
        },
      ],
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(scheduledList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(cancelled, { headers: { ETag: '"lifecycle:7"' } }),
      );
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={scheduledVersion}
      />,
    );

    const cancelButton = await screen.findByRole("button", { name: "取消排期" });
    expect(cancelButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("取消排期原因"), {
      target: { value: "上线时间需要重新确认" },
    });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认取消排期"), {
      target: { value: version.contentVersion },
    });
    expect(cancelButton).toBeEnabled();
    fireEvent.click(cancelButton);

    expect(await screen.findByText("fd-20260801-r1 · 已安排上线 → 可以发布")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      expectedActiveContentVersion: "fd-20260801-r0",
      reason: "上线时间需要重新确认",
    });
  });

  it("withdraws the active version with an optional replacement chosen only from same-day history", async () => {
    const publishedVersion = {
      ...version,
      activeContentVersion: version.contentVersion,
      state: "published" as const,
    };
    const publishedList = {
      activeContentVersion: version.contentVersion,
      fortuneDate: version.fortuneDate,
      items: [
        { ...versionList.items[0]!, state: "published" as const },
        { ...versionList.items[1]!, state: "superseded" as const },
        {
          ...versionList.items[0]!,
          contentVersion: "fd-20260801-r2",
          state: "approved" as const,
        },
      ],
    };
    const withdrawn = {
      activeContentVersion: "fd-20260801-r0",
      auditEventId: "audit-withdraw-001",
      contentVersion: version.contentVersion,
      fortuneDate: version.fortuneDate,
      lifecycleRevision: 7,
      state: "withdrawn" as const,
      transitions: [
        {
          contentVersion: version.contentVersion,
          fromState: "published" as const,
          toState: "withdrawn" as const,
        },
        {
          contentVersion: "fd-20260801-r0",
          fromState: "superseded" as const,
          toState: "published" as const,
        },
      ],
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(publishedList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(withdrawn, { headers: { ETag: '"lifecycle:7"' } }),
      );
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={publishedVersion}
      />,
    );

    const withdrawButton = await screen.findByRole("button", { name: "下线当前版本" });
    const replacement = screen.getByLabelText("下线后恢复的安全旧版本（可选）");
    expect(replacement).toHaveTextContent("fd-20260801-r0");
    expect(replacement).not.toHaveTextContent("fd-20260801-r2");
    fireEvent.change(replacement, { target: { value: "fd-20260801-r0" } });
    fireEvent.change(screen.getByLabelText("下线原因"), {
      target: { value: "发现合规问题，需要立即停止公开" },
    });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认下线"), {
      target: { value: version.contentVersion },
    });
    expect(withdrawButton).toBeEnabled();
    fireEvent.click(withdrawButton);

    expect(await screen.findByText("fd-20260801-r1 · 已上线 → 已下线")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      expectedActiveContentVersion: version.contentVersion,
      reason: "发现合规问题，需要立即停止公开",
      replacementContentVersion: "fd-20260801-r0",
    });
  });

  it("restores the currently viewed same-day superseded version after exact confirmation", async () => {
    const historicalVersion = {
      ...version,
      activeContentVersion: "fd-20260801-r1",
      contentVersion: "fd-20260801-r0",
      state: "superseded" as const,
    };
    const historicalList = {
      activeContentVersion: "fd-20260801-r1",
      fortuneDate: version.fortuneDate,
      items: [
        { ...versionList.items[0]!, state: "published" as const },
        { ...versionList.items[1]!, state: "superseded" as const },
      ],
    };
    const restored = {
      activeContentVersion: "fd-20260801-r0",
      auditEventId: "audit-rollback-001",
      contentVersion: "fd-20260801-r0",
      fortuneDate: version.fortuneDate,
      lifecycleRevision: 7,
      state: "published" as const,
      transitions: [
        {
          contentVersion: "fd-20260801-r1",
          fromState: "published" as const,
          toState: "superseded" as const,
        },
        {
          contentVersion: "fd-20260801-r0",
          fromState: "superseded" as const,
          toState: "published" as const,
        },
      ],
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(historicalList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(restored, { headers: { ETag: '"lifecycle:7"' } }),
      );
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={historicalVersion}
      />,
    );

    const rollbackButton = await screen.findByRole("button", {
      name: "恢复这个历史版本",
    });
    expect(rollbackButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("恢复原因"), {
      target: { value: "当前版本异常，恢复经过验证的旧版" },
    });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认恢复"), {
      target: { value: "fd-20260801-r0" },
    });
    expect(rollbackButton).toBeEnabled();
    fireEvent.click(rollbackButton);

    expect(await screen.findByText("fd-20260801-r0 · 已被新版本替换 → 已上线")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      expectedActiveContentVersion: "fd-20260801-r1",
      reason: "当前版本异常，恢复经过验证的旧版",
      targetContentVersion: "fd-20260801-r0",
    });
  });

  it("treats a withdrawn version as terminal and never offers direct restore or publish", async () => {
    const withdrawnVersion = {
      ...version,
      activeContentVersion: null,
      state: "withdrawn" as const,
    };
    const withdrawnList = {
      ...versionList,
      activeContentVersion: null,
      items: versionList.items.map((item) =>
        item.contentVersion === version.contentVersion
          ? { ...item, state: "withdrawn" as const }
          : item,
      ),
    };
    vi.mocked(fetch).mockReset().mockResolvedValue(createAdminJsonResponse(withdrawnList));

    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={withdrawnVersion}
      />,
    );

    expect(await screen.findByText("已下线版本不能直接恢复或重新发布。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "立即发布" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复这个历史版本" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下线当前版本" })).not.toBeInTheDocument();
  });

  it("shows the stable publish-preflight failure instead of a generic status message", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(versionList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            error: {
              code: "PUBLISH_PRECHECK_FAILED",
              details: { failedChecks: ["required_images"] },
              message: "发布前检查未通过。",
              requestId: "request-publish-preflight-0001",
              retryable: false,
            },
          },
          {
            headers: { "X-Request-Id": "request-publish-preflight-0001" },
            status: 422,
          },
        ),
      );
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={version}
      />,
    );

    await screen.findByRole("button", { name: "立即发布" });
    fireEvent.change(screen.getByLabelText("发布原因"), { target: { value: "准备上线" } });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认发布"), {
      target: { value: version.contentVersion },
    });
    fireEvent.click(screen.getByRole("button", { name: "立即发布" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "发布预检未通过，请按上方检查清单处理失败项后重试。",
    );
  });

  it("unblocks after both authoritative reads succeed even when the refreshed ETag is unchanged", async () => {
    const changedList = { ...versionList, activeContentVersion: "fd-20260801-r2" };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(versionList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            error: {
              code: "ACTIVE_CONTENT_VERSION_CHANGED",
              details: { currentActiveContentVersion: "fd-20260801-r2" },
              message: "当前在线版本已经变化。",
              requestId: "request-active-conflict-0001",
              retryable: true,
            },
          },
          {
            headers: { "X-Request-Id": "request-active-conflict-0001" },
            status: 409,
          },
        ),
      )
      .mockResolvedValueOnce(createAdminJsonResponse(changedList));
    const onVersionRefresh = vi.fn().mockResolvedValue(true);
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        onVersionRefresh={onVersionRefresh}
        version={version}
      />,
    );

    await screen.findByRole("button", { name: "立即发布" });
    fireEvent.change(screen.getByLabelText("发布原因"), { target: { value: "准备上线" } });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认发布"), {
      target: { value: version.contentVersion },
    });
    fireEvent.click(screen.getByRole("button", { name: "立即发布" }));

    expect(await screen.findByText("当前在线版本：fd-20260801-r2")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("当前在线版本已经变化");
    expect(screen.getByRole("button", { name: "立即发布" })).toBeEnabled();
    expect(onVersionRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("also refreshes and locks schedule controls when the lifecycle revision is stale", async () => {
    const changedList = {
      ...versionList,
      items: versionList.items.map((item) => ({ ...item, lifecycleRevision: 7 })),
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(versionList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            error: {
              code: "REVISION_MISMATCH",
              details: { currentLifecycleRevision: 7 },
              message: "生命周期修订已经变化。",
              requestId: "request-schedule-revision-0001",
              retryable: true,
            },
          },
          {
            headers: { "X-Request-Id": "request-schedule-revision-0001" },
            status: 412,
          },
        ),
      )
      .mockResolvedValueOnce(createAdminJsonResponse(changedList));
    const onVersionRefresh = vi.fn().mockResolvedValue(false);
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        onVersionRefresh={onVersionRefresh}
        version={version}
      />,
    );

    await screen.findByRole("button", { name: "安排定时上线" });
    fireEvent.change(screen.getByLabelText("排期原因"), { target: { value: "明日规范时刻上线" } });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认排期"), {
      target: { value: version.contentVersion },
    });
    fireEvent.click(screen.getByRole("button", { name: "安排定时上线" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("生命周期修订已过期");
    expect(screen.getByRole("button", { name: "安排定时上线" })).toBeDisabled();
    expect(onVersionRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("freezes an uncertain publish intent and reuses its body and idempotency key after a ledger check", async () => {
    const published = {
      activeContentVersion: version.contentVersion,
      auditEventId: "audit-publish-retried-001",
      contentVersion: version.contentVersion,
      fortuneDate: version.fortuneDate,
      lifecycleRevision: 7,
      state: "published" as const,
      transitions: [
        {
          contentVersion: version.contentVersion,
          fromState: "approved" as const,
          toState: "published" as const,
        },
      ],
    };
    const immediatelyAppliedList = {
      ...versionList,
      activeContentVersion: version.contentVersion,
      items: versionList.items.map((item) =>
        item.contentVersion === version.contentVersion
          ? { ...item, lifecycleRevision: 7, state: "published" as const }
          : item,
      ),
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(versionList))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(createAdminJsonResponse(immediatelyAppliedList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(published, { headers: { ETag: '"lifecycle:7"' } }),
      );
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={version}
      />,
    );

    await screen.findByRole("button", { name: "立即发布" });
    fireEvent.change(screen.getByLabelText("发布原因"), { target: { value: "准备上线" } });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认发布"), {
      target: { value: version.contentVersion },
    });
    fireEvent.click(screen.getByRole("button", { name: "立即发布" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("发布结果暂时无法确认");
    expect(screen.getByLabelText("发布原因")).toBeDisabled();
    const retry = screen.getByRole("button", { name: "确认状态并安全重试发布" });
    fireEvent.click(retry);

    expect(await screen.findByText("audit-publish-retried-001")).toBeInTheDocument();
    const firstRequest = fetchMock.mock.calls[1]?.[1];
    const retriedRequest = fetchMock.mock.calls[3]?.[1];
    expect(retriedRequest?.body).toBe(firstRequest?.body);
    expect(new Headers(retriedRequest?.headers).get("Idempotency-Key")).toBe(
      new Headers(firstRequest?.headers).get("Idempotency-Key"),
    );
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("freezes an uncertain schedule intent and reuses the complete request after a ledger check", async () => {
    const scheduled = {
      activeContentVersion: versionList.activeContentVersion,
      auditEventId: "audit-schedule-retried-001",
      contentVersion: version.contentVersion,
      fortuneDate: version.fortuneDate,
      lifecycleRevision: 7,
      state: "scheduled" as const,
      transitions: [
        {
          contentVersion: version.contentVersion,
          fromState: "approved" as const,
          toState: "scheduled" as const,
        },
      ],
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(versionList))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(createAdminJsonResponse(versionList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(scheduled, { headers: { ETag: '"lifecycle:7"' } }),
      );
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={version}
      />,
    );

    await screen.findByRole("button", { name: "安排定时上线" });
    fireEvent.change(screen.getByLabelText("排期原因"), { target: { value: "按冻结时刻上线" } });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认排期"), {
      target: { value: version.contentVersion },
    });
    fireEvent.click(screen.getByRole("button", { name: "安排定时上线" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("排期结果暂时无法确认");
    expect(screen.getByLabelText("排期原因")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "确认状态并安全重试排期" }));

    expect(await screen.findByText("audit-schedule-retried-001")).toBeInTheDocument();
    const firstRequest = fetchMock.mock.calls[1]?.[1];
    const retriedRequest = fetchMock.mock.calls[3]?.[1];
    expect(retriedRequest?.body).toBe(firstRequest?.body);
    expect(new Headers(retriedRequest?.headers).get("If-Match")).toBe(
      new Headers(firstRequest?.headers).get("If-Match"),
    );
    expect(new Headers(retriedRequest?.headers).get("Idempotency-Key")).toBe(
      new Headers(firstRequest?.headers).get("Idempotency-Key"),
    );
  });

  it("freezes an uncertain cancel intent and reuses the complete request after a ledger check", async () => {
    const scheduledVersion = { ...version, state: "scheduled" as const };
    const scheduledList = {
      ...versionList,
      items: versionList.items.map((item) =>
        item.contentVersion === version.contentVersion
          ? { ...item, state: "scheduled" as const }
          : item,
      ),
    };
    const cancelled = {
      activeContentVersion: versionList.activeContentVersion,
      auditEventId: "audit-cancel-retried-001",
      contentVersion: version.contentVersion,
      fortuneDate: version.fortuneDate,
      lifecycleRevision: 7,
      state: "approved" as const,
      transitions: [
        {
          contentVersion: version.contentVersion,
          fromState: "scheduled" as const,
          toState: "approved" as const,
        },
      ],
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(scheduledList))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(createAdminJsonResponse(scheduledList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(cancelled, { headers: { ETag: '"lifecycle:7"' } }),
      );
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={scheduledVersion}
      />,
    );

    await screen.findByRole("button", { name: "取消排期" });
    fireEvent.change(screen.getByLabelText("取消排期原因"), {
      target: { value: "重新确认上线窗口" },
    });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认取消排期"), {
      target: { value: version.contentVersion },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消排期" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("取消排期结果暂时无法确认");
    expect(screen.getByLabelText("取消排期原因")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "确认状态并安全重试取消排期" }));

    expect(await screen.findByText("audit-cancel-retried-001")).toBeInTheDocument();
    const firstRequest = fetchMock.mock.calls[1]?.[1];
    const retriedRequest = fetchMock.mock.calls[3]?.[1];
    expect(retriedRequest?.body).toBe(firstRequest?.body);
    expect(new Headers(retriedRequest?.headers).get("If-Match")).toBe(
      new Headers(firstRequest?.headers).get("If-Match"),
    );
    expect(new Headers(retriedRequest?.headers).get("Idempotency-Key")).toBe(
      new Headers(firstRequest?.headers).get("Idempotency-Key"),
    );
  });

  it("freezes an uncertain withdraw intent and reuses the complete request after a ledger check", async () => {
    const publishedVersion = {
      ...version,
      activeContentVersion: version.contentVersion,
      state: "published" as const,
    };
    const publishedList = {
      activeContentVersion: version.contentVersion,
      fortuneDate: version.fortuneDate,
      items: [
        { ...versionList.items[0]!, state: "published" as const },
        { ...versionList.items[1]!, state: "superseded" as const },
      ],
    };
    const withdrawn = {
      activeContentVersion: "fd-20260801-r0",
      auditEventId: "audit-withdraw-retried-001",
      contentVersion: version.contentVersion,
      fortuneDate: version.fortuneDate,
      lifecycleRevision: 7,
      state: "withdrawn" as const,
      transitions: [
        {
          contentVersion: version.contentVersion,
          fromState: "published" as const,
          toState: "withdrawn" as const,
        },
        {
          contentVersion: "fd-20260801-r0",
          fromState: "superseded" as const,
          toState: "published" as const,
        },
      ],
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(publishedList))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(createAdminJsonResponse(publishedList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(withdrawn, { headers: { ETag: '"lifecycle:7"' } }),
      );
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={publishedVersion}
      />,
    );

    await screen.findByRole("button", { name: "下线当前版本" });
    fireEvent.change(screen.getByLabelText("下线后恢复的安全旧版本（可选）"), {
      target: { value: "fd-20260801-r0" },
    });
    fireEvent.change(screen.getByLabelText("下线原因"), {
      target: { value: "紧急停止公开" },
    });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认下线"), {
      target: { value: version.contentVersion },
    });
    fireEvent.click(screen.getByRole("button", { name: "下线当前版本" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("下线结果暂时无法确认");
    expect(screen.getByLabelText("下线原因")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "确认状态并安全重试下线" }));

    expect(await screen.findByText("audit-withdraw-retried-001")).toBeInTheDocument();
    const firstRequest = fetchMock.mock.calls[1]?.[1];
    const retriedRequest = fetchMock.mock.calls[3]?.[1];
    expect(retriedRequest?.body).toBe(firstRequest?.body);
    expect(new Headers(retriedRequest?.headers).get("If-Match")).toBe(
      new Headers(firstRequest?.headers).get("If-Match"),
    );
    expect(new Headers(retriedRequest?.headers).get("Idempotency-Key")).toBe(
      new Headers(firstRequest?.headers).get("Idempotency-Key"),
    );
  });

  it("freezes an uncertain rollback intent and reuses the complete request after a ledger check", async () => {
    const historicalVersion = {
      ...version,
      activeContentVersion: "fd-20260801-r1",
      contentVersion: "fd-20260801-r0",
      state: "superseded" as const,
    };
    const historicalList = {
      activeContentVersion: "fd-20260801-r1",
      fortuneDate: version.fortuneDate,
      items: [
        { ...versionList.items[0]!, state: "published" as const },
        { ...versionList.items[1]!, state: "superseded" as const },
      ],
    };
    const restored = {
      activeContentVersion: "fd-20260801-r0",
      auditEventId: "audit-rollback-retried-001",
      contentVersion: "fd-20260801-r0",
      fortuneDate: version.fortuneDate,
      lifecycleRevision: 7,
      state: "published" as const,
      transitions: [
        {
          contentVersion: "fd-20260801-r1",
          fromState: "published" as const,
          toState: "superseded" as const,
        },
        {
          contentVersion: "fd-20260801-r0",
          fromState: "superseded" as const,
          toState: "published" as const,
        },
      ],
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(createAdminJsonResponse(historicalList))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(createAdminJsonResponse(historicalList))
      .mockResolvedValueOnce(
        createAdminJsonResponse(restored, { headers: { ETag: '"lifecycle:7"' } }),
      );
    render(
      <ContentLifecycleActions
        csrfToken="csrf-token-that-is-longer-than-thirty-two-characters"
        etag={'"lifecycle:6"'}
        onLifecycleChange={vi.fn()}
        onUnauthorized={vi.fn()}
        version={historicalVersion}
      />,
    );

    await screen.findByRole("button", { name: "恢复这个历史版本" });
    fireEvent.change(screen.getByLabelText("恢复原因"), {
      target: { value: "恢复经过验证的旧版" },
    });
    fireEvent.change(screen.getByLabelText("输入内容版本以确认恢复"), {
      target: { value: historicalVersion.contentVersion },
    });
    fireEvent.click(screen.getByRole("button", { name: "恢复这个历史版本" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("恢复结果暂时无法确认");
    expect(screen.getByLabelText("恢复原因")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "确认状态并安全重试恢复" }));

    expect(await screen.findByText("audit-rollback-retried-001")).toBeInTheDocument();
    const firstRequest = fetchMock.mock.calls[1]?.[1];
    const retriedRequest = fetchMock.mock.calls[3]?.[1];
    expect(retriedRequest?.body).toBe(firstRequest?.body);
    expect(new Headers(retriedRequest?.headers).get("If-Match")).toBe(
      new Headers(firstRequest?.headers).get("If-Match"),
    );
    expect(new Headers(retriedRequest?.headers).get("Idempotency-Key")).toBe(
      new Headers(firstRequest?.headers).get("Idempotency-Key"),
    );
  });
});
