import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContentLifecycleService } from "./content-lifecycle.service";
import { PostgresContentLifecycleStore } from "./postgres-content-lifecycle.store";

const databaseUrl = process.env.FIVE_CONTENT_LIFECYCLE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

function opaqueKey(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function waitForLock(pool: Pool, applicationName: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND application_name = $1
            AND wait_event_type = 'Lock'
       ) AS waiting`,
      [applicationName],
    );
    if (result.rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for PostgreSQL lock: ${applicationName}`);
}

describeDatabase("PostgresContentLifecycleStore", () => {
  let pool: Pool;
  let service: ContentLifecycleService;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 8 });
    service = new ContentLifecycleService(
      new PostgresContentLifecycleStore(pool),
      { now: () => new Date("2026-08-01T13:00:00.000Z") },
      {
        nextAuditEventId: () => opaqueKey("audit"),
        nextContentVersion: () => opaqueKey("content"),
        nextDraftId: () => opaqueKey("draft"),
        nextEvidenceId: () => opaqueKey("evidence"),
      },
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("atomically persists the shared lifecycle revision, idempotency, audit, and immutable records", async () => {
    const fortuneDate = "2026-08-05";
    const firstDraft = await service.createDraft({
      actorId: "operator-integration",
      copyFromContentVersion: null,
      fortuneDate,
      requestId: opaqueKey("request-create-first"),
    });
    expect(firstDraft.kind).toBe("created");
    if (firstDraft.kind !== "created") return;
    const posterModule = {
      posterTemplateVersion: "poster-v1",
      sampleAssetId: "asset-sample-1",
      templateId: "template-v1",
    };
    await expect(
      service.updateDraftModule({
        actorId: "operator-integration",
        draftId: firstDraft.draft.draftId,
        expectedDraftRevision: 1,
        module: posterModule,
        moduleCode: "poster_consistency",
        requestId: opaqueKey("request-update-first"),
      }),
    ).resolves.toMatchObject({ kind: "updated", result: { draftRevision: 2 } });

    const submitKey = opaqueKey("submit-first");
    const submitInput = {
      actorId: "operator-integration",
      draftId: firstDraft.draft.draftId,
      expectedDraftRevision: 2,
      idempotencyKey: submitKey,
      requestId: opaqueKey("request-submit-first"),
    };
    const concurrentSubmits = await Promise.all([
      service.submitDraft(submitInput),
      service.submitDraft({ ...submitInput, requestId: opaqueKey("request-submit-first-retry") }),
    ]);
    expect(concurrentSubmits.map((result) => result.kind).sort()).toEqual([
      "existing",
      "submitted",
    ]);
    const firstSubmit = concurrentSubmits.find((result) => result.kind === "submitted");
    expect(firstSubmit).toBeDefined();
    if (firstSubmit === undefined || !("result" in firstSubmit)) return;
    expect(firstSubmit.result.lifecycleRevision).toBe(1);
    expect(firstSubmit.result.contentVersion).not.toContain(fortuneDate);
    expect(
      new Set(
        concurrentSubmits.flatMap((result) =>
          "result" in result ? [result.result.contentVersion] : [],
        ),
      ),
    ).toEqual(new Set([firstSubmit.result.contentVersion]));

    const secondDraft = await service.createDraft({
      actorId: "operator-integration",
      copyFromContentVersion: null,
      fortuneDate,
      requestId: opaqueKey("request-create-second"),
    });
    expect(secondDraft.kind).toBe("created");
    if (secondDraft.kind !== "created") return;
    const secondSubmit = await service.submitDraft({
      actorId: "operator-integration",
      draftId: secondDraft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: opaqueKey("submit-second"),
      requestId: opaqueKey("request-submit-second"),
    });
    expect(secondSubmit).toMatchObject({ kind: "submitted", result: { lifecycleRevision: 2 } });
    if (secondSubmit.kind !== "submitted" || !("result" in secondSubmit)) return;
    const versionsAtRevisionTwo = await service.listVersions(fortuneDate);
    expect(versionsAtRevisionTwo).toMatchObject({
      activeContentVersion: null,
      fortuneDate,
      items: expect.arrayContaining([
        expect.objectContaining({ contentVersion: firstSubmit.result.contentVersion }),
        expect.objectContaining({ contentVersion: secondSubmit.result.contentVersion }),
      ]),
    });
    if ("items" in versionsAtRevisionTwo) {
      expect(versionsAtRevisionTwo.items).toHaveLength(2);
      expect(versionsAtRevisionTwo.items.every((item) => item.lifecycleRevision === 2)).toBe(true);
    }

    const confirmedEvidence = await service.addMasterReviewEvidence({
      actorId: "operator-integration",
      contentVersion: firstSubmit.result.contentVersion,
      evidence: {
        conclusion: "confirmed",
        notes: "完成首次核对。",
        references: [{ kind: "note", reference: "integration-master-confirmed" }],
        reviewedAt: "2026-08-01T10:00:00+08:00",
        reviewerDisplayName: "林老师",
      },
      expectedLifecycleRevision: 2,
      idempotencyKey: opaqueKey("master-confirmed"),
      requestId: opaqueKey("request-master-confirmed"),
    });
    expect(confirmedEvidence).toMatchObject({
      kind: "added",
      version: { lifecycleRevision: 3 },
    });
    const evidence = await service.addMasterReviewEvidence({
      actorId: "operator-integration",
      contentVersion: firstSubmit.result.contentVersion,
      evidence: {
        conclusion: "changes_requested",
        notes: "需要重新核对颜色关系。",
        references: [{ kind: "note", reference: "integration-master-changes" }],
        reviewedAt: "2026-08-01T10:30:00+08:00",
        reviewerDisplayName: "林老师",
      },
      expectedLifecycleRevision: 3,
      idempotencyKey: opaqueKey("master-changes"),
      requestId: opaqueKey("request-master-changes"),
    });
    expect(evidence).toMatchObject({ kind: "added", version: { lifecycleRevision: 4 } });
    if (evidence.kind !== "added") return;
    expect(evidence.version.preflightChecks).toContainEqual(
      expect.objectContaining({ code: "master_review_evidence", status: "failed" }),
    );
    const evidenceId = evidence.version.masterReviewEvidence[0]?.evidenceId;
    expect(evidenceId).toEqual(expect.any(String));
    if (evidenceId === undefined) return;

    const decisionKey = opaqueKey("decision-changes-requested");
    const decisionInput = {
      actorId: "operator-integration",
      contentVersion: firstSubmit.result.contentVersion,
      decision: "changes_requested" as const,
      expectedLifecycleRevision: 4,
      idempotencyKey: decisionKey,
      reason: "大师要求重新核对五档颜色关系。",
      requestId: opaqueKey("request-decision"),
    };
    const concurrentDecisions = await Promise.all([
      service.decideReview(decisionInput),
      service.decideReview({ ...decisionInput, requestId: opaqueKey("request-decision-retry") }),
    ]);
    expect(concurrentDecisions.map((result) => result.kind).sort()).toEqual([
      "applied",
      "existing",
    ]);
    expect(concurrentDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: expect.objectContaining({ lifecycleRevision: 5, state: "changes_requested" }),
        }),
      ]),
    );
    expect((await service.listDrafts(fortuneDate)).items).toEqual([]);

    const copied = await service.createDraft({
      actorId: "operator-integration",
      copyFromContentVersion: firstSubmit.result.contentVersion,
      fortuneDate,
      requestId: opaqueKey("request-copy-rejected"),
    });
    expect(copied).toMatchObject({
      kind: "created",
      draft: {
        draftRevision: 1,
        modules: { poster_consistency: posterModule },
      },
    });
    if (copied.kind !== "created") return;
    await service.updateDraftModule({
      actorId: "operator-integration",
      draftId: copied.draft.draftId,
      expectedDraftRevision: 1,
      module: { ...posterModule, posterTemplateVersion: "poster-v2" },
      moduleCode: "poster_consistency",
      requestId: opaqueKey("request-edit-copy"),
    });
    expect(
      (await service.getVersion(firstSubmit.result.contentVersion))?.snapshot.poster_consistency,
    ).toEqual(posterModule);

    const audit = await service.listAuditEvents({
      contentVersion: firstSubmit.result.contentVersion,
      cursor: null,
      fortuneDate,
      limit: 100,
    });
    expect(audit).toMatchObject({ kind: "page", nextCursor: null });
    if (audit.kind !== "page") return;
    expect(audit.items.map((event) => event.action).sort()).toEqual([
      "content_changes_requested",
      "content_submitted",
      "master_review_evidence_added",
      "master_review_evidence_added",
    ]);
    const auditEventId = audit.items[0]?.auditEventId;
    expect(auditEventId).toEqual(expect.any(String));
    if (auditEventId === undefined) return;

    await expect(
      pool.query(
        `UPDATE content_versions
            SET snapshot = jsonb_set(snapshot, '{poster_consistency,posterTemplateVersion}', '"tampered"')
          WHERE content_version = $1`,
        [firstSubmit.result.contentVersion],
      ),
    ).rejects.toThrow("content version snapshot is immutable");
    await expect(
      pool.query("DELETE FROM content_versions WHERE content_version = $1", [
        firstSubmit.result.contentVersion,
      ]),
    ).rejects.toThrow("content_versions cannot be deleted");
    await expect(
      pool.query("UPDATE master_review_evidence SET notes = 'tampered' WHERE evidence_id = $1", [
        evidenceId,
      ]),
    ).rejects.toThrow("master_review_evidence is append-only");
    await expect(
      pool.query("DELETE FROM content_lifecycle_audit_events WHERE audit_event_id = $1", [
        auditEventId,
      ]),
    ).rejects.toThrow("content_lifecycle_audit_events is append-only");
    await expect(
      pool.query("UPDATE content_drafts SET modules = '{}'::jsonb WHERE draft_id = $1", [
        firstDraft.draft.draftId,
      ]),
    ).rejects.toThrow("submitted content draft is immutable");

    const retained = await pool.query<{ retained: boolean }>(
      `SELECT bool_and(retain_until >= occurred_at + interval '365 days') AS retained
         FROM content_lifecycle_audit_events`,
    );
    expect(retained.rows[0]?.retained).toBe(true);
  });

  it("returns one database snapshot for a content version and its lifecycle revision", async () => {
    const fortuneDate = "2026-09-10";
    const draft = await service.createDraft({
      actorId: "operator-integration",
      copyFromContentVersion: null,
      fortuneDate,
      requestId: opaqueKey("request-consistent-version"),
    });
    expect(draft.kind).toBe("created");
    if (draft.kind !== "created") return;
    const submitted = await service.submitDraft({
      actorId: "operator-integration",
      draftId: draft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: opaqueKey("submit-consistent-version"),
      requestId: opaqueKey("request-submit-consistent-version"),
    });
    expect(submitted.kind).toBe("submitted");
    if (submitted.kind !== "submitted") return;

    const readerApplication = opaqueKey("consistent-version-reader");
    const writerApplication = opaqueKey("consistent-version-writer");
    const readerPool = new Pool({
      application_name: readerApplication,
      connectionString: databaseUrl,
      max: 4,
    });
    const readerService = new ContentLifecycleService(
      new PostgresContentLifecycleStore(readerPool),
    );
    const blocker = await pool.connect();
    const writer = await pool.connect();
    const evidenceId = opaqueKey("consistent-evidence");
    let mutation: Promise<void> | null = null;
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE content_lifecycle_days IN ACCESS SHARE MODE");
      await writer.query("BEGIN");
      await writer.query("SELECT set_config('application_name', $1, false)", [writerApplication]);
      mutation = (async () => {
        await writer.query("LOCK TABLE content_lifecycle_days IN ACCESS EXCLUSIVE MODE");
        await writer.query(
          `INSERT INTO master_review_evidence (
             evidence_id, content_version, reviewer_display_name, reviewed_at,
             conclusion, notes, references_json, recorded_at, recorded_revision
           ) VALUES (
             $1, $2, '林老师', '2026-09-09T12:00:00.000Z',
             'confirmed', '一致性读取测试', '[{"kind":"note","reference":"snapshot-test"}]'::jsonb,
             '2026-09-09T12:01:00.000Z', 2
           )`,
          [evidenceId, submitted.result.contentVersion],
        );
        await writer.query(
          `UPDATE content_lifecycle_days
              SET lifecycle_revision = 2
            WHERE fortune_date = $1::date AND lifecycle_revision = 1`,
          [fortuneDate],
        );
        await writer.query("COMMIT");
      })();
      await waitForLock(pool, writerApplication);

      const read = readerService.getVersion(submitted.result.contentVersion);
      await waitForLock(pool, readerApplication);
      await blocker.query("COMMIT");

      const view = await read;
      await mutation;
      expect(view).not.toBeNull();
      if (view === null) return;
      expect([
        { evidenceIds: [], lifecycleRevision: 1 },
        { evidenceIds: [evidenceId], lifecycleRevision: 2 },
      ]).toContainEqual({
        evidenceIds: view.masterReviewEvidence.map((evidence) => evidence.evidenceId),
        lifecycleRevision: view.lifecycleRevision,
      });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await mutation?.catch(() => undefined);
      await writer.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      writer.release();
      await readerPool.end();
    }
  });

  it("returns one database snapshot for a version list and its lifecycle revision", async () => {
    const fortuneDate = "2026-09-11";
    const draft = await service.createDraft({
      actorId: "operator-integration",
      copyFromContentVersion: null,
      fortuneDate,
      requestId: opaqueKey("request-consistent-list"),
    });
    expect(draft.kind).toBe("created");
    if (draft.kind !== "created") return;
    const submitted = await service.submitDraft({
      actorId: "operator-integration",
      draftId: draft.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: opaqueKey("submit-consistent-list"),
      requestId: opaqueKey("request-submit-consistent-list"),
    });
    expect(submitted.kind).toBe("submitted");
    if (submitted.kind !== "submitted") return;

    const readerApplication = opaqueKey("consistent-list-reader");
    const writerApplication = opaqueKey("consistent-list-writer");
    const readerPool = new Pool({
      application_name: readerApplication,
      connectionString: databaseUrl,
      max: 4,
    });
    const readerService = new ContentLifecycleService(
      new PostgresContentLifecycleStore(readerPool),
    );
    const blocker = await pool.connect();
    const writer = await pool.connect();
    let mutation: Promise<void> | null = null;
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE content_lifecycle_days IN ACCESS SHARE MODE");
      await writer.query("BEGIN");
      await writer.query("SELECT set_config('application_name', $1, false)", [writerApplication]);
      mutation = (async () => {
        await writer.query("LOCK TABLE content_lifecycle_days IN ACCESS EXCLUSIVE MODE");
        await writer.query(
          "UPDATE content_versions SET state = 'changes_requested' WHERE content_version = $1",
          [submitted.result.contentVersion],
        );
        await writer.query(
          `UPDATE content_lifecycle_days
              SET lifecycle_revision = 2
            WHERE fortune_date = $1::date AND lifecycle_revision = 1`,
          [fortuneDate],
        );
        await writer.query("COMMIT");
      })();
      await waitForLock(pool, writerApplication);

      const read = readerService.listVersions(fortuneDate);
      await waitForLock(pool, readerApplication);
      await blocker.query("COMMIT");

      const view = await read;
      await mutation;
      expect("items" in view).toBe(true);
      if (!("items" in view)) return;
      expect([
        { lifecycleRevision: 1, state: "in_review" },
        { lifecycleRevision: 2, state: "changes_requested" },
      ]).toContainEqual({
        lifecycleRevision: view.items[0]?.lifecycleRevision,
        state: view.items[0]?.state,
      });
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await mutation?.catch(() => undefined);
      await writer.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      writer.release();
      await readerPool.end();
    }
  });
});
