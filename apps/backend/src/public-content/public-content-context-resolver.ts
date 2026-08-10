import type { components } from "@five/api-contract";

import type { RequestContext } from "../request-context/request-context-resolver";
import { shiftFortuneDate } from "./public-content-date";

export type PublicContentContext = components["schemas"]["PublicContentContext"];

const PUBLIC_SWITCH_HOUR = 18;
const PUBLIC_SWITCH_BOUNDARY = "18:00" as const;
const TIMEZONE = "Asia/Shanghai";

const shanghaiFormatter = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
  calendar: "gregory",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  month: "2-digit",
  timeZone: TIMEZONE,
  year: "numeric",
});

function requirePart(parts: ReadonlyMap<string, string>, name: string): string {
  const value = parts.get(name);
  if (value === undefined) throw new Error(`Intl did not return the ${name} part`);
  return value;
}

function shanghaiCivilDateAndHour(instant: Date): { civilDate: string; hour: number } {
  const parts = new Map(
    shanghaiFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    civilDate: `${requirePart(parts, "year")}-${requirePart(parts, "month")}-${requirePart(parts, "day")}`,
    hour: Number(requirePart(parts, "hour")),
  };
}

export class PublicContentContextResolver {
  resolve(requestContext: RequestContext): PublicContentContext {
    const instant = new Date(requestContext.responseGeneratedAt);
    if (Number.isNaN(instant.getTime())) {
      throw new RangeError("requestContext.responseGeneratedAt must be a valid instant");
    }
    const local = shanghaiCivilDateAndHour(instant);
    if (local.civilDate !== requestContext.civilDate) {
      throw new RangeError(
        "requestContext.civilDate must match responseGeneratedAt in Asia/Shanghai",
      );
    }
    const advancedFromCivilDate = local.hour >= PUBLIC_SWITCH_HOUR;
    return {
      advancedFromCivilDate,
      servedFortuneDate: advancedFromCivilDate
        ? shiftFortuneDate(requestContext.civilDate, 1)
        : requestContext.civilDate,
      switchBoundary: PUBLIC_SWITCH_BOUNDARY,
    };
  }
}
