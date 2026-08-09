// Answerability: the regulator asks on-chain, the holder answers in zero knowledge, the
// contract checks the answer.
//
//   node ops/audit.mjs threshold 500        # prove a position is at most 500, hide it
//   node ops/audit.mjs range 100 400        # prove it sits inside a band
//   node ops/audit.mjs exact                # disclose the figure itself
//   node ops/audit.mjs aggregate 2000       # prove total exposure across ALL positions
//   node ops/audit.mjs list
//
// The order matters and is enforced by the contract. requestAudit() is called by the
// auditor BEFORE any proof exists, and the proof carries that request's context hash as
// a public signal. An answer to one question therefore cannot be presented as the answer
// to another, and once answered the request closes.
//
// The aggregate case is the strict one. Its context hash is Poseidon over the ctxNonce,
// the enumerated commitments and their active flags, and the circuit checks that hash
// itself — so a holder cannot quietly drop a position from the total. The report is
// complete or there is no proof.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as snarkjs from "snarkjs";
import { makePoseidon } from "./merkle.mjs";
import { loadNotes, FIELD } from "./note.mjs";
import { ROOT, RPC, readDeployment } from "./env.mjs";

const dep = readDeployment();
const pk = process.env.DEPLOYER_PK;
const AGG_SLOTS = 5;

const CAST = fs.existsSync(path.join(process.env.USERPROFILE ?? "", ".foundry", "bin", "cast.exe"))
  ? path.join(process.env.USERPROFILE, ".foundry", "bin", "cast.exe")
  : "cast";
const cast = (args) => execFileSync(CAST, args, { encoding: "utf8" });
const send = (args) => {
  const out = cast(["send", ...args, "--rpc-url", RPC, "--chain", "10143", "--private-key", pk]);
  const tx = /transactionHash\s+(0x[0-9a-f]+)/.exec(out)?.[1];
  const ok = /status\s+1/.test(out);
  return { tx, ok, out };
};

const LOG = path.join(ROOT, "audit-log.json");
const readLog = () => (fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, "utf8")) : []);
const appendLog = (e) => {
  const all = readLog();
  all.push(e);
  fs.writeFileSync(LOG, JSON.stringify(all, null, 2) + "\n");
};

const build = (name) => ({
  wasm: path.join(ROOT, `circuits/build/${name}_js/${name}.wasm`),
  zkey: path.join(ROOT, `circuits/build/${name}_final.zkey`),
  vkey: JSON.parse(fs.readFileSync(path.join(ROOT, `circuits/build/${name}_vk.json`), "utf8")),
});

async function proveAndSend({ circuit, input, selector, sig, question, ctx, kind, answer }) {
  const { wasm, zkey, vkey } = build(circuit);

  console.log(`\nregulator registers the question on-chain first`);
  const req = send([dep.pool, "requestAudit(uint256,string)", ctx.toString(), question]);
  console.log(`  requestAudit  ${req.ok ? "ok" : "FAILED"}  ${req.tx}`);

  console.log(`proving (${circuit})…`);
  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  const ms = Date.now() - t0;
  if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) {
    throw new Error("proof does not verify locally");
  }
  console.log(`  proved and verified locally in ${ms} ms`);

  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [pA, pB, pC, pub] = JSON.parse("[" + calldata + "]");
  const fmt = (x) => `[${x.join(",")}]`;
  const fmt2 = (x) => `[[${x[0].join(",")}],[${x[1].join(",")}]]`;

  console.log(`submitting to the contract…`);
  const res = send([dep.pool, sig, fmt(pA), fmt2(pB), fmt(pC), fmt(pub)]);
  console.log(`  ${selector}  ${res.ok ? "VERIFIED ON-CHAIN" : "REFUSED"}  ${res.tx}`);
  if (!res.ok) console.log(res.out.slice(0, 600));

  appendLog({
    kind, question, circuit,
    contextHash: ctx.toString(),
    answer,
    requestTx: req.tx,
    verifyTx: res.tx,
    verified: res.ok,
    proveMs: ms,
    at: new Date().toISOString(),
  });
  return res;
}

const notes = loadNotes();
if (!notes.length) { console.error("no positions in notes.json — run ops/deposit.mjs first"); process.exit(1); }

const { h2, h3, poseidon, F } = await makePoseidon();
const hN = (arr) => F.toObject(poseidon(arr));
const [cmd, ...args] = process.argv.slice(2);
const nonce = BigInt(Date.now()) % FIELD;
const toDisplay = (units) => (Number(units) / 1e6).toLocaleString();

if (cmd === "threshold") {
  const capUnits = BigInt(Math.round(Number(args[0] ?? 500) * 1e6));
  const n = notes[notes.length - 1];
  const ctx = h2(nonce, BigInt(n.commitment));

  await proveAndSend({
    circuit: "thresholdDisclosure",
    selector: "proveThreshold",
    sig: "proveThreshold(uint256[2],uint256[2][2],uint256[2],uint256[3])",
    question: `is this position at most ${toDisplay(capUnits)} ${dep.assetSymbol}?`,
    ctx, kind: "threshold",
    answer: `yes — position <= ${toDisplay(capUnits)}, figure not disclosed`,
    input: {
      commitment: BigInt(n.commitment).toString(),
      threshold: capUnits.toString(),
      auditContextHash: ctx.toString(),
      amount: n.amount,
      pubKey: n.pubKey,
      blinding: n.blinding,
    },
  });
}

else if (cmd === "range") {
  const lo = BigInt(Math.round(Number(args[0] ?? 100) * 1e6));
  const hi = BigInt(Math.round(Number(args[1] ?? 400) * 1e6));
  const n = notes[notes.length - 1];
  const ctx = h3(nonce, BigInt(n.commitment), lo);

  await proveAndSend({
    circuit: "rangeDisclosure",
    selector: "proveRange",
    sig: "proveRange(uint256[2],uint256[2][2],uint256[2],uint256[4])",
    question: `is this position inside the ${toDisplay(lo)}–${toDisplay(hi)} reporting bracket?`,
    ctx, kind: "range",
    answer: `yes — inside the bracket, figure not disclosed`,
    input: {
      commitment: BigInt(n.commitment).toString(),
      lower: lo.toString(),
      upper: hi.toString(),
      auditContextHash: ctx.toString(),
      amount: n.amount,
      pubKey: n.pubKey,
      blinding: n.blinding,
    },
  });
}

else if (cmd === "exact") {
  const n = notes[notes.length - 1];
  const ctx = h2(nonce + 1n, BigInt(n.commitment));

  await proveAndSend({
    circuit: "disclosure",
    selector: "proveExact",
    sig: "proveExact(uint256[2],uint256[2][2],uint256[2],uint256[3])",
    question: `disclose this position in full`,
    ctx, kind: "exact",
    answer: `${toDisplay(BigInt(n.amount))} ${dep.assetSymbol}`,
    input: {
      commitment: BigInt(n.commitment).toString(),
      disclosedAmount: n.amount,
      auditContextHash: ctx.toString(),
      amount: n.amount,
      pubKey: n.pubKey,
      blinding: n.blinding,
    },
  });
}

else if (cmd === "aggregate") {
  const capUnits = BigInt(Math.round(Number(args[0] ?? 2000) * 1e6));
  const used = notes.slice(-AGG_SLOTS);

  // Pad to the circuit's fixed width. Padding slots are inactive: they contribute zero
  // and their commitments are unconstrained, but they are still inside the context hash,
  // so the set the regulator asked about is the set that gets proved.
  const commitments = [], active = [], amounts = [], pubKeys = [], blindings = [];
  for (let i = 0; i < AGG_SLOTS; i++) {
    const n = used[i];
    commitments.push(n ? BigInt(n.commitment) : 0n);
    active.push(n ? 1n : 0n);
    amounts.push(n ? BigInt(n.amount) : 0n);
    pubKeys.push(n ? BigInt(n.pubKey) : 0n);
    blindings.push(n ? BigInt(n.blinding) : 0n);
  }

  // auditContextHash = Poseidon(ctxNonce, commitments…, active…) — the circuit
  // recomputes this, so omitting a position changes the hash and no proof exists.
  const ctx = hN([nonce, ...commitments, ...active]);
  const total = amounts.reduce((a, b) => a + b, 0n);

  console.log(`aggregating ${used.length} position(s); true total ${toDisplay(total)} (never published)`);

  await proveAndSend({
    circuit: "aggregateDisclosure",
    selector: "proveAggregate",
    sig: "proveAggregate(uint256[2],uint256[2][2],uint256[2],uint256[13])",
    question: `is total exposure across all ${used.length} registered positions at most ${toDisplay(capUnits)} ${dep.assetSymbol}?`,
    ctx, kind: "aggregate",
    answer: `yes — sum of ${used.length} positions <= ${toDisplay(capUnits)}, no individual position disclosed`,
    input: {
      commitments: commitments.map(String),
      active: active.map(String),
      cap: capUnits.toString(),
      auditContextHash: ctx.toString(),
      ctxNonce: nonce.toString(),
      amounts: amounts.map(String),
      pubKeys: pubKeys.map(String),
      blindings: blindings.map(String),
    },
  });
}

else if (cmd === "list") {
  for (const e of readLog()) {
    console.log(`${e.kind.padEnd(10)} ${e.verified ? "VERIFIED" : "refused "}  ${e.question}`);
    console.log(`           answer: ${e.answer}`);
    console.log(`           verify tx: ${e.verifyTx}\n`);
  }
}

else {
  console.log("usage: threshold <cap> | range <lo> <hi> | exact | aggregate <cap> | list");
  process.exit(1);
}

process.exit(0);
