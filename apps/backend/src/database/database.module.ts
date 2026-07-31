import { Global, Module } from "@nestjs/common";

import { DATABASE_PROBE } from "./database-probe";
import { PostgresDatabaseProbe } from "./postgres-database-probe";
import { createPostgresPool, DATABASE_POOL, PostgresPoolShutdown } from "./postgres-pool";

@Global()
@Module({
  exports: [DATABASE_POOL, DATABASE_PROBE],
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: createPostgresPool,
    },
    PostgresPoolShutdown,
    {
      provide: DATABASE_PROBE,
      useClass: PostgresDatabaseProbe,
    },
  ],
})
export class DatabaseModule {}
