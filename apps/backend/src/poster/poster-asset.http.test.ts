import "reflect-metadata";

import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PosterAssetController } from "./poster-asset.controller";
import { LocalPosterAssetStore, POSTER_ASSET_STORE } from "./poster-asset.store";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SVG_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><text>日签</text></svg>',
  "utf8",
);

describe("local poster asset HTTP adapter", () => {
  let app: NestFastifyApplication;
  let assetDirectory: string;
  let store: LocalPosterAssetStore;

  beforeAll(async () => {
    assetDirectory = await mkdtemp(join(tmpdir(), "five-poster-assets-"));
    store = new LocalPosterAssetStore(assetDirectory);

    @Module({
      controllers: [PosterAssetController],
      providers: [{ provide: POSTER_ASSET_STORE, useValue: store }],
    })
    class PosterAssetHttpTestModule {}

    app = await NestFactory.create<NestFastifyApplication>(
      PosterAssetHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await rm(assetDirectory, { force: true, recursive: true });
  });

  it("serves a controlled generated PNG for inline preview and download", async () => {
    await store.put("poster-job-01.png", PNG_BYTES);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/poster-assets/poster-job-01.png",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["content-disposition"]).toBe('inline; filename="poster-job-01.png"');
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(response.rawPayload).toEqual(PNG_BYTES);
    await expect(store.listKeys()).resolves.toEqual(["poster-job-01.png"]);
    await store.delete("poster-job-01.png");
    await expect(store.listKeys()).resolves.toEqual([]);
  });

  it("continues to serve a controlled legacy SVG with its original media type", async () => {
    await store.put("poster-job-legacy.svg", SVG_BYTES);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/poster-assets/poster-job-legacy.svg",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers["content-disposition"]).toBe(
      'inline; filename="poster-job-legacy.svg"',
    );
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(response.rawPayload).toEqual(SVG_BYTES);
    await store.delete("poster-job-legacy.svg");
  });

  it.each(["arbitrary.png", "arbitrary.svg", "poster-job-01.webp"])(
    "rejects an uncontrolled poster asset key %s even when it exists",
    async (assetKey) => {
      await store.put(assetKey, PNG_BYTES);
      try {
        const response = await app.inject({
          method: "GET",
          url: `/api/v1/poster-assets/${assetKey}`,
        });

        expect(response.statusCode).toBe(404);
      } finally {
        await store.delete(assetKey);
      }
    },
  );

  it("rejects an encoded traversal attempt instead of reading another asset", async () => {
    await store.put("poster-secret.png", PNG_BYTES);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/poster-assets/poster-%2e%2e%2fposter-secret.png",
      });

      expect(response.statusCode).toBe(404);
      expect(response.rawPayload).not.toEqual(PNG_BYTES);
    } finally {
      await store.delete("poster-secret.png");
    }
  });

  it("removes stale interrupted-write files without touching a current write", async () => {
    const staleTemporary = ".poster-stale.png.00000000-0000-4000-8000-000000000001.tmp";
    const currentTemporary = ".poster-current.png.00000000-0000-4000-8000-000000000002.tmp";
    await writeFile(join(assetDirectory, staleTemporary), "stale");
    await writeFile(join(assetDirectory, currentTemporary), "current");
    const staleTime = new Date(Date.now() - 600_000);
    await utimes(join(assetDirectory, staleTemporary), staleTime, staleTime);

    await expect(store.listKeys()).resolves.toEqual([]);

    expect(await readdir(assetDirectory)).toEqual([currentTemporary]);
    await rm(join(assetDirectory, currentTemporary));
  });
});
