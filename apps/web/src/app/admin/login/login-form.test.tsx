import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminJsonResponse } from "../admin-test-responses";
import { LoginForm } from "./login-form";

const minimumPassword = "Passw0rd";
const sessionResponse = {
  absoluteExpiresAt: "2026-07-31T20:00:00+08:00",
  credentialRevision: 3,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: "2026-07-31T08:30:00+08:00",
  issuedAt: "2026-07-31T08:00:00+08:00",
  username: "maintainer",
};

describe("LoginForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates the session with one username and password submission", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(createAdminJsonResponse(sessionResponse, { status: 201 }));
    const onAuthenticated = vi.fn();
    const localStorageSpy = vi.spyOn(Storage.prototype, "setItem");

    render(<LoginForm onAuthenticated={onAuthenticated} />);
    fireEvent.change(screen.getByLabelText("管理员账号"), {
      target: { value: "MainTainer" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: minimumPassword },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录后台" }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(sessionResponse));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/api/v1/auth/sessions",
      expect.objectContaining({
        body: JSON.stringify({
          password: minimumPassword,
          username: "MainTainer",
        }),
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      }),
    );
    expect(screen.queryByLabelText("六位动态码")).not.toBeInTheDocument();
    expect(localStorageSpy).not.toHaveBeenCalled();
  });

  it("keeps credential failures generic and explains rate limits", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { headers: { "Retry-After": "42" }, status: 429 }));
    render(<LoginForm onAuthenticated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("管理员账号"), { target: { value: "unknown" } });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "incorrect password value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录后台" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("账号或密码无效");

    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "another incorrect password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录后台" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("42 秒后再试");
  });

  it.each(["1234567", "😀".repeat(129)])(
    "validates the password length in Unicode code points before sending",
    async (password) => {
      const fetchMock = vi.mocked(fetch);
      render(<LoginForm onAuthenticated={vi.fn()} />);
      fireEvent.change(screen.getByLabelText("管理员账号"), {
        target: { value: "MainTainer" },
      });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: password } });

      fireEvent.click(screen.getByRole("button", { name: "登录后台" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("8 至 128 个 Unicode 字符");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
