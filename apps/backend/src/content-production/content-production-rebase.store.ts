import type {
  ContentProductionRebaseApplyInput,
  ContentProductionRebaseEvent,
  ContentProductionRebaseResult,
} from "./content-production-rebase";

export type ContentProductionRebaseInspection =
  | {
      readonly createdAt: string;
      readonly draftId: string;
      readonly draftRevision: 1;
      readonly fortuneDate: string;
      readonly kind: "eligible";
      readonly source: ContentProductionRebaseApplyInput["source"];
    }
  | {
      readonly code: "published_active_version";
      readonly fortuneDate: string;
      readonly kind: "protected";
    }
  | {
      readonly code: "not_found";
      readonly fortuneDate: string;
      readonly kind: "missing";
    }
  | Extract<ContentProductionRebaseResult, { readonly kind: "state_conflict" }>;

export interface ContentProductionRebaseStoreInput extends ContentProductionRebaseApplyInput {
  readonly eventId: string;
  readonly requestHash: string;
  readonly retainUntil: string;
}

export interface ContentProductionRebaseStore {
  inspect(fortuneDate: string): Promise<ContentProductionRebaseInspection>;
  rebase(input: ContentProductionRebaseStoreInput): Promise<ContentProductionRebaseResult>;
  inspectEvent(idempotencyKey: string): Promise<ContentProductionRebaseEvent | null>;
}
