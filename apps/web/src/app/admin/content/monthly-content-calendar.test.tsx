import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminJsonResponse } from "../admin-test-responses";
import { MonthlyContentCalendar } from "./monthly-content-calendar";

const now = Date.now();
const session = {
  absoluteExpiresAt: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
  credentialRevision: 1,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
  issuedAt: new Date(now).toISOString(),
  username: "maintainer",
};

describe("MonthlyContentCalendar", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows an empty day visually and starts automatic production from that day", async () => {
    const onProductionCreated = vi.fn();
    const today = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(new Date());
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes("daily-content-versions")) {
        return Promise.resolve(
          createAdminJsonResponse({ activeContentVersion: null, fortuneDate: today, items: [] }),
        );
      }
      if (url.includes("daily-content-productions") && init?.method === "POST") {
        return Promise.resolve(
          createAdminJsonResponse(
            {
              completedImageSlots: 0,
              draftId: "generated-draft",
              draftRevision: 1,
              fortuneDate: today,
              imageSlots: [
                {
                  attemptLimit: 3,
                  attempts: 0,
                  canRetry: false,
                  deliveryReady: false,
                  imageSlot: "required_primary",
                  lastError: null,
                  nextAttemptAt: null,
                  status: "pending",
                },
                {
                  attemptLimit: 3,
                  attempts: 0,
                  canRetry: false,
                  deliveryReady: false,
                  imageSlot: "required_alternative",
                  lastError: null,
                  nextAttemptAt: null,
                  status: "pending",
                },
                {
                  attemptLimit: 0,
                  attempts: 0,
                  canRetry: false,
                  deliveryReady: false,
                  imageSlot: "optional",
                  lastError: null,
                  nextAttemptAt: null,
                  status: "not_requested",
                },
              ],
              lastError: null,
              optionalImageStatus: "not_requested",
              pendingImageSlots: 2,
              requiredGenerationComplete: false,
              requiredImagesReady: false,
              status: "generating",
              updatedAt: new Date().toISOString(),
            },
            { status: 202 },
          ),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <MonthlyContentCalendar
        drafts={[]}
        onProductionCreated={onProductionCreated}
        onUnauthorized={vi.fn()}
        productions={[]}
        session={session}
      />,
    );

    expect(await screen.findByText("这一天还没有内容")).toBeVisible();
    expect(screen.getByRole("button", { name: `${today}，未准备` })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "生成这一天" }));

    await waitFor(() =>
      expect(onProductionCreated).toHaveBeenCalledWith(
        expect.objectContaining({ draftId: "generated-draft", fortuneDate: today }),
      ),
    );
    const productionRequest = vi
      .mocked(fetch)
      .mock.calls.find(([, init]) => init?.method === "POST")?.[1];
    expect(JSON.parse(String(productionRequest?.body))).toEqual({ fortuneDate: today });
  });

  it("falls back to the published version after an automatic draft has been submitted", async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(new Date());
    const contentVersion = "content-calendar-published-0001";
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes("daily-content-versions?")) {
        return Promise.resolve(
          createAdminJsonResponse({
            activeContentVersion: contentVersion,
            fortuneDate: today,
            items: [
              {
                contentVersion,
                createdAt: "2026-08-03T08:00:00.000Z",
                effectiveFrom: "2026-08-03T08:01:00.000Z",
                effectiveTo: null,
                lifecycleRevision: 4,
                state: "published",
              },
            ],
          }),
        );
      }
      if (url.includes("daily-content-drafts/generated-draft/image-assets")) {
        return Promise.resolve(createAdminJsonResponse({}, { status: 404 }));
      }
      if (url.endsWith("daily-content-drafts/generated-draft")) {
        return Promise.resolve(createAdminJsonResponse({}, { status: 404 }));
      }
      if (url.endsWith(`/daily-content-versions/${contentVersion}/daily-image-set`)) {
        return Promise.resolve(createAdminJsonResponse({}, { status: 404 }));
      }
      if (url.endsWith(`/daily-content-versions/${contentVersion}`)) {
        return Promise.resolve(
          createAdminJsonResponse(
            {
              activeContentVersion: contentVersion,
              contentVersion,
              fortuneDate: today,
              lifecycleRevision: 4,
              masterReviewEvidence: [],
              preflightChecks: [],
              snapshot: {
                calendar_algorithm: null,
                copy_and_formula: null,
                poster_consistency: null,
                visual_and_rights: null,
              },
              state: "published",
            },
            { headers: { ETag: '"lifecycle:4"' } },
          ),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <MonthlyContentCalendar
        drafts={[]}
        onProductionCreated={vi.fn()}
        onUnauthorized={vi.fn()}
        productions={[
          {
            completedImageSlots: 2,
            draftId: "generated-draft",
            draftRevision: 4,
            fortuneDate: today,
            imageSlots: [
              {
                attemptLimit: 3,
                attempts: 1,
                canRetry: false,
                deliveryReady: true,
                imageSlot: "required_primary",
                lastError: null,
                nextAttemptAt: null,
                status: "ready",
              },
              {
                attemptLimit: 3,
                attempts: 1,
                canRetry: false,
                deliveryReady: true,
                imageSlot: "required_alternative",
                lastError: null,
                nextAttemptAt: null,
                status: "ready",
              },
              {
                attemptLimit: 3,
                attempts: 1,
                canRetry: false,
                deliveryReady: true,
                imageSlot: "optional",
                lastError: null,
                nextAttemptAt: null,
                status: "ready",
              },
            ],
            lastError: null,
            optionalImageStatus: "ready",
            pendingImageSlots: 0,
            requiredGenerationComplete: true,
            requiredImagesReady: true,
            status: "awaiting_review",
            updatedAt: "2026-08-03T08:01:00.000Z",
          },
        ]}
        session={session}
      />,
    );

    expect(await screen.findByText("不可变版本")).toBeVisible();
    expect(screen.getByRole("link", { name: /content-calendar-p/ })).toHaveAttribute(
      "href",
      `/admin/content/versions/${contentVersion}`,
    );
    expect(screen.queryByText("没有找到这份草稿或内容版本")).not.toBeInTheDocument();
  });
});
