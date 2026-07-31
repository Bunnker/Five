import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminNavigationGuard } from "../admin-navigation-guard";
import { createAdminJsonResponse } from "../admin-test-responses";
import { RecoveryForm } from "./recovery-form";

const challengeToken = "recovery-challenge-that-is-longer-than-thirty-two-characters";
const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const maximumUnicodePassword = "🧧".repeat(128);
const session = {
  absoluteExpiresAt: "2026-07-31T20:00:00+08:00",
  credentialRevision: 4,
  csrfToken: "replacement-csrf-token-longer-than-thirty-two-characters",
  idleExpiresAt: "2026-07-31T08:30:00+08:00",
  issuedAt: "2026-07-31T08:00:00+08:00",
  username: "maintainer",
};
const recoveryCodes = Array.from(
  { length: 10 },
  (_, index) => `FIVE-NEW-${String(index + 1).padStart(2, "0")}-RECOVERY-CODE`,
);

describe("RecoveryForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("replaces credentials in two stages and shows ten one-time codes only in memory", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        createAdminJsonResponse({
          challengeToken,
          expiresAt: "2026-07-31T08:10:00+08:00",
          totpProvisioning: {
            algorithm: "SHA1",
            digits: 6,
            otpauthUri: `otpauth://totp/Five:maintainer?secret=${secret}&issuer=Five`,
            periodSeconds: 30,
            secret,
          },
        }),
      )
      .mockResolvedValueOnce(createAdminJsonResponse({ recoveryCodes, session }, { status: 201 }));
    const onRecovered = vi.fn();
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const sharedNavigationSpy = vi.fn();
    render(
      <AdminNavigationGuard>
        <a
          href="/admin/security"
          onClick={(event) => {
            event.preventDefault();
            sharedNavigationSpy();
          }}
        >
          安全记录
        </a>
        <RecoveryForm onRecovered={onRecovered} />
      </AdminNavigationGuard>,
    );

    expect(screen.getByLabelText("管理员账号")).toHaveAttribute(
      "pattern",
      "[A-Za-z0-9][A-Za-z0-9._\\-]*",
    );
    fireEvent.change(screen.getByLabelText("管理员账号"), {
      target: { value: "MainTainer" },
    });
    fireEvent.change(screen.getByLabelText("一次性恢复码"), {
      target: { value: "FIVE-OLD-RECOVERY-CODE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始恢复" }));

    expect(await screen.findByText(secret)).toBeInTheDocument();
    expect(screen.getByLabelText("新密码")).not.toHaveAttribute("maxlength");
    expect(screen.getByLabelText("再次输入新密码")).not.toHaveAttribute("maxlength");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/admin/api/v1/auth/recovery-challenges",
      expect.objectContaining({
        body: JSON.stringify({
          recoveryCode: "FIVE-OLD-RECOVERY-CODE",
          username: "MainTainer",
        }),
        method: "POST",
      }),
    );
    expect(screen.queryByRole("link", { name: /otpauth/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: maximumUnicodePassword },
    });
    fireEvent.change(screen.getByLabelText("再次输入新密码"), {
      target: { value: maximumUnicodePassword },
    });
    fireEvent.change(screen.getByLabelText("新验证器六位动态码"), {
      target: { value: "654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成恢复" }));

    const codeList = await screen.findByRole("list", { name: "新恢复码" });
    expect(within(codeList).getAllByRole("listitem")).toHaveLength(10);
    expect(onRecovered).toHaveBeenCalledWith(session);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/admin/api/v1/auth/recovery-completions",
      expect.objectContaining({
        body: JSON.stringify({
          challengeToken,
          newPassword: maximumUnicodePassword,
          totpCode: "654321",
        }),
        method: "POST",
      }),
    );
    expect(storageSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "进入控制台" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(screen.getByRole("link", { name: "安全记录" }));
    expect(sharedNavigationSpy).not.toHaveBeenCalled();
    const blockedUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(blockedUnload);
    expect(blockedUnload.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /已经离线保存/ }));
    expect(screen.getByRole("link", { name: "进入控制台" })).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByRole("link", { name: "安全记录" }));
    expect(sharedNavigationSpy).toHaveBeenCalledTimes(1);
    const allowedUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(allowedUnload);
    expect(allowedUnload.defaultPrevented).toBe(false);
  });

  it("does not send mismatched new passwords", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      createAdminJsonResponse({
        challengeToken,
        expiresAt: "2026-07-31T08:10:00+08:00",
        totpProvisioning: {
          algorithm: "SHA1",
          digits: 6,
          otpauthUri: `otpauth://totp/Five:maintainer?secret=${secret}&issuer=Five`,
          periodSeconds: 30,
          secret,
        },
      }),
    );
    render(
      <AdminNavigationGuard>
        <RecoveryForm onRecovered={vi.fn()} />
      </AdminNavigationGuard>,
    );
    fireEvent.change(screen.getByLabelText("管理员账号"), {
      target: { value: "maintainer" },
    });
    fireEvent.change(screen.getByLabelText("一次性恢复码"), {
      target: { value: "FIVE-OLD-RECOVERY-CODE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始恢复" }));
    await screen.findByText(secret);

    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "new correct horse battery staple" },
    });
    fireEvent.change(screen.getByLabelText("再次输入新密码"), {
      target: { value: "not the same password at all" },
    });
    fireEvent.change(screen.getByLabelText("新验证器六位动态码"), {
      target: { value: "654321" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成恢复" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("两次输入的新密码不一致");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
