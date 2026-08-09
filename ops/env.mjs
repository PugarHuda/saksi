// Loads .env from the repo root into process.env without a dependency.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, ".env");

if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

export const ROOT = root;
export const CHAIN = process.env.CHAIN ?? "monad";
export const RPC = process.env.MONAD_RPC ?? "https://testnet-rpc.monad.xyz";
export const EXPLORER = process.env.MONAD_EXPLORER ?? "https://testnet.monadexplorer.com";

/** Deployment facts written by the ops scripts, read by the consoles. */
export const DEPLOY_FILE = path.join(root, "deployment.json");

export function readDeployment() {
  return fs.existsSync(DEPLOY_FILE) ? JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf8")) : {};
}

export function writeDeployment(patch) {
  const next = { ...readDeployment(), ...patch };
  fs.writeFileSync(DEPLOY_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}
