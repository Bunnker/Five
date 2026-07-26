const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const SHICHEN_BOUNDARY_HOURS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25] as const;
const SHANGHAI_TIME_PATTERN = /T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?\+08:00$/;

export interface RequestContextBoundaryDurations {
  millisecondsUntilNextCivilMidnight: number;
  millisecondsUntilNextShichen: number;
}

function millisecondsSinceCivilMidnight(responseGeneratedAt: string): number {
  const match = SHANGHAI_TIME_PATTERN.exec(responseGeneratedAt);

  if (match === null) {
    throw new RangeError(
      "requestContext.responseGeneratedAt must be an Asia/Shanghai time with +08:00 offset",
    );
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  const millisecond = Number((match[4] ?? "").padEnd(3, "0"));

  return (
    hour * MILLISECONDS_PER_HOUR +
    minute * MILLISECONDS_PER_MINUTE +
    second * MILLISECONDS_PER_SECOND +
    millisecond
  );
}

export function resolveRequestContextBoundaryDurations(
  responseGeneratedAt: string,
): RequestContextBoundaryDurations {
  const localMilliseconds = millisecondsSinceCivilMidnight(responseGeneratedAt);
  const nextShichenBoundaryHour = SHICHEN_BOUNDARY_HOURS.find(
    (hour) => hour * MILLISECONDS_PER_HOUR > localMilliseconds,
  );

  if (nextShichenBoundaryHour === undefined) {
    throw new Error("Unable to find the next shichen boundary");
  }

  return {
    millisecondsUntilNextCivilMidnight: MILLISECONDS_PER_DAY - localMilliseconds,
    millisecondsUntilNextShichen:
      nextShichenBoundaryHour * MILLISECONDS_PER_HOUR - localMilliseconds,
  };
}
