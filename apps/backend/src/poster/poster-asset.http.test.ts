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

  it("serves a generated SVG for inline preview and download", async () => {
    await store.put("poster-job-01.svg", Buffer.from("<svg>日签</svg>", "utf8"));

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/poster-assets/poster-job-01.svg",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/svg+xml");
    expect(response.headers["content-disposition"]).toBe('inline; filename="poster-job-01.svg"');
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(response.body).toBe("<svg>日签</svg>");
    await expect(store.listKeys()).resolves.toEqual(["poster-job-01.svg"]);
    await store.delete("poster-job-01.svg");
    await expect(store.listKeys()).resolves.toEqual([]);
  });

  it("removes stale interrupted-write files without touching a current write", async () => {
    const staleTemporary = ".poster-stale.svg.00000000-0000-4000-8000-000000000001.tmp";
    const currentTemporary = ".poster-current.svg.00000000-0000-4000-8000-000000000002.tmp";
    await writeFile(join(assetDirectory, staleTemporary), "stale");
    await writeFile(join(assetDirectory, currentTemporary), "current");
    const staleTime = new Date(Date.now() - 600_000);
    await utimes(join(assetDirectory, staleTemporary), staleTime, staleTime);

    await expect(store.listKeys()).resolves.toEqual([]);

    expect(await readdir(assetDirectory)).toEqual([currentTemporary]);
    await rm(join(assetDirectory, currentTemporary));
  });
});
