import { constants } from "node:fs";
import { access, copyFile } from "node:fs/promises";
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
