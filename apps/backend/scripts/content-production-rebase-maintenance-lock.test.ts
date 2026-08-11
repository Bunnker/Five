import { describe, expect, it, vi } from "vitest";

import { withContentProductionRebaseMaintenanceLock } from "./content-production-rebase-maintenance-lock";

interface QueryResult {
  readonly rows: ReadonlyArray<{ readonly acquired?: boolean }>;
}

function client(results: readonly QueryResult[]) {
  const query = vi.fn(async () => {
    const next = results[query.mock.calls.length - 1];
    if (next === undefined) throw new Error("unexpected maintenance lock query");
    return next;
  });
  return { query };
}

describe("content production rebase command-period maintenance lock", () => {
  it("holds a shared lock through inspect and always releases it", async () => {
    const database = client([{ rows: [{ acquired: true }] }, { rows: [] }]);
    const operation = vi.fn(async () => "plan-written");

    await expect(
      withContentProductionRebaseMaintenanceLock(database, "shared", operation),
    ).resolves.toBe("plan-written");

    expect(operation).toHaveBeenCalledOnce();
    expect(database.query.mock.calls).toEqual([
      [
        "SELECT pg_try_advisory_lock_shared(hashtextextended($1, 0)) AS acquired",
        ["five:content-production-rebase:maintenance"],
      ],
      [
        "SELECT pg_advisory_unlock_shared(hashtextextended($1, 0)) AS released",
        ["five:content-production-rebase:maintenance"],
      ],
    ]);
  });

  it("does not run inspect when an exclusive apply lock conflicts", async () => {
    const database = client([{ rows: [{ acquired: false }] }]);
    const operation = vi.fn(async () => undefined);

    await expect(
      withContentProductionRebaseMaintenanceLock(database, "shared", operation),
    ).rejects.toThrow("maintenance lock is already held");

    expect(operation).not.toHaveBeenCalled();
    expect(database.query).toHaveBeenCalledOnce();
  });

  it("releases an exclusive apply lock when the command fails", async () => {
    const database = client([{ rows: [{ acquired: true }] }, { rows: [] }]);

    await expect(
      withContentProductionRebaseMaintenanceLock(database, "exclusive", async () => {
        throw new Error("apply failed");
      }),
    ).rejects.toThrow("apply failed");

    expect(database.query.mock.calls.at(-1)).toEqual([
      "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released",
      ["five:content-production-rebase:maintenance"],
    ]);
  });
});
