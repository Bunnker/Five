import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";

import { DATABASE_PROBE, type DatabaseProbe } from "../database/database-probe";

export interface LiveHealth {
  service: "five-http";
  status: "ok";
}

export interface ReadyHealth {
  database: "reachable";
  service: "five-http";
  status: "ready";
}

@Injectable()
export class HealthService {
  constructor(@Inject(DATABASE_PROBE) private readonly database: DatabaseProbe) {}

  live(): LiveHealth {
    return {
      service: "five-http",
      status: "ok",
    };
  }

  async ready(): Promise<ReadyHealth> {
    try {
      await this.database.check();
    } catch {
      throw new ServiceUnavailableException({
        database: "unreachable",
        service: "five-http",
        status: "not_ready",
      });
    }

    return {
      database: "reachable",
      service: "five-http",
      status: "ready",
    };
  }
}
