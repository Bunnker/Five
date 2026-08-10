import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, appendFile, chmod, copyFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const localEnv = resolve(root, ".env");
const exampleEnv = resolve(root, ".env.example");

try {
  await access(localEnv, constants.F_OK);
} catch {
  await copyFile(exampleEnv, localEnv);
  console.log("Created .env from .env.example for local development.");
}

// Tighten permissions before any generated credential material is appended.
await chmod(localEnv, 0o600);
const current = await readFile(localEnv, "utf8");
const hasVariable = (name) => new RegExp(`^${name}=`, "mu").test(current);
const additions = [];

if (!hasVariable("FIVE_DEMO_CONTENT")) {
  additions.push("FIVE_DEMO_CONTENT=0");
}
if (!hasVariable("FIVE_ADMIN_HMAC_KEY_BASE64")) {
  additions.push(`FIVE_ADMIN_HMAC_KEY_BASE64=${randomBytes(32).toString("base64")}`);
}
if (!hasVariable("FIVE_ANALYTICS_HMAC_KEY_BASE64")) {
  additions.push(`FIVE_ANALYTICS_HMAC_KEY_BASE64=${randomBytes(32).toString("base64")}`);
}
if (!hasVariable("FIVE_ADMIN_TRUSTED_ORIGINS")) {
  additions.push("FIVE_ADMIN_TRUSTED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000");
}

if (additions.length > 0) {
  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  await appendFile(localEnv, `${separator}${additions.join("\n")}\n`, { mode: 0o600 });
  console.log("Added local security configuration to .env.");
}
