import { Global, Module } from "@nestjs/common";

import { DATABASE_PROBE } from "./database-probe";
import { PostgresDatabaseProbe } from "./postgres-database-probe";

@Global()
@Module({
  exports: [DATABASE_PROBE],
  providers: [
    {
      provide: DATABASE_PROBE,
      useClass: PostgresDatabaseProbe,
    },
  ],
})
export class DatabaseModule {}
