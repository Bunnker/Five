export type DayCorrectionImageActionOperation = "candidate_select" | "upload";

export interface StoredDayCorrectionImageActionSuccess {
  readonly assetId: string;
  readonly correctionRevision: number;
  readonly draftRevision: number;
  readonly kind: "existing" | "replaced";
  readonly previewUrl: string;
}

export type FindDayCorrectionImageActionResult =
  | { readonly kind: "missing" }
  | { readonly kind: "idempotency_conflict" }
  | {
      readonly kind: "existing";
      readonly result: StoredDayCorrectionImageActionSuccess;
    };

export type RecordDayCorrectionImageActionResult =
  | { readonly kind: "idempotency_conflict" }
  | {
      readonly kind: "existing" | "recorded";
      readonly result: StoredDayCorrectionImageActionSuccess;
    };

export interface DayCorrectionImageActionIdempotencyStore {
  find(input: {
    readonly correctionId: string;
    readonly idempotencyKey: string;
    readonly operation: DayCorrectionImageActionOperation;
    readonly requestHash: string;
  }): Promise<FindDayCorrectionImageActionResult>;
  record(input: {
    readonly correctionId: string;
    readonly idempotencyKey: string;
    readonly operation: DayCorrectionImageActionOperation;
    readonly requestHash: string;
    readonly result: StoredDayCorrectionImageActionSuccess;
  }): Promise<RecordDayCorrectionImageActionResult>;
}

function key(
  operation: DayCorrectionImageActionOperation,
  correctionId: string,
  idempotencyKey: string,
): string {
  return `${operation}\u0000${correctionId}\u0000${idempotencyKey}`;
}

export class InMemoryDayCorrectionImageActionIdempotencyStore implements DayCorrectionImageActionIdempotencyStore {
  private readonly records = new Map<
    string,
    {
      readonly requestHash: string;
      readonly result: StoredDayCorrectionImageActionSuccess;
    }
  >();

  find(
    input: Parameters<DayCorrectionImageActionIdempotencyStore["find"]>[0],
  ): Promise<FindDayCorrectionImageActionResult> {
    const prior = this.records.get(key(input.operation, input.correctionId, input.idempotencyKey));
    return Promise.resolve(
      prior === undefined
        ? { kind: "missing" }
        : prior.requestHash === input.requestHash
          ? { kind: "existing", result: structuredClone(prior.result) }
          : { kind: "idempotency_conflict" },
    );
  }

  record(
    input: Parameters<DayCorrectionImageActionIdempotencyStore["record"]>[0],
  ): Promise<RecordDayCorrectionImageActionResult> {
    const recordKey = key(input.operation, input.correctionId, input.idempotencyKey);
    const prior = this.records.get(recordKey);
    if (prior !== undefined) {
      return Promise.resolve(
        prior.requestHash === input.requestHash
          ? { kind: "existing", result: structuredClone(prior.result) }
          : { kind: "idempotency_conflict" },
      );
    }
    this.records.set(recordKey, {
      requestHash: input.requestHash,
      result: structuredClone(input.result),
    });
    return Promise.resolve({ kind: "recorded", result: structuredClone(input.result) });
  }
}
