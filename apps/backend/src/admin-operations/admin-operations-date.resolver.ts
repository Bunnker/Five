import {
  RequestContextResolver,
  type RequestContext,
} from "../request-context/request-context-resolver";
import {
  PublicContentContextResolver,
  type PublicContentContext,
} from "../public-content/public-content-context-resolver";

const MILLISECONDS_PER_DAY = 86_400_000;
const FORTUNE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function fortuneDateInstant(fortuneDate: string): Date {
  if (!FORTUNE_DATE_PATTERN.test(fortuneDate)) {
    throw new RangeError(`fortuneDate must use YYYY-MM-DD: ${fortuneDate}`);
  }
  const instant = new Date(`${fortuneDate}T00:00:00.000Z`);
  if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== fortuneDate) {
    throw new RangeError(`fortuneDate is not a valid Gregorian date: ${fortuneDate}`);
  }
  return instant;
}

/**
 * Keeps operations read models on the same Asia/Shanghai request-context rules
 * without teaching the service or PostgreSQL adapter their own +08:00 logic.
 */
export class AdminOperationsDateResolver {
  constructor(
    private readonly currentRequestContextResolver: RequestContextResolver,
    private readonly publicContentContextResolver = new PublicContentContextResolver(),
  ) {}

  resolveCurrent(): RequestContext {
    return this.currentRequestContextResolver.resolve();
  }

  resolvePublicContentContext(requestContext: RequestContext): PublicContentContext {
    return this.publicContentContextResolver.resolve(requestContext);
  }

  resolveForFortuneDate(fortuneDate: string): RequestContext {
    fortuneDateInstant(fortuneDate);
    const context = this.resolveAt(new Date(`${fortuneDate}T04:00:00.000Z`));
    if (
      context.civilDate !== fortuneDate ||
      context.fortuneDate !== fortuneDate ||
      context.crossedDayBoundary
    ) {
      throw new Error(`Unable to build preview context for ${fortuneDate}`);
    }
    return context;
  }

  shiftFortuneDate(fortuneDate: string, days: number): string {
    if (!Number.isSafeInteger(days)) throw new RangeError(`days must be an integer: ${days}`);
    const shifted = new Date(
      fortuneDateInstant(fortuneDate).getTime() + days * MILLISECONDS_PER_DAY,
    );
    if (Number.isNaN(shifted.getTime())) throw new RangeError("Shifted fortuneDate is invalid");
    return shifted.toISOString().slice(0, 10);
  }

  weekdayIndex(fortuneDate: string): number {
    return fortuneDateInstant(fortuneDate).getUTCDay();
  }

  formatInstant(instant: Date): string {
    return this.resolveAt(instant).responseGeneratedAt;
  }

  formatShanghaiDate(instant: Date): string {
    return this.resolveAt(instant).civilDate;
  }

  private resolveAt(instant: Date): RequestContext {
    if (Number.isNaN(instant.getTime())) throw new RangeError("Instant is invalid");
    const milliseconds = instant.getTime();
    return new RequestContextResolver({ now: () => new Date(milliseconds) }).resolve();
  }
}
