import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";

import type { DatabaseProbe } from "./database-probe";

@Injectable()
export class PostgresDatabaseProbe implements DatabaseProbe, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is missing. Run the service through the root pnpm dev or pnpm smoke command.",
      );
    }

    this.pool = new Pool({
      application_name: "five",
      connectionString,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 4,
    });
  }

  async check(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
