import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const POSTER_ASSET_STORE = Symbol("POSTER_ASSET_STORE");

const SAFE_ASSET_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/u;
const INTERRUPTED_WRITE_FILE =
  /^\.[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}\.[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.tmp$/u;
const STALE_INTERRUPTED_WRITE_MILLISECONDS = 300_000;

export interface PosterAssetStore {
  delete(assetKey: string): Promise<void>;
  listKeys(): Promise<string[]>;
  put(assetKey: string, body: Buffer): Promise<void>;
  read(assetKey: string): Promise<Buffer | null>;
}

function assertSafeAssetKey(assetKey: string): void {
  if (!SAFE_ASSET_KEY.test(assetKey) || assetKey.includes("..")) {
    throw new RangeError("Invalid poster asset key");
  }
}

export class LocalPosterAssetStore implements PosterAssetStore {
  constructor(private readonly directory: string) {}

  async put(assetKey: string, body: Buffer): Promise<void> {
    assertSafeAssetKey(assetKey);
    await mkdir(this.directory, { recursive: true });
    const destination = join(this.directory, assetKey);
    const temporary = join(this.directory, `.${assetKey}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, body, { flag: "wx" });
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async listKeys(): Promise<string[]> {
    try {
      const entries = await readdir(this.directory, { withFileTypes: true });
      const staleBefore = Date.now() - STALE_INTERRUPTED_WRITE_MILLISECONDS;
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && INTERRUPTED_WRITE_FILE.test(entry.name))
          .map(async (entry) => {
            const path = join(this.directory, entry.name);
            try {
              const metadata = await stat(path);
              if (metadata.mtimeMs < staleBefore) {
                await rm(path, { force: true });
              }
            } catch (error) {
              if (
                typeof error !== "object" ||
                error === null ||
                !("code" in error) ||
                error.code !== "ENOENT"
              ) {
                throw error;
              }
            }
          }),
      );
      return entries
        .filter((entry) => entry.isFile() && SAFE_ASSET_KEY.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
  }

  async read(assetKey: string): Promise<Buffer | null> {
    assertSafeAssetKey(assetKey);
    try {
      return await readFile(join(this.directory, assetKey));
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  async delete(assetKey: string): Promise<void> {
    assertSafeAssetKey(assetKey);
    await rm(join(this.directory, assetKey), { force: true });
  }
}
