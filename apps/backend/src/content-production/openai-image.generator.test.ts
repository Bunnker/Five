import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiImageGenerator } from "./openai-image.generator";

describe("OpenAI image generator adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests a vertical GPT Image 2 PNG and decodes the returned image bytes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ b64_json: Buffer.from("png-image").toString("base64") }] }),
          { headers: { "content-type": "application/json", "x-request-id": "image-request-1" } },
        ),
      );
    const generator = new OpenAiImageGenerator("five-test-key", fetcher);

    const result = await generator.generate({ prompt: "一套黑色与乳白色的通勤穿搭" });

    expect(result.bytes.toString()).toBe("png-image");
    expect(result).toMatchObject({
      declaredMediaType: "image/png",
      model: "gpt-image-2",
      reproductionReference: "image-request-1",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({
        body: JSON.stringify({
          model: "gpt-image-2",
          output_format: "png",
          prompt: "一套黑色与乳白色的通勤穿搭",
          quality: "medium",
          size: "1024x1536",
        }),
        method: "POST",
      }),
    );
  });

  it("aborts a timed-out provider request and returns a stable adapter error", async () => {
    vi.useFakeTimers();
    const observedSignal = { current: null as AbortSignal | null };
    const fetcher = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      observedSignal.current = init?.signal ?? null;
      if (observedSignal.current === null) {
        return Promise.reject(new Error("missing provider abort signal"));
      }
      return new Promise<Response>((_resolve, reject) => {
        observedSignal.current?.addEventListener(
          "abort",
          () => reject(observedSignal.current?.reason),
          { once: true },
        );
      });
    });
    const generator = new OpenAiImageGenerator("five-test-key", fetcher, undefined, 25);

    const generation = generator.generate({ prompt: "一套绿色与乳白色的通勤穿搭" });
    const timeoutExpectation = expect(generation).rejects.toMatchObject({
      code: "OPENAI_IMAGE_REQUEST_TIMEOUT",
      name: "OpenAiImageGenerationTimeoutError",
      timeoutMilliseconds: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    await timeoutExpectation;
    expect(observedSignal.current?.aborted).toBe(true);
  });
});
