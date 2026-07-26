import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Solar } from "lunar-javascript";

import {
  CALENDAR_RULE_VERSION,
  CalendarRuleEngine,
  type CalendarDayAnswer,
} from "../src/calendar/calendar-rule-engine";
import {
  RequestContextResolver,
  type RequestContext,
} from "../src/request-context/request-context-resolver";

const GOLDEN_SCHEMA_VERSION = 1 as const;
const GENERATOR_VERSION = "1.0.0" as const;
const RANGE_FROM = "2026-01-01" as const;
const RANGE_TO = "2027-01-01" as const;
const RANGE_COUNT = 366 as const;

const GENERATOR_SOURCE_PATHS = [
  "scripts/calendar-golden-support.ts",
  "scripts/generate-calendar-golden.ts",
  "src/calendar/calendar-rule-engine.ts",
  "src/request-context/request-context-resolver.ts",
] as const;

const BOUNDARY_INPUTS = [
  { id: "before-23h", instant: "2026-07-23T14:59:00.000Z" },
  { id: "at-23h", instant: "2026-07-23T15:00:00.000Z" },
  { id: "last-minute-before-midnight", instant: "2026-07-23T15:59:00.000Z" },
  { id: "civil-midnight", instant: "2026-07-23T16:00:00.000Z" },
  { id: "zi-hour-last-minute", instant: "2026-07-23T16:59:00.000Z" },
  { id: "zi-hour-end", instant: "2026-07-23T17:00:00.000Z" },
  { id: "month-end", instant: "2026-07-31T15:00:00.000Z" },
  { id: "year-end", instant: "2026-12-31T15:00:00.000Z" },
  { id: "leap-day-start", instant: "2024-02-28T15:00:00.000Z" },
  { id: "leap-day-end", instant: "2024-02-29T15:00:00.000Z" },
] as const;

const REFERENCE_INPUTS = [
  { fortuneDate: "1949-10-01", id: "standard-anchor" },
  { fortuneDate: "1949-09-30", id: "pre-anchor" },
  { fortuneDate: "1949-11-30", id: "anchor-plus-60-days" },
] as const;

export interface CalendarGoldenBoundary {
  calendar: CalendarDayAnswer;
  id: (typeof BOUNDARY_INPUTS)[number]["id"];
  instant: string;
  requestContext: RequestContext;
}

export interface CalendarGoldenReference {
  calendar: CalendarDayAnswer;
  fortuneDate: string;
  id: (typeof REFERENCE_INPUTS)[number]["id"];
}

export interface CalendarGoldenData {
  boundaries: CalendarGoldenBoundary[];
  boundariesSha256: string;
  calendarRuleVersion: typeof CALENDAR_RULE_VERSION;
  entries: CalendarDayAnswer[];
  entriesSha256: string;
  generator: {
    name: "calendar-golden-support";
    sourceFiles: readonly string[];
    sourceSha256: string;
    version: typeof GENERATOR_VERSION;
  };
  range: {
    count: typeof RANGE_COUNT;
    from: typeof RANGE_FROM;
    to: typeof RANGE_TO;
  };
  referenceCases: CalendarGoldenReference[];
  referenceCasesSha256: string;
  schemaVersion: typeof GOLDEN_SCHEMA_VERSION;
  sources: {
    crossCheck: {
      declaredRuntimeDependencies: 0;
      license: "MIT";
      package: "lunar-javascript";
      repositoryCommit: "4c45a59";
      version: "1.7.7";
    };
    officialCalendar: {
      sha256: string;
      url: string;
    };
    standard: {
      anchor: "1949-10-01=甲子";
      id: "GB/T 33661-2017";
      url: string;
    };
    timezone: {
      id: "Asia/Shanghai";
      referenceTzdbVersion: "2026c";
      runtimeIcuVersion: string;
      runtimeNodeVersion: string;
      runtimeTzdbVersion: string;
      url: string;
    };
  };
}

export interface CalendarGoldenVerification {
  checkedBoundaries: number;
  checkedDays: number;
  checkedReferences: number;
  lunarCrossChecks: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function parseDate(fortuneDate: string): [year: number, month: number, day: number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fortuneDate);

  if (match === null) {
    throw new RangeError(`Invalid golden date: ${fortuneDate}`);
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function addDays(fortuneDate: string, days: number): string {
  const [year, month, day] = parseDate(fortuneDate);
  const result = new Date(Date.UTC(year, month - 1, day + days));

  return [
    result.getUTCFullYear().toString().padStart(4, "0"),
    (result.getUTCMonth() + 1).toString().padStart(2, "0"),
    result.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function buildBoundary(
  input: (typeof BOUNDARY_INPUTS)[number],
  engine: CalendarRuleEngine,
): CalendarGoldenBoundary {
  const requestContext = new RequestContextResolver({
    now: () => new Date(input.instant),
  }).resolve();

  return {
    calendar: engine.evaluate(requestContext.fortuneDate),
    id: input.id,
    instant: input.instant,
    requestContext,
  };
}

function buildReference(
  input: (typeof REFERENCE_INPUTS)[number],
  engine: CalendarRuleEngine,
): CalendarGoldenReference {
  return {
    calendar: engine.evaluate(input.fortuneDate),
    fortuneDate: input.fortuneDate,
    id: input.id,
  };
}

function readLunarGanzhi(fortuneDate: string): string {
  const [year, month, day] = parseDate(fortuneDate);
  return Solar.fromYmd(year, month, day).getLunar().getDayInGanZhi();
}

function assertSameAnswer(actual: unknown, expected: unknown, context: string): void {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch (error) {
    throw new Error(`${context}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function readCrossCheckSource(): CalendarGoldenData["sources"]["crossCheck"] {
  const packageJson = JSON.parse(
    readFileSync(require.resolve("lunar-javascript/package.json"), "utf8"),
  ) as unknown;

  if (typeof packageJson !== "object" || packageJson === null) {
    throw new TypeError("lunar-javascript package metadata is not an object");
  }

  const metadata = packageJson as {
    dependencies?: unknown;
    license?: unknown;
    version?: unknown;
  };
  const runtimeDependencyCount =
    typeof metadata.dependencies === "object" && metadata.dependencies !== null
      ? Object.keys(metadata.dependencies).length
      : 0;

  assert.equal(metadata.version, "1.7.7", "Unexpected lunar-javascript version");
  assert.equal(metadata.license, "MIT", "Unexpected lunar-javascript license");
  assert.equal(
    runtimeDependencyCount,
    0,
    "lunar-javascript must not add declared runtime dependencies without a new review",
  );

  return {
    declaredRuntimeDependencies: 0,
    license: "MIT",
    package: "lunar-javascript",
    repositoryCommit: "4c45a59",
    version: "1.7.7",
  };
}

function buildSourceMetadata(): CalendarGoldenData["sources"] {
  return {
    crossCheck: readCrossCheckSource(),
    officialCalendar: {
      sha256: "19509e6b1a2798f9d9a024332a15d1b2734012a50b90e3b452d793bf0314e5d2",
      url: "https://pmo.cas.cn/xwdt2019/kpdt2019/202203/P020251230620718707826.pdf",
    },
    standard: {
      anchor: "1949-10-01=甲子",
      id: "GB/T 33661-2017",
      url: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=E107EA4DE9725EDF819F33C60A44B296",
    },
    timezone: {
      id: "Asia/Shanghai",
      referenceTzdbVersion: "2026c",
      runtimeIcuVersion: process.versions.icu ?? "unreported",
      runtimeNodeVersion: process.version,
      runtimeTzdbVersion: process.versions.tz ?? "unreported",
      url: "https://www.iana.org/time-zones",
    },
  };
}

function parseGoldenData(value: unknown): CalendarGoldenData {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Calendar golden data must be an object");
  }

  const candidate = value as Partial<CalendarGoldenData>;

  if (
    !Array.isArray(candidate.entries) ||
    !Array.isArray(candidate.boundaries) ||
    !Array.isArray(candidate.referenceCases)
  ) {
    throw new TypeError(
      "Calendar golden data must contain entries, boundaries and referenceCases arrays",
    );
  }

  if (
    candidate.generator === undefined ||
    candidate.range === undefined ||
    candidate.sources === undefined
  ) {
    throw new TypeError("Calendar golden data is missing traceability metadata");
  }

  return candidate as CalendarGoldenData;
}

export function calculateGeneratorSourceSha256(): string {
  const backendRoot = resolve(__dirname, "..");
  const source = GENERATOR_SOURCE_PATHS.map((relativePath) => {
    const content = readFileSync(resolve(backendRoot, relativePath), "utf8");
    return `${relativePath}\n${content}`;
  }).join("\n");

  return sha256(source);
}

export function buildCalendarGoldenData(): CalendarGoldenData {
  const engine = new CalendarRuleEngine();
  const entries = Array.from({ length: RANGE_COUNT }, (_, index) =>
    engine.evaluate(addDays(RANGE_FROM, index)),
  );
  const boundaries = BOUNDARY_INPUTS.map((input) => buildBoundary(input, engine));
  const referenceCases = REFERENCE_INPUTS.map((input) => buildReference(input, engine));

  return {
    boundaries,
    boundariesSha256: sha256Json(boundaries),
    calendarRuleVersion: CALENDAR_RULE_VERSION,
    entries,
    entriesSha256: sha256Json(entries),
    generator: {
      name: "calendar-golden-support",
      sourceFiles: GENERATOR_SOURCE_PATHS,
      sourceSha256: calculateGeneratorSourceSha256(),
      version: GENERATOR_VERSION,
    },
    range: {
      count: RANGE_COUNT,
      from: RANGE_FROM,
      to: RANGE_TO,
    },
    referenceCases,
    referenceCasesSha256: sha256Json(referenceCases),
    schemaVersion: GOLDEN_SCHEMA_VERSION,
    sources: buildSourceMetadata(),
  };
}

export function verifyCalendarGoldenData(value: unknown): CalendarGoldenVerification {
  const data = parseGoldenData(value);
  const engine = new CalendarRuleEngine();

  assert.equal(data.schemaVersion, GOLDEN_SCHEMA_VERSION, "Unexpected golden schema version");
  assert.equal(data.calendarRuleVersion, CALENDAR_RULE_VERSION, "Unexpected calendar rule version");
  assert.deepStrictEqual(data.range, {
    count: RANGE_COUNT,
    from: RANGE_FROM,
    to: RANGE_TO,
  });
  assert.equal(data.entries.length, RANGE_COUNT, "Golden answer count must be 366");
  assertSameAnswer(data.sources, buildSourceMetadata(), "Golden source metadata mismatch");
  assertSameAnswer(
    data.generator.sourceFiles,
    GENERATOR_SOURCE_PATHS,
    "Golden generator source-file list mismatch",
  );
  assert.equal(
    data.generator.sourceSha256,
    calculateGeneratorSourceSha256(),
    "Golden data was made by different generator sources; explicitly regenerate and review it",
  );

  for (let index = 0; index < RANGE_COUNT; index += 1) {
    const fortuneDate = addDays(RANGE_FROM, index);
    const stored = data.entries[index];

    if (stored === undefined) {
      throw new Error(`Missing golden answer for ${fortuneDate}`);
    }

    assertSameAnswer(
      stored,
      engine.evaluate(fortuneDate),
      `Golden answer mismatch for ${fortuneDate}`,
    );

    const lunarGanzhi = readLunarGanzhi(fortuneDate);
    assert.equal(
      stored.ganzhiDay,
      lunarGanzhi,
      `Independent lunar cross-check mismatch for ${fortuneDate}`,
    );

    if (index > 0) {
      const previous = data.entries[index - 1];

      if (previous === undefined) {
        throw new Error(`Missing previous golden answer before ${fortuneDate}`);
      }

      assert.equal(
        stored.ganzhiIndex,
        (previous.ganzhiIndex + 1) % 60,
        `Ganzhi cycle did not advance by one for ${fortuneDate}`,
      );
    }
  }

  assert.equal(
    sha256Json(data.entries),
    data.entriesSha256,
    "Golden answer checksum does not match",
  );

  assert.equal(
    data.boundaries.length,
    BOUNDARY_INPUTS.length,
    "Unexpected number of golden boundary answers",
  );

  BOUNDARY_INPUTS.forEach((input, index) => {
    const stored = data.boundaries[index];

    if (stored === undefined) {
      throw new Error(`Missing golden boundary ${input.id}`);
    }

    assertSameAnswer(
      stored,
      buildBoundary(input, engine),
      `Golden boundary mismatch for ${input.id}`,
    );
  });

  assert.equal(
    sha256Json(data.boundaries),
    data.boundariesSha256,
    "Golden boundary checksum does not match",
  );

  assert.equal(
    data.referenceCases.length,
    REFERENCE_INPUTS.length,
    "Unexpected number of golden reference answers",
  );

  REFERENCE_INPUTS.forEach((input, index) => {
    const stored = data.referenceCases[index];

    if (stored === undefined) {
      throw new Error(`Missing golden reference ${input.id}`);
    }

    assertSameAnswer(
      stored,
      buildReference(input, engine),
      `Golden reference mismatch for ${input.id}`,
    );
  });

  const anchor = data.referenceCases[0]?.calendar;
  const preAnchor = data.referenceCases[1]?.calendar;
  const plusSixty = data.referenceCases[2]?.calendar;
  assert.equal(anchor?.ganzhiDay, "甲子", "The national-standard anchor must be 甲子");
  assert.equal(anchor?.ganzhiIndex, 0, "The national-standard anchor index must be 0");
  assert.equal(preAnchor?.ganzhiIndex, 59, "The day before the anchor must use positive modulo");
  assert.equal(plusSixty?.ganzhiDay, anchor?.ganzhiDay, "The ganzhi day must repeat after 60 days");
  assert.equal(
    plusSixty?.ganzhiIndex,
    anchor?.ganzhiIndex,
    "The ganzhi index must repeat after 60 days",
  );
  assert.equal(
    sha256Json(data.referenceCases),
    data.referenceCasesSha256,
    "Golden reference checksum does not match",
  );

  return {
    checkedBoundaries: data.boundaries.length,
    checkedDays: data.entries.length,
    checkedReferences: data.referenceCases.length,
    lunarCrossChecks: data.entries.length,
  };
}
