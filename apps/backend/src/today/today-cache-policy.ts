import { resolveRequestContextBoundaryDurations } from "../request-context/request-context-boundaries";
import type { PublicContentContext } from "../public-content/public-content-context-resolver";
import type { RequestContext } from "../request-context/request-context-resolver";
import { parseZonedDateTime } from "../request-context/zoned-date-time";

export interface TodayCacheDecision {
  cacheControl: string;
  sharedMaxAgeSeconds: number;
}

const MAX_SHARED_CACHE_MILLISECONDS = 60_000;
const MILLISECONDS_PER_SECOND = 1_000;

function requireZonedInstant(value: string, label: string): number {
  const instant = parseZonedDateTime(value);

  if (instant === null) {
    throw new RangeError(`${label} must be a valid ISO 8601 instant`);
  }

  return instant;
}

export class TodayCachePolicy {
  calculate(
    requestContext: RequestContext,
    effectiveTo: string,
    publicContentContext?: PublicContentContext,
  ): TodayCacheDecision {
    const responseInstant = requireZonedInstant(
      requestContext.responseGeneratedAt,
      "requestContext.responseGeneratedAt",
    );
    const effectiveToInstant = requireZonedInstant(effectiveTo, "content.effectiveTo");
    const nextPublicSwitchInstant =
      publicContentContext === undefined
        ? Number.POSITIVE_INFINITY
        : requireZonedInstant(
            `${publicContentContext.servedFortuneDate}T18:00:00+08:00`,
            "publicContentContext next switch",
          );
    const boundaries = resolveRequestContextBoundaryDurations(requestContext.responseGeneratedAt);
    const remainingMilliseconds = Math.min(
      MAX_SHARED_CACHE_MILLISECONDS,
      effectiveToInstant - responseInstant,
      nextPublicSwitchInstant - responseInstant,
      boundaries.millisecondsUntilNextShichen,
      boundaries.millisecondsUntilNextCivilMidnight,
    );
    const sharedMaxAgeSeconds = Math.max(
      0,
      Math.floor(remainingMilliseconds / MILLISECONDS_PER_SECOND),
    );

    return {
      cacheControl: `public, max-age=0, s-maxage=${sharedMaxAgeSeconds}, must-revalidate`,
      sharedMaxAgeSeconds,
    };
  }
}
