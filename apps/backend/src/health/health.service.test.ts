import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { DatabaseProbe } from "../database/database-probe";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  it("reports the HTTP process as live without touching PostgreSQL", () => {
    const database: DatabaseProbe = {
      check: vi.fn(),
    };
    const service = new HealthService(database);

    expect(service.live()).toEqual({
      service: "five-http",
      status: "ok",
    });
    expect(database.check).not.toHaveBeenCalled();
  });

  it("reports ready only after PostgreSQL answers", async () => {
    const database: DatabaseProbe = {
      check: vi.fn().mockResolvedValue(undefined),
    };
    const service = new HealthService(database);

    await expect(service.ready()).resolves.toEqual({
      database: "reachable",
      service: "five-http",
      status: "ready",
    });
  });

  it("returns an unavailable result when PostgreSQL cannot answer", async () => {
    const database: DatabaseProbe = {
      check: vi.fn().mockRejectedValue(new Error("offline")),
    };
    const service = new HealthService(database);

    await expect(service.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
