import { Controller, Get, Inject, Param, Res, StreamableFile } from "@nestjs/common";

import { POSTER_ASSET_STORE, type PosterAssetStore } from "./poster-asset.store";

interface PosterAssetHttpReply {
  header(name: string, value: string): unknown;
  status(code: number): unknown;
}

const CONTROLLED_POSTER_ASSET_KEY = /^poster-[A-Za-z0-9_-]{1,180}\.(?:png|svg)$/u;

function controlledPosterMediaType(assetKey: string): string | null {
  if (!CONTROLLED_POSTER_ASSET_KEY.test(assetKey)) {
    return null;
  }
  return assetKey.endsWith(".svg") ? "image/svg+xml; charset=utf-8" : "image/png";
}

@Controller("api/v1/poster-assets")
export class PosterAssetController {
  constructor(
    @Inject(POSTER_ASSET_STORE)
    private readonly store: PosterAssetStore,
  ) {}

  @Get(":assetKey")
  async get(
    @Param("assetKey") assetKey: string,
    @Res({ passthrough: true }) reply: PosterAssetHttpReply,
  ): Promise<StreamableFile | null> {
    const mediaType = controlledPosterMediaType(assetKey);
    if (mediaType === null) {
      reply.status(404);
      return null;
    }

    let body: Buffer | null;
    try {
      body = await this.store.read(assetKey);
    } catch {
      body = null;
    }
    if (body === null) {
      reply.status(404);
      return null;
    }

    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("Content-Disposition", `inline; filename="${assetKey}"`);
    reply.header("Content-Type", mediaType);
    reply.status(200);
    return new StreamableFile(body);
  }
}
