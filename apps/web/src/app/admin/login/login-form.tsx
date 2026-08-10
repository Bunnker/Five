"use client";

import { useEffect, useState, type FormEvent } from "react";

import { adminApi, describeAdminApiError, type AdminSession } from "../admin-api";
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
  const [formState, setFormState] = useState<FormState>({ kind: "idle" });

  useEffect(() => {
    const forgetSecrets = () => {
      setPassword("");
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

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formState.kind === "submitting") return;
    if (!isAdminPasswordLengthValid(password)) {
      setFormState({ kind: "error", message: ADMIN_PASSWORD_LENGTH_MESSAGE });
      return;
    }
    setFormState({ kind: "submitting" });

    const result = await adminApi.createSession({ password, username: username.trim() });
    setPassword("");
    if (!result.ok) {
      setFormState({ kind: "error", message: describeAdminApiError(result.error) });
      return;
    }

    onAuthenticated(result.data);
  }

  const busy = formState.kind === "submitting";

  return (
    <section className="admin-auth-card" aria-labelledby="admin-login-title">
      <div className="admin-auth-card__index" aria-hidden="true">
        壹
      </div>
      <div className="admin-auth-card__heading">
        <p className="admin-kicker">CONTROL DESK · 账号登录</p>
        <h1 id="admin-login-title">维护者登录</h1>
        <p>输入唯一维护者账号和密码。</p>
      </div>

      <form className="admin-form" onSubmit={submitLogin}>
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
            required
            type="password"
            value={password}
          />
        </label>
        <button className="admin-button admin-button--primary" disabled={busy} type="submit">
          {busy ? "正在登录…" : "登录后台"}
        </button>
      </form>

      {formState.kind === "error" ? (
        <p className="admin-message admin-message--error" role="alert">
          {formState.message}
        </p>
      ) : null}

      <p className="admin-auth-card__footnote">
        页面不会把密码写入网址、localStorage 或 sessionStorage。
      </p>
    </section>
  );
}
