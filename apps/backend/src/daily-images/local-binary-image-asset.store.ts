import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rmdir, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface BinaryImageAssetStore {
  put(input: {
    readonly bytes: Buffer;
    readonly extension: "avif" | "jpg" | "png" | "webp";
    readonly sha256: string;
  }): Promise<{ readonly storageKey: string }>;
  read(storageKey: string): Promise<Buffer | null>;
}

const STORAGE_KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{64}\.(?:avif|jpg|png|webp)$/u;

export class LocalBinaryImageAssetStore implements BinaryImageAssetStore {
  constructor(private readonly root = resolve(process.cwd(), ".five-assets", "daily-images")) {}

  async put(input: {
    readonly bytes: Buffer;
    readonly extension: "avif" | "jpg" | "png" | "webp";
    readonly sha256: string;
  }): Promise<{ readonly storageKey: string }> {
    const actual = createHash("sha256").update(input.bytes).digest("hex");
    if (actual !== input.sha256 || !/^[0-9a-f]{64}$/u.test(input.sha256)) {
      throw new Error("Binary image checksum mismatch");
    }
    const storageKey = `${input.sha256.slice(0, 2)}/${input.sha256}.${input.extension}`;
    const target = join(this.root, storageKey);
    const directory = dirname(target);
    const lock = `${target}.lock`;
    await mkdir(directory, { recursive: true });
    await this.acquireLock(lock);
    const temporary = join(directory, `.${input.sha256}.${randomUUID()}.tmp`);
    try {
      if (await this.exists(target)) {
        const existing = await readFile(target);
        if (createHash("sha256").update(existing).digest("hex") !== input.sha256) {
          throw new Error("Content-addressed image path contains different bytes");
        }
        return { storageKey };
      }
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(input.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
      return { storageKey };
    } finally {
      await unlink(temporary).catch(() => undefined);
      await rmdir(lock).catch(() => undefined);
    }
  }

  async read(storageKey: string): Promise<Buffer | null> {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) return null;
    return readFile(join(this.root, storageKey)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
  }

  private async acquireLock(lock: string): Promise<void> {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      try {
        await mkdir(lock);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      }
    }
    throw new Error("Timed out acquiring image storage lock");
  }

  private async exists(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      },
    );
  }
}
