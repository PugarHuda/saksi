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
import { CAST, ROOT, RPC, readAsp, readDeployment } from "./env.mjs";
import { sourceKeyOf } from "./asp.mjs";

const dep = readDeployment();
const asp = readAsp();
if (!dep.pool || !dep.validator) {
  console.error("deployment.json has no `pool`/`validator` — there is nothing to compare the set against.");
  process.exit(1);
}
const wallets = fs.existsSync(path.join(ROOT, "wallets.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "wallets.json"), "utf8"))
  : [];


const call = (to, sig, ...args) =>
  execFileSync(CAST, ["call", to, sig, ...args, "--rpc-url", RPC], { encoding: "utf8" }).trim();

// The published set reduces members this project does not operate to leaves, so a wallet
// is optional here — and membership is a property of the leaf in any case.
// cast prints each element with a human-readable exponent glued on — "5685… [5.685e75]" —
// so the annotation has to come off per element; stripping brackets globally merges the
// digits with the exponent and every lookup silently misses.
const denyList = new Set(
  call(dep.pool, "getDenyList()(uint256[8])")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((x) => (x.trim().match(/^\d+/) ?? ["0"])[0])
    .filter((x) => x !== "0"),
);

// Match the LEAF, never the wallet. The published set carries an address for only the
// twelve members this project operates and reduces the other 512 to leaves — so a wallet
// match run from a clone finds no witness for anyone else and prints the burn address as
// "no witness", which is verbatim the claim the README retracts a few lines below as our
// own bug. Every member carries `sourceKey`, in both the raw build and the public one,
// and the leaf is what the circuit proves membership of in any case.
const hasLeaf = (set, addr) => {
  if (!set) return false;
  const key = sourceKeyOf(addr).toString();
  return set.members.some((m) => m.sourceKey === key);
};

// The set as it stood before the last rebuild. Between a credential changing and the root
// rotating, this is what the pool was still accepting proofs against — the window the live
// gate exists to close.
const prevPath = path.join(ROOT, "asp.previous.json");
const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, "utf8")) : null;

const inSet = (addr) => hasLeaf(asp, addr);
const inPrevSet = (addr) => hasLeaf(prev, addr);

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
  "subject", "", "gate 1 · Cleanverse", "gate 2 · set now", "gate 2 · set before rebuild",
  "deny list", "enters?",
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
  // The deny list is the third control and deposit() enforces it, so a verdict drawn from
  // two gates is wrong — and wrong permissively. 0x…dEaD passes Cleanverse, holds a witness
  // in the set, and is still refused at entry because its leaf is on the list.
  const denied = denyList.has(sourceKeyOf(addr).toString());
  rows.push([
    addr.slice(0, 10) + "…" + addr.slice(-6),
    name || label(addr),
    gate1 === null ? "reverted" : gate1 ? "ADMITS" : "refuses",
    gate2 ? "ADMITS" : "no witness",
    prev ? (inPrevSet(addr) ? "ADMITS" : "no witness") : "—",
    denied ? "LISTED" : "clear",
    gate1 && gate2 && !denied ? "yes" : "no",
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
// ---------------------------------------------------------------------------
// The sweep.
//
// Everything above compares a handful of hand-picked addresses, and for a while it
// printed "0 disagreements" and a closing line asserting the set was faithful to the
// registry. It was reporting on four subjects and calling it a property of five hundred.
// The set at that moment contained fifteen wallets Cleanverse had frozen.
//
// So ask the validator about EVERY member. The direction matters: a member the validator
// refuses is the set being more permissive than the compliance provider, which inverts
// the safety direction the whole design rests on.

const members = asp.members ?? [];
// Only members carrying an address can be put to the validator. Run from a clone the
// published set is leaf-only for everyone this project does not operate, so the sweep
// covers a dozen — and reporting that as 524 would be the same over-claim this script
// already made once, in the one sentence a reader would screenshot.
const addressable = members.filter((m) => m.wallet).length;
const refused = [];
let unanswered = 0;

// ponytail: serial, because `call` is execFileSync and four workers over a synchronous
// body ran strictly one at a time anyway — the Promise.all around it bought nothing but a
// comment claiming concurrency. If the sweep gets slow, the upgrade is eth_call over fetch
// (evidence.mjs already does that) rather than more workers around a blocking subprocess.
function sweep() {
  let done = 0;
  for (const m of members) {
    if (!m.wallet) continue;                  // a leaf-only member is not addressable here
    try {
      const ok = call(dep.validator, "complianceVerify(address,address)(bool)", dep.pool, m.wallet);
      if (ok.trim() !== "true") refused.push(m);
    } catch {
      unanswered++;
    }
    if (++done % 25 === 0) process.stdout.write(`\r  swept ${done}/${addressable}`);
  }
}

// Say what is actually being checked. Running from a clone, only the committed public set
// is available and it carries addresses for the members this project operates — so the
// sweep covers a dozen, not five hundred, and reporting it as a full sweep would be exactly
// the over-claim this script already made once.
if (addressable < members.length) {
  console.log(`\n${members.length - addressable} of ${members.length} members are published as`);
  console.log("leaves only, so the validator cannot be asked about them from this copy of the");
  console.log(`set. Sweeping the ${addressable} that carry an address.`);
}
console.log(`\nsweeping ${addressable} of ${members.length} members against Cleanverse's validator…`);
sweep();
process.stdout.write(`\r  swept ${addressable}/${addressable}\n\n`);

if (unanswered) {
  console.log(`${unanswered} member(s) the validator would not answer about — counted as unknown,`);
  console.log("not as agreement. A rate-limited read must not be reported as a clean result.\n");
}

if (refused.length === 0) {
  console.log(`All ${addressable - unanswered} addressable members are admitted by Cleanverse too.`);
  console.log("");
  console.log("Read that for what it is. This set is BUILT by applying Cleanverse's own predicate to");
  console.log("Cleanverse's own registry, so the result holds by construction at the instant of the");
  console.log("read — a member can only be refused if the registry moved in between, which is exactly");
  console.log("the temporal gap the live gate exists to close. The sweep earns its keep by catching a");
  console.log("builder that has drifted, not because passing it proves anything structural.");
} else {
  console.log(`${refused.length} member(s) hold a witness in this set that Cleanverse REFUSES:`);
  for (const m of refused.slice(0, 20)) {
    console.log(`  ${m.wallet}  tier ${m.tier}  ${label(m.wallet) || m.label || ""}`);
  }
  if (refused.length > 20) console.log(`  … and ${refused.length - 20} more`);
  console.log("");
  console.log("That is the set being MORE permissive than the compliance provider, which is the");
  console.log("one direction it must never be. Gate one still refuses them at deposit, so no");
  console.log("position was ever opened this way — but the anchored root is supposed to be a");
  console.log("snapshot of eligibility, and a snapshot that admits frozen credentials is wrong.");
  process.exitCode = 1;
}
