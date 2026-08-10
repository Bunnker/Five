import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PostgresContentProductionStore } from "./postgres-content-production.store";

describe("PostgresContentProductionStore", () => {
  it("serializes a PostgreSQL date as the Asia/Shanghai fortune date", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          completed_image_slots: 0,
          draft_id: "draft-automatic-0001",
          draft_revision: 1,
          fortune_date: new Date("2026-08-02T16:00:00.000Z"),
          image_slots: [
            {
              attemptLimit: 3,
              attempts: 1,
              canRetry: false,
              deliveryReady: true,
              imageSlot: "required_primary",
              lastError: null,
              nextAttemptAt: null,
              status: "ready",
            },
            {
              attemptLimit: 3,
              attempts: 0,
              canRetry: false,
              deliveryReady: false,
              imageSlot: "required_alternative",
              lastError: null,
              nextAttemptAt: "2026-08-02T15:10:00.000Z",
              status: "pending",
            },
            {
              attemptLimit: 0,
              attempts: 0,
              canRetry: false,
              deliveryReady: false,
              imageSlot: "optional",
              lastError: null,
              nextAttemptAt: null,
              status: "not_requested",
            },
          ],
          last_error: null,
          pending_image_slots: 1,
          status: "generating",
          updated_at: new Date("2026-08-02T15:09:44.122Z"),
        },
      ],
    });
    const store = new PostgresContentProductionStore({ query } as unknown as Pool);

    await expect(store.listProductions()).resolves.toEqual([
      expect.objectContaining({
        fortuneDate: "2026-08-03",
        imageSlots: [
          expect.objectContaining({
            deliveryReady: true,
            imageSlot: "required_primary",
            status: "ready",
          }),
          expect.objectContaining({
            deliveryReady: false,
            imageSlot: "required_alternative",
            status: "pending",
          }),
          expect.objectContaining({
            deliveryReady: false,
            imageSlot: "optional",
            status: "not_requested",
          }),
        ],
        optionalImageStatus: "not_requested",
        requiredGenerationComplete: false,
        requiredImagesReady: false,
      }),
    ]);
    const statement = String(query.mock.calls[0]?.[0]);
    expect(statement).toContain("image_asset_withdrawal_events");
    expect(statement).toContain("selected_withdrawal.asset_id IS NOT NULL");
  });
});
