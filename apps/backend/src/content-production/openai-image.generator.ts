export interface GeneratedImage {
  readonly bytes: Buffer;
  readonly declaredMediaType: "image/png";
  readonly model: string;
  readonly reproductionReference: string;
}

export interface ImageGenerator {
  generate(input: { readonly prompt: string }): Promise<GeneratedImage>;
}

interface OpenAiImageResponse {
  readonly data?: ReadonlyArray<{ readonly b64_json?: unknown }>;
}

const DEFAULT_OPENAI_IMAGE_REQUEST_TIMEOUT_MS = 60_000;

export class OpenAiImageGenerationTimeoutError extends Error {
  readonly code = "OPENAI_IMAGE_REQUEST_TIMEOUT";

  constructor(
    readonly timeoutMilliseconds: number,
    options?: { readonly cause?: unknown },
  ) {
    super(`OpenAI image generation timed out after ${timeoutMilliseconds} ms`, options);
    this.name = "OpenAiImageGenerationTimeoutError";
  }
}

function parseImageResponse(value: unknown): string {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    throw new Error("OpenAI image response is missing data");
  }
  const data = (value as OpenAiImageResponse).data;
  const encoded = data?.[0]?.b64_json;
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error("OpenAI image response is missing b64_json");
  }
  return encoded;
}

export class OpenAiImageGenerator implements ImageGenerator {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly endpoint = "https://api.openai.com/v1/images/generations",
    private readonly requestTimeoutMilliseconds = DEFAULT_OPENAI_IMAGE_REQUEST_TIMEOUT_MS,
  ) {
    if (apiKey.trim() === "") throw new Error("Five image API key is empty");
    if (!Number.isSafeInteger(requestTimeoutMilliseconds) || requestTimeoutMilliseconds < 1) {
      throw new Error("OpenAI image request timeout must be a positive integer");
    }
  }

  async generate(input: { readonly prompt: string }): Promise<GeneratedImage> {
    const abortController = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutRejection = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        abortController.abort();
        reject(new OpenAiImageGenerationTimeoutError(this.requestTimeoutMilliseconds));
      }, this.requestTimeoutMilliseconds);
    });

    try {
      const providerRequest = (async () => {
        const response = await this.fetcher(this.endpoint, {
          body: JSON.stringify({
            model: "gpt-image-2",
            output_format: "png",
            prompt: input.prompt,
            quality: "medium",
            size: "1024x1536",
          }),
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`OpenAI image generation failed with HTTP ${response.status}`);
        }
        const encoded = parseImageResponse(await response.json());
        const requestId = response.headers.get("x-request-id");
        return {
          bytes: Buffer.from(encoded, "base64"),
          declaredMediaType: "image/png" as const,
          model: "gpt-image-2",
          reproductionReference: requestId ?? `openai-response-${Date.now()}`,
        };
      })();
      return await Promise.race([providerRequest, timeoutRejection]);
    } catch (error) {
      if (!timedOut || error instanceof OpenAiImageGenerationTimeoutError) throw error;
      throw new OpenAiImageGenerationTimeoutError(this.requestTimeoutMilliseconds, {
        cause: error,
      });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}

export function openAiImageGeneratorFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ImageGenerator | null {
  const apiKey = environment.FIVE_IMAGE_OPENAI_API_KEY;
  return apiKey === undefined || apiKey.trim() === "" ? null : new OpenAiImageGenerator(apiKey);
}
