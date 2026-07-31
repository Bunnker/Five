import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminSessionProvider } from "../admin-session-context";
import { createAdminJsonResponse } from "../admin-test-responses";
import { EmergencyControlPanel } from "./emergency-control-panel";

const testNowMs = Date.now();
const sessionResponse = {
  absoluteExpiresAt: new Date(testNowMs + 12 * 60 * 60 * 1000).toISOString(),
  credentialRevision: 3,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: new Date(testNowMs + 30 * 60 * 1000).toISOString(),
  issuedAt: new Date(testNowMs).toISOString(),
  username: "maintainer",
};
const enabledStatus = {
  auditEventId: null,
  changedAt: "2026-07-31T08:00:00+08:00",
  publicAccessEnabled: true,
  reason: null,
  revision: 2,
};
const stoppedStatus = {
  auditEventId: "audit-03",
  changedAt: "2026-07-31T08:06:00+08:00",
  publicAccessEnabled: false,
  reason: "发现未审核图片",
  revision: 3,
};

function sessionResponseObject() {
  return createAdminJsonResponse(sessionResponse);
}

function emergencyStatusResponse(status: typeof enabledStatus | typeof stoppedStatus) {
  return createAdminJsonResponse(status, {
    headers: { ETag: `"emergency-control:${status.revision}"` },
  });
}

describe("EmergencyControlPanel", () => {
  let getRandomValuesMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    getRandomValuesMock = vi.fn((values: Uint8Array) => values.fill(9));
    vi.stubGlobal("crypto", { getRandomValues: getRandomValuesMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requires the exact phrase, reason and a fresh TOTP before stopping public access", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(sessionResponseObject())
      .mockResolvedValueOnce(emergencyStatusResponse(enabledStatus))
      .mockResolvedValueOnce(emergencyStatusResponse(stoppedStatus));
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    render(
      <AdminSessionProvider>
        <EmergencyControlPanel />
      </AdminSessionProvider>,
    );

    expect(await screen.findByText("公开内容正常开放")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("操作原因"), {
      target: { value: "发现未审核图片" },
    });
    fireEvent.change(screen.getByLabelText("确认短语"), {
      target: { value: "停止全部公开内容" },
    });
    fireEvent.change(screen.getByLabelText("当前验证器六位动态码"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "立即停止全部公开内容" }));

    expect(await screen.findByText("公开内容已经停止")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/admin/api/v1/emergency-control/stop",
      expect.objectContaining({
        body: JSON.stringify({
          confirmationPhrase: "停止全部公开内容",
          reason: "发现未审核图片",
          totpCode: "123456",
        }),
        headers: expect.objectContaining({
          "Idempotency-Key": "09090909090909090909090909090909",
          "If-Match": '"emergency-control:2"',
          "X-CSRF-Token": sessionResponse.csrfToken,
        }),
        method: "POST",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("紧急状态已更新");
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it("refreshes stale state without replaying the high-risk operation", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(sessionResponseObject())
      .mockResolvedValueOnce(emergencyStatusResponse(enabledStatus))
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { ETag: '"emergency-control:3"' },
          status: 412,
        }),
      )
      .mockResolvedValueOnce(emergencyStatusResponse(stoppedStatus));
    render(
      <AdminSessionProvider>
        <EmergencyControlPanel />
      </AdminSessionProvider>,
    );
    await screen.findByText("公开内容正常开放");
    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "状态检查" } });
    fireEvent.change(screen.getByLabelText("确认短语"), {
      target: { value: "停止全部公开内容" },
    });
    fireEvent.change(screen.getByLabelText("当前验证器六位动态码"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "立即停止全部公开内容" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("状态已过期");
    expect(await screen.findByText("公开内容已经停止")).toBeInTheDocument();
    expect(screen.getByLabelText("当前验证器六位动态码")).toHaveValue("");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/stop"))).toHaveLength(1);
  });

  it("confirms an applied operation after the first response is lost without replaying it", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(sessionResponseObject())
      .mockResolvedValueOnce(emergencyStatusResponse(enabledStatus))
      .mockRejectedValueOnce(new TypeError("connection lost after write"))
      .mockResolvedValueOnce(emergencyStatusResponse(stoppedStatus));
    render(
      <AdminSessionProvider>
        <EmergencyControlPanel />
      </AdminSessionProvider>,
    );
    await screen.findByText("公开内容正常开放");
    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "发现未审核图片" } });
    fireEvent.change(screen.getByLabelText("确认短语"), {
      target: { value: "停止全部公开内容" },
    });
    fireEvent.change(screen.getByLabelText("当前验证器六位动态码"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "立即停止全部公开内容" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("操作结果暂时无法确认");
    fireEvent.click(screen.getByRole("button", { name: "确认结果并安全重试" }));

    expect(await screen.findByText("公开内容已经停止")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已确认紧急操作生效");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/stop"))).toHaveLength(1);
    expect(getRandomValuesMock).toHaveBeenCalledTimes(1);
  });

  it("reconciles an ambiguous gateway failure before deciding whether to replay", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(sessionResponseObject())
      .mockResolvedValueOnce(emergencyStatusResponse(enabledStatus))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(emergencyStatusResponse(stoppedStatus));
    render(
      <AdminSessionProvider>
        <EmergencyControlPanel />
      </AdminSessionProvider>,
    );
    await screen.findByText("公开内容正常开放");
    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "发现未审核图片" } });
    fireEvent.change(screen.getByLabelText("确认短语"), {
      target: { value: "停止全部公开内容" },
    });
    fireEvent.change(screen.getByLabelText("当前验证器六位动态码"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "立即停止全部公开内容" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("操作结果暂时无法确认");
    fireEvent.click(screen.getByRole("button", { name: "确认结果并安全重试" }));

    expect(await screen.findByText("公开内容已经停止")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/stop"))).toHaveLength(1);
  });

  it("reuses the exact request when reconciliation proves the first write was not applied", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(sessionResponseObject())
      .mockResolvedValueOnce(emergencyStatusResponse(enabledStatus))
      .mockRejectedValueOnce(new TypeError("connection lost before write"))
      .mockResolvedValueOnce(emergencyStatusResponse(enabledStatus))
      .mockResolvedValueOnce(emergencyStatusResponse(stoppedStatus));
    render(
      <AdminSessionProvider>
        <EmergencyControlPanel />
      </AdminSessionProvider>,
    );
    await screen.findByText("公开内容正常开放");
    fireEvent.change(screen.getByLabelText("操作原因"), { target: { value: "发现未审核图片" } });
    fireEvent.change(screen.getByLabelText("确认短语"), {
      target: { value: "停止全部公开内容" },
    });
    fireEvent.change(screen.getByLabelText("当前验证器六位动态码"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "立即停止全部公开内容" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "确认结果并安全重试" }));

    expect(await screen.findByText("公开内容已经停止")).toBeInTheDocument();
    const stopCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/stop"));
    expect(stopCalls).toHaveLength(2);
    expect(stopCalls[1]?.[1]).toEqual(stopCalls[0]?.[1]);
    expect(getRandomValuesMock).toHaveBeenCalledTimes(1);
  });
});
