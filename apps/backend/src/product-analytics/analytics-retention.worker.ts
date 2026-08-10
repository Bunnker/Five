import type { AnalyticsEventService } from "./analytics-event.service";

export class AnalyticsRetentionWorker {
  constructor(private readonly analytics: Pick<AnalyticsEventService, "purgeExpired">) {}

  async runOne(): Promise<
    { readonly deletedCount: number; readonly kind: "purged" } | { readonly kind: "failed" }
  > {
    try {
      const deletedCount = await this.analytics.purgeExpired();
      return { deletedCount, kind: "purged" };
    } catch {
      // Analytics is a side capability. A cleanup retry must not block publishing or image work.
      return { kind: "failed" };
    }
  }
}
