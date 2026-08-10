import { Controller, Get, Inject, Param, Res } from "@nestjs/common";

import type { DailyImageAssetService } from "../daily-images/daily-image-asset.service";
import { isOpaqueAdminId } from "./admin-content.validation";
import { DAILY_IMAGE_ASSET_SERVICE } from "./admin-http.providers";

interface BinaryReply {
  header(name: string, value: string): BinaryReply;
  send(payload?: unknown): void;
  status(code: number): BinaryReply;
  type(mediaType: string): BinaryReply;
}

@Controller("api/v1/image-assets")
export class PublicImageController {
  constructor(
    @Inject(DAILY_IMAGE_ASSET_SERVICE)
    private readonly images: DailyImageAssetService,
  ) {}

  @Get(":assetId")
  async read(@Param("assetId") assetId: string, @Res() reply: BinaryReply): Promise<void> {
    const binary = isOpaqueAdminId(assetId)
      ? await this.images.readPublicAssetBinary(assetId)
      : null;
    reply.header("X-Content-Type-Options", "nosniff");
    if (binary === null) {
      reply.header("Cache-Control", "no-store");
      reply.status(404).send();
      return;
    }
    reply.header("Cache-Control", "public, max-age=0, s-maxage=60, must-revalidate");
    reply.type(binary.mediaType).send(binary.bytes);
  }
}
