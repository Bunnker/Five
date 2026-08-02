import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import type { Pool } from "pg";

import { adminSecurityCryptoFromEnvironment } from "../admin-auth/admin-auth.configuration";
import { NodeScryptPasswordHasher, SystemAdminAuthRandom } from "../admin-auth/admin-auth.crypto";
import { AdminAuthService, EmergencyControlService } from "../admin-auth/admin-auth.service";
import { PostgresAdminSecurityStore } from "../admin-auth/postgres-admin-security.store";
import { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import { CONTENT_LIFECYCLE_STORE } from "../content-lifecycle/content-lifecycle.store";
import { PostgresContentLifecycleStore } from "../content-lifecycle/postgres-content-lifecycle.store";
import { DatabaseModule } from "../database/database.module";
import { DATABASE_POOL } from "../database/postgres-pool";
import { SystemClock } from "../request-context/system-clock";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminContentController } from "./admin-content.controller";
import { AdminHttpExceptionFilter } from "./admin-http-exception.filter";
import {
  ADMIN_AUTH_SERVICE,
  CONTENT_LIFECYCLE_SERVICE,
  EMERGENCY_CONTROL_SERVICE,
} from "./admin-http.providers";
import { AdminSecurityController } from "./admin-security.controller";

const ADMIN_SECURITY_STORE = Symbol("ADMIN_SECURITY_STORE");
const ADMIN_SECURITY_CRYPTO = Symbol("ADMIN_SECURITY_CRYPTO");

function runtimeAdminSecurityEnvironment(): NodeJS.ProcessEnv {
  if (process.env.NODE_ENV !== "test") {
    return process.env;
  }
  return {
    ...process.env,
    FIVE_ADMIN_HMAC_KEY_BASE64:
      process.env.FIVE_ADMIN_HMAC_KEY_BASE64 ?? Buffer.alloc(32, 0xa1).toString("base64"),
    FIVE_ADMIN_TOTP_ACTIVE_KEY_VERSION: process.env.FIVE_ADMIN_TOTP_ACTIVE_KEY_VERSION ?? "1",
    FIVE_ADMIN_TOTP_KEYS_JSON:
      process.env.FIVE_ADMIN_TOTP_KEYS_JSON ??
      JSON.stringify({ 1: Buffer.alloc(32, 0xb2).toString("base64") }),
  };
}

@Module({
  controllers: [AdminAuthController, AdminContentController, AdminSecurityController],
  exports: [ADMIN_AUTH_SERVICE, CONTENT_LIFECYCLE_SERVICE, EMERGENCY_CONTROL_SERVICE],
  imports: [DatabaseModule],
  providers: [
    SystemClock,
    NodeScryptPasswordHasher,
    SystemAdminAuthRandom,
    {
      inject: [DATABASE_POOL],
      provide: ADMIN_SECURITY_STORE,
      useFactory: (pool: Pool) => new PostgresAdminSecurityStore(pool),
    },
    {
      inject: [DATABASE_POOL],
      provide: CONTENT_LIFECYCLE_STORE,
      useFactory: (pool: Pool) => new PostgresContentLifecycleStore(pool),
    },
    {
      provide: ADMIN_SECURITY_CRYPTO,
      useFactory: () => adminSecurityCryptoFromEnvironment(runtimeAdminSecurityEnvironment()),
    },
    {
      inject: [
        ADMIN_SECURITY_STORE,
        NodeScryptPasswordHasher,
        ADMIN_SECURITY_CRYPTO,
        SystemAdminAuthRandom,
        SystemClock,
      ],
      provide: ADMIN_AUTH_SERVICE,
      useFactory: (
        store: PostgresAdminSecurityStore,
        passwordHasher: NodeScryptPasswordHasher,
        crypto: ReturnType<typeof adminSecurityCryptoFromEnvironment>,
        random: SystemAdminAuthRandom,
        clock: SystemClock,
      ) =>
        new AdminAuthService(
          store,
          passwordHasher,
          crypto.secretCipher,
          crypto.digester,
          random,
          clock,
        ),
    },
    {
      inject: [
        ADMIN_SECURITY_STORE,
        ADMIN_SECURITY_CRYPTO,
        SystemAdminAuthRandom,
        SystemClock,
        ADMIN_AUTH_SERVICE,
      ],
      provide: EMERGENCY_CONTROL_SERVICE,
      useFactory: (
        store: PostgresAdminSecurityStore,
        crypto: ReturnType<typeof adminSecurityCryptoFromEnvironment>,
        random: SystemAdminAuthRandom,
        clock: SystemClock,
        authService: AdminAuthService,
      ) => new EmergencyControlService(store, crypto.secretCipher, random, clock, authService),
    },
    {
      inject: [CONTENT_LIFECYCLE_STORE, SystemClock],
      provide: CONTENT_LIFECYCLE_SERVICE,
      useFactory: (store: PostgresContentLifecycleStore, clock: SystemClock) =>
        new ContentLifecycleService(store, clock),
    },
    { provide: APP_FILTER, useClass: AdminHttpExceptionFilter },
  ],
})
export class AdminHttpModule {}
