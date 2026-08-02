import { describe, expect, it } from "vitest";

import {
  isCreateDraftRequest,
  isDraftModuleUpdate,
  isExpectedActiveVersionRequest,
  isIdempotencyKey,
  isMasterReviewEvidenceRequest,
  isRollbackRequest,
  isReviewDecisionRequest,
  isScheduleRequest,
  isWithdrawRequest,
  parseStrongRevisionEtag,
} from "./admin-content.validation";

describe("admin content HTTP validation", () => {
  it("requires a real fortune date and the exact create-draft shape", () => {
    expect(isCreateDraftRequest({ copyFromContentVersion: null, fortuneDate: "2026-07-15" })).toBe(
      true,
    );
    expect(isCreateDraftRequest({ copyFromContentVersion: null, fortuneDate: "2026-02-30" })).toBe(
      false,
    );
    expect(
      isCreateDraftRequest({
        copyFromContentVersion: null,
        fortuneDate: "2026-07-15",
        operator: "forged",
      }),
    ).toBe(false);
  });

  it("matches a module payload to the module selected by the path", () => {
    const poster = {
      posterTemplateVersion: "poster-v1",
      sampleAssetId: "sample-1",
      templateId: "template-1",
    };
    expect(isDraftModuleUpdate("poster_consistency", poster)).toBe(true);
    expect(isDraftModuleUpdate("calendar_algorithm", poster)).toBe(false);
    expect(isDraftModuleUpdate("poster_consistency", { ...poster, extra: true })).toBe(false);
  });

  it("rejects malformed nested data in every draft module", () => {
    expect(
      isDraftModuleUpdate("calendar_algorithm", {
        algorithmVersion: "algorithm-v1",
        calendar: {},
        calendarDataVersion: "data-v1",
        calendarRuleVersion: "rule-v1",
        tiers: [{}, {}, {}, {}, {}],
      }),
    ).toBe(false);
    expect(
      isDraftModuleUpdate("copy_and_formula", {
        balanceSuggestion: {},
        basis: {},
        copyVersion: "copy-v1",
        outfitFormulas: [{}, {}, {}],
        outfitVersion: "outfit-v1",
        share: {},
      }),
    ).toBe(false);
    expect(
      isDraftModuleUpdate("visual_and_rights", {
        assetManifestVersion: "assets-v1",
        assets: [{}, {}],
        looks: [{}, {}],
        rightsRecords: [],
      }),
    ).toBe(false);
    expect(
      isDraftModuleUpdate("poster_consistency", {
        posterTemplateVersion: "poster-v1",
        sampleAssetId: "",
        templateId: "",
      }),
    ).toBe(false);
  });

  it("requires complete, traceable master evidence", () => {
    expect(
      isMasterReviewEvidenceRequest({
        conclusion: "confirmed",
        notes: "已核对日柱、五档和颜色关系。",
        references: [{ kind: "message_link", reference: "evidence/message-01" }],
        reviewedAt: "2026-07-31T20:00:00+08:00",
        reviewerDisplayName: "林老师",
      }),
    ).toBe(true);
    expect(
      isMasterReviewEvidenceRequest({
        conclusion: "confirmed",
        notes: "",
        references: [],
        reviewedAt: "2026-07-31T20:00:00+08:00",
        reviewerDisplayName: "林老师",
      }),
    ).toBe(false);
    expect(
      isMasterReviewEvidenceRequest({
        conclusion: "confirmed",
        notes: "",
        references: [{ kind: "note", reference: "note-01" }],
        reviewedAt: "2026-07-31T12:00:00",
        reviewerDisplayName: "林老师",
      }),
    ).toBe(false);
    expect(
      isMasterReviewEvidenceRequest({
        conclusion: "confirmed",
        notes: "",
        references: [{ kind: "note", reference: "note-01" }],
        reviewedAt: "2026-02-30T20:00:00+08:00",
        reviewerDisplayName: "林老师",
      }),
    ).toBe(false);
    expect(
      isMasterReviewEvidenceRequest({
        conclusion: "confirmed",
        notes: "",
        references: [{ kind: "note", reference: "note-01" }],
        reviewedAt: "2026-07-31T20:00+08:00",
        reviewerDisplayName: "林老师",
      }),
    ).toBe(false);
  });

  it("requires a reason only when review requests changes", () => {
    expect(isReviewDecisionRequest({ decision: "approved", reason: null })).toBe(true);
    expect(
      isReviewDecisionRequest({ decision: "changes_requested", reason: "五档顺序需重核" }),
    ).toBe(true);
    expect(isReviewDecisionRequest({ decision: "changes_requested", reason: "  " })).toBe(false);
  });

  it("validates lifecycle action bodies without accepting forged fields", () => {
    expect(
      isExpectedActiveVersionRequest({
        expectedActiveContentVersion: "content-current",
        reason: "立即发布已核对版本。",
      }),
    ).toBe(true);
    expect(
      isExpectedActiveVersionRequest({
        expectedActiveContentVersion: null,
        reason: "  ",
      }),
    ).toBe(false);
    expect(
      isScheduleRequest({
        effectiveFrom: "2026-08-01T23:00:00+08:00",
        expectedActiveContentVersion: null,
        reason: "按内容生效时间自动发布。",
      }),
    ).toBe(true);
    expect(
      isScheduleRequest({
        effectiveFrom: "2026-08-01T23:00:00",
        expectedActiveContentVersion: null,
        reason: "缺少时区。",
      }),
    ).toBe(false);
    expect(
      isWithdrawRequest({
        expectedActiveContentVersion: "content-current",
        reason: "发现权利风险，立即下线。",
        replacementContentVersion: "content-safe",
      }),
    ).toBe(true);
    expect(
      isRollbackRequest({
        expectedActiveContentVersion: "content-current",
        reason: "恢复同日已发布的安全版本。",
        targetContentVersion: "content-safe",
      }),
    ).toBe(true);
    expect(
      isRollbackRequest({
        expectedActiveContentVersion: "content-current",
        reason: "恢复同日已发布的安全版本。",
        targetContentVersion: "content-safe",
        fortuneDate: "2026-08-02",
      }),
    ).toBe(false);
  });

  it("accepts only strong resource-specific ETags and bounded idempotency keys", () => {
    expect(parseStrongRevisionEtag('"draft:7"', "draft")).toBe(7);
    expect(parseStrongRevisionEtag('W/"draft:7"', "draft")).toBeNull();
    expect(parseStrongRevisionEtag('"lifecycle:7"', "draft")).toBeNull();
    expect(isIdempotencyKey("content-action-0001")).toBe(true);
    expect(isIdempotencyKey("short")).toBe(false);
  });
});
