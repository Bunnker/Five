import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_ANONYMOUS_ID_KEY,
  ANALYTICS_OPT_OUT_KEY,
  clearAnalyticsAnonymousId,
  generateAnalyticsReferralId,
  setAnalyticsOptOut,
  trackAnalyticsEvent,
} from "./analytics";

const context = {
  channelId: "organic",
  contentVersion: "fd-20260715-r1",
  fortuneDate: "2026-07-15",
} as const;

describe("first-party anonymous analytics", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
        .mockReturnValueOnce("22222222-2222-4222-8222-222222222222")
        .mockReturnValueOnce("33333333-3333-4333-8333-333333333333"),
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reuses one random first-party browser id and sends only the contract fields", async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    trackAnalyticsEvent({ ...context, eventName: "view_today_summary" });
    trackAnalyticsEvent({ ...context, eventName: "open_outfit_hub" });

    expect(sendBeacon).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(await (sendBeacon.mock.calls[0]?.[1] as Blob).text());
    const secondBody = JSON.parse(await (sendBeacon.mock.calls[1]?.[1] as Blob).text());
    expect(firstBody).toEqual({
      anonymousId: "browser:11111111-1111-4111-8111-111111111111",
      channelId: "organic",
      contentVersion: "fd-20260715-r1",
      eventId: "event:22222222-2222-4222-8222-222222222222",
      eventName: "view_today_summary",
      fortuneDate: "2026-07-15",
      posterInstanceId: null,
      referralId: null,
      sourceContentVersion: null,
    });
    expect(secondBody.anonymousId).toBe(firstBody.anonymousId);
    expect(secondBody.eventId).toBe("event:33333333-3333-4333-8333-333333333333");
    const storedId = window.localStorage.getItem(ANALYTICS_ANONYMOUS_ID_KEY);
    expect(storedId).toBe("browser:11111111-1111-4111-8111-111111111111");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to a keepalive request when sendBeacon does not queue the event", async () => {
    const sendBeacon = vi.fn().mockReturnValue(false);
    vi.stubGlobal("navigator", { sendBeacon });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    trackAnalyticsEvent({
      ...context,
      eventName: "share_link_landing_view",
      referralId: "referral:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceContentVersion: "fd-20260715-r0",
    });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/analytics-events",
      expect.objectContaining({ keepalive: true, method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      anonymousId: "browser:11111111-1111-4111-8111-111111111111",
      channelId: "organic",
      contentVersion: "fd-20260715-r1",
      eventId: "event:22222222-2222-4222-8222-222222222222",
      eventName: "share_link_landing_view",
      fortuneDate: "2026-07-15",
      posterInstanceId: null,
      referralId: "referral:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceContentVersion: "fd-20260715-r0",
    });
  });

  it("replaces a malformed stored browser id before sending", async () => {
    window.localStorage.setItem(ANALYTICS_ANONYMOUS_ID_KEY, "corrupt");
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon });

    trackAnalyticsEvent({ ...context, eventName: "view_today_summary" });

    const body = JSON.parse(await (sendBeacon.mock.calls[0]?.[1] as Blob).text());
    expect(body.anonymousId).toBe("browser:11111111-1111-4111-8111-111111111111");
    expect(window.localStorage.getItem(ANALYTICS_ANONYMOUS_ID_KEY)).toBe(body.anonymousId);
  });

  it("drops an event whose fields do not match its event type", () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon });

    trackAnalyticsEvent({
      ...context,
      eventName: "share_summary_initiated",
      referralId: null,
    });

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("honors explicit opt-out, removes the old id, and preserves opt-out when clearing data", () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon });
    window.localStorage.setItem(ANALYTICS_ANONYMOUS_ID_KEY, "browser:existing-anonymous-id");

    setAnalyticsOptOut(true);
    trackAnalyticsEvent({ ...context, eventName: "view_today_summary" });
    clearAnalyticsAnonymousId();

    expect(window.localStorage.getItem(ANALYTICS_OPT_OUT_KEY)).toBe("true");
    expect(window.localStorage.getItem(ANALYTICS_ANONYMOUS_ID_KEY)).toBeNull();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("creates an independent high-entropy referral id without reading the browser id", () => {
    window.localStorage.setItem(ANALYTICS_ANONYMOUS_ID_KEY, "browser:existing-anonymous-id");

    expect(generateAnalyticsReferralId()).toBe("referral:11111111-1111-4111-8111-111111111111");
    expect(window.localStorage.getItem(ANALYTICS_ANONYMOUS_ID_KEY)).toBe(
      "browser:existing-anonymous-id",
    );
  });
});
