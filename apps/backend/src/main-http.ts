import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import { AppModule } from "./app.module";
import type { AdminAuthService, EmergencyControlService } from "./admin-auth/admin-auth.service";
import { ADMIN_AUTH_SERVICE, EMERGENCY_CONTROL_SERVICE } from "./admin-http/admin-http.providers";
import {
  adminTrustedOriginsFromEnvironment,
  installAdminRequestProtection,
} from "./admin-http/admin-request-protection";
import { installAdminImageMultipart } from "./admin-http/admin-image-multipart";
import { installFeedbackRequestProtection } from "./feedback/feedback-request-protection";
import { installPublicAccessGate } from "./http/public-access-gate";

function readPort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      // The current web rewrite reaches this process over loopback. Trusting only that hop lets
      // Fastify recover the browser-facing source without accepting spoofed proxy headers from
      // direct remote clients. Issue #34 must replace/extend this with the deployed proxy CIDR.
      trustProxy: "loopback",
    }),
  );
  await installAdminImageMultipart(app.getHttpAdapter().getInstance());
  installFeedbackRequestProtection(app.getHttpAdapter().getInstance());
  installAdminRequestProtection(
    app.getHttpAdapter().getInstance(),
    app.get<AdminAuthService>(ADMIN_AUTH_SERVICE),
    adminTrustedOriginsFromEnvironment(process.env),
  );
  const emergencyControl = app.get<EmergencyControlService>(EMERGENCY_CONTROL_SERVICE);
  installPublicAccessGate(app.getHttpAdapter().getInstance(), {
    getPublicAccessControl: () => emergencyControl.getState(),
  });
  const port = readPort(process.env.HTTP_PORT, 3_100);

  app.enableShutdownHooks();
  await app.listen(port, "0.0.0.0");
  Logger.log(`Five HTTP is listening on http://localhost:${port}`, "Bootstrap");
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error, "Five HTTP failed to start", "Bootstrap");
  process.exitCode = 1;
});
