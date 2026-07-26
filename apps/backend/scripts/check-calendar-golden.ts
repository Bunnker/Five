import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { verifyCalendarGoldenData } from "./calendar-golden-support";
import { GOLDEN_CHECKSUM_PATH, GOLDEN_DATA_PATH } from "./generate-calendar-golden";

const PROCESS_TIMEZONES = ["UTC", "America/Los_Angeles", "Asia/Shanghai"] as const;

function buildInTimezone(timezone: (typeof PROCESS_TIMEZONES)[number]): string {
  return execFileSync(
    process.execPath,
    [
      "-r",
      "ts-node/register/transpile-only",
      resolve(__dirname, "generate-calendar-golden.ts"),
      "--stdout",
    ],
    {
      cwd: resolve(__dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, TZ: timezone },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

const serialized = readFileSync(GOLDEN_DATA_PATH, "utf8");
const recordedChecksum = readFileSync(GOLDEN_CHECKSUM_PATH, "utf8").trim();
const actualChecksum = createHash("sha256").update(serialized, "utf8").digest("hex");

assert.equal(
  recordedChecksum,
  `${actualChecksum}  ${basename(GOLDEN_DATA_PATH)}`,
  "The fixed answer file checksum does not match",
);

for (const timezone of PROCESS_TIMEZONES) {
  assert.equal(
    buildInTimezone(timezone),
    serialized,
    `Fixed answers changed when the process timezone was ${timezone}`,
  );
}

const summary = verifyCalendarGoldenData(JSON.parse(serialized) as unknown);
process.stdout.write(
  `Calendar answers passed: ${summary.checkedDays} dates, ${summary.checkedBoundaries} boundaries, ${summary.checkedReferences} references, ${summary.lunarCrossChecks} independent checks.\n`,
);
