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
import { ROOT, RPC, readDeployment } from "./env.mjs";
import { makePoseidon, buildTree } from "./merkle.mjs";

const LEVELS = 10;
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const dep = readDeployment();
const dry = process.argv.includes("--dry");
const asLabel = (() => {
  const i = process.argv.indexOf("--as");
  return i > 0 ? process.argv[i + 1] : "issuer";
})();

const CAST = fs.existsSync(path.join(process.env.USERPROFILE ?? "", ".foundry", "bin", "cast.exe"))
  ? path.join(process.env.USERPROFILE, ".foundry", "bin", "cast.exe")
  : "cast";
const run = (args) => execFileSync(CAST, args, { encoding: "utf8" });
const call = (to, sig, ...a) => run(["call", to, sig, ...a, "--rpc-url", RPC]).trim();
const send = (pk, args) =>
  run(["send", ...args, "--rpc-url", RPC, "--chain", "10143", "--gas-limit", "5000000",
       "--private-key", pk]);

const wallets = JSON.parse(fs.readFileSync(path.join(ROOT, "wallets.json"), "utf8"));
const owner = [...wallets].reverse().find((w) => w.label === "issuer" && w.priv)
  ?? { address: process.env.DEPLOYER_ADDRESS, priv: process.env.DEPLOYER_PK };
const spender = [...wallets].reverse().find((w) => w.label === asLabel && w.priv) ?? owner;

const notes = JSON.parse(fs.readFileSync(path.join(ROOT, "notes.json"), "utf8"));
const mine = notes.filter((n) => n.wallet.toLowerCase() === spender.address.toLowerCase());
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
const argOf = (flag, dflt = null) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const toUnits = (v) => BigInt(Math.round(Number(v) * 1e6));

const withdrawUnits = argOf("--withdraw") ? toUnits(argOf("--withdraw")) : 0n;
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
const outs = [
  { amount: outA, privKey: rand(), blinding: rand() },
  { amount: outB, privKey: rand(), blinding: rand() },
].map((o) => {
  const pubKey = h1(o.privKey);
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
fs.writeFileSync(
  path.join(ROOT, ".artifacts", "last-transfer.json"),
  JSON.stringify({
    spender: spender.address,
    spent: inNotes.map((n) => hexOf(n.commitment)),
    outputs: outs.map((o) => ({
      amount: o.amount.toString(),
      commitment: hexOf(o.commitment),
      privKey: o.privKey.toString(),
      blinding: o.blinding.toString(),
    })),
    noteRoot: tree.root.toString(),
    withdraw: withdrawUnits.toString(),
    at: new Date().toISOString(),
  }, null, 2),
);

console.log("\ntransacting…");
const out = send(spender.priv, [dep.pool,
  "transact(uint256[2],uint256[2][2],uint256[2],uint256[7],address,address,uint256)",
  fmt(pA), fmt2(pB), fmt(pC), fmt(pub), recipient, relayer, fee.toString()]);
console.log(out.split("\n").filter((l) => /^(status|transactionHash|gasUsed|blockNumber)/.test(l)).join("\n"));
if (!/^status\s+1/m.test(out)) throw new Error("transact reverted — nothing recorded");

const txHash = /transactionHash\s+(0x[0-9a-f]+)/.exec(out)?.[1];

// The spent notes are gone and the new ones are the register's; record them so the next
// aggregate proof enumerates what the pool actually holds.
const kept = notes.filter((n) => !ins.some((i) => i.commitment === n.commitment));
for (const o of outs) {
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
fs.writeFileSync(path.join(ROOT, "notes.json"), JSON.stringify(kept, null, 2) + "\n");
fs.writeFileSync(
  path.join(ROOT, "notes.public.json"),
  JSON.stringify(kept.map(({ commitment, depositTx, provedAt, aspRoot, origin }) =>
    ({ commitment, depositTx, provedAt, aspRoot, origin })), null, 2) + "\n",
);

console.log(`\ntwo notes spent, two created. tx ${txHash}`);
console.log("nullifiers published; which input became which output is not on chain.");
process.exit(0);
