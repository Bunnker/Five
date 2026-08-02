import { createHash } from "node:crypto";

import sharp from "sharp";

export type SupportedImageMediaType = "image/avif" | "image/jpeg" | "image/png" | "image/webp";

export type ImageFileErrorCode =
  "invalid" | "media_type_mismatch" | "too_large" | "unsupported_media_type";

export class ImageFileError extends Error {
  constructor(readonly code: ImageFileErrorCode) {
    super(code);
    this.name = "ImageFileError";
  }
}

export interface InspectedImageFile {
  readonly extension: "avif" | "jpg" | "png" | "webp";
  readonly height: number;
  readonly mediaType: SupportedImageMediaType;
  readonly sha256: string;
  readonly width: number;
}

const MEDIA = {
  heif: { extension: "avif", mediaType: "image/avif" },
  jpeg: { extension: "jpg", mediaType: "image/jpeg" },
  png: { extension: "png", mediaType: "image/png" },
  webp: { extension: "webp", mediaType: "image/webp" },
} as const;

function declaredMediaType(value: string): SupportedImageMediaType | null {
  switch (value.toLowerCase().split(";", 1)[0]?.trim()) {
    case "image/avif":
      return "image/avif";
    case "image/jpeg":
      return "image/jpeg";
    case "image/png":
      return "image/png";
    case "image/webp":
      return "image/webp";
    default:
      return null;
  }
}

export async function inspectImageFile(input: {
  readonly bytes: Buffer;
  readonly declaredMediaType: string;
  readonly maximumBytes: number;
}): Promise<InspectedImageFile> {
  if (input.bytes.length === 0) throw new ImageFileError("invalid");
  if (input.bytes.length > input.maximumBytes) throw new ImageFileError("too_large");
  const declared = declaredMediaType(input.declaredMediaType);
  if (declared === null) throw new ImageFileError("unsupported_media_type");

  try {
    const image = sharp(input.bytes, {
      failOn: "error",
      limitInputPixels: 50_000_000,
    }).autoOrient();
    const metadata = await image.metadata();
    if (metadata.format === "heif" && metadata.compression !== "av1") {
      throw new ImageFileError("unsupported_media_type");
    }
    const media =
      metadata.format === "heif"
        ? MEDIA.heif
        : metadata.format === "jpeg"
          ? MEDIA.jpeg
          : metadata.format === "png"
            ? MEDIA.png
            : metadata.format === "webp"
              ? MEDIA.webp
              : undefined;
    if (media === undefined || metadata.width === undefined || metadata.height === undefined) {
      throw new ImageFileError("unsupported_media_type");
    }
    if ((metadata.pages ?? 1) !== 1) throw new ImageFileError("invalid");
    if (media.mediaType !== declared) throw new ImageFileError("media_type_mismatch");
    // Metadata can be read from a valid header even when the pixel payload is truncated.
    // Decode every pixel under the same 50 MP limit before accepting the original bytes.
    await image.clone().raw().toBuffer();
    const oriented = metadata.autoOrient;
    return {
      extension: media.extension,
      height: oriented?.height ?? metadata.height,
      mediaType: media.mediaType,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      width: oriented?.width ?? metadata.width,
    };
  } catch (error) {
    if (error instanceof ImageFileError) throw error;
    throw new ImageFileError("invalid");
  }
}
