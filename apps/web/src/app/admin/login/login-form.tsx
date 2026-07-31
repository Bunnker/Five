"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  adminApi,
  describeAdminApiError,
  type AdminSession,
  type PasswordChallenge,
} from "../admin-api";
import {
  ADMIN_PASSWORD_LENGTH_MESSAGE,
  ADMIN_USERNAME_INPUT_PATTERN,
  isAdminPasswordLengthValid,
} from "../admin-credentials";

type LoginFormProps = {
  onAuthenticated: (session: AdminSession) => void;
};

type FormState = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };

export function LoginForm({ onAuthenticated }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [challenge, setChallenge] = useState<PasswordChallenge | null>(null);
  const [formState, setFormState] = useState<FormState>({ kind: "idle" });
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const forgetSecrets = () => {
      setPassword("");
      setTotpCode("");
      setChallenge(null);
      setFormState({ kind: "idle" });
    };
    const forgetRestoredSecrets = (event: PageTransitionEvent) => {
      if (event.persisted) forgetSecrets();
    };
    window.addEventListener("pagehide", forgetSecrets);
    window.addEventListener("pageshow", forgetRestoredSecrets);
    return () => {
      window.removeEventListener("pagehide", forgetSecrets);
      window.removeEventListener("pageshow", forgetRestoredSecrets);
    };
  }, []);

  function changeStep() {
    setChallenge(null);
    setTotpCode("");
    setFormState({ kind: "idle" });
    requestAnimationFrame(() => passwordInput.current?.focus());
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formState.kind === "submitting") return;
    if (!isAdminPasswordLengthValid(password)) {
      setFormState({ kind: "error", message: ADMIN_PASSWORD_LENGTH_MESSAGE });
      return;
    }
    setFormState({ kind: "submitting" });

    const result = await adminApi.createPasswordChallenge({ password, username: username.trim() });
    setPassword("");
    if (!result.ok) {
      setFormState({ kind: "error", message: describeAdminApiError(result.error) });
      return;
    }

    setChallenge(result.data);
    setFormState({ kind: "idle" });
  }

  async function submitTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formState.kind === "submitting" || challenge === null) return;
    if (!/^\d{6}$/u.test(totpCode)) {
      setFormState({ kind: "error", message: "请输入验证器显示的六位动态码。" });
      return;
    }

    setFormState({ kind: "submitting" });
    const result = await adminApi.createSession({
      challengeToken: challenge.challengeToken,
      totpCode,
    });
    setTotpCode("");
    if (!result.ok) {
      setFormState({ kind: "error", message: describeAdminApiError(result.error) });
      return;
    }

    setChallenge(null);
    onAuthenticated(result.data);
  }

  const busy = formState.kind === "submitting";

  return (
    <section className="admin-auth-card" aria-labelledby="admin-login-title">
      <div className="admin-auth-card__index" aria-hidden="true">
        {challenge === null ? "壹" : "贰"}
      </div>
      <div className="admin-auth-card__heading">
        <p className="admin-kicker">CONTROL DESK · 双重验证</p>
        <h1 id="admin-login-title">{challenge === null ? "维护者登录" : "确认动态码"}</h1>
        <p>
          {challenge === null
            ? "先核验唯一维护者账号与密码，再用验证器完成第二步。"
            : "密码已通过。挑战仅在当前页面内存中保留，离开页面即失效。"}
        </p>
      </div>

      {challenge === null ? (
        <form className="admin-form" onSubmit={submitPassword}>
          <label>
            <span>管理员账号</span>
            <input
              autoComplete="username"
              maxLength={64}
              minLength={3}
              name="username"
              onChange={(event) => setUsername(event.currentTarget.value)}
              pattern={ADMIN_USERNAME_INPUT_PATTERN}
              required
              spellCheck={false}
              type="text"
              value={username}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete="current-password"
              name="password"
              onChange={(event) => setPassword(event.currentTarget.value)}
              ref={passwordInput}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="admin-button admin-button--primary" disabled={busy} type="submit">
            {busy ? "正在核验…" : "继续验证"}
          </button>
        </form>
      ) : (
        <form className="admin-form" onSubmit={submitTotp}>
          <p className="admin-inline-note">
            账号 <strong>{username}</strong> · 挑战有效至{" "}
            <time dateTime={challenge.expiresAt}>
              {new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(
                new Date(challenge.expiresAt),
              )}
            </time>
          </p>
          <label>
            <span>六位动态码</span>
            <input
              autoComplete="one-time-code"
              autoFocus
              inputMode="numeric"
              maxLength={6}
              name="totpCode"
              onChange={(event) => setTotpCode(event.currentTarget.value.replace(/\D/gu, ""))}
              pattern="\d{6}"
              required
              type="text"
              value={totpCode}
            />
          </label>
          <div className="admin-form__actions">
            <button className="admin-button admin-button--primary" disabled={busy} type="submit">
              {busy ? "正在进入…" : "进入后台"}
            </button>
            <button
              className="admin-button admin-button--quiet"
              disabled={busy}
              onClick={changeStep}
              type="button"
            >
              返回账号密码
            </button>
          </div>
        </form>
      )}

      {formState.kind === "error" ? (
        <p className="admin-message admin-message--error" role="alert">
          {formState.message}
        </p>
      ) : null}

      <p className="admin-auth-card__footnote">
        页面不会把密码、动态码或挑战写入网址、localStorage 或 sessionStorage。
      </p>
    </section>
  );
}
