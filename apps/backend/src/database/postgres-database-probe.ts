import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import type { DatabaseProbe } from "./database-probe";
import { DATABASE_POOL } from "./postgres-pool";

@Injectable()
export class PostgresDatabaseProbe implements DatabaseProbe {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async check(): Promise<void> {
    await this.pool.query("SELECT 1");
  }
}
