import { parseFortuneDate, shiftFortuneDate } from "./public-content-date";

export interface PublicContentWindow {
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  readonly prepareBy: string;
  readonly switchBoundary: "18:00";
}

const PUBLIC_SWITCH_BOUNDARY = "18:00" as const;

export class PublicContentWindowResolver {
  resolve(fortuneDate: string): PublicContentWindow {
    parseFortuneDate(fortuneDate);
    const previousCivilDate = shiftFortuneDate(fortuneDate, -1);
    return {
      effectiveFrom: `${previousCivilDate}T18:00:00+08:00`,
      effectiveTo: `${fortuneDate}T18:00:00+08:00`,
      prepareBy: `${previousCivilDate}T13:00:00+08:00`,
      switchBoundary: PUBLIC_SWITCH_BOUNDARY,
    };
  }
}
