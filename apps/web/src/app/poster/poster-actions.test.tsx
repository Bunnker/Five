import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PosterActions } from "./poster-actions";

const props = {
  channelId: "wechat_group",
  copyText: "2026年7月15日 · 木日\n大吉：红色",
  fortuneDate: "2026-07-15",
  posterJobEndpoint: "/api/v1/poster-jobs" as const,
  posterTemplateVersion: "poster-template-v3",
  sourceContentVersion: "fd-20260715-r1",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-request-id": "request-poster-job",
    },
    status,
  });
}

function posterJob(
  status: "failed" | "processing" | "ready" | "version_changed",
  overrides: Record<string, unknown> = {},
) {
  return {
    assetUrl: null,
    channelId: props.channelId,
    currentActiveContentVersion: props.sourceContentVersion,
    entry: null,
    jobId: "poster-job-01",
    posterInstanceId: null,
    posterTemplateVersion: props.posterTemplateVersion,
    sourceContentVersion: props.sourceContentVersion,
    status,
    ...overrides,
  };
}

describe("PosterActions", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "018f47f2-b953-4ee1-91cc-018f47f2b953") });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses one idempotency key when the same intent is retried", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        jsonResponse(
          posterJob("ready", {
            assetUrl: "https://cdn.example.com/posters/poster-hash.svg",
            entry: {
              landingUrl:
                "https://five.example/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
              type: "web_qr",
            },
            posterInstanceId: "poster-instance-01",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PosterActions {...props} pollIntervalMs={1} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("海报暂时没有生成成功"),
    );
    fireEvent.click(screen.getByRole("button", { name: "重新尝试生成" }));

    expect(await screen.findByRole("img", { name: "2026-07-15 日签海报" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers);
    const secondHeaders = new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers);
    expect(firstHeaders.get("Idempotency-Key")).toBe("018f47f2-b953-4ee1-91cc-018f47f2b953");
    expect(secondHeaders.get("Idempotency-Key")).toBe(firstHeaders.get("Idempotency-Key"));
    expect(JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({
      channelId: props.channelId,
      expectedContentVersion: props.sourceContentVersion,
      fortuneDate: props.fortuneDate,
    });
  });

  it("uses a new idempotency key after the server confirms the previous job failed", async () => {
    const randomUUIDMock = vi
      .fn()
      .mockReturnValueOnce("018f47f2-b953-4ee1-91cc-018f47f2b953")
      .mockReturnValueOnce("018f47f2-b953-4ee1-91cc-018f47f2b954");
    vi.stubGlobal("crypto", { randomUUID: randomUUIDMock });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(posterJob("failed")))
      .mockResolvedValueOnce(
        jsonResponse(
          posterJob("ready", {
            assetUrl: "https://cdn.example.com/posters/poster-hash.svg",
            entry: {
              landingUrl:
                "https://five.example/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
              type: "web_qr",
            },
            posterInstanceId: "poster-instance-02",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PosterActions {...props} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("海报暂时没有生成成功"),
    );
    fireEvent.click(screen.getByRole("button", { name: "重新尝试生成" }));

    expect(await screen.findByRole("img", { name: "2026-07-15 日签海报" })).toBeVisible();
    const firstHeaders = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers);
    const secondHeaders = new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers);
    expect(firstHeaders.get("Idempotency-Key")).toBe("018f47f2-b953-4ee1-91cc-018f47f2b953");
    expect(secondHeaders.get("Idempotency-Key")).toBe("018f47f2-b953-4ee1-91cc-018f47f2b954");
  });

  it("polls a processing job and exposes a safe preview and download", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(posterJob("processing"), 202))
      .mockResolvedValueOnce(
        jsonResponse(
          posterJob("ready", {
            assetUrl: "https://cdn.example.com/posters/poster-hash.svg",
            entry: {
              landingUrl:
                "https://five.example/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
              type: "web_qr",
            },
            posterInstanceId: "poster-instance-01",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PosterActions {...props} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));

    expect(await screen.findByText("正在排版日签…")).toBeVisible();
    const preview = await screen.findByRole("img", { name: "2026-07-15 日签海报" });
    expect(preview).toHaveAttribute("src", "https://cdn.example.com/posters/poster-hash.svg");
    expect(screen.getByRole("button", { name: "下载海报" })).toBeEnabled();
    expect(screen.getByText(/海报已经准备好.*长按上方海报保存到手机/u)).toBeVisible();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/poster-jobs/poster-job-01");
  });

  it("downloads a cross-origin poster through a controlled credential-free blob", async () => {
    const NativeURL = URL;
    const createObjectURL = vi.fn(() => "blob:https://five.test/poster-download");
    const revokeObjectURL = vi.fn();
    class DownloadURL extends NativeURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal("URL", DownloadURL);
    const downloads: Array<{ download: string; href: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ download: this.download, href: this.href });
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          posterJob("ready", {
            assetUrl: "https://cdn.example.com/posters/poster-hash.svg",
            entry: {
              landingUrl:
                "https://five.example/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
              type: "web_qr",
            },
            posterInstanceId: "poster-instance-download",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response("<svg/>", {
          headers: { "content-length": "6", "content-type": "image/svg+xml" },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PosterActions {...props} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));
    fireEvent.click(await screen.findByRole("button", { name: "下载海报" }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(fetchMock.mock.calls[1]).toEqual([
      "https://cdn.example.com/posters/poster-hash.svg",
      { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" },
    ]);
    expect(downloads).toEqual([
      { download: "five-2026-07-15.svg", href: "blob:https://five.test/poster-download" },
    ]);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:https://five.test/poster-download");
    expect(screen.getByText("海报下载已开始。")).toBeVisible();
  });

  it("rejects a poster whose declared length exceeds the mobile download limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          posterJob("ready", {
            assetUrl: "https://cdn.example.com/posters/poster-too-large.png",
            entry: {
              landingUrl:
                "https://five.example/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
              type: "web_qr",
            },
            posterInstanceId: "poster-instance-declared-too-large",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          headers: {
            "content-length": String(10 * 1024 * 1024 + 1),
            "content-type": "image/png",
          },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PosterActions {...props} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));
    fireEvent.click(await screen.findByRole("button", { name: "下载海报" }));

    expect(await screen.findByText("自动下载未成功，请长按上方海报保存。")).toBeVisible();
    expect(screen.getByRole("img", { name: "2026-07-15 日签海报" })).toBeVisible();
  });

  it("cancels an undeclared-length poster stream as soon as it exceeds the limit", async () => {
    const cancel = vi.fn();
    const pendingPull = Promise.race<never>([]);
    let chunkIndex = 0;
    const oversizedBody = new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        if (chunkIndex < 11) {
          chunkIndex += 1;
          controller.enqueue(new Uint8Array(1024 * 1024));
          return;
        }
        return pendingPull;
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          posterJob("ready", {
            assetUrl: "https://cdn.example.com/posters/poster-stream-too-large.png",
            entry: {
              landingUrl:
                "https://five.example/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
              type: "web_qr",
            },
            posterInstanceId: "poster-instance-stream-too-large",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(oversizedBody, {
          headers: { "content-type": "image/png" },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PosterActions {...props} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));
    fireEvent.click(await screen.findByRole("button", { name: "下载海报" }));

    expect(await screen.findByText("自动下载未成功，请长按上方海报保存。")).toBeVisible();
    expect(cancel).toHaveBeenCalledOnce();
    expect(chunkIndex).toBe(11);
  });

  it("rejects a successful download response with a non-image media type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          posterJob("ready", {
            assetUrl: "https://cdn.example.com/posters/not-an-image.png",
            entry: {
              landingUrl:
                "https://five.example/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
              type: "web_qr",
            },
            posterInstanceId: "poster-instance-invalid-media",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response("<html>not an image</html>", {
          headers: { "content-type": "text/html" },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<PosterActions {...props} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));
    fireEvent.click(await screen.findByRole("button", { name: "下载海报" }));

    expect(await screen.findByText("自动下载未成功，请长按上方海报保存。")).toBeVisible();
    expect(screen.getByRole("img", { name: "2026-07-15 日签海报" })).toBeVisible();
  });

  it("keeps the preview and return path usable when automatic download is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          posterJob("ready", {
            assetUrl: "https://cdn.example.com/posters/poster-hash.svg",
            entry: {
              landingUrl:
                "https://five.example/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
              type: "web_qr",
            },
            posterInstanceId: "poster-instance-download-fallback",
          }),
        ),
      )
      .mockRejectedValueOnce(new TypeError("CDN does not allow cross-origin fetch"));
    vi.stubGlobal("fetch", fetchMock);

    render(<PosterActions {...props} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));
    fireEvent.click(await screen.findByRole("button", { name: "下载海报" }));

    expect(await screen.findByText("自动下载未成功，请长按上方海报保存。")).toBeVisible();
    expect(screen.getByRole("img", { name: "2026-07-15 日签海报" })).toBeVisible();
    expect(screen.getByRole("link", { name: "返回当日内容" })).toBeVisible();
  });

  it("keeps polling beyond the old 24-second window so the default worker cycle can finish", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(posterJob("processing"), 202));
    for (let attempt = 0; attempt < 24; attempt += 1) {
      fetchMock.mockResolvedValueOnce(jsonResponse(posterJob("processing")));
    }
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        posterJob("ready", {
          assetUrl: "https://cdn.example.com/posters/poster-after-worker-cycle.svg",
          entry: {
            landingUrl:
              "https://five.example/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
            type: "web_qr",
          },
          posterInstanceId: "poster-instance-after-worker-cycle",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<PosterActions {...props} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));

    expect(await screen.findByRole("img", { name: "2026-07-15 日签海报" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/posters/poster-after-worker-cycle.svg",
    );
    expect(fetchMock).toHaveBeenCalledTimes(26);
  });

  it("does not misreport a still-processing job as failed when the polling window ends", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(posterJob("processing"), 202));
    fetchMock.mockResolvedValueOnce(jsonResponse(posterJob("processing"), 202));
    for (let attempt = 0; attempt < 50; attempt += 1) {
      fetchMock.mockResolvedValueOnce(jsonResponse(posterJob("processing")));
    }
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        posterJob("ready", {
          assetUrl: "https://cdn.example.com/posters/poster-after-delay.svg",
          entry: {
            landingUrl:
              "https://five.example/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
            type: "web_qr",
          },
          posterInstanceId: "poster-instance-after-delay",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<PosterActions {...props} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("海报仍在生成"));
    expect(screen.queryByText("海报暂时没有生成成功")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续查询生成进度" }));
    expect(await screen.findByRole("img", { name: "2026-07-15 日签海报" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/posters/poster-after-delay.svg",
    );
  });

  it("shows a version-changed state when creation returns the frozen 409 error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "CONTENT_VERSION_CHANGED",
              details: {
                currentContentVersion: "fd-20260715-r2",
                expectedContentVersion: props.sourceContentVersion,
              },
              message: "页面内容版本已经变化，请刷新后重试。",
              requestId: "request-poster-job",
              retryable: true,
            },
          },
          409,
        ),
      ),
    );

    render(<PosterActions {...props} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("当天内容已经更新"));
    expect(screen.queryByRole("button", { name: "重新尝试生成" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回当日内容" })).toBeVisible();
  });

  it("rejects an unsafe ready payload and keeps text, link and return fallbacks usable", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: writeTextMock } });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          posterJob("ready", {
            assetUrl: "javascript:alert(1)",
            entry: {
              landingUrl:
                "https://five.example/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1&birthDate=1990-01-01",
              type: "web_qr",
            },
            posterInstanceId: "poster-instance-01",
          }),
        ),
      ),
    );

    render(<PosterActions {...props} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("海报暂时没有生成成功"),
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制今日文字" }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(props.copyText));
    fireEvent.click(screen.getByRole("button", { name: "复制当日链接" }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(2));
    const copiedUrl = new URL(writeTextMock.mock.calls[1]?.[0] as string);
    expect(Object.fromEntries(copiedUrl.searchParams)).toEqual({
      channelId: props.channelId,
      expectedContentVersion: props.sourceContentVersion,
    });
    expect(screen.getByRole("link", { name: "返回当日内容" })).toHaveAttribute(
      "href",
      "/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
    );
  });

  it("stops on version_changed without replacing the requested source version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          posterJob("version_changed", {
            currentActiveContentVersion: "fd-20260715-r2",
          }),
        ),
      ),
    );

    render(<PosterActions {...props} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "生成日签海报" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("当天内容已经更新"));
    expect(screen.getByRole("link", { name: "返回当日内容" })).toBeVisible();
  });
});
