// The asset-side gate: does Cleanverse let this wallet touch OUR A-Token?
//
//   node ops/cva-gate.mjs                  # sweep wallets.json
//   node ops/cva-gate.mjs 0xabc… 0xdef…    # sweep the addresses given instead
//   node ops/cva-gate.mjs --selfcheck      # no network; asserts the verdict mapping
//
// Saksi already asks Cleanverse's Validator whether a wallet may enter the POOL —
// `ops/validator.mjs verify`, and the same question again on-chain inside every deposit.
// That is not the same question as whether a wallet may hold the ASSET. The pool carries
// the rule we registered against Cleanverse's Compliance Validator; the A-Token carries
// the rule the issuer registered against the token itself. Two rule sets, two contracts,
// and `verify_apass` is the only call that asks the second one.
//
// Everything below reads. The kill switch at the bottom is behind a flag and is not run.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { Cleanverse, APASS_VERDICT, apassVerdictCode } from "./cleanverse.mjs";
import { ROOT, CHAIN, RPC, readDeployment } from "./env.mjs";

const args = process.argv.slice(2);

// ---- self-check ---------------------------------------------------------
// The mapping below is the whole reason this file exists: three of the four verdicts
// arrive as a `data.code`, one arrives as an error. Get it wrong and frozen wallets read
// as failures of the lookup rather than as refusals.
if (args.includes("--selfcheck")) {
  const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: got ${a}, want ${b}`); };
  eq(apassVerdictCode("Failed to validate atoken: failed to check apass: custom err name APassNotActive, revert data: 0x322fde89"), 3, "frozen");
  eq(apassVerdictCode("[CN_001]get apass err: apass not found for user 0xdead"), 2, "absent");
  eq(apassVerdictCode("atoken not exist"), 1, "unknown atoken");
  eq(apassVerdictCode("Service temporarily unavailable"), null, "a real failure stays a failure");
  eq(apassVerdictCode(""), null, "empty");
  console.log("selfcheck ok");
  process.exit(0);
}

const dep = readDeployment();
const ATOKEN = dep.atoken;
if (!ATOKEN) { console.error("deployment.json has no `atoken`"); process.exit(1); }

const cv = new Cleanverse();

// ---- subjects -----------------------------------------------------------
const given = args.filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
let subjects;
if (given.length) {
  subjects = given.map((address) => ({ label: address.slice(0, 10), address }));
} else {
  const f = path.join(ROOT, "wallets.json");
  if (!fs.existsSync(f)) { console.error("no wallets.json; pass addresses on the command line"); process.exit(1); }
  // label and address only — nothing else in that file belongs in a console.
  subjects = JSON.parse(fs.readFileSync(f, "utf8")).map((w) => ({ label: w.label, address: w.address }));
}
// A wallet that never had a credential, so the "no A-Pass" row is always on the sheet.
subjects.push({ label: "unknown wallet", address: "0xe69B129724007C56A0BAcCDe1dAa7Aa2646D16b5" });

// ---- on-chain second opinion -------------------------------------------
const rpc = async (method, params) => {
  const r = await fetch(RPC, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json());
};
const pad = (a) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const COMPLIANCE_VERIFY = "0xaf375463"; // complianceVerify(address,address)

async function poolGate(who) {
  if (!dep.pool || !dep.validator) return null;
  const j = await rpc("eth_call", [{ to: dep.validator, data: COMPLIANCE_VERIFY + pad(dep.pool) + pad(who) }, "latest"]);
  if (j.error) return null;
  return BigInt(j.result) === 1n;
}

// ---- the A-Token's own posture -----------------------------------------
console.log(`chain      ${CHAIN}`);
console.log(`a-token    ${ATOKEN}  ${dep.atokenSymbol ?? ""}`);
console.log(`pool       ${dep.pool ?? "—"}`);

const { rules = [] } = await cv.atokenRules(CHAIN, ATOKEN);
for (const [i, r] of rules.entries()) {
  console.log(`rule[${i}]    min_tier ${r.min_tier}  min_sub_tier ${r.min_sub_tier}` +
    `  group ${r.allowed_group || "*"}  sub_group ${r.allowed_sub_group || "*"}` +
    `  countries ${r.countries?.length ? r.countries.join(",") : "*"}${r.is_black_list ? " (BLOCKED)" : ""}`);
}
if (!rules.length) console.log("rule[?]    none — the A-Token admits every A-Pass holder");

const { paused } = await cv.atokenIsPaused(CHAIN, ATOKEN);
console.log(`paused     ${paused}${paused ? "   — every transfer of this asset is halted" : ""}`);

// ---- the sweep ----------------------------------------------------------
console.log(`\n${"subject".padEnd(16)}${"asset gate (verify_apass)".padEnd(34)}pool gate (on-chain)`);
console.log("-".repeat(74));

let disagree = 0;
for (const s of subjects) {
  let verdict;
  try {
    const v = await cv.verifyApass(CHAIN, ATOKEN, s.address);
    verdict = { code: v.code, text: `${v.code} ${APASS_VERDICT[v.code] ?? v.message}` };
  } catch (e) {
    verdict = { code: null, text: `error: ${e.message.slice(0, 60)}` };
  }
  const pool = await poolGate(s.address);
  const agree = verdict.code === null || pool === null ? "" :
    (verdict.code === 4) === pool ? "" : "   <- disagree";
  if (agree) disagree++;
  console.log(`${s.label.padEnd(16)}${verdict.text.padEnd(34)}${pool === null ? "—" : pool}${agree}`);
}

if (disagree) {
  console.log(`\n${disagree} wallet(s) are judged differently by the asset and by the pool. That is not a`);
  console.log("bug in either: the A-Token's rule and the pool's rule are separate registrations,");
  console.log("and a wallet can be good enough to hold the asset and not good enough to enter the");
  console.log("pool, or the reverse. Saksi's own association set is a third answer again.");
}

// ---- kill switch --------------------------------------------------------
// atoken/set_paused is encrypted and it stops every transfer of the asset, including
// redemptions. It is one call, and it is deliberately not one keystroke.
if (args.includes("--pause") || args.includes("--unpause")) {
  const want = args.includes("--pause");
  if (!args.includes("--i-mean-it")) {
    console.log(`\nrefusing to ${want ? "pause" : "unpause"} ${ATOKEN} without --i-mean-it.`);
    console.log("this halts every transfer of the asset for every holder.");
    process.exit(1);
  }
  const r = await cv.setAtokenPaused(CHAIN, ATOKEN, want);
  console.log(`\npaused = ${r.paused}   tx ${r.tx_hash}`);
}
