import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TodayPageData } from "../../lib/today";
import HelpPage from "./page";

const { headersMock, loadTodayMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  loadTodayMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("../../components/public-content-boundary-guard", () => ({
  PublicContentBoundaryGuard: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../lib/today", () => ({ loadToday: loadTodayMock }));

const today = {
  content: { fortuneDate: "2026-07-15" },
  daJiCard: { contentVersion: "fd-20260715-r1" },
  publicContentContext: {
    advancedFromCivilDate: false,
    servedFortuneDate: "2026-07-15",
    switchBoundary: "18:00",
  },
  requestContext: { fortuneDate: "2026-07-15" },
} as TodayPageData;

describe("HelpPage", () => {
  beforeEach(() => {
    headersMock.mockReset();
    loadTodayMock.mockReset();
    headersMock.mockResolvedValue(new Headers({ "x-request-id": "request-help-page" }));
    loadTodayMock.mockResolvedValue(today);
  });

  it("keeps the public explanations available on a direct visit", async () => {
    render(await HelpPage({ searchParams: Promise.resolve({}) }));

    expect(loadTodayMock).toHaveBeenCalledWith({ requestId: "request-help-page" });
    expect(screen.getByRole("heading", { level: 1, name: "使用说明与反馈" })).toBeVisible();
    expect(screen.getByText("内容基于传统文化规则整理，仅供穿搭参考。")).toBeVisible();
    expect(screen.getByText(/不会对现实结果作承诺/u)).toBeVisible();

    const imageSection = screen.getByRole("region", { name: "AI 图片与素材" });
    expect(imageSection).toHaveTextContent("离线生成");
    expect(imageSection).toHaveTextContent("人工检查");
    expect(imageSection).toHaveTextContent("用户访问时不会触发生成");
    const imageFeedbackLink = within(imageSection).getByRole("link", { name: "反馈问题图片" });
    expect(imageFeedbackLink).toHaveAttribute(
      "href",
      expect.stringContaining("category=content_error"),
    );
    expect(imageFeedbackLink).toHaveAttribute("href", expect.stringContaining("#feedback"));

    const privacySection = screen.getByRole("region", { name: "数据与隐私" });
    expect(privacySection).toHaveTextContent("不接入第三方统计 SDK");
    expect(privacySection).toHaveTextContent("不创建跨设备标识");
    expect(privacySection).toHaveTextContent("最长保存 90 天");
    expect(privacySection).toHaveTextContent("可在下方随时退出");
    expect(privacySection).toHaveTextContent("通用逐请求访问日志目前关闭");
    expect(privacySection).toHaveTextContent("IP 地址和浏览器请求头");
    expect(privacySection).toHaveTextContent("进程随机密钥");
    expect(privacySection).toHaveTextContent("不保存原始网络地址");
    expect(privacySection).toHaveTextContent("一分钟窗口失效");
    expect(privacySection).toHaveTextContent("清理超过 24 小时的窗口");
    expect(privacySection).toHaveTextContent("不记录反馈全文或联系方式");
    expect(privacySection).toHaveTextContent("当前没有自动到期删除机制");
    expect(privacySection).toHaveTextContent("公开试用前必须确定保存上限和退出渠道");
    expect(privacySection).toHaveTextContent("不提交反馈");

    const feedback = screen.getByRole("form", { name: "匿名反馈" });
    expect(feedback).toHaveAttribute("data-fortune-date", "2026-07-15");
    expect(feedback).toHaveAttribute("data-content-version", "fd-20260715-r1");
    expect(feedback).toHaveAttribute("data-channel-id", "organic");
    expect(screen.getByRole("heading", { name: "使用约定" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "隐私说明" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /登录|账户|出生|个人运势|即将上线/u }),
    ).not.toBeInTheDocument();
  });

  it("uses the carried channel only when date and version still match the current snapshot", async () => {
    render(
      await HelpPage({
        searchParams: Promise.resolve({
          channelId: "wechat_group",
          expectedContentVersion: "fd-20260715-r1",
          fortuneDate: "2026-07-15",
        }),
      }),
    );

    expect(screen.getByRole("form", { name: "匿名反馈" })).toHaveAttribute(
      "data-channel-id",
      "wechat_group",
    );
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute(
      "href",
      "/?channelId=wechat_group",
    );
    expect(screen.getByText(/2026-07-15.*fd-20260715-r1/u)).toBeVisible();
  });

  it("keeps feedback bound to servedFortuneDate between the 18:00 and 23:00 boundaries", async () => {
    loadTodayMock.mockResolvedValue({
      ...today,
      content: { fortuneDate: "2026-07-16" },
      daJiCard: { contentVersion: "fd-20260716-r1" },
      publicContentContext: {
        advancedFromCivilDate: true,
        servedFortuneDate: "2026-07-16",
        switchBoundary: "18:00",
      },
      requestContext: { fortuneDate: "2026-07-15" },
    } as TodayPageData);

    render(await HelpPage({ searchParams: Promise.resolve({}) }));

    const feedback = screen.getByRole("form", { name: "匿名反馈" });
    expect(feedback).toHaveAttribute("data-fortune-date", "2026-07-16");
    expect(feedback).toHaveAttribute("data-content-version", "fd-20260716-r1");
  });

  it("preselects content correction from the problem-image entry", async () => {
    render(
      await HelpPage({
        searchParams: Promise.resolve({
          category: "content_error",
          channelId: "organic",
          expectedContentVersion: "fd-20260715-r1",
          fortuneDate: "2026-07-15",
        }),
      }),
    );

    expect(screen.getByRole("radio", { name: "内容或图片有误" })).toBeChecked();
  });

  it("does not silently rebind stale feedback context to the current snapshot", async () => {
    render(
      await HelpPage({
        searchParams: Promise.resolve({
          channelId: "wechat_group",
          expectedContentVersion: "fd-20260714-r9",
          fortuneDate: "2026-07-14",
        }),
      }),
    );

    expect(screen.queryByRole("form", { name: "匿名反馈" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("为避免把问题记到错误版本");
  });

  it("does not reflect a channel containing control characters", async () => {
    render(
      await HelpPage({
        searchParams: Promise.resolve({
          channelId: "wechat\nheader",
          expectedContentVersion: "fd-20260715-r1",
          fortuneDate: "2026-07-15",
        }),
      }),
    );

    expect(screen.queryByRole("form", { name: "匿名反馈" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("渠道信息与当前内容不一致");
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute("href", "/");
  });

  it("still explains the product when current version context is unavailable", async () => {
    loadTodayMock.mockResolvedValue(null);

    render(await HelpPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { level: 1, name: "使用说明与反馈" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("当前内容版本尚未加载完整");
    expect(screen.queryByRole("form", { name: "匿名反馈" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute("href", "/");
  });
});
