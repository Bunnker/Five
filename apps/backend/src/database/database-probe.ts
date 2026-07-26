export interface DatabaseProbe {
  check(): Promise<void>;
}

export const DATABASE_PROBE = Symbol("DATABASE_PROBE");
