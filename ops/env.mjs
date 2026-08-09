// Loads .env from the repo root into process.env without a dependency, and holds the few
// facts every ops script needs: where the repo is, where the chain is, where cast is, and
// how to read the two files the scripts share.
import fs from "node:fs";
import os from "node:os";
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
  writeJson(DEPLOY_FILE, next);
  return next;
}

/** Write a JSON artefact so that an interrupted write cannot destroy the previous one.
 *
 *  Every ledger here was a bare writeFileSync, which truncates the target before it writes:
 *  kill the process mid-write and the file that held a position's `blinding` is left half a
 *  document, the next run's JSON.parse throws, and the recovery path IS the failure path.
 *  Temp-file-then-rename means the reader only ever sees the old file or the new one.
 *
 *  ponytail: same-directory rename, which is atomic on NTFS and on POSIX. No fsync — the
 *  threat here is a killed process, not a power cut. */
export function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** Foundry's cast. Eight files carried this three-line dance, and two of them disagreed
 *  about where the home directory comes from — `os.homedir()` is the one that also works
 *  where the binary is not called cast.exe. */
export const CAST = (() => {
  const local = path.join(os.homedir(), ".foundry", "bin",
    process.platform === "win32" ? "cast.exe" : "cast");
  return fs.existsSync(local) ? local : "cast";
})();

/** The two fields every caller pulls out of a `cast send` / `cast receipt` table. Anchored,
 *  because an unanchored /status\s+1/ matches inside other fields of the same receipt. */
export const txHashOf = (out) => /^transactionHash\s+(0x[0-9a-fA-F]+)/m.exec(out)?.[1] ?? null;
export const succeeded = (out) => /^status\s+1/m.test(out);

/** The association set: the raw build when it is present, the published one otherwise.
 *  Five scripts inlined this, and the fallback is load-bearing — `asp.json` is gitignored,
 *  so a clone only ever has `asp.public.json`.
 *
 *  ponytail: exits rather than throwing, because all five call sites did exactly that. */
export function readAsp() {
  const found = ["asp.json", "asp.public.json"]
    .map((f) => path.join(root, f))
    .find((f) => fs.existsSync(f));
  if (!found) {
    console.error("no association set on disk — run `node ops/asp.mjs build` first.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(found, "utf8"));
}

/** A JSON artefact a script depends on, or one honest line instead of an ENOENT trace. */
export function readOrExit(file, how) {
  const p = path.isAbsolute(file) ? file : path.join(root, file);
  if (!fs.existsSync(p)) {
    console.error(`${path.basename(p)} not found — ${how}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
