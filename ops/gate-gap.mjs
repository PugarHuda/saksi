// Why two gates and not one.
//
//   node ops/gate-gap.mjs
//
// Gate one is Cleanverse's own Validator, asked live in the transaction that moves value.
// Gate two is membership of the association set the issuer anchored, proved in zero
// knowledge. The difference between them is TIME, and that is the whole argument.
//
// A correction worth recording, because we made the mistake and it flattered us. An
// earlier version of this script pointed at the burn address: Cleanverse's validator
// answers that 0x…dEaD satisfies this pool's rule, because somebody in the shared sandbox
// issued it a credential, while our set had no witness for it. We presented that as proof
// the second gate catches what the first misses.
//
// It was not. Our set was missing roughly seven eighths of the eligible population — a
// server-side status filter on a column that is null for most rows — and 0x…dEaD was
// excluded by that bug, not by any property of the design. With the population enumerated
// correctly the two gates agree about it, exactly as they should: the set is FAITHFUL to
// the registry, never cleaner than it.
//
// The real divergence is temporal, and it is the one that matters. The anchored root is a
// snapshot; credentials move continuously. A holder frozen after the last rotation is
// refused by the live call while still carrying a witness in the anchored root — and a
// holder credentialed after it passes the live call with no witness at all. Neither gate
// subsumes the other, and this table shows both directions against the previous set.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, RPC, readDeployment } from "./env.mjs";

const dep = readDeployment();
const asp = JSON.parse(fs.readFileSync(path.join(ROOT, "asp.json"), "utf8"));
const wallets = fs.existsSync(path.join(ROOT, "wallets.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "wallets.json"), "utf8"))
  : [];

const CAST = fs.existsSync(path.join(process.env.USERPROFILE ?? "", ".foundry", "bin", "cast.exe"))
  ? path.join(process.env.USERPROFILE, ".foundry", "bin", "cast.exe")
  : "cast";

const call = (to, sig, ...args) =>
  execFileSync(CAST, ["call", to, sig, ...args, "--rpc-url", RPC], { encoding: "utf8" }).trim();

const inSet = (addr) =>
  asp.members.some((m) => m.wallet.toLowerCase() === addr.toLowerCase());

// The set as it stood before the last rebuild. Between a credential changing and the root
// rotating, this is what the pool was still accepting proofs against — the window the live
// gate exists to close.
const prevPath = path.join(ROOT, "asp.previous.json");
const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, "utf8")) : null;
const inPrevSet = (addr) =>
  !!prev && prev.members.some((m) => m.wallet.toLowerCase() === addr.toLowerCase());

const label = (addr) =>
  wallets.find((w) => w.address.toLowerCase() === addr.toLowerCase())?.label ?? "";

const SUBJECTS = [
  ["0x000000000000000000000000000000000000dEaD", "the burn address"],
  ["0x1111111111111111111111111111111111111111", "0x1111…1111"],
  [dep.issuer, "issuer"],
  [dep.pool, "the pool contract itself"],
];

for (const w of wallets) if (!SUBJECTS.some(([a]) => a?.toLowerCase() === w.address.toLowerCase())) {
  SUBJECTS.push([w.address, w.label]);
}

console.log(`pool      ${dep.pool}`);
console.log(`validator ${dep.validator}   (Cleanverse's contract, not ours)`);
console.log(`asp root  ${asp.root}`);
console.log(`          ${asp.admitted} members, built ${asp.builtAt}\n`);

const head = [
  "subject", "", "gate 1 · Cleanverse", "gate 2 · set now", "gate 2 · set before rebuild", "admitted?",
];
const rows = [head, head.map((h) => "-".repeat(Math.max(h.length, 3)))];

for (const [addr, name] of SUBJECTS) {
  if (!addr) continue;
  let gate1;
  try {
    gate1 = call(dep.validator, "complianceVerify(address,address)(bool)", dep.pool, addr) === "true";
  } catch {
    gate1 = null;
  }
  const gate2 = inSet(addr);
  rows.push([
    addr.slice(0, 10) + "…" + addr.slice(-6),
    name || label(addr),
    gate1 === null ? "reverted" : gate1 ? "ADMITS" : "refuses",
    gate2 ? "ADMITS" : "no witness",
    prev ? (inPrevSet(addr) ? "ADMITS" : "no witness") : "—",
    gate1 && gate2 ? "yes" : "no",
  ]);
}

const w = head.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
for (const r of rows) console.log(r.map((c, i) => (c ?? "").padEnd(w[i])).join("  "));

// Only a real answer counts. A reverted call is an unknown, and folding unknowns into the
// headline would inflate the one number this table exists to report.
const answered = rows.slice(2).filter((r) => r[2] !== "reverted");
const nowDisagree = answered.filter((r) => (r[2] === "ADMITS") !== (r[3] === "ADMITS"));
const staleWindow = answered.filter((r) => r[2] === "refuses" && r[4] === "ADMITS");

console.log(`\nagainst the CURRENT set:  ${nowDisagree.length} disagreement(s)`);
console.log(`against the PREVIOUS set: ${staleWindow.length} holder(s) the live gate refuses`);
console.log(`                          but the older anchored root still admits\n`);

if (staleWindow.length) {
  console.log("That second number is the argument. Each of those holders had a valid membership");
  console.log("witness under the root the pool was accepting proofs against, and only the live");
  console.log("call to Cleanverse refused them. Between a credential changing and the issuer");
  console.log("rotating the root, the anchored set is stale by construction — the live gate is");
  console.log("what closes that window, and the anchored set is what survives an operator who");
  console.log("never rotates. Neither subsumes the other.");
} else {
  console.log("The set was rebuilt after the last credential change, so no holder is currently");
  console.log("caught in the window. Freeze a credential without rotating the root to see it.");
}
console.log("\nThe set is faithful to the registry, never cleaner than it: an address Cleanverse");
console.log("credentials is an address this set admits.");
