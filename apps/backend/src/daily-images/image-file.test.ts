import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectImageFile } from "./image-file";
import { LocalBinaryImageAssetStore } from "./local-binary-image-asset.store";

const FIXED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const FIXED_HEIC = Buffer.from(
  "AAAAGGZ0eXBoZWljAAAAAGhlaWNtaWYxAAAB7W1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAABEGlwcnAAAADuaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAMY2xsaQDLAEAAAAAUaXNwZQAAAAAAAAACAAAAAgAAAChjbGFwAAAAAQAAAAEAAAABAAAAAf/AAAAAgAAA/8AAAACAAAAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcmh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAJEIBAQNwAAADALAAAAMAAAMAHqAUIEHAoQQYh7kWVTcCAgYAgKIAAQAJRAHAYXLIRFNkAAAAGmlwbWEAAAAAAAAAAQABB4ECAwaHhIUAAAAsaWxvYwAAAABEAAACAAEAAAABAAAChwAAAEkAAgAAAAEAAAIVAAAAcgAAAAFtZGF0AAAAAAAAAMsAAAAGRXhpZgAATU0AKgAAAAgABAESAAMAAAABAAEAAAFCAAQAAAABAAAA1gFDAAQAAAABAAAAgodpAAQAAAABAAAAPgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAA1qADAAQAAAABAAAAggAAAAAAAABFKAGvo1kNKujP8XcGzu8v1WaAAeSjOf/z2L+79vRN/5d/eNd7fv/8PY//wOT86/QrtiodM7BY+xcffUVhKTVL24hZRAZU",
  "base64",
);

describe("image file boundary", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("derives checksum, real media type, and dimensions from the uploaded bytes", async () => {
    const inspected = await inspectImageFile({
      bytes: FIXED_PNG,
      declaredMediaType: "image/png",
      maximumBytes: 8 * 1024 * 1024,
    });

    expect(inspected).toEqual({
      extension: "png",
      height: 1,
      mediaType: "image/png",
      sha256: createHash("sha256").update(FIXED_PNG).digest("hex"),
      width: 1,
    });
  });

  it.each([
    [Buffer.from("not an image"), "image/png", "invalid"],
    [FIXED_PNG, "image/jpeg", "media_type_mismatch"],
    [FIXED_PNG, "image/gif", "unsupported_media_type"],
    [Buffer.concat([FIXED_PNG, Buffer.alloc(32)]), "image/png", "too_large"],
  ] as const)(
    "rejects invalid, spoofed, unsupported, and oversized input %#",
    async (bytes, mediaType, code) => {
      await expect(
        inspectImageFile({
          bytes,
          declaredMediaType: mediaType,
          maximumBytes: code === "too_large" ? FIXED_PNG.length : 8 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({ code });
    },
  );

  it("does not classify HEVC HEIC bytes as AVIF just because Sharp reports heif", async () => {
    await expect(
      inspectImageFile({
        bytes: FIXED_HEIC,
        declaredMediaType: "image/avif",
        maximumBytes: 8 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: "unsupported_media_type" });
  });

  it("rejects a truncated image even when its header is sufficient for metadata", async () => {
    const truncatedPng = FIXED_PNG.subarray(0, FIXED_PNG.length - 17);

    await expect(
      inspectImageFile({
        bytes: truncatedPng,
        declaredMediaType: "image/png",
        maximumBytes: 8 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("stores immutable bytes under a content-addressed key without replacing an existing file", async () => {
    const root = await mkdtemp(join(tmpdir(), "five-image-store-"));
    temporaryRoots.push(root);
    const store = new LocalBinaryImageAssetStore(root);
    const checksum = createHash("sha256").update(FIXED_PNG).digest("hex");

    const first = await store.put({ bytes: FIXED_PNG, extension: "png", sha256: checksum });
    const firstStat = await stat(join(root, first.storageKey));
    const second = await store.put({ bytes: FIXED_PNG, extension: "png", sha256: checksum });
    const secondStat = await stat(join(root, second.storageKey));

    expect(first).toEqual({ storageKey: `${checksum.slice(0, 2)}/${checksum}.png` });
    expect(second).toEqual(first);
    expect(secondStat.ino).toBe(firstStat.ino);
    await expect(store.read(first.storageKey)).resolves.toEqual(FIXED_PNG);
    await expect(readFile(join(root, first.storageKey))).resolves.toEqual(FIXED_PNG);
  });
});
