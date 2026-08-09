// Why two gates and not one.
//
//   node ops/gate-gap.mjs
//
// Gate one is Cleanverse's own Validator, asked live. Gate two is membership of the
// association set the issuer anchored, proved in zero knowledge. They are not redundant,
// and the cheapest way to show it is to find an address the two disagree about.
//
// The burn address is one. On Monad testnet today, Cleanverse's validator answers that
// 0x…dEaD satisfies this pool's min_tier 30 rule — someone in the shared sandbox issued
// it a credential. Gate one admits it. Gate two has no membership witness for it, so no
// proof exists and it does not get in.
//
// The honest half of the same result: 0x1111…1111 IS in our set, because it is in the
// registry. The association set is faithful to Cleanverse, not cleaner than it. What the
// second gate adds is not better identity data — it is a second, independent question,
// anchored by the issuer at a point in time, that an address has to satisfy as well.

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

const head = ["subject", "", "gate 1 · Cleanverse", "gate 2 · association set", "admitted?"];
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
    gate1 && gate2 ? "yes" : "no",
  ]);
}

const w = head.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
for (const r of rows) console.log(r.map((c, i) => (c ?? "").padEnd(w[i])).join("  "));

// Only a real answer counts as disagreement. A reverted call is an unknown, and folding
// unknowns into the headline would inflate the one number this table exists to report.
const disagreements = rows
  .slice(2)
  .filter((r) => r[2] !== "reverted" && (r[2] === "ADMITS") !== (r[3] === "ADMITS"));

console.log(`\n${disagreements.length} address(es) the two gates disagree about.`);
if (disagreements.length) {
  console.log("Each one is a case a single-gate register would have got wrong in one direction");
  console.log("or the other. That is the argument for building both.");
}
