import { afterEach, describe, expect, it, vi } from "vitest";

import { loadToday, type TodayDateData } from "./today";

const todayResponse = {
  content: {
    calendar: {
      dayElement: "water",
      dayElementLabel: "水",
      ganzhiDay: "己亥",
      lunarDateText: "六月十一",
      weekdayText: "星期五",
    },
    fortuneDate: "2026-07-24",
  },
  requestContext: {
    civilDate: "2026-07-23",
    crossedDayBoundary: true,
    fortuneDate: "2026-07-24",
    shichen: "子",
  },
} satisfies TodayDateData;

describe("loadToday", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("loads the server-owned date data and forwards the request id without another cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(todayResponse), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadToday({
        apiOrigin: "http://backend.test:3100",
        requestId: "web-request-123",
      }),
    ).resolves.toEqual(todayResponse);
    expect(fetchMock).toHaveBeenCalledWith("http://backend.test:3100/api/v1/today", {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-request-id": "web-request-123",
      },
      signal: expect.any(AbortSignal),
    });
  });

  it("does not invent a date when the backend has no published content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "CONTENT_NOT_READY",
            details: {},
            message: "今日内容正在校验中，请稍后重试。",
            requestId: "request-123",
            retryable: true,
          },
        }),
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadToday({ apiOrigin: "http://backend.test:3100" })).resolves.toBeNull();

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((requestInit.headers as Record<string, string>)["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it("rejects malformed 200 data instead of rendering a partial date card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...todayResponse,
            requestContext: {
              ...todayResponse.requestContext,
              crossedDayBoundary: "false",
            },
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(loadToday({ apiOrigin: "http://backend.test:3100" })).resolves.toBeNull();
  });

  it("stops waiting for an unresponsive backend", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      }),
    );

    const result = loadToday({
      apiOrigin: "http://backend.test:3100",
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toBeNull();
  });
});
