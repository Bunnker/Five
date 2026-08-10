import type { Pool, PoolClient } from "pg";

import type {
  DayCorrectionImageActionIdempotencyStore,
  FindDayCorrectionImageActionResult,
  RecordDayCorrectionImageActionResult,
  StoredDayCorrectionImageActionSuccess,
} from "./day-correction-image-action-idempotency.store";

interface IdempotencyRow {
  request_hash: string;
  response_json: unknown;
}

function parseSuccess(value: unknown): StoredDayCorrectionImageActionSuccess | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return (candidate.kind === "existing" || candidate.kind === "replaced") &&
    typeof candidate.assetId === "string" &&
    candidate.assetId.length > 0 &&
    Number.isSafeInteger(candidate.correctionRevision) &&
    Number(candidate.correctionRevision) >= 1 &&
    Number.isSafeInteger(candidate.draftRevision) &&
    Number(candidate.draftRevision) >= 1 &&
    typeof candidate.previewUrl === "string" &&
    candidate.previewUrl.length > 0
    ? (candidate as unknown as StoredDayCorrectionImageActionSuccess)
    : null;
}

async function find(
  client: Pool | PoolClient,
  input: Parameters<DayCorrectionImageActionIdempotencyStore["find"]>[0],
): Promise<FindDayCorrectionImageActionResult> {
  const prior = await client.query<IdempotencyRow>(
    `SELECT request_hash, response_json
       FROM day_correction_image_idempotency
      WHERE operation = $1
        AND correction_id = $2
        AND idempotency_key = $3`,
    [input.operation, input.correctionId, input.idempotencyKey],
  );
  const row = prior.rows[0];
  if (row === undefined) return { kind: "missing" };
  const result = parseSuccess(row.response_json);
  return row.request_hash === input.requestHash && result !== null
    ? { kind: "existing", result }
    : { kind: "idempotency_conflict" };
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

export class PostgresDayCorrectionImageActionIdempotencyStore implements DayCorrectionImageActionIdempotencyStore {
  constructor(private readonly pool: Pool) {}

  find(
    input: Parameters<DayCorrectionImageActionIdempotencyStore["find"]>[0],
  ): Promise<FindDayCorrectionImageActionResult> {
    return find(this.pool, input);
  }

  async record(
    input: Parameters<DayCorrectionImageActionIdempotencyStore["record"]>[0],
  ): Promise<RecordDayCorrectionImageActionResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `five:day-correction-image-idempotency:${input.correctionId}:${input.idempotencyKey}`,
      ]);
      const prior = await find(client, input);
      if (prior.kind !== "missing") {
        await client.query("COMMIT");
        return prior;
      }
      await client.query(
        `INSERT INTO day_correction_image_idempotency (
           operation, correction_id, idempotency_key, request_hash, response_json, created_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, transaction_timestamp())`,
        [
          input.operation,
          input.correctionId,
          input.idempotencyKey,
          input.requestHash,
          JSON.stringify(input.result),
        ],
      );
      await client.query("COMMIT");
      return { kind: "recorded", result: structuredClone(input.result) };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
