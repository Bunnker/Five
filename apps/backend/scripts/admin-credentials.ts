import { randomUUID } from "node:crypto";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import { createInterface } from "node:readline/promises";

import { Pool } from "pg";
import { adminSecurityCryptoFromEnvironment } from "../src/admin-auth/admin-auth.configuration";
import {
  NodeScryptPasswordHasher,
  SystemAdminAuthRandom,
} from "../src/admin-auth/admin-auth.crypto";
import { AdminAuthService } from "../src/admin-auth/admin-auth.service";
import { PostgresAdminSecurityStore } from "../src/admin-auth/postgres-admin-security.store";
import { SystemClock } from "../src/request-context/system-clock";

type CredentialCommand = "bootstrap" | "reset";

async function visibleQuestion(prompt: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await readline.question(prompt);
  } finally {
    readline.close();
  }
}

function hiddenQuestion(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.stdin.setRawMode === undefined) {
    throw new Error("This credential command requires an interactive TTY");
  }
  process.stdout.write(prompt);
  const decoder = new StringDecoder("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: Buffer) => {
      for (const character of decoder.write(chunk)) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Credential command interrupted"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          continue;
        }
        if (character >= " " && character !== "\u007f") {
          value += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

function credentialCommand(value: string | undefined): CredentialCommand {
  if (value !== "bootstrap" && value !== "reset") {
    throw new Error("Usage: pnpm --filter @five/backend admin:credentials <bootstrap|reset>");
  }
  return value;
}

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (value === undefined || value.trim().length === 0) {
    throw new Error("DATABASE_URL is required");
  }
  return value;
}

async function main(): Promise<void> {
  const command = credentialCommand(process.argv[2]);
  const { digester } = adminSecurityCryptoFromEnvironment(process.env);
  const pool = new Pool({ connectionString: requiredDatabaseUrl(), max: 1 });
  try {
    const store = new PostgresAdminSecurityStore(pool);
    if (command === "bootstrap" && (await store.isInitialized())) {
      throw new Error("管理员账号已经初始化；如需离线恢复，请运行 reset 命令");
    }
    const auth = new AdminAuthService(
      store,
      new NodeScryptPasswordHasher(),
      digester,
      new SystemAdminAuthRandom(),
      new SystemClock(),
    );
    const username = await visibleQuestion("管理员用户名：");
    const password = await hiddenQuestion("新密码（8–128 个字符，不回显）：");
    const confirmation = await hiddenQuestion("再次输入新密码（不回显）：");
    if (password !== confirmation) {
      throw new Error("两次输入的密码不一致");
    }
    const context = {
      requestId: `offline-credentials-${randomUUID()}`,
      source: "offline-console",
      userAgent: null,
    };
    const result =
      command === "bootstrap"
        ? await auth.bootstrapAccount({ context, password, username })
        : await auth.offlineReset({
            context,
            newPassword: password,
            username,
          });
    if (result.kind === "already_initialized") {
      throw new Error("管理员账号已经初始化；如需离线恢复，请运行 reset 命令");
    }
    if (result.kind !== "created" && result.kind !== "completed") {
      throw new Error("凭据未更新：请检查用户名和密码长度后重试");
    }
    process.stdout.write("\n管理员账号和密码已更新。\n");
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "凭据命令失败";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
