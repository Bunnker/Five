import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TodayShareAction } from "./today-share-action";

const analyticsMocks = vi.hoisted(() => ({
  generateAnalyticsReferralId: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock("../lib/analytics", () => analyticsMocks);

const props = {
  channelId: "organic",
  contentVersion: "fd-20260715-r1",
  fortuneDate: "2026-07-15",
  shareOptionsHref:
    "/share?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&channelId=organic",
};

describe("TodayShareAction", () => {
  beforeEach(() => {
    analyticsMocks.generateAnalyticsReferralId.mockReturnValue(
      "referral:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("directly shares the immutable complete daily page when Web Share is available", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      share: shareMock,
      userAgent: "Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1",
    });

    render(<TodayShareAction {...props} />);
    const action = screen.getByRole("link", { name: "分享今天" });
    expect(action).toHaveAttribute("href", props.shareOptionsHref);
    fireEvent.click(action);

    await waitFor(() => expect(shareMock).toHaveBeenCalledOnce());
    const shareData = shareMock.mock.calls[0]?.[0] as ShareData;
    const sharedUrl = new URL(shareData.url ?? "");
    expect(sharedUrl.pathname).toBe("/daily/2026-07-15");
    expect(Object.fromEntries(sharedUrl.searchParams)).toEqual({
      channelId: "user_share",
      expectedContentVersion: "fd-20260715-r1",
      referralId: "referral:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(shareData.title).toBe("Five · 2026-07-15 五行穿衣");
    expect(analyticsMocks.trackAnalyticsEvent).toHaveBeenCalledWith({
      channelId: "user_share",
      contentVersion: "fd-20260715-r1",
      eventName: "share_summary_initiated",
      fortuneDate: "2026-07-15",
      referralId: "referral:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(analyticsMocks.trackAnalyticsEvent.mock.invocationCallOrder[0]).toBeLessThan(
      shareMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("keeps the complete user page open and explains the native WeChat menu", async () => {
    const shareMock = vi.fn();
    vi.stubGlobal("navigator", {
      share: shareMock,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) MicroMessenger/8.0.60",
    });

    render(<TodayShareAction {...props} />);
    const navigationAllowed = fireEvent.click(screen.getByRole("link", { name: "分享今天" }));

    expect(navigationAllowed).toBe(false);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "点击微信右上角 ···，选择发送给朋友或分享到朋友圈",
    );
    expect(shareMock).not.toHaveBeenCalled();
    expect(analyticsMocks.trackAnalyticsEvent).toHaveBeenCalledWith({
      channelId: "user_share",
      contentVersion: "fd-20260715-r1",
      eventName: "share_summary_initiated",
      fortuneDate: "2026-07-15",
      referralId: "referral:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(window.location.pathname).toBe("/daily/2026-07-15");
    expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({
      channelId: "user_share",
      expectedContentVersion: "fd-20260715-r1",
      referralId: "referral:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });

  it("retains the share-options link when the browser has no Web Share API", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/142" });

    render(<TodayShareAction {...props} />);
    const action = screen.getByRole("link", { name: "分享今天" });

    expect(action).toHaveAttribute("href", props.shareOptionsHref);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
