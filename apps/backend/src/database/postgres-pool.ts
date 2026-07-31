import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";

export const DATABASE_POOL = Symbol("DATABASE_POOL");

export function createPostgresPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is missing. Run the service through the root pnpm dev or pnpm smoke command.",
    );
  }
  return new Pool({
    application_name: "five",
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 4,
  });
}

@Injectable()
export class PostgresPoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
