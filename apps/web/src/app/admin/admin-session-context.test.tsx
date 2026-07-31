import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminSession } from "./admin-api";
import { AdminSessionProvider, useAdminSession } from "./admin-session-context";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Request-Id": "request-context-test",
    },
    status,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

const testNowMs = Date.now();

const oldSession: AdminSession = {
  absoluteExpiresAt: new Date(testNowMs + 12 * 60 * 60 * 1000).toISOString(),
  credentialRevision: 3,
  csrfToken: "old-csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: new Date(testNowMs + 30 * 60 * 1000).toISOString(),
  issuedAt: new Date(testNowMs).toISOString(),
  username: "old-maintainer",
};

const adoptedSession: AdminSession = {
  ...oldSession,
  credentialRevision: 4,
  csrfToken: "new-csrf-token-that-is-longer-than-thirty-two-characters",
  username: "new-maintainer",
};

function SessionProbe() {
  const { adoptSession, refreshSession, state } = useAdminSession();
  return (
    <div>
      <output>{state.kind === "authenticated" ? state.session.username : state.kind}</output>
      <button onClick={() => adoptSession(adoptedSession)} type="button">
        adopt session
      </button>
      <button onClick={() => void refreshSession()} type="button">
        refresh session
      </button>
    </div>
  );
}

describe("AdminSessionProvider", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not let an older session GET overwrite a newly adopted login", async () => {
    const pendingGet = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pendingGet.promise);
    render(
      <AdminSessionProvider>
        <SessionProbe />
      </AdminSessionProvider>,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "adopt session" }));
    expect(screen.getByText("new-maintainer")).toBeInTheDocument();
    pendingGet.resolve(jsonResponse(oldSession));
    await act(async () => undefined);

    expect(screen.getByText("new-maintainer")).toBeInTheDocument();
    expect(screen.queryByText("old-maintainer")).not.toBeInTheDocument();
  });

  it("masks the session at the earliest expiry and only then revalidates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-31T08:00:00.000Z");
    const expiringSession: AdminSession = {
      ...oldSession,
      absoluteExpiresAt: "2026-07-31T16:00:00.000Z",
      idleExpiresAt: "2026-07-31T08:00:01.000Z",
      issuedAt: "2026-07-31T08:00:00.000Z",
      username: "maintainer",
    };
    const revalidation = deferred<Response>();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(expiringSession))
      .mockReturnValueOnce(revalidation.promise);
    render(
      <AdminSessionProvider>
        <SessionProbe />
      </AdminSessionProvider>,
    );
    await act(async () => undefined);
    expect(screen.getByText("maintainer")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(999));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("maintainer")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.queryByText("maintainer")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);

    revalidation.resolve(jsonResponse({ error: {} }, 401));
    await act(async () => undefined);
    expect(screen.getByText("unauthenticated")).toBeInTheDocument();
  });

  it("masks an overdue session as soon as a throttled background tab becomes visible", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-07-31T08:00:00.000Z");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const expiringSession: AdminSession = {
      ...oldSession,
      absoluteExpiresAt: "2026-07-31T16:00:00.000Z",
      idleExpiresAt: "2026-07-31T08:00:01.000Z",
      issuedAt: "2026-07-31T08:00:00.000Z",
      username: "maintainer",
    };
    const revalidation = deferred<Response>();
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(expiringSession))
      .mockReturnValueOnce(revalidation.promise);
    render(
      <AdminSessionProvider>
        <SessionProbe />
      </AdminSessionProvider>,
    );
    await act(async () => undefined);
    expect(screen.getByText("maintainer")).toBeInTheDocument();

    vi.setSystemTime("2026-07-31T08:30:00.000Z");
    fireEvent(document, new Event("visibilitychange"));

    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.queryByText("maintainer")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);

    revalidation.resolve(jsonResponse({ error: {} }, 401));
    await act(async () => undefined);
    expect(screen.getByText("unauthenticated")).toBeInTheDocument();
  });
});
