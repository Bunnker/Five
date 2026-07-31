import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FeedbackForm } from "./feedback-form";

const context = {
  channelId: "organic",
  contentVersion: "fd-20260715-r1",
  fortuneDate: "2026-07-15",
} as const;

describe("FeedbackForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("submits exactly the frozen anonymous feedback contract", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ feedbackId: "feedback-01", status: "received" }), {
        headers: { "content-type": "application/json" },
        status: 202,
      }),
    );
    render(<FeedbackForm context={context} initialCategory="content_error" />);

    fireEvent.click(screen.getByRole("radio", { name: "产品建议" }));
    fireEvent.change(screen.getByLabelText("反馈内容"), {
      target: { value: "希望说明文字更容易找到。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交匿名反馈" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/feedback-reports",
      expect.objectContaining({
        body: JSON.stringify({
          category: "product_feedback",
          channelId: "organic",
          contact: null,
          contentVersion: "fd-20260715-r1",
          fortuneDate: "2026-07-15",
          message: "希望说明文字更容易找到。",
        }),
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("已经收到");
    expect(screen.getByLabelText("反馈内容")).toHaveValue("");
  });

  it("requires a non-empty message and preserves the selected category", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<FeedbackForm context={context} initialCategory="content_error" />);

    expect(screen.getByRole("radio", { name: "内容或图片有误" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "产品建议" }));
    fireEvent.change(screen.getByLabelText("反馈内容"), { target: { value: "   " } });
    fireEvent.submit(screen.getByRole("form", { name: "匿名反馈" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请先写下反馈内容");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "产品建议" })).toBeChecked();
  });

  it("keeps the user copy and shows a useful retry state when rate limited", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    render(<FeedbackForm context={context} initialCategory="content_error" />);

    fireEvent.change(screen.getByLabelText("反馈内容"), {
      target: { value: "这张图片的主色不一致。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交匿名反馈" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请求较多");
    expect(screen.getByLabelText("反馈内容")).toHaveValue("这张图片的主色不一致。");
  });

  it("keeps public content usable when feedback intake is unavailable", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    render(<FeedbackForm context={context} initialCategory="content_error" />);

    fireEvent.change(screen.getByLabelText("反馈内容"), {
      target: { value: "反馈服务测试。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交匿名反馈" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "反馈暂时无法接收，今日公共内容仍可继续使用",
    );
    expect(screen.getByLabelText("反馈内容")).toHaveValue("反馈服务测试。");
  });

  it("does not treat a malformed success body as accepted", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: "received" }), {
        headers: { "content-type": "application/json" },
        status: 202,
      }),
    );
    render(<FeedbackForm context={context} initialCategory="content_error" />);

    fireEvent.change(screen.getByLabelText("反馈内容"), {
      target: { value: "文字说明需要修正。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交匿名反馈" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时没能提交");
    expect(screen.getByLabelText("反馈内容")).toHaveValue("文字说明需要修正。");
  });
});
