import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import { AppModule } from "./app.module";
import { installFeedbackRequestProtection } from "./feedback/feedback-request-protection";

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
  installFeedbackRequestProtection(app.getHttpAdapter().getInstance());
  const port = readPort(process.env.HTTP_PORT, 3_100);

  app.enableShutdownHooks();
  await app.listen(port, "0.0.0.0");
  Logger.log(`Five HTTP is listening on http://localhost:${port}`, "Bootstrap");
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error, "Five HTTP failed to start", "Bootstrap");
  process.exitCode = 1;
});
