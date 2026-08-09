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
const AGG_SLOTS = 5;

// The auditor is a different party from the issuer, and must be: an issuer registering
// its own question and then answering it demonstrates the mechanism but proves nothing
// about separation. requestAudit() is sent from the auditor's key; the disclosure that
// answers it is sent from the holder's.
const auditorPk = process.env.AUDITOR_PK ?? process.env.DEPLOYER_PK;
const pk = process.env.DEPLOYER_PK;

const CAST = fs.existsSync(path.join(process.env.USERPROFILE ?? "", ".foundry", "bin", "cast.exe"))
  ? path.join(process.env.USERPROFILE, ".foundry", "bin", "cast.exe")
  : "cast";
const cast = (args) => execFileSync(CAST, args, { encoding: "utf8" });
const send = (args, key = pk) => {
  const out = cast(["send", ...args, "--rpc-url", RPC, "--chain", "10143", "--private-key", key]);
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

/// Must match SaksiPool's DisclosureKind constants.
const KIND = { exact: 1, threshold: 2, range: 3, aggregate: 4 };
const ZERO32 = "0x" + "0".repeat(64);

// The claim binds the FIGURE the regulator asked about, and without it the rest of the
// ceremony is decoration. Pinning the subject and the kind still left "is this position at
// most 1,000?" answerable with a proof that it is at most 2^64-1 — true, provable, and it
// closed the request permanently with the record reading ANSWERED. Computed here, on the
// auditor's side, before any answer exists, exactly as SaksiPool.claimHash recomputes it
// from the prover's own public signals.
const claimHash = (kind, a, b) => {
  if (kind === "exact") return ZERO32;                     // an exact demand names no figure
  const types = kind === "range" ? "uint8,uint256,uint256" : "uint8,uint256";
  const vals = kind === "range"
    ? [String(KIND[kind]), a.toString(), b.toString()]
    : [String(KIND[kind]), a.toString()];
  const encoded = cast(["abi-encode", `f(${types})`, ...vals]).trim();
  return cast(["keccak", encoded]).trim();
};

async function proveAndSend({ circuit, input, selector, sig, question, ctx, kind, answer, subject, claim }) {
  const { wasm, zkey, vkey } = build(circuit);

  // The request names the position and the kind of answer it will accept. Without both,
  // any known commitment could close any request — one unit buys the permanent right to
  // write a false answer into the record, and an exact-disclosure demand can be satisfied
  // with a vacuous threshold statement.
  console.log(`\nregulator registers the question on-chain first`);
  const req = send(
    [dep.pool, "requestAudit(uint256,uint256,uint8,bytes32,string)",
      ctx.toString(), (subject ?? 0n).toString(), String(KIND[kind]),
      claim ?? ZERO32, question],
    auditorPk,
  );
  console.log(
    `  requestAudit  ${req.ok ? "ok" : "FAILED"}  ${req.tx}` +
    (auditorPk === pk ? "   (WARNING: signed by the issuer's own key)" : "   signed by the auditor"),
  );

  console.log(`proving (${circuit})…`);
  const t0 = Date.now();
  let proof, publicSignals;
  try {
    ({ proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey));
  } catch (e) {
    // Only an unsatisfiable constraint is an ANSWER. A missing wasm, an unset signal or a
    // path typo throws into this same catch, and every one of them was being published as
    // "no proof exists for this claim" — a permanent, substantive statement about someone's
    // position, written by a broken toolchain rather than by the arithmetic.
    if (!/Assert Failed/i.test(e.message ?? "")) throw e;

    // A cap that actually binds has no witness. The register cannot answer "yes" to a
    // question whose answer is no — there is no proof to produce, so the request stays
    // open on-chain and the failure is the honest outcome rather than an error.
    const ms = Date.now() - t0;
    console.log(`  NO PROOF EXISTS — the claim is false (${(e.message ?? "").split("\n")[0]})`);
    appendLog({
      kind, question, circuit,
      contextHash: ctx.toString(),
      answer: "no — no proof exists for this claim, so the request stays open",
      requestTx: req.tx,
      verifyTx: null,
      verified: false,
      proveMs: ms,
      at: new Date().toISOString(),
    });
    return { ok: false };
  }
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
// Pin the locale: the host default renders 1000 as "1.000", which in an audit pack
// reads as one token rather than a thousand.
const toDisplay = (units) => (Number(units) / 1e6).toLocaleString("en-US");

if (cmd === "threshold") {
  const capUnits = BigInt(Math.round(Number(args[0] ?? 500) * 1e6));
  const n = notes[notes.length - 1];
  const ctx = h2(nonce, BigInt(n.commitment));

  await proveAndSend({
    circuit: "thresholdDisclosure",
    selector: "proveThreshold",
    sig: "proveThreshold(uint256[2],uint256[2][2],uint256[2],uint256[3])",
    question: `is this position at most ${toDisplay(capUnits)} ${dep.assetSymbol}?`,
    ctx, kind: "threshold", subject: BigInt(n.commitment),
    claim: claimHash("threshold", capUnits),
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
    ctx, kind: "range", subject: BigInt(n.commitment),
    claim: claimHash("range", lo, hi),
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
    ctx, kind: "exact", subject: BigInt(n.commitment),
    claim: claimHash("exact"),
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

  // THE SET IS THE AUDITOR'S TO CHOOSE, NOT THE HOLDER'S.
  //
  // The circuit checks that auditContextHash equals Poseidon over the enumerated
  // commitments and their active flags, so a holder who drops a position computes a
  // different hash and no proof exists. That property is only worth anything if the
  // AUDITOR fixed the hash. If the prover picks the set and then asks for a request over
  // its own choice, the constraint proves the answer matches the declared set and says
  // nothing about whether the set was complete — which is a much weaker claim than the
  // one worth making.
  //
  // So the required set is read from the register itself, on-chain, on the auditor's
  // side: every commitment the contract holds, in the contract's own order.
  const onChain = cast(["call", dep.pool, "allCommitments()(bytes32[])", "--rpc-url", RPC])
    .replace(/[\[\]\s]/g, "")
    .split(",")
    .filter(Boolean);

  const known = new Map(notes.map((n) => [BigInt(n.commitment).toString(), n]));
  let required = onChain.map((c) => ({ commitment: c, note: known.get(BigInt(c).toString()) }));

  // A SPENT commitment is not a position, and the register having spent some is public:
  // every `transact` publishes its input nullifiers in the Transacted event, so anyone
  // counting can see that two positions were retired. WHICH two is what stays hidden, and
  // that is the confidentiality this register is for.
  //
  // So the auditor's set is the commitments the contract holds MINUS the retired ones, and
  // the count of retirements is checked against the chain rather than taken on trust — if
  // the register claimed a retirement the event log does not show, this refuses to proceed.
  // Read the receipts of the transfers the register recorded, rather than scanning logs:
  // Monad caps eth_getLogs at a 100-block range, so a from-block-0 sweep is not available.
  // Each receipt is fetched by hash and its Transacted topic counted, which is bounded and
  // exact — and still a chain read, not the ledger vouching for itself.
  const TRANSACTED = cast(["sig-event", "Transacted(bytes32,bytes32,uint256,address)"]).trim();
  const transferTxs = [...new Set(notes.filter((n) => n.origin === "transact")
    .map((n) => n.depositTx).filter(Boolean))];
  const retiredOnChain = transferTxs.reduce((sum, tx) => {
    const receipt = cast(["receipt", tx, "--rpc-url", RPC]);
    return sum + (receipt.includes(TRANSACTED) ? 2 : 0);   // two inputs nullified per transfer
  }, 0);
  const retiredClaimed = required.length - required.filter((r) => r.note).length;
  if (retiredClaimed !== retiredOnChain) {
    console.log(`the register accounts for ${retiredClaimed} retired commitment(s) but the chain shows ${retiredOnChain}.`);
    console.log("Refusing to enumerate a set the event log does not corroborate.");
    process.exit(1);
  }
  if (retiredOnChain) {
    console.log(`${retiredOnChain} commitment(s) were retired by a shielded transfer and are not positions.`);
    required = required.filter((r) => r.note);
  }

  if (required.length > AGG_SLOTS) {
    console.log(
      `the register holds ${required.length} live positions; this circuit is fixed at ${AGG_SLOTS} slots.\n` +
      `A wider set needs a wider circuit — answering over a subset would be exactly the\n` +
      `cherry-picking this design exists to prevent, so it is refused rather than trimmed.`,
    );
    process.exit(1);
  }
  const missing = required.filter((r) => !r.note);
  if (missing.length) {
    console.log(`cannot open ${missing.length} of the register's positions — they belong to another holder.`);
    console.log("An aggregate over the whole register needs every holder to contribute; refusing to answer partially.");
    process.exit(1);
  }

  const used = required.map((r) => r.note);
  console.log(`the auditor enumerated ${used.length} position(s) from the register on-chain`);

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
    ctx, kind: "aggregate", subject: 0n,   // the set is named by the context hash
    claim: claimHash("aggregate", capUnits),
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
