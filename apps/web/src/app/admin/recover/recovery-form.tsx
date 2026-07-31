"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type MouseEvent } from "react";

import {
  adminApi,
  describeAdminApiError,
  type AdminSession,
  type RecoveryChallenge,
} from "../admin-api";
import { useAdminNavigationGuard } from "../admin-navigation-guard";
import {
  ADMIN_PASSWORD_LENGTH_MESSAGE,
  ADMIN_USERNAME_INPUT_PATTERN,
  isAdminPasswordLengthValid,
} from "../admin-credentials";

type RecoveryFormProps = {
  onRecovered: (session: AdminSession) => void;
};

type SubmitState = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };

export function RecoveryForm({ onRecovered }: RecoveryFormProps) {
  const { setNavigationBlocked } = useAdminNavigationGuard();
  const [username, setUsername] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [challenge, setChallenge] = useState<RecoveryChallenge | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[] | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  useEffect(() => () => setNavigationBlocked(false), [setNavigationBlocked]);

  useEffect(() => {
    const forgetSecrets = () => {
      setRecoveryCode("");
      setChallenge(null);
      setNewPassword("");
      setNewPasswordConfirmation("");
      setTotpCode("");
      setNewRecoveryCodes(null);
      setSavedOffline(false);
      setNavigationBlocked(false);
      setSubmitState({ kind: "idle" });
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
  }, [setNavigationBlocked]);

  async function startRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitState.kind === "submitting") return;
    setSubmitState({ kind: "submitting" });
    const result = await adminApi.createRecoveryChallenge({
      recoveryCode: recoveryCode.trim(),
      username: username.trim(),
    });
    setRecoveryCode("");
    if (!result.ok) {
      setSubmitState({ kind: "error", message: describeAdminApiError(result.error) });
      return;
    }
    setChallenge(result.data);
    setSubmitState({ kind: "idle" });
  }

  async function completeRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitState.kind === "submitting" || challenge === null) return;
    if (!isAdminPasswordLengthValid(newPassword)) {
      setSubmitState({ kind: "error", message: ADMIN_PASSWORD_LENGTH_MESSAGE });
      return;
    }
    if (newPassword !== newPasswordConfirmation) {
      setSubmitState({ kind: "error", message: "两次输入的新密码不一致。" });
      return;
    }
    if (!/^\d{6}$/u.test(totpCode)) {
      setSubmitState({ kind: "error", message: "请输入新验证器显示的六位动态码。" });
      return;
    }

    setSubmitState({ kind: "submitting" });
    const result = await adminApi.completeRecovery({
      challengeToken: challenge.challengeToken,
      newPassword,
      totpCode,
    });
    setNewPassword("");
    setNewPasswordConfirmation("");
    setTotpCode("");
    if (!result.ok) {
      setSubmitState({ kind: "error", message: describeAdminApiError(result.error) });
      return;
    }

    setChallenge(null);
    setNavigationBlocked(true);
    setNewRecoveryCodes([...result.data.recoveryCodes]);
    setSubmitState({ kind: "idle" });
    onRecovered(result.data.session);
  }

  function preventUnsavedNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (!savedOffline) event.preventDefault();
  }

  const busy = submitState.kind === "submitting";

  if (newRecoveryCodes !== null) {
    return (
      <section className="admin-recovery-codes" aria-labelledby="new-recovery-codes-title">
        <p className="admin-kicker">CONTROL RESTORED · 仅显示一次</p>
        <h1 id="new-recovery-codes-title">保存新的恢复码</h1>
        <p>
          密码和验证器已经更新，全部旧会话及旧恢复码均已失效。请把下面十个代码离线保存；离开本页后无法再次查看。
        </p>
        <ol aria-label="新恢复码">
          {newRecoveryCodes.map((code, index) => (
            <li key={code}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <code>{code}</code>
            </li>
          ))}
        </ol>
        <label className="admin-confirm-check">
          <input
            checked={savedOffline}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setSavedOffline(checked);
              setNavigationBlocked(!checked);
            }}
            type="checkbox"
          />
          <span>我已经离线保存全部十个恢复码</span>
        </label>
        <Link
          aria-disabled={savedOffline ? undefined : true}
          className="admin-button admin-button--primary"
          href="/admin"
          onClick={preventUnsavedNavigation}
          tabIndex={savedOffline ? undefined : -1}
        >
          进入控制台
        </Link>
      </section>
    );
  }

  return (
    <section className="admin-auth-card admin-auth-card--wide" aria-labelledby="recovery-title">
      <div className="admin-auth-card__index" aria-hidden="true">
        {challenge === null ? "壹" : "贰"}
      </div>
      <div className="admin-auth-card__heading">
        <p className="admin-kicker">RECOVERY CEREMONY · 控制权恢复</p>
        <h1 id="recovery-title">{challenge === null ? "使用恢复码" : "设置新验证器"}</h1>
        <p>
          {challenge === null
            ? "恢复码会在服务端原子消费。成功进入下一步后，旧会话、旧验证器和全部旧恢复码立即失效。"
            : "不要关闭或刷新页面。新验证器密钥和恢复挑战只保存在当前页面内存中。"}
        </p>
      </div>

      {challenge === null ? (
        <form className="admin-form" onSubmit={startRecovery}>
          <label>
            <span>管理员账号</span>
            <input
              autoComplete="username"
              maxLength={64}
              minLength={3}
              onChange={(event) => setUsername(event.currentTarget.value)}
              pattern={ADMIN_USERNAME_INPUT_PATTERN}
              required
              spellCheck={false}
              type="text"
              value={username}
            />
          </label>
          <label>
            <span>一次性恢复码</span>
            <input
              autoComplete="off"
              maxLength={128}
              minLength={16}
              onChange={(event) => setRecoveryCode(event.currentTarget.value)}
              required
              spellCheck={false}
              type="password"
              value={recoveryCode}
            />
          </label>
          <button className="admin-button admin-button--primary" disabled={busy} type="submit">
            {busy ? "正在核验…" : "开始恢复"}
          </button>
        </form>
      ) : (
        <>
          <section className="admin-provisioning" aria-labelledby="provisioning-title">
            <div>
              <p className="admin-kicker">NEW AUTHENTICATOR</p>
              <h2 id="provisioning-title">在验证器中新增 Five</h2>
            </div>
            <p>选择“手动输入密钥”，录入以下内容：</p>
            <code>{challenge.totpProvisioning.secret}</code>
            <dl>
              <div>
                <dt>算法</dt>
                <dd>{challenge.totpProvisioning.algorithm}</dd>
              </div>
              <div>
                <dt>位数</dt>
                <dd>{challenge.totpProvisioning.digits}</dd>
              </div>
              <div>
                <dt>周期</dt>
                <dd>{challenge.totpProvisioning.periodSeconds} 秒</dd>
              </div>
            </dl>
          </section>
          <form className="admin-form" onSubmit={completeRecovery}>
            <label>
              <span>新密码</span>
              <input
                autoComplete="new-password"
                onChange={(event) => setNewPassword(event.currentTarget.value)}
                required
                type="password"
                value={newPassword}
              />
            </label>
            <label>
              <span>再次输入新密码</span>
              <input
                autoComplete="new-password"
                onChange={(event) => setNewPasswordConfirmation(event.currentTarget.value)}
                required
                type="password"
                value={newPasswordConfirmation}
              />
            </label>
            <label>
              <span>新验证器六位动态码</span>
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setTotpCode(event.currentTarget.value.replace(/\D/gu, ""))}
                pattern="\d{6}"
                required
                type="text"
                value={totpCode}
              />
            </label>
            <button className="admin-button admin-button--primary" disabled={busy} type="submit">
              {busy ? "正在更新凭据…" : "完成恢复"}
            </button>
          </form>
        </>
      )}

      {submitState.kind === "error" ? (
        <p className="admin-message admin-message--error" role="alert">
          {submitState.message}
        </p>
      ) : null}
    </section>
  );
}
