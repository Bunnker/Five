import { describe, expect, it } from "vitest";

import { ContentLifecycleService } from "./content-lifecycle.service";
import { evaluateContentPreflight } from "./content-preflight";
import type { DraftModules, StoredMasterReviewEvidence } from "./content-lifecycle.store";
import { InMemoryContentLifecycleStore } from "./in-memory-content-lifecycle.store";

function completeModules(): DraftModules {
  const scenario = { code: "daily", label: "日常" };
  const audience = { code: "all", label: "通用" };
  const tiers: NonNullable<DraftModules["calendar_algorithm"]>["tiers"] = [
    {
      algorithmLabel: "大吉",
      colors: [
        { colorCode: "black", name: "黑色" },
        { colorCode: "navy", name: "藏青" },
        { colorCode: "royal_blue", name: "宝蓝" },
        { colorCode: "dark_green", name: "墨绿" },
        { colorCode: "dark_gray_family", name: "深灰系" },
      ],
      displayLabel: "今日优先",
      displaySection: "primary",
      element: "water",
      elementLabel: "水",
      explanation: "优先黑色",
      rank: 1,
      relationText: "金生水",
      tierCode: "da_ji",
    },
    {
      algorithmLabel: "次吉",
      colors: [
        { colorCode: "white", name: "白色" },
        { colorCode: "ivory", name: "乳白" },
        { colorCode: "silver", name: "银色" },
        { colorCode: "gold", name: "金色" },
        { colorCode: "light_family", name: "浅色系" },
      ],
      displayLabel: "稳妥选择",
      displaySection: "primary",
      element: "metal",
      elementLabel: "金",
      explanation: "稳妥白色",
      rank: 2,
      relationText: "金与金同类",
      tierCode: "ci_ji",
    },
    {
      algorithmLabel: "平",
      colors: [
        { colorCode: "red", name: "红色" },
        { colorCode: "orange", name: "橙色" },
        { colorCode: "purple", name: "紫色" },
        { colorCode: "pink_family", name: "粉色系" },
      ],
      displayLabel: "日常可穿",
      displaySection: "primary",
      element: "fire",
      elementLabel: "火",
      explanation: "日常红色",
      rank: 3,
      relationText: "火克金",
      tierCode: "ping",
    },
    {
      algorithmLabel: "较差",
      colors: [
        { colorCode: "yellow", name: "黄色" },
        { colorCode: "coffee", name: "咖色" },
        { colorCode: "brown", name: "棕色" },
        { colorCode: "khaki", name: "卡其" },
        { colorCode: "dark_brown_family", name: "褐色系" },
      ],
      displayLabel: "注意",
      displaySection: "attention",
      element: "earth",
      elementLabel: "土",
      explanation: "减少黄色",
      rank: 4,
      relationText: "土生金",
      tierCode: "jiao_cha",
    },
    {
      algorithmLabel: "不利",
      colors: [
        { colorCode: "green", name: "绿色" },
        { colorCode: "cyan", name: "青色" },
        { colorCode: "emerald", name: "翠色" },
        { colorCode: "lake_blue", name: "湖蓝" },
        { colorCode: "light_green_family", name: "浅绿系" },
      ],
      displayLabel: "注意",
      displaySection: "attention",
      element: "wood",
      elementLabel: "木",
      explanation: "减少绿色",
      rank: 5,
      relationText: "金克木",
      tierCode: "bu_li",
    },
  ];
  type OutfitFormula = NonNullable<DraftModules["copy_and_formula"]>["outfitFormulas"][number];
  const formulaSlots: OutfitFormula["slots"][] = [
    [
      {
        colorCodes: ["black"],
        garmentParts: ["上衣"],
        ratioPercent: 100,
        role: "primary",
        roleLabel: "主色",
        tierCode: "da_ji",
      },
    ],
    [
      {
        colorCodes: ["black"],
        garmentParts: ["上衣"],
        ratioPercent: 70,
        role: "primary",
        roleLabel: "主色",
        tierCode: "da_ji",
      },
      {
        colorCodes: ["white"],
        garmentParts: ["下装"],
        ratioPercent: 30,
        role: "secondary",
        roleLabel: "辅助色",
        tierCode: "ci_ji",
      },
    ],
    [
      {
        colorCodes: ["black"],
        garmentParts: ["上衣"],
        ratioPercent: 60,
        role: "primary",
        roleLabel: "主色",
        tierCode: "da_ji",
      },
      {
        colorCodes: ["white"],
        garmentParts: ["下装"],
        ratioPercent: 30,
        role: "secondary",
        roleLabel: "辅助色",
        tierCode: "ci_ji",
      },
      {
        colorCodes: ["red"],
        garmentParts: ["配饰"],
        ratioPercent: 10,
        role: "accent",
        roleLabel: "点缀色",
        tierCode: "ping",
      },
    ],
  ];
  const formulas: NonNullable<DraftModules["copy_and_formula"]>["outfitFormulas"] = [
    "one",
    "two",
    "three",
  ].map((suffix, index) => ({
    audience,
    disclaimer: "传统文化配色仅供穿搭参考。",
    formulaId: `formula-${suffix}`,
    kind: index === 0 ? "mono" : index === 1 ? "dual" : "triple",
    lookIds: index < 2 ? [`look-${index + 1}`] : [],
    scenario,
    slots: formulaSlots[index]!,
    title: `公式 ${suffix}`,
  }));
  const assets: NonNullable<DraftModules["visual_and_rights"]>["assets"] = [1, 2].map((number) => ({
    aiLabelStatus: "not_applicable",
    altText: `搭配图 ${number}`,
    assetId: `asset-${number}`,
    declaredModel: null,
    fileUrl: `https://cdn.example.com/content/asset-${number}.webp`,
    generatedAt: null,
    height: 1200,
    mediaType: "image/webp",
    promptVersion: null,
    reviewStatus: "approved",
    rightsRecordIds: [`rights-${number}`],
    rightsStatus: "cleared",
    sha256: String(number).repeat(64),
    sourceType: "licensed",
    width: 900,
  }));
  return {
    calendar_algorithm: {
      algorithmVersion: "gbt-33661-2017-anchor-1949-10-01-jiazi",
      calendar: {
        branch: "申",
        dayElement: "metal",
        dayElementLabel: "金",
        ganzhiDay: "戊申",
        lunarDateText: "六月十九",
        weekdayText: "星期六",
      },
      calendarDataVersion: "calendar-golden-fortune-date-23h-v1",
      calendarRuleVersion: "fortune-date-23h-v1",
      tiers,
    },
    copy_and_formula: {
      balanceSuggestion: {
        accessoryExamples: ["包", "鞋"],
        description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
        preferredTierCode: "da_ji",
        title: "已经穿了注意色",
      },
      basis: {
        disclaimer: "传统文化配色仅供穿搭参考。",
        steps: ["确认命理日", "按关系排序"],
      },
      copyVersion: "copy-v1",
      outfitFormulas: formulas,
      outfitVersion: "outfit-v1",
      share: {
        copyText: "今日穿搭参考",
        posterJobEndpoint: "/api/v1/poster-jobs",
        posterTemplateVersion: "poster-v1",
        summaryText: "今日优先黑色",
      },
    },
    poster_consistency: {
      posterTemplateVersion: "poster-v1",
      sampleAssetId: "asset-1",
      templateId: "template-v1",
    },
    visual_and_rights: {
      assetManifestVersion: "assets-v1",
      assets,
      looks: [1, 2].map((number) => ({
        alternatives: [],
        audience,
        coverAssetId: `asset-${number}`,
        detailAssetIds: [],
        formulaId: number === 1 ? "formula-one" : "formula-two",
        items:
          number === 1
            ? [
                {
                  category: "top" as const,
                  categoryLabel: "上衣",
                  colorCode: "black",
                  description: "黑色上衣",
                },
              ]
            : [
                {
                  category: "top" as const,
                  categoryLabel: "上衣",
                  colorCode: "black",
                  description: "黑色上衣",
                },
                {
                  category: "bottom" as const,
                  categoryLabel: "下装",
                  colorCode: "white",
                  description: "白色下装",
                },
              ],
        lookId: `look-${number}`,
        requiredForPublish: true,
        scenario,
        sortOrder: number,
        title: `搭配 ${number}`,
      })),
      rightsRecords: [1, 2].map((number) => ({
        kind: "license",
        recordedAt: "2026-07-31T23:00:00+08:00",
        reference: `license-record-${number}`,
        rightsRecordId: `rights-${number}`,
      })),
    },
  };
}

function deterministicService(
  store = new InMemoryContentLifecycleStore(),
): ContentLifecycleService {
  let draftNumber = 0;
  let contentNumber = 0;
  let evidenceNumber = 0;
  let auditNumber = 0;
  return new ContentLifecycleService(
    store,
    { now: () => new Date("2026-07-31T15:00:00.000Z") },
    {
      nextAuditEventId: () => `audit-${++auditNumber}`,
      nextContentVersion: () => `content-opaque-${++contentNumber}`,
      nextDraftId: () => `draft-${++draftNumber}`,
      nextEvidenceId: () => `evidence-${++evidenceNumber}`,
    },
  );
}

describe("ContentLifecycleService", () => {
  it("creates an editable draft that can be resumed from the server", async () => {
    const service = new ContentLifecycleService(new InMemoryContentLifecycleStore());

    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-01",
      requestId: "request-create-draft-0001",
    });

    expect(created).toMatchObject({
      kind: "created",
      draft: {
        draftRevision: 1,
        fortuneDate: "2026-08-01",
        modules: {
          calendar_algorithm: null,
          copy_and_formula: null,
          poster_consistency: null,
          visual_and_rights: null,
        },
        state: "draft",
      },
    });
    await expect(service.listDrafts("2026-08-01")).resolves.toEqual({
      items: [
        expect.objectContaining({
          draftId: created.kind === "created" ? created.draft.draftId : "missing",
          draftRevision: 1,
          fortuneDate: "2026-08-01",
        }),
      ],
    });
  });

  it("updates only the requested draft module with optimistic concurrency", async () => {
    const service = new ContentLifecycleService(new InMemoryContentLifecycleStore());
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-01",
      requestId: "request-create-draft-0002",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const module = {
      posterTemplateVersion: "poster-v1",
      sampleAssetId: "asset-sample",
      templateId: "template-1",
    };

    await expect(
      service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: 1,
        module,
        moduleCode: "poster_consistency",
        requestId: "request-update-draft-0001",
      }),
    ).resolves.toEqual({
      kind: "updated",
      result: {
        draftId: created.draft.draftId,
        draftRevision: 2,
        module,
        moduleCode: "poster_consistency",
      },
    });
    await expect(
      service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: 1,
        module,
        moduleCode: "poster_consistency",
        requestId: "request-update-draft-0002",
      }),
    ).resolves.toEqual({ kind: "revision_mismatch", currentRevision: 2 });
  });

  it("freezes one opaque version and returns it for idempotent submit retries", async () => {
    const service = deterministicService();
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-01",
      requestId: "request-create-draft-0003",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const idempotencyKey = "submit-idempotency-0001";
    const input = {
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey,
      requestId: "request-submit-draft-0001",
    };

    const submitted = await service.submitDraft(input);
    expect(submitted).toEqual({
      kind: "submitted",
      result: {
        contentVersion: "content-opaque-1",
        draftId: created.draft.draftId,
        lifecycleRevision: 1,
        state: "in_review",
      },
    });
    expect(
      submitted.kind === "submitted" ? submitted.result.contentVersion : "2026-08-01",
    ).not.toContain("2026-08-01");
    await expect(service.submitDraft(input)).resolves.toEqual({
      kind: "existing",
      result: submitted.kind === "submitted" ? submitted.result : null,
    });
    await expect(
      service.submitDraft({
        ...input,
        expectedDraftRevision: 2,
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    await expect(
      service.submitDraft({
        ...input,
        idempotencyKey: "invalid key!!!!!!!!",
      }),
    ).resolves.toEqual({ kind: "invalid_argument" });
    await expect(
      service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: 1,
        module: {
          posterTemplateVersion: "changed-after-submit",
          sampleAssetId: "asset-2",
          templateId: "template-2",
        },
        moduleCode: "poster_consistency",
        requestId: "request-update-after-submit",
      }),
    ).resolves.toEqual({ kind: "invalid_state" });

    const version = await service.getVersion("content-opaque-1");
    expect(version).toMatchObject({
      contentVersion: "content-opaque-1",
      lifecycleRevision: 1,
      snapshot: created.draft.modules,
      state: "in_review",
    });
  });

  it("requires all nine checks and complete confirmed master evidence before approval", async () => {
    const service = deterministicService();
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-complete-draft",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    let revision = 1;
    for (const moduleCode of [
      "calendar_algorithm",
      "copy_and_formula",
      "visual_and_rights",
      "poster_consistency",
    ] as const) {
      const update = await service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: revision,
        module: completeModules()[moduleCode]!,
        moduleCode,
        requestId: `request-update-${moduleCode}`,
      });
      expect(update.kind).toBe("updated");
      revision += 1;
    }
    const submitted = await service.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: revision,
      idempotencyKey: "submit-idempotency-complete",
      requestId: "request-submit-complete",
    });
    expect(submitted.kind).toBe("submitted");
    if (submitted.kind !== "submitted") return;

    const missingMaster = await service.decideReview({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      decision: "approved",
      expectedLifecycleRevision: 1,
      idempotencyKey: "approve-without-master-001",
      reason: null,
      requestId: "request-approve-without-master",
    });
    expect(missingMaster).toMatchObject({
      kind: "master_review_missing",
      preflightChecks: expect.arrayContaining([
        expect.objectContaining({ code: "master_review_evidence", status: "failed" }),
      ]),
    });
    expect(
      missingMaster.kind === "master_review_missing" ? missingMaster.preflightChecks : [],
    ).toHaveLength(9);

    await expect(
      service.addMasterReviewEvidence({
        actorId: "operator-1",
        contentVersion: submitted.result.contentVersion,
        evidence: {
          conclusion: "confirmed",
          notes: "无效日期不应入库。",
          references: [{ kind: "note", reference: "invalid-date-note" }],
          reviewedAt: "2026-02-30T22:30:00+08:00",
          reviewerDisplayName: "林老师",
        },
        expectedLifecycleRevision: 1,
        idempotencyKey: "master-invalid-date-0001",
        requestId: "request-master-invalid-date",
      }),
    ).resolves.toEqual({ kind: "invalid_argument" });

    const evidence = await service.addMasterReviewEvidence({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      evidence: {
        conclusion: "confirmed",
        notes: "已核对五行、五档与颜色关系。",
        references: [{ kind: "document", reference: "master-review-2026-08-02.pdf" }],
        reviewedAt: "2026-07-31T22:30:00+08:00",
        reviewerDisplayName: "林老师",
      },
      expectedLifecycleRevision: 1,
      idempotencyKey: "master-evidence-idempotency-001",
      requestId: "request-master-evidence-001",
    });
    expect(evidence).toMatchObject({
      kind: "added",
      version: {
        lifecycleRevision: 2,
        masterReviewEvidence: [
          expect.objectContaining({
            conclusion: "confirmed",
            evidenceId: "evidence-1",
            reviewerDisplayName: "林老师",
          }),
        ],
      },
    });
    expect(evidence.kind === "added" ? evidence.version.preflightChecks : []).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "passed" })]),
    );
    expect(
      evidence.kind === "added"
        ? evidence.version.preflightChecks.every((check) => check.status === "passed")
        : false,
    ).toBe(true);

    const approved = await service.decideReview({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      decision: "approved",
      expectedLifecycleRevision: 2,
      idempotencyKey: "approve-idempotency-complete",
      reason: null,
      requestId: "request-approve-complete",
    });
    expect(approved).toMatchObject({
      action: {
        activeContentVersion: null,
        contentVersion: submitted.result.contentVersion,
        lifecycleRevision: 3,
        state: "approved",
        transitions: [
          {
            contentVersion: submitted.result.contentVersion,
            fromState: "in_review",
            toState: "approved",
          },
        ],
      },
      kind: "applied",
    });
    expect(approved.kind).toBe("applied");
    if (approved.kind !== "applied") return;
    await expect(
      service.decideReview({
        actorId: "operator-1",
        contentVersion: submitted.result.contentVersion,
        decision: "approved",
        expectedLifecycleRevision: 2,
        idempotencyKey: "approve-idempotency-complete",
        reason: null,
        requestId: "request-approve-complete-retry",
      }),
    ).resolves.toMatchObject({ kind: "existing", action: approved.action });

    const firstAuditPage = await service.listAuditEvents({
      contentVersion: submitted.result.contentVersion,
      cursor: null,
      fortuneDate: "2026-08-02",
      limit: 2,
    });
    expect(firstAuditPage).toMatchObject({
      kind: "page",
      items: [
        expect.objectContaining({ action: "content_review_approved" }),
        expect.objectContaining({ action: "master_review_evidence_added" }),
      ],
      nextCursor: expect.any(String),
    });
    if (firstAuditPage.kind !== "page") return;
    const secondAuditPage = await service.listAuditEvents({
      contentVersion: submitted.result.contentVersion,
      cursor: firstAuditPage.nextCursor,
      fortuneDate: "2026-08-02",
      limit: 2,
    });
    expect(secondAuditPage).toMatchObject({
      kind: "page",
      items: [expect.objectContaining({ action: "content_submitted" })],
      nextCursor: null,
    });
    await expect(
      service.listAuditEvents({
        contentVersion: null,
        cursor: "tampered.invalid",
        fortuneDate: null,
        limit: 50,
      }),
    ).resolves.toEqual({ kind: "invalid_cursor" });
    const impossibleDateCursor = Buffer.from(
      JSON.stringify({
        id: "audit-forged",
        occurredAt: "2026-02-30T00:00:00.000Z",
        version: 1,
      }),
    ).toString("base64url");
    await expect(
      service.listAuditEvents({
        contentVersion: null,
        cursor: impossibleDateCursor,
        fortuneDate: null,
        limit: 50,
      }),
    ).resolves.toEqual({ kind: "invalid_cursor" });
  });

  it("reports non-master preflight failures separately", async () => {
    const service = deterministicService();
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-incomplete-draft",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const submitted = await service.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-incomplete-0001",
      requestId: "request-submit-incomplete",
    });
    expect(submitted.kind).toBe("submitted");
    if (submitted.kind !== "submitted") return;
    await service.addMasterReviewEvidence({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      evidence: {
        conclusion: "confirmed",
        notes: "仅完成大师核对。",
        references: [{ kind: "note", reference: "master-note-2026-08-04" }],
        reviewedAt: "2026-07-31T22:30:00+08:00",
        reviewerDisplayName: "林老师",
      },
      expectedLifecycleRevision: 1,
      idempotencyKey: "master-incomplete-0001",
      requestId: "request-master-incomplete",
    });

    await expect(
      service.decideReview({
        actorId: "operator-1",
        contentVersion: submitted.result.contentVersion,
        decision: "approved",
        expectedLifecycleRevision: 2,
        idempotencyKey: "approve-incomplete-0001",
        reason: null,
        requestId: "request-approve-incomplete",
      }),
    ).resolves.toMatchObject({
      kind: "required_review_missing",
      preflightChecks: expect.arrayContaining([
        expect.objectContaining({ code: "master_review_evidence", status: "passed" }),
        expect.objectContaining({ code: "required_images", status: "failed" }),
      ]),
    });
  });

  it("rejects golden-data dates outside the frozen range and duplicate required covers", () => {
    const confirmedEvidence: StoredMasterReviewEvidence[] = [
      {
        conclusion: "confirmed",
        contentVersion: "opaque-version",
        evidenceId: "evidence-1",
        notes: "确认",
        recordedAt: "2026-07-31T15:00:00.000Z",
        recordedRevision: 1,
        references: [{ kind: "note", reference: "master-note" }],
        reviewedAt: "2026-07-31T14:00:00.000Z",
        reviewerDisplayName: "林老师",
      },
    ];
    const outside = evaluateContentPreflight(completeModules(), confirmedEvidence, "2027-01-02");
    expect(outside).toContainEqual(
      expect.objectContaining({ code: "calendar_golden_data", status: "failed" }),
    );

    const duplicateCover = completeModules();
    if (duplicateCover.visual_and_rights === null) throw new Error("fixture missing visual module");
    duplicateCover.visual_and_rights.looks[1] = {
      ...duplicateCover.visual_and_rights.looks[1]!,
      coverAssetId: duplicateCover.visual_and_rights.looks[0]!.coverAssetId,
    };
    const duplicateChecks = evaluateContentPreflight(
      duplicateCover,
      confirmedEvidence,
      "2026-08-02",
    );
    expect(duplicateChecks).toContainEqual(
      expect.objectContaining({ code: "required_images", status: "failed" }),
    );
  });

  it("rejects colors that do not belong to the tier's fixed five-element palette", () => {
    const snapshot = completeModules();
    if (snapshot.calendar_algorithm === null) throw new Error("fixture missing calendar module");
    snapshot.calendar_algorithm.tiers[0] = {
      ...snapshot.calendar_algorithm.tiers[0]!,
      colors: [{ colorCode: "green", name: "绿色" }],
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "calendar_algorithm", status: "failed" }),
    );
  });

  it("rejects public tier labels that disagree with the tier code and rank", () => {
    const snapshot = completeModules();
    if (snapshot.calendar_algorithm === null) throw new Error("fixture missing calendar module");
    snapshot.calendar_algorithm.tiers[3] = {
      ...snapshot.calendar_algorithm.tiers[3]!,
      algorithmLabel: "不利",
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "calendar_algorithm", status: "failed" }),
    );
  });

  it("rejects formula sets that do not contain mono, dual, and triple choices", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    snapshot.copy_and_formula.outfitFormulas = snapshot.copy_and_formula.outfitFormulas.map(
      (formula) => ({ ...formula, kind: "mono", slots: [formula.slots[0]!] }),
    );

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "copy_and_formula", status: "failed" }),
    );
  });

  it("rejects formulas whose slot count does not match mono, dual, or triple", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    const dual = snapshot.copy_and_formula.outfitFormulas.find(
      (formula) => formula.kind === "dual",
    );
    if (dual === undefined) throw new Error("fixture missing dual formula");
    dual.slots = [dual.slots[0]!];

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "copy_and_formula", status: "failed" }),
    );
  });

  it("rejects a mono formula that is not a primary great-fortune color", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    const mono = snapshot.copy_and_formula.outfitFormulas.find(
      (formula) => formula.kind === "mono",
    );
    if (mono === undefined) throw new Error("fixture missing mono formula");
    mono.slots[0] = {
      ...mono.slots[0]!,
      colorCodes: ["green"],
      role: "accent",
      roleLabel: "点缀色",
      tierCode: "bu_li",
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "copy_and_formula", status: "failed" }),
    );
  });

  it("rejects a dual formula that is not great-fortune paired with secondary or neutral", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    const dual = snapshot.copy_and_formula.outfitFormulas.find(
      (formula) => formula.kind === "dual",
    );
    if (dual === undefined) throw new Error("fixture missing dual formula");
    dual.slots[1] = {
      ...dual.slots[1]!,
      colorCodes: ["green"],
      role: "accent",
      roleLabel: "点缀色",
      tierCode: "bu_li",
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "copy_and_formula", status: "failed" }),
    );
  });

  it("rejects a triple formula whose declared ratios do not total one hundred", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    const triple = snapshot.copy_and_formula.outfitFormulas.find(
      (formula) => formula.kind === "triple",
    );
    if (triple === undefined) throw new Error("fixture missing triple formula");
    triple.slots[2] = { ...triple.slots[2]!, ratioPercent: 20 };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "copy_and_formula", status: "failed" }),
    );
  });

  it("rejects a formula that points at a missing or mismatched look", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    snapshot.copy_and_formula.outfitFormulas[0] = {
      ...snapshot.copy_and_formula.outfitFormulas[0]!,
      lookIds: ["look-missing"],
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "reference_integrity", status: "failed" }),
    );
  });

  it("rejects formula colors that are not declared by their referenced tiers", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    snapshot.copy_and_formula.outfitFormulas[0]!.slots[0] = {
      ...snapshot.copy_and_formula.outfitFormulas[0]!.slots[0]!,
      colorCodes: ["green"],
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "reference_integrity", status: "failed" }),
    );
  });

  it("rejects a look color that is not declared by its linked formula", () => {
    const snapshot = completeModules();
    if (snapshot.visual_and_rights === null) throw new Error("fixture missing visual module");
    snapshot.visual_and_rights.looks[0]!.items[0] = {
      ...snapshot.visual_and_rights.looks[0]!.items[0]!,
      colorCode: "green",
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "reference_integrity", status: "failed" }),
    );
  });

  it("rejects a look that references an unusable detail asset", () => {
    const snapshot = completeModules();
    if (snapshot.visual_and_rights === null) throw new Error("fixture missing visual module");
    const sourceAsset = snapshot.visual_and_rights.assets[0];
    if (sourceAsset === undefined) throw new Error("fixture missing source asset");
    snapshot.visual_and_rights.assets.push({
      ...sourceAsset,
      assetId: "asset-detail-unusable",
      fileUrl: null,
      sha256: "3".repeat(64),
    });
    snapshot.visual_and_rights.looks[0] = {
      ...snapshot.visual_and_rights.looks[0]!,
      detailAssetIds: ["asset-detail-unusable"],
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "reference_integrity", status: "failed" }),
    );
  });

  it("rejects a poster sample whose template version differs from share copy", () => {
    const snapshot = completeModules();
    if (snapshot.poster_consistency === null) throw new Error("fixture missing poster module");
    snapshot.poster_consistency.posterTemplateVersion = "poster-v2";

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "poster_consistency", status: "failed" }),
    );
  });

  it("returns every resumable draft without a hidden five-hundred-row cutoff", async () => {
    const service = deterministicService();
    for (let index = 0; index < 501; index += 1) {
      const created = await service.createDraft({
        actorId: "operator-1",
        copyFromContentVersion: null,
        fortuneDate: "2026-08-05",
        requestId: `request-bulk-draft-${index.toString().padStart(4, "0")}`,
      });
      expect(created.kind).toBe("created");
    }
    expect((await service.listDrafts("2026-08-05")).items).toHaveLength(501);
  });

  it("copies a rejected immutable snapshot only through an explicit new-draft request", async () => {
    const service = deterministicService();
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-rejected-draft",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const updated = await service.updateDraftModule({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      module: completeModules().copy_and_formula!,
      moduleCode: "copy_and_formula",
      requestId: "request-update-rejected-draft",
    });
    expect(updated.kind).toBe("updated");
    const submitted = await service.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 2,
      idempotencyKey: "submit-idempotency-rejected",
      requestId: "request-submit-rejected",
    });
    expect(submitted.kind).toBe("submitted");
    if (submitted.kind !== "submitted") return;

    await expect(
      service.decideReview({
        actorId: "operator-1",
        contentVersion: submitted.result.contentVersion,
        decision: "changes_requested",
        expectedLifecycleRevision: 1,
        idempotencyKey: "reject-idempotency-no-reason",
        reason: "   ",
        requestId: "request-reject-no-reason",
      }),
    ).resolves.toEqual({ kind: "invalid_argument" });
    const rejected = await service.decideReview({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      decision: "changes_requested",
      expectedLifecycleRevision: 1,
      idempotencyKey: "reject-idempotency-with-reason",
      reason: "大师要求重新核对五档颜色关系。",
      requestId: "request-reject-with-reason",
    });
    expect(rejected).toMatchObject({
      action: { lifecycleRevision: 2, state: "changes_requested" },
      kind: "applied",
    });
    await expect(service.listDrafts("2026-08-03")).resolves.toEqual({ items: [] });
    await service.decideReview({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      decision: "changes_requested",
      expectedLifecycleRevision: 1,
      idempotencyKey: "reject-idempotency-with-reason",
      reason: "大师要求重新核对五档颜色关系。",
      requestId: "request-reject-with-reason-retry",
    });
    await expect(service.listDrafts("2026-08-03")).resolves.toEqual({ items: [] });
    const copy = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: submitted.result.contentVersion,
      fortuneDate: "2026-08-03",
      requestId: "request-copy-rejected-version",
    });
    expect(copy).toMatchObject({
      draft: { draftId: "draft-2", draftRevision: 1 },
      kind: "created",
    });
    const copied = await service.getDraft("draft-2");
    expect(copied?.modules).toEqual(
      (await service.getVersion(submitted.result.contentVersion))?.snapshot,
    );
    const changedCopy = await service.updateDraftModule({
      actorId: "operator-1",
      draftId: "draft-2",
      expectedDraftRevision: 1,
      module: completeModules().poster_consistency!,
      moduleCode: "poster_consistency",
      requestId: "request-edit-copied-draft",
    });
    expect(changedCopy.kind).toBe("updated");
    expect(
      (await service.getVersion(submitted.result.contentVersion))?.snapshot.poster_consistency,
    ).toBe(null);
    expect((await service.listDrafts("2026-08-03")).items).toHaveLength(1);
  });
});
