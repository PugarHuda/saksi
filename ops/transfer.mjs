// Move a position inside the register — the shielded half, and the reason the commitment
// scheme is there at all.
//
//   node ops/transfer.mjs --as issuer            # re-split two notes, nothing leaves
//   node ops/transfer.mjs --as issuer --dry
//
// An ENTRY is public: deposit() takes a plaintext amount from a visible sender and emits
// both. So the map from a commitment to its opening amount and its first owner is readable
// by anyone. This is the operation that breaks that link. Two notes are spent — their
// nullifiers published, the notes themselves never named — and two fresh commitments are
// inserted. Value is conserved inside the circuit. Nothing on-chain says which inputs
// became which outputs, or what either is worth.
//
// The note tree lives off-chain because Poseidon has no cheap Solidity implementation, so
// the owner publishes its root. Every leaf is emitted by the contract, so anyone can
// rebuild the tree from the event log and check the root — which is exactly what this
// script does before publishing: it reads allCommitments() from the chain rather than
// trusting the local ledger, so a root can only be published for a tree the register
// itself produced.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as snarkjs from "snarkjs";
import { CAST, ROOT, RPC, readDeployment, readOrExit, succeeded, txHashOf, writeJson } from "./env.mjs";
import { makePoseidon, buildTree } from "./merkle.mjs";
import { writePublicIndex } from "./note.mjs";

const LEVELS = 10;
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const dep = readDeployment();
const dry = process.argv.includes("--dry");
// `--as` with nothing after it used to yield undefined, which matched no wallet and fell
// through to the issuer — so a typo spent the ISSUER's positions and said nothing.
const asLabel = (() => {
  const i = process.argv.indexOf("--as");
  if (i < 0) return "issuer";
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) { console.error("--as needs a holder label"); process.exit(1); }
  return v;
})();

const run = (args) => execFileSync(CAST, args, { encoding: "utf8" });
const call = (to, sig, ...a) => run(["call", to, sig, ...a, "--rpc-url", RPC]).trim();
const send = (pk, args) =>
  run(["send", ...args, "--rpc-url", RPC, "--chain", "10143", "--gas-limit", "5000000",
       "--private-key", pk]);

// wallets.json is gitignored — it holds keys — so from a clone it is simply absent, and
// this read used to end the script in an ENOENT stack trace. The issuer from .env is the
// honest fallback: it is the one holder a clone can be configured for.
const wallets = fs.existsSync(path.join(ROOT, "wallets.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "wallets.json"), "utf8"))
  : [];
const owner = [...wallets].reverse().find((w) => w.label === "issuer" && w.priv)
  ?? { address: process.env.DEPLOYER_ADDRESS, priv: process.env.DEPLOYER_PK };
const spender = [...wallets].reverse().find((w) => w.label === asLabel && w.priv) ?? owner;
if (!spender.priv || !spender.address) {
  console.error(`no key for '${asLabel}' — wallets.json is absent and DEPLOYER_PK/DEPLOYER_ADDRESS are not set.`);
  process.exit(1);
}

const notes = readOrExit("notes.json", "no positions to spend — run `node ops/deposit.mjs 250` first.");
const mine = notes.filter((n) => n.wallet?.toLowerCase() === spender.address.toLowerCase());
if (mine.length < 2) {
  console.error(`${asLabel} holds ${mine.length} position(s); a JoinSplit spends two.`);
  console.error("Deposit twice from the same wallet, or pass --as for a holder that has.");
  process.exit(1);
}
const ins = mine.slice(0, 2);

// ---- 1. the tree the register itself produced ------------------------------

// allCommitments() is the authority, not notes.json: the leaf INDEX is inside the
// nullifier, so a tree built in the wrong order yields a nullifier the contract has never
// heard of and the spend is unprovable against the published root.
const raw = call(dep.pool, "allCommitments()(bytes32[])");
const onChain = raw.replace(/[[\]\s]/g, "").split(",").filter(Boolean);
console.log(`register holds ${onChain.length} commitment(s), read from the pool`);

const { h1, h2, h3 } = await makePoseidon();
const leaves = onChain.map((c) => BigInt(c));
const tree = buildTree(h2, leaves, LEVELS);
console.log(`note root    ${tree.root}`);

const indexOf = (commitment) => {
  const i = onChain.findIndex((c) => BigInt(c) === BigInt(commitment));
  if (i < 0) throw new Error(`commitment ${commitment} is not in the register`);
  return i;
};

// ---- 2. the spend ----------------------------------------------------------

const inNotes = ins.map((n) => ({
  amount: BigInt(n.amount),
  privKey: BigInt(n.privKey),
  blinding: BigInt(n.blinding),
  index: indexOf(n.commitment),
  commitment: BigInt(n.commitment),
}));

const total = inNotes.reduce((s, n) => s + n.amount, 0n);

// Leaving the register is the other half, and it is the edge Cleanverse is most opinionated
// about: every address that receives a CVA needs a credential. So `transact` calls
// complianceVerify on their validator for the RECIPIENT, and again for the RELAYER if a fee
// is paid — two live compliance checks that exist only on this path.
//
//   node ops/transfer.mjs --as issuer --withdraw 50 --to 0x… --relayer 0x… --fee 0.5
//
// A withdrawal of x is encoded as publicAmount = FIELD - x, because the circuit constrains
// sumIn + publicAmount === sumOut over the field. A positive publicAmount is refused by the
// contract as DepositsUseDepositPath: deposits have their own gated entry and must not be
// able to arrive through the spend path.
// A flag with nothing after it read as `undefined`, which every caller below treats as "not
// passed" — and a flag followed by ANOTHER flag ate it as its value: `--to-label --withdraw
// 50` set the recipient label to "--withdraw" and still withdrew 50.
const argOf = (flag, dflt = null) => {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) { console.error(`${flag} needs a value`); process.exit(1); }
  return v;
};
// An amount the register cannot represent must not reach the circuit. Number("abc") is NaN
// and Number("1e400") is Infinity; both throw out of BigInt, but a negative does not — it
// builds a commitment over a field-wrapped amount and only fails at the contract.
const toUnits = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) { console.error(`not a valid amount: ${v}`); process.exit(1); }
  return BigInt(Math.round(n * 1e6));
};

const withdrawUnits = argOf("--withdraw") ? toUnits(argOf("--withdraw")) : 0n;
// A real recipient. outPubkey is a PRIVATE input to the circuit, so paying someone else
// needs no recompile, no new ceremony and no redeploy — and until it was wired, every
// output of every transfer here was keyed to the sender's own fresh key, which means
// nothing had ever changed hands. A register whose positions cannot move to another
// person is a vault with a disclosure API.
const toPubKey = argOf("--to-pubkey") ? BigInt(argOf("--to-pubkey")) : null;
// A label becomes a filename, so it is a path fragment with no validation between it and
// the disk. "public" resolves to notes.public.json, which .gitignore deliberately
// un-ignores — so it would write a live spending key into a tracked file. "../../x"
// escapes the repository altogether. This project has leaked commitment openings twice;
// this was a third route to the same place.
const LABEL_OK = (l) =>
  /^[a-z0-9_-]{1,32}$/i.test(l) && l.toLowerCase() !== "public";   // notes.public.json is tracked
const toLabel = argOf("--to-label");
if (toLabel && !LABEL_OK(toLabel)) {
  console.error("--to-label must be letters, digits, _ or - : it becomes a filename");
  process.exit(1);
}
if (toPubKey && !toLabel) {
  console.error("--to-pubkey needs --to-label: the recipient's note has to be written somewhere");
  process.exit(1);
}
const recipient = argOf("--to", "0x0000000000000000000000000000000000000000");
const relayer = argOf("--relayer", "0x0000000000000000000000000000000000000000");
const fee = argOf("--fee") ? toUnits(argOf("--fee")) : 0n;

if (withdrawUnits > total) {
  console.error(`cannot withdraw ${Number(withdrawUnits) / 1e6} from notes worth ${Number(total) / 1e6}`);
  process.exit(1);
}
if (withdrawUnits === 0n && fee !== 0n) {
  console.error("a fee is only payable out of a withdrawal — the contract refuses it otherwise");
  process.exit(1);
}
if (fee > withdrawUnits) {
  console.error("the relayer's fee cannot exceed the withdrawal it is paid from");
  process.exit(1);
}
if (withdrawUnits > 0n && /^0x0{40}$/i.test(recipient)) {
  console.error("--withdraw needs --to: paying out to the zero address burns the tokens, and");
  console.error("only the validator refusing address(0) stands between you and that.");
  process.exit(1);
}

// The split must be RANDOM, and this is not a nicety. A fixed ratio in a public repository
// is a public constant, and deposits are plaintext, so an observer could compute every note
// in the register by arithmetic and the shielding would buy nothing. An earlier version of
// this file split 37/63 while the comment above it claimed the amounts "cannot be recovered
// by inspection" — they could, from this file.
const remaining = total - withdrawUnits;
const pick = (n) => {
  const b = crypto.getRandomValues(new Uint32Array(1))[0];
  return (BigInt(b) * n) / 4294967296n;
};
// Keep both sides off the extremes: a zero-value output takes the circuit's dummy branch on
// its next spend, which skips the Merkle check and burns a tree slot for nothing.
const lo = remaining / 5n;
const outA = remaining === 0n ? 0n : lo + pick(remaining - 2n * lo);
const outB = remaining - outA;

// Fresh keys for the outputs. The whole point is that the new notes are not linkable to
// the old ones, so they must not reuse the spending key.
const rand = () => {
  let v;
  do { v = BigInt("0x" + crypto.getRandomValues(new Uint8Array(31)).reduce(
    (s, b) => s + b.toString(16).padStart(2, "0"), "")); } while (v >= FIELD || v === 0n);
  return v;
};
// Output 0 goes to the recipient when one is named, output 1 is always the sender's change.
// The recipient's slot carries THEIR public key and no private key at all — this process
// cannot spend what it is about to send, which is the whole difference between a transfer
// and a re-labelling.
const outs = [
  toPubKey
    ? { amount: outA, pubKey: toPubKey, blinding: rand(), privKey: null, to: toLabel }
    : { amount: outA, privKey: rand(), blinding: rand() },
  { amount: outB, privKey: rand(), blinding: rand() },
].map((o) => {
  const pubKey = o.pubKey ?? h1(o.privKey);
  return { ...o, pubKey, commitment: h3(o.amount, pubKey, o.blinding) };
});

// cast prints a decimal followed by a human-readable exponent — "1234… [1.2e75]" — so the
// annotation has to come off before this is a number.
const extDataHash = BigInt(
  call(dep.pool, "extDataHashOf(address,address,uint256)(uint256)",
       recipient, relayer, fee.toString())
    .split(/\s+/)[0],
);

const input = {
  root: tree.root.toString(),
  publicAmount: (withdrawUnits === 0n ? 0n : FIELD - withdrawUnits).toString(),
  extDataHash: extDataHash.toString(),
  inputNullifier: inNotes.map((n) => h3(n.commitment, BigInt(n.index), n.privKey).toString()),
  outputCommitment: outs.map((o) => o.commitment.toString()),
  inAmount: inNotes.map((n) => n.amount.toString()),
  inPrivKey: inNotes.map((n) => n.privKey.toString()),
  inBlinding: inNotes.map((n) => n.blinding.toString()),
  inLeafIndex: inNotes.map((n) => n.index.toString()),
  inPathElements: inNotes.map((n) => tree.proof(n.index).pathElements.map((x) => x.toString())),
  outAmount: outs.map((o) => o.amount.toString()),
  outPubkey: outs.map((o) => o.pubKey.toString()),
  outBlinding: outs.map((o) => o.blinding.toString()),
};

console.log(`\nspending ${asLabel}'s notes at leaves ${inNotes.map((n) => n.index).join(" and ")}`);
console.log(`  in   ${inNotes.map((n) => Number(n.amount) / 1e6).join(" + ")} = ${Number(total) / 1e6}`);
console.log(`  out  ${outs.map((o) => Number(o.amount) / 1e6).join(" + ")} = ${Number(remaining) / 1e6}  (never published)`);
if (withdrawUnits) {
  console.log(`  exit ${Number(withdrawUnits) / 1e6} to ${recipient}` + (fee ? `, of which ${Number(fee) / 1e6} to the relayer ${relayer}` : ""));
  console.log("       the contract checks both against Cleanverse's validator");
}

const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input,
  path.join(ROOT, "circuits", "build", "transfer_js", "transfer.wasm"),
  path.join(ROOT, "circuits", "build", "transfer_final.zkey"),
);
const vkey = JSON.parse(fs.readFileSync(
  path.join(ROOT, "circuits", "build", "transfer_vk.json"), "utf8"));
if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) {
  throw new Error("transfer proof does not verify locally");
}
console.log(`\ntransfer proof   proved and verified in ${Date.now() - t0} ms`);

const cd = JSON.parse("[" + await snarkjs.groth16.exportSolidityCallData(proof, publicSignals) + "]");
const [pA, pB, pC, pub] = cd;

const expectedPublic = withdrawUnits === 0n ? 0n : FIELD - withdrawUnits;
if (BigInt(pub[1]) !== expectedPublic) throw new Error("publicAmount disagrees with the withdrawal");
if (BigInt(pub[2]) !== extDataHash) throw new Error("extDataHash disagrees with the pool");

if (dry) {
  console.log("\n--dry: not sending");
  process.exit(0);
}

// ---- 3. publish the root, then spend against it ----------------------------

const known = call(dep.pool, "knownNoteRoot(uint256)(bool)", tree.root.toString());
if (known !== "true") {
  console.log("\npublishing the note root…");
  console.log(send(owner.priv, [dep.pool, "publishNoteRoot(uint256)", tree.root.toString()])
    .split("\n").filter((l) => /^(status|transactionHash|blockNumber)/.test(l)).join("\n"));
}

const fmt = (x) => `[${x.join(",")}]`;
const fmt2 = (x) => `[[${x[0].join(",")}],[${x[1].join(",")}]]`;

// Persist the output secrets BEFORE the send. Between the transaction landing and the
// ledger being written, a crash takes the privKey and blinding of both change notes with
// it — and the commitments are already in the tree, so there is no recovery. deposit.mjs
// writes its artifact first; this file did not.
const hexOf = (v) => "0x" + v.toString(16).padStart(64, "0");
fs.mkdirSync(path.join(ROOT, ".artifacts"), { recursive: true });
// One file per transfer, not one slot. `last-transfer.json` was overwritten by the next
// run — so the recovery copy written before the send survived only until the operator did
// the obvious thing after a crash, which is to run the script again.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeJson(
  path.join(ROOT, ".artifacts", `transfer-${stamp}.json`),
  {
    spender: spender.address,
    spent: inNotes.map((n) => hexOf(n.commitment)),
    outputs: outs.map((o) => ({
      amount: o.amount.toString(),
      commitment: hexOf(o.commitment),
      // A note paid to someone else has no key here, and that absence is the point of the
      // whole operation — this process cannot spend what it is sending.
      privKey: o.privKey ? o.privKey.toString() : null,
      to: o.to ?? null,
      // Not the recipient's. The private key controls SPENDING; the blinding controls
      // DISCLOSURE — every disclosure circuit takes (amount, pubKey, blinding) and no key
      // at all. Keeping it would leave the sender able to answer any audit about a note
      // they gave away, including publishing its exact figure first and closing the
      // request forever. Hygiene rather than proof: this process generated the blinding
      // and the recipient has to trust it was not kept elsewhere. The structural fix is
      // for the recipient to supply it with their public key.
      blinding: o.to ? null : o.blinding.toString(),
    })),
    noteRoot: tree.root.toString(),
    withdraw: withdrawUnits.toString(),
    at: new Date().toISOString(),
  },
);

// The recipient's ledger, also BEFORE the send, and this one is not a nicety.
//
// The artifact above deliberately withholds the recipient's blinding — the sender should
// not keep a disclosure witness for a note they gave away. That left notes.<label>.json,
// written after the send, as the ONLY place that blinding was ever recorded. Kill the
// process between the transaction landing and that write and the recipient's commitment is
// in the tree with no opening anywhere on earth: unspendable, undisclosable, permanent.
// Written first, `depositTx` is filled in afterwards; a phantom row from a reverted send is
// recoverable, a lost blinding is not.
const recipientLedgers = [];
for (const o of outs.filter((x) => x.to)) {
  const rf = path.join(ROOT, `notes.${o.to}.json`);
  const led = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, "utf8")) : { label: o.to, notes: [] };
  led.notes.push({
    amount: o.amount.toString(),
    amountDisplay: Number(o.amount) / 1e6,
    commitment: hexOf(o.commitment),
    blinding: o.blinding.toString(),
    pubKey: o.pubKey.toString(),
    noteRoot: tree.root.toString(),
    origin: "received",
    from: spender.address,
    receivedAt: new Date().toISOString(),
    depositTx: null,                 // filled in once the transaction is known to have landed
  });
  writeJson(rf, led);
  recipientLedgers.push({ file: rf, commitment: hexOf(o.commitment), to: o.to });
}

console.log("\ntransacting…");
const out = send(spender.priv, [dep.pool,
  "transact(uint256[2],uint256[2][2],uint256[2],uint256[7],address,address,uint256)",
  fmt(pA), fmt2(pB), fmt(pC), fmt(pub), recipient, relayer, fee.toString()]);
console.log(out.split("\n").filter((l) => /^(status|transactionHash|gasUsed|blockNumber)/.test(l)).join("\n"));
if (!succeeded(out)) {
  // The recipient rows were written before the send, deliberately. A REVERT is the one case
  // where we know for certain the commitment is not in the tree, so the pending row can be
  // taken back out — otherwise writePublicIndex would later publish a position the register
  // does not hold. A crash instead of a revert leaves the row, which is the safe direction:
  // a phantom row is visible and fixable, a lost blinding is neither.
  for (const { file, commitment } of recipientLedgers) {
    const led = JSON.parse(fs.readFileSync(file, "utf8"));
    led.notes = led.notes.filter((n) => !(n.commitment === commitment && !n.depositTx));
    writeJson(file, led);
  }
  throw new Error("transact reverted — nothing recorded");
}

const txHash = txHashOf(out);

// Record the spend where the auditor can count it. ops/audit.mjs derives the number of
// RETIRED commitments by reading these receipts from the chain — two inputs per transfer —
// and compares it against the commitments this machine cannot open. A transfer missing from
// this list makes the two disagree and the aggregate refuses, which is the safe direction
// but only because the list is written here rather than maintained by hand.
const TRANSFERS = path.join(ROOT, "transfers.json");
const transfers = fs.existsSync(TRANSFERS) ? JSON.parse(fs.readFileSync(TRANSFERS, "utf8")) : [];
if (txHash && !transfers.includes(txHash)) transfers.push(txHash);
writeJson(TRANSFERS, transfers);

// The recipient's note is already on disk; name the transaction that carried it.
for (const { file, commitment, to } of recipientLedgers) {
  const led = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const n of led.notes) if (n.commitment === commitment && !n.depositTx) n.depositTx = txHash;
  writeJson(file, led);
  console.log(`\n${to} received a position, and only ${to} can spend it — this`);
  console.log(`process never held the key. Written to notes.${to}.json`);
}

// The spent notes are gone and the new ones are the register's; record them so the next
// aggregate proof enumerates what the pool actually holds.
const kept = notes.filter((n) => !ins.some((i) => i.commitment === n.commitment));
for (const o of outs) {
  if (o.to) continue;              // already written to the recipient's own ledger, above
  kept.push({
    wallet: spender.address,
    amount: o.amount.toString(),
    amountDisplay: Number(o.amount) / 1e6,
    commitment: hexOf(o.commitment),
    privKey: o.privKey.toString(),
    blinding: o.blinding.toString(),
    pubKey: o.pubKey.toString(),
    aspRoot: dep.aspRoot,
    noteRoot: tree.root.toString(),
    origin: "transact",
    provedAt: new Date().toISOString(),
    depositTx: txHash,
  });
}
writeJson(path.join(ROOT, "notes.json"), kept);
// Derive the index from every ledger on disk rather than from this transfer's own view.
// Rebuilding it from `kept` plus THIS transfer's recipients dropped every earlier
// recipient: a second transfer to a second holder published an index that had quietly
// forgotten the first one's position, and evidence.mjs counts rows in this file.
writePublicIndex();

// Publish the root that contains the leaves this transfer just inserted. Without it the
// new positions — including one paid to someone else — have no Merkle path into any known
// root, so nobody can spend them, and the recipient would depend on the sender choosing to
// act again. The sender should not hold that veto over a note they have given away.
{
  const after = call(dep.pool, "allCommitments()(bytes32[])")
    .replace(/[[\]\s]/g, "").split(",").filter(Boolean).map((c) => BigInt(c));
  const next = buildTree(h2, after, LEVELS);
  if (call(dep.pool, "knownNoteRoot(uint256)(bool)", next.root.toString()) !== "true") {
    console.log("\npublishing the root that contains the new leaves…");
    console.log(
      send(owner.priv, [dep.pool, "publishNoteRoot(uint256)", next.root.toString()])
        .split("\n").filter((l) => /^(status|blockNumber)/.test(l)).join("  "),
    );
  }
}

console.log(`\ntwo notes spent, two created. tx ${txHash}`);
console.log("nullifiers published; which input became which output is not on chain.");
process.exit(0);
