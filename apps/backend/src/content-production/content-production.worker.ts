import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import type { RequestContext } from "../request-context/request-context-resolver";
import type { ContentProductionService } from "./content-production.service";

interface FortuneDateResolver {
  resolve(): RequestContext;
}

export interface ContentProductionWindowResult {
  readonly accepted: number;
  readonly existing: number;
  readonly failed: number;
}

function addDays(fortuneDate: string, days: number): string {
  const [year, month, day] = fortuneDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError(`Invalid fortuneDate: ${fortuneDate}`);
  }
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

export class ContentProductionWorker {
  constructor(
    private readonly service: ContentProductionService,
    private readonly contextResolver: FortuneDateResolver,
    private readonly publicContentContextResolver: PublicContentContextResolver,
  ) {}

  async runWindow(): Promise<ContentProductionWindowResult> {
    const requestContext = this.contextResolver.resolve();
    const startDate = this.publicContentContextResolver.resolve(requestContext).servedFortuneDate;
    const result = { accepted: 0, existing: 0, failed: 0 };
    for (let offset = 0; offset < 30; offset += 1) {
      const fortuneDate = addDays(startDate, offset);
      const ensured = await this.service.ensureDay({
        actorId: "system-content-production-worker",
        fortuneDate,
        idempotencyKey: `automatic-production:${fortuneDate}:v1`,
        requestId: `worker-production-${fortuneDate}`,
      });
      if (ensured.kind === "accepted") result.accepted += 1;
      else if (ensured.kind === "existing") result.existing += 1;
      else result.failed += 1;
    }
    return result;
  }
}
