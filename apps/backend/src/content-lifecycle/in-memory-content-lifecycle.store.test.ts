import { describe, expect, it } from "vitest";

import { ContentLifecycleService } from "./content-lifecycle.service";
import { InMemoryContentLifecycleStore } from "./in-memory-content-lifecycle.store";

describe("InMemoryContentLifecycleStore consistent reads", () => {
  it("does not expose a lifecycle view while its transaction is only partially applied", async () => {
    const store = new InMemoryContentLifecycleStore();
    const service = new ContentLifecycleService(store);
    const draft = await service.createDraft({
      actorId: "operator-test",
      copyFromContentVersion: null,
      fortuneDate: "2026-09-12",
      requestId: "request-consistent-memory-create",
    });
    expect(draft.kind).toBe("created");
    if (draft.kind !== "created") return;
    const submitted = await service.submitDraft({
      actorId: "operator-test",
      draftId: draft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-consistent-memory-0001",
      requestId: "request-consistent-memory-submit",
    });
    expect(submitted.kind).toBe("submitted");
    if (submitted.kind !== "submitted") return;

    let signalEvidenceInserted: () => void = () => undefined;
    const evidenceInserted = new Promise<void>((resolve) => {
      signalEvidenceInserted = resolve;
    });
    let releaseMutation: () => void = () => undefined;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const evidenceId = "evidence-consistent-memory";
    const mutation = store.transaction(async (transaction) => {
      const projection = await transaction.getOrCreateProjectionForUpdate("2026-09-12");
      await transaction.insertEvidence({
        conclusion: "confirmed",
        contentVersion: submitted.result.contentVersion,
        evidenceId,
        notes: "内存事务一致性测试",
        recordedAt: "2026-09-11T12:01:00.000Z",
        recordedRevision: 2,
        references: [{ kind: "note", reference: "memory-snapshot-test" }],
        reviewedAt: "2026-09-11T12:00:00.000Z",
        reviewerDisplayName: "林老师",
      });
      signalEvidenceInserted();
      await mutationGate;
      await transaction.updateProjection({ ...projection, revision: 2 });
    });
    await evidenceInserted;

    let readResolved = false;
    const read = service.getVersion(submitted.result.contentVersion).then((view) => {
      readResolved = true;
      return view;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const resolvedWhileMutationOpen = readResolved;
    releaseMutation();

    const [view] = await Promise.all([read, mutation]);
    expect(resolvedWhileMutationOpen).toBe(false);
    expect(view).toMatchObject({
      lifecycleRevision: 2,
      masterReviewEvidence: [{ evidenceId }],
    });
  });
});
