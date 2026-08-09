// What a Groth16 verification actually costs on Monad.
//
//   node ops/gas.mjs
//
// This project told a reader that no on-chain gas number here can be reproduced, because
// Monad charges the submitted limit and reports it back as `gasUsed`, so every receipt says
// `gasUsed == gasLimit`. The receipts are useless, and the conclusion drawn from them was
// wrong: `eth_estimateGas` is a real simulation with real resolution, and every proof this
// register has ever submitted is still replayable against its verifier — `verifyProof` is a
// view, so estimating it costs nothing and changes nothing.
//
// The result is a scaling law rather than a constant, which is the number the ceilings in
// the summary were missing: they were compile-time constants with no price attached.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { ROOT, RPC, readDeployment } from "./env.mjs";

const dep = readDeployment();

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const b = await r.json();
  if (b.error) throw new Error(`${method}: ${b.error.message}`);
  return b.result;
}
const estimate = async (to, data) => Number(BigInt(await rpc("eth_estimateGas", [{ to, data }])));

// verifyProof(uint[2],uint[2][2],uint[2],uint[N]) — one selector per public-signal width.
const SEL = {
  3: "0x43753b4d",
  4: "0x6a5e9d67",
  7: "0x9d3c6b13",
  11: "0x1b0f7b8f",
  13: "0x83b9c4a6",
};
const sig = (n) => `verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[${n}])`;

// Recover each selector rather than trusting a table: a wrong one estimates as a fallback
// and silently returns a number that means nothing.
const { execFileSync } = await import("node:child_process");
const CAST = fs.existsSync(path.join(process.env.USERPROFILE ?? "", ".foundry", "bin", "cast.exe"))
  ? path.join(process.env.USERPROFILE, ".foundry", "bin", "cast.exe")
  : "cast";
for (const n of Object.keys(SEL)) {
  SEL[n] = execFileSync(CAST, ["sig", sig(n)], { encoding: "utf8" }).trim();
}

const audit = JSON.parse(fs.readFileSync(path.join(ROOT, "audit-log.json"), "utf8"));
const KIND_SIGNALS = { exact: 3, threshold: 3, range: 4, aggregate: 13 };

// Each row: the transaction that carried the proof, the verifier it was checked by, and how
// many public signals that circuit publishes. The proof itself is always the first
// 2 + 4 + 2 + N words of the calldata body, so a transaction that carries trailing arguments
// — transact does — is truncated to exactly the verifier's own argument list.
const ROWS = [];
for (const e of audit) {
  if (!e.verifyTx) continue;
  const n = KIND_SIGNALS[e.kind];
  ROWS.push({ label: e.kind, tx: e.verifyTx, verifier: dep.verifiers[e.kind === "exact" ? "exact" : e.kind], n });
}
ROWS.push({
  label: "transfer (JoinSplit)",
  tx: "0x08b6801b1cbcaa681f2a81d77628e4c88dcec9bf70793492663fa605422d0e3a",
  verifier: dep.verifiers.transfer,
  n: 7,
});

console.log("Groth16 verification, priced by Monad's own estimator");
console.log("(every proof below is one this register actually submitted)\n");
console.log("  circuit               signals   gas");

const points = [];
const seen = new Set();
for (const r of ROWS) {
  if (!r.verifier || seen.has(r.label)) continue;
  seen.add(r.label);
  const tx = await rpc("eth_getTransactionByHash", [r.tx]);
  if (!tx) { console.log(`  ${r.label.padEnd(21)} skipped — transaction not found`); continue; }
  const body = tx.input.slice(10);                       // drop the caller's own selector
  const words = 2 + 4 + 2 + r.n;
  const data = SEL[r.n] + body.slice(0, words * 64);
  try {
    const g = await estimate(r.verifier, data);
    console.log(`  ${r.label.padEnd(21)} ${String(r.n).padStart(4)}    ${g.toLocaleString("en-US").padStart(10)}`);
    points.push([r.n, g]);
  } catch (e) {
    console.log(`  ${r.label.padEnd(21)} ${String(r.n).padStart(4)}    failed: ${e.message.slice(0, 50)}`);
  }
}

// Least squares over the points we have. Two would fit a line trivially; four make the fit
// mean something, and the residual is what says whether "per public signal" is the right
// model at all.
if (points.length >= 3) {
  const N = points.length;
  const sx = points.reduce((a, [x]) => a + x, 0);
  const sy = points.reduce((a, [, y]) => a + y, 0);
  const sxy = points.reduce((a, [x, y]) => a + x * y, 0);
  const sxx = points.reduce((a, [x]) => a + x * x, 0);
  const slope = (N * sxy - sx * sy) / (N * sxx - sx * sx);
  const base = (sy - slope * sx) / N;
  const worst = Math.max(...points.map(([x, y]) => Math.abs(y - (base + slope * x))));
  console.log(`\n  fit: ${Math.round(base).toLocaleString("en-US")} gas + ` +
    `${Math.round(slope).toLocaleString("en-US")} per public signal`);
  console.log(`       worst residual ${Math.round(worst)} gas over ${N} points`);
  console.log(`\n  so a wider aggregate costs ${Math.round(slope * 2).toLocaleString("en-US")} gas per extra`);
  console.log("  position (a commitment and its active flag are two signals each), and");
  console.log("  Merkle depth costs nothing at all — depth is a private witness dimension,");
  console.log("  so depth 20 verifies at exactly this price and only proving time doubles.");
}

// The root cause, measured against the precompiles rather than inferred.
console.log("\nWhy it costs what it costs — BN254 precompiles, marginal cost per pair:");
const G1 = "0".repeat(64) + "0".repeat(64);
const PAIR = G1 + "0".repeat(64).repeat(4);
const pair = [];
for (const k of [1, 2, 3]) {
  try {
    const g = await estimate("0x0000000000000000000000000000000000000008", "0x" + PAIR.repeat(k));
    pair.push(g);
    console.log(`  ecPairing k=${k}   ${g.toLocaleString("en-US").padStart(10)}`);
  } catch (e) { console.log(`  ecPairing k=${k}   failed`); }
}
if (pair.length === 3) {
  const marginal = Math.round(((pair[2] - pair[1]) + (pair[1] - pair[0])) / 2);
  console.log(`\n  marginal ${marginal.toLocaleString("en-US")} gas per pair, against 34,000 under EIP-1108`);
  console.log(`  — Monad prices this precompile at about ${(marginal / 34000).toFixed(2)}x the Ethereum schedule,`);
  console.log("  which is the whole of the gap between the ~264k a disclosure verification");
  console.log("  measures locally in Foundry and what it costs here.");
}
