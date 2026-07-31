import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminJsonResponse } from "../admin-test-responses";
import { LoginForm } from "./login-form";

const maximumUnicodePassword = "😀".repeat(128);

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

  it("completes password then TOTP without persisting credentials or challenges", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        createAdminJsonResponse({
          challengeToken: "challenge-token-that-is-longer-than-thirty-two-characters",
          expiresAt: "2026-07-31T08:05:00+08:00",
        }),
      )
      .mockResolvedValueOnce(createAdminJsonResponse(sessionResponse, { status: 201 }));
    const onAuthenticated = vi.fn();
    const localStorageSpy = vi.spyOn(Storage.prototype, "setItem");

    render(<LoginForm onAuthenticated={onAuthenticated} />);
    expect(screen.getByLabelText("管理员账号")).toHaveAttribute(
      "pattern",
      "[A-Za-z0-9][A-Za-z0-9._\\-]*",
    );
    fireEvent.change(screen.getByLabelText("管理员账号"), {
      target: { value: "MainTainer" },
    });
    expect(screen.getByLabelText("密码")).not.toHaveAttribute("minlength");
    expect(screen.getByLabelText("密码")).not.toHaveAttribute("maxlength");
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: maximumUnicodePassword },
    });
    fireEvent.click(screen.getByRole("button", { name: "继续验证" }));

    expect(await screen.findByLabelText("六位动态码")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/admin/api/v1/auth/password-challenges",
      expect.objectContaining({
        body: JSON.stringify({
          password: maximumUnicodePassword,
          username: "MainTainer",
        }),
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      }),
    );
    expect(screen.getByLabelText("六位动态码")).toHaveAttribute("inputmode", "numeric");

    fireEvent.change(screen.getByLabelText("六位动态码"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "进入后台" }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(sessionResponse));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/admin/api/v1/auth/sessions",
      expect.objectContaining({
        body: JSON.stringify({
          challengeToken: "challenge-token-that-is-longer-than-thirty-two-characters",
          totpCode: "123456",
        }),
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      }),
    );
    expect(localStorageSpy).not.toHaveBeenCalled();
  });

  it("keeps the first step generic when credentials fail and explains rate limits", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { headers: { "Retry-After": "42" }, status: 429 }));
    render(<LoginForm onAuthenticated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("管理员账号"), { target: { value: "unknown" } });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "incorrect password value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "继续验证" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("账号、密码、动态码或恢复凭据无效");
    expect(screen.queryByLabelText("六位动态码")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "another incorrect password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "继续验证" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("42 秒后再试");
  });

  it("forgets an in-progress challenge when the page enters browser history", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      createAdminJsonResponse({
        challengeToken: "challenge-token-that-is-longer-than-thirty-two-characters",
        expiresAt: "2026-07-31T08:05:00+08:00",
      }),
    );
    render(<LoginForm onAuthenticated={vi.fn()} />);
    expect(screen.getByLabelText("密码")).not.toHaveAttribute("maxlength");
    fireEvent.change(screen.getByLabelText("管理员账号"), {
      target: { value: "maintainer" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "继续验证" }));
    await screen.findByLabelText("六位动态码");

    window.dispatchEvent(new Event("pagehide"));

    expect(await screen.findByLabelText("密码")).toHaveValue("");
    expect(screen.queryByLabelText("六位动态码")).not.toBeInTheDocument();
  });

  it.each(["short-password", "😀".repeat(129)])(
    "validates the password length in Unicode code points before sending",
    async (password) => {
      const fetchMock = vi.mocked(fetch);
      render(<LoginForm onAuthenticated={vi.fn()} />);
      fireEvent.change(screen.getByLabelText("管理员账号"), {
        target: { value: "MainTainer" },
      });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: password } });

      fireEvent.click(screen.getByRole("button", { name: "继续验证" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("16 至 128 个 Unicode 字符");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
