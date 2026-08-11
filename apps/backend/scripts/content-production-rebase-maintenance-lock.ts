const MAINTENANCE_LOCK = "five:content-production-rebase:maintenance";

export interface ContentProductionRebaseMaintenanceLockQuery {
  query(
    statement: string,
    parameters: readonly string[],
  ): Promise<{ readonly rows: ReadonlyArray<{ readonly acquired?: boolean }> }>;
}

export async function withContentProductionRebaseMaintenanceLock<T>(
  database: ContentProductionRebaseMaintenanceLockQuery,
  mode: "exclusive" | "shared",
  operation: () => Promise<T>,
): Promise<T> {
  const shared = mode === "shared";
  const acquireStatement = shared
    ? "SELECT pg_try_advisory_lock_shared(hashtextextended($1, 0)) AS acquired"
    : "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired";
  const releaseStatement = shared
    ? "SELECT pg_advisory_unlock_shared(hashtextextended($1, 0)) AS released"
    : "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released";
  const result = await database.query(acquireStatement, [MAINTENANCE_LOCK]);
  if (result.rows[0]?.acquired !== true) {
    throw new Error("Another content production rebase command maintenance lock is already held");
  }
  try {
    return await operation();
  } finally {
    await database.query(releaseStatement, [MAINTENANCE_LOCK]).catch(() => undefined);
  }
}
