import { Controller, Get } from "@nestjs/common";

import { HealthService, type LiveHealth, type ReadyHealth } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("live")
  live(): LiveHealth {
    return this.healthService.live();
  }

  @Get("ready")
  ready(): Promise<ReadyHealth> {
    return this.healthService.ready();
  }
}
