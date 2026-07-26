import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { buildCalendarGoldenData, verifyCalendarGoldenData } from "./calendar-golden-support";

export const GOLDEN_DATA_PATH = resolve(
  __dirname,
  "..",
  "testdata",
  "calendar",
  "calendar-golden-fortune-date-23h-v1.json",
);
export const GOLDEN_CHECKSUM_PATH = `${GOLDEN_DATA_PATH}.sha256`;

function serializeGoldenData(): string {
  const data = buildCalendarGoldenData();
  verifyCalendarGoldenData(data);
  return `${JSON.stringify(data, null, 2)}\n`;
}

function writeNewGoldenData(serialized: string): void {
  if (existsSync(GOLDEN_DATA_PATH) || existsSync(GOLDEN_CHECKSUM_PATH)) {
    throw new Error(
      "The fixed answer file already exists. Do not overwrite it to make tests pass; create and review a new rule version instead.",
    );
  }

  mkdirSync(dirname(GOLDEN_DATA_PATH), { recursive: true });
  const checksum = createHash("sha256").update(serialized, "utf8").digest("hex");

  writeFileSync(GOLDEN_DATA_PATH, serialized, { encoding: "utf8", flag: "wx" });
  writeFileSync(GOLDEN_CHECKSUM_PATH, `${checksum}  ${basename(GOLDEN_DATA_PATH)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });

  process.stdout.write(`Created 366 fixed calendar answers and checksum at ${GOLDEN_DATA_PATH}\n`);
}

function main(): void {
  const mode = process.argv[2];
  const serialized = serializeGoldenData();

  if (mode === "--stdout") {
    process.stdout.write(serialized);
  } else if (mode === "--write") {
    writeNewGoldenData(serialized);
  } else {
    throw new Error(
      "Choose --stdout for a read-only preview or --write for the one-time explicit creation.",
    );
  }
}

if (require.main === module) {
  main();
}
