import {
  type DraftModules,
  StructuredDailyContentGenerator,
} from "./structured-daily-content.generator";

export class DeterministicDraftGenerator {
  constructor(private readonly generator = new StructuredDailyContentGenerator()) {}

  generate(fortuneDate: string): DraftModules {
    return this.generator.generate(fortuneDate);
  }
}
