import type { StoredPublicCachePurgeIntent } from "./content-release.store";
import type { PublicCachePurger } from "./public-cache-purge.worker";
import type { StoredImageCachePurgeIntent } from "../daily-images/daily-image-asset.store";

export interface HttpPublicCachePurgerConfig {
  readonly endpoint: string | null;
  readonly token: string | null;
}

export type PublicCachePurgeFetch = (
  input: Request | string | URL,
  init?: RequestInit,
) => Promise<Response>;

const REQUEST_TIMEOUT_MILLISECONDS = 10_000;

function purgeRequestBody(
  intent: StoredImageCachePurgeIntent | StoredPublicCachePurgeIntent,
): Record<string, unknown> {
  const common = {
    fortuneDate: intent.fortuneDate,
    paths: ["/api/v1/today", `/api/v1/daily/${intent.fortuneDate}`],
    purgeIntentId: intent.purgeIntentId,
    requestId: intent.requestId,
  };
  if ("assetId" in intent) {
    return {
      action: "image_asset_withdrawn",
      assetId: intent.assetId,
      cacheTags: [
        "five:today",
        `five:fortune-date:${intent.fortuneDate}`,
        `five:content-version:${intent.contentVersion}`,
        `five:image-asset:${intent.assetId}`,
      ],
      contentVersion: intent.contentVersion,
      ...common,
    };
  }
  return {
    action: intent.action,
    activeContentVersion: {
      after: intent.afterActiveContentVersion,
      before: intent.beforeActiveContentVersion,
    },
    cacheTags: ["five:today", `five:fortune-date:${intent.fortuneDate}`],
    ...common,
  };
}

export class HttpPublicCachePurger implements PublicCachePurger {
  constructor(
    private readonly config: HttpPublicCachePurgerConfig,
    private readonly fetcher: PublicCachePurgeFetch = fetch,
  ) {}

  async purge(intent: StoredImageCachePurgeIntent | StoredPublicCachePurgeIntent): Promise<void> {
    if (this.config.endpoint === null || this.config.endpoint.trim() === "") {
      throw new Error("Public cache purge endpoint is not configured");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Idempotency-Key": intent.purgeIntentId,
      "X-Request-Id": intent.requestId,
    };
    if (this.config.token !== null && this.config.token !== "") {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    const response = await this.fetcher(this.config.endpoint, {
      body: JSON.stringify(purgeRequestBody(intent)),
      headers,
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
    });

    if (!response.ok) {
      throw new Error(`Public cache purge failed with status ${response.status}`);
    }
  }
}

export function publicCachePurgerFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): PublicCachePurger {
  return new HttpPublicCachePurger({
    endpoint: environment.FIVE_PUBLIC_CACHE_PURGE_ENDPOINT?.trim() || null,
    token: environment.FIVE_PUBLIC_CACHE_PURGE_TOKEN?.trim() || null,
  });
}
