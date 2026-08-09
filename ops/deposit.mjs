// Enter the register: prove eligibility in zero knowledge, then deposit CVA.
//
//   node ops/deposit.mjs 250            # deposit 250 notes from the issuer wallet
//   node ops/deposit.mjs 250 --dry      # build and verify the proof, do not send
//
// What actually happens, in order:
//   1. Look the caller up in the association set the issuer anchored on-chain, and take
//      its Merkle path. If the wallet is not in the set — because its A-Pass was frozen
//      and the set was rebuilt without it — there is no path and no proof exists.
//   2. Build a note, and bind the proof to it: bindHash is the commitment, sourceKey is
//      keccak(caller). A proof for one wallet is useless from another, and a proof for
//      one note cannot be presented for a different one.
//   3. Prove, verify locally, then send. The pool re-checks every public signal against
//      chain state before it looks at the pairing, so a proof that disagrees with the
//      register's own view of the deny list or the root is refused before any maths.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as snarkjs from "snarkjs";
import { makePoseidon, buildTree } from "./merkle.mjs";
import { noteTools, randomField, saveNote, writePublicIndex } from "./note.mjs";
import { sourceKeyOf } from "./asp.mjs";
import { CAST, ROOT, RPC, readAsp, readDeployment, succeeded, txHashOf, writeJson } from "./env.mjs";

const dep = readDeployment();
const asp = readAsp();
// Which holder is entering. The register's whole point is that several PEOPLE hold
// positions in it, not that one wallet holds several notes, so the depositor has to be
// selectable:  node ops/deposit.mjs 640 --as fund
// `--as` with nothing after it yielded undefined, which is falsy — so the script quietly
// deposited from the ISSUER wallet instead of the holder the operator meant to name.
const asLabel = (() => {
  const i = process.argv.indexOf("--as");
  if (i < 0) return null;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) { console.error("--as needs a holder label"); process.exit(1); }
  return v;
})();
const holder = (() => {
  if (!asLabel) return { address: process.env.DEPLOYER_ADDRESS, priv: process.env.DEPLOYER_PK };
  // wallets.json is gitignored, so a clone does not have it — say that instead of ENOENT.
  const f = path.join(ROOT, "wallets.json");
  if (!fs.existsSync(f)) {
    console.error(`--as ${asLabel} needs wallets.json, which is not in this clone (it holds keys).`);
    console.error("Run `node ops/apass.mjs new <label> <ISO2>` to create one, or drop --as to");
    console.error("deposit from the issuer wallet in .env.");
    process.exit(1);
  }
  const ws = JSON.parse(fs.readFileSync(f, "utf8"));
  // Last match wins: seed-holders appends, so the freshest wallet for a label is the live
  // one — an older entry for the same label has already spent its balance.
  const w = [...ws].reverse().find((x) => x.label === asLabel && x.priv);
  if (!w) {
    console.error(`no wallet labelled ${asLabel} carrying a key in wallets.json`);
    process.exit(1);
  }
  return w;
})();
const who = holder.address;
const pk = holder.priv;
if (!/^0x[0-9a-fA-F]{40}$/.test(who ?? "") || !pk) {
  console.error("no depositor — set DEPLOYER_ADDRESS and DEPLOYER_PK in .env (see README), or pass --as.");
  process.exit(1);
}
if (!dep.pool || !dep.asset) {
  console.error("deployment.json has no `pool`/`asset` — deploy first, then run ops/setup-pool.mjs.");
  process.exit(1);
}
const dry = process.argv.includes("--dry");
// argv[2] is positional, so `node ops/deposit.mjs --dry` read "--dry" as the amount. NaN and
// Infinity throw out of BigInt loudly enough, but 0 and a negative did not: a zero-value
// note costs a full proving run and a deposit transaction to insert a leaf that takes the
// circuit's dummy branch on its next spend, and a negative reached `cast` as a uint256
// argument. Both are operator typos, and neither should get as far as the prover.
const amountUnits = Number(process.argv[2] ?? 250);
if (!Number.isFinite(amountUnits) || amountUnits <= 0) {
  console.error(`usage: node ops/deposit.mjs <amount> [--as <label>] [--dry]   (got ${JSON.stringify(process.argv[2])})`);
  process.exit(1);
}
const amount = BigInt(Math.round(amountUnits * 1e6));      // 6 decimals

const cast = (args) => execFileSync(CAST, args, { encoding: "utf8" }).trim();

// ---- 1. membership witness -------------------------------------------------

const member = asp.members.find((m) => m.wallet && m.wallet.toLowerCase() === who.toLowerCase());
if (!member) {
  console.error(`${who} is not in the current association set (root ${asp.root}).`);
  console.error("Its A-Pass is frozen, expired, or below the rule — there is no proof to build.");
  process.exit(1);
}

const { h2 } = await makePoseidon();
const leaves = asp.members.map((m) => BigInt(m.sourceKey));
const tree = buildTree(h2, leaves, asp.levels);
if (tree.root.toString() !== asp.root) throw new Error("rebuilt root disagrees with asp.json");
const { pathElements, leafIndex } = tree.proof(member.index);

// ---- 2. the note -----------------------------------------------------------

const t = await noteTools();
const privKey = randomField();
const blinding = randomField();
const pubKey = t.pubKey(privKey);
const commitment = t.commitment(amount, pubKey, blinding);

const sourceKey = sourceKeyOf(who);
// Read the pool's list, do not assume it. The comment here used to say "must equal the
// pool's on-chain list" beside an array of zeros, which was true until a real sanctions
// entry was set — after which every deposit reverted DenyListMismatch, including the one the
// README hands a judge as the quickstart.
const denyList = cast(["call", dep.pool, "getDenyList()(uint256[8])", "--rpc-url", RPC])
  .replace(/^\[|\]$/g, "")
  .split(",")
  // cast glues a human-readable exponent onto each element — "5685… [5.685e75]" — so the
  // annotation comes off per element; stripping brackets globally merges digits with it.
  .map((x) => BigInt((x.trim().match(/^\d+/) ?? ["0"])[0]));

const input = {
  aspRoot: asp.root,
  denyList: denyList.map(String),
  sourceKey: sourceKey.toString(),
  bindHash: commitment.toString(),            // the pool pins this to the commitment
  pathElements: pathElements.map(String),
  leafIndex: String(leafIndex),
};

console.log(`caller       ${who}  (leaf ${leafIndex} of ${asp.members.length})`);
console.log(`amount       ${amountUnits} ${dep.assetSymbol}`);
console.log(`commitment   0x${commitment.toString(16).padStart(64, "0")}`);

// ---- 3. prove --------------------------------------------------------------

const art = (name) => ({
  wasm: path.join(ROOT, `circuits/build/${name}_js/${name}.wasm`),
  zkey: path.join(ROOT, `circuits/build/${name}_final.zkey`),
  vkey: JSON.parse(fs.readFileSync(path.join(ROOT, `circuits/build/${name}_vk.json`), "utf8")),
});

async function prove(name, inputs, label) {
  const { wasm, zkey, vkey } = art(name);
  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, wasm, zkey);
  if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) {
    throw new Error(`${name}: proof does not verify locally — do not send it`);
  }
  console.log(`  ${label.padEnd(18)} proved and verified in ${Date.now() - t0} ms`);
  // The JS API takes (proof, publicSignals); the CLI takes them the other way round.
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  return JSON.parse("[" + calldata + "]");
}

console.log("\nproving…");

// Proof one: who may enter. Binds this caller and this commitment, but says nothing
// about value — the compliance circuit's own header is explicit that a separate proof
// must tie the commitment to an amount.
const [pA, pB, pC, pub] = await prove("compliance", input, "compliance");

// Proof two: what is entering. Opens the commitment and shows it contains exactly the
// amount being transferred. Without it a depositor could move one unit and commit to a
// million, and the JoinSplit would carry the forgery out the other side.
const [bA, bB, bC, bind] = await prove(
  "disclosure",
  {
    commitment: commitment.toString(),
    disclosedAmount: amount.toString(),
    auditContextHash: "0",      // entry binding answers no auditor's question
    amount: amount.toString(),
    pubKey: pubKey.toString(),
    blinding: blinding.toString(),
  },
  "value binding",
);

if (BigInt(bind[0]) !== commitment) throw new Error("binding proof names a different commitment");
if (BigInt(bind[1]) !== amount) throw new Error("binding proof names a different amount");

const commitmentHex = "0x" + commitment.toString(16).padStart(64, "0");
if (BigInt(pub[10]) !== commitment) throw new Error("bindHash is not the commitment");
if (BigInt(pub[9]) !== sourceKey) throw new Error("sourceKey is not this caller");

const artifact = {
  wallet: who,
  amount: amount.toString(),
  amountDisplay: amountUnits,
  commitment: commitmentHex,
  privKey: privKey.toString(),
  blinding: blinding.toString(),
  pubKey: pubKey.toString(),
  aspRoot: asp.root,
  leafIndex,
  proof: { pA, pB, pC, pub },
  binding: { bA, bB, bC, bind },
  provedAt: new Date().toISOString(),
};
// .artifacts is gitignored, so from a clone the directory does not exist and this threw
// ENOENT after the proving had already been paid for. transfer.mjs creates it; this did not.
fs.mkdirSync(path.join(ROOT, ".artifacts"), { recursive: true });
// One file per deposit, keyed by the commitment it opens. This was a single slot called
// last-deposit.json, which meant the pre-send copy of the blinding — the only thing standing
// between a crash after broadcast and a permanently unspendable position — was destroyed by
// the very next deposit. After a crash the operator's instinct is to run the script again,
// and that is exactly what erased the recovery data.
const ARTIFACT = path.join(ROOT, ".artifacts", `deposit-${commitmentHex.slice(2, 18)}.json`);
writeJson(ARTIFACT, artifact);

if (dry) { console.log("\n--dry: not sending"); process.exit(0); }

// ---- 4. send ---------------------------------------------------------------

const fmt = (x) => `[${x.join(",")}]`;
const fmt2 = (x) => `[[${x[0].join(",")}],[${x[1].join(",")}]]`;

console.log("\napproving the pool to pull the note…");
console.log(cast(["send", dep.asset, "approve(address,uint256)", dep.pool, amount.toString(),
  "--rpc-url", RPC, "--chain", "10143", "--private-key", pk]).split("\n")
  .filter((l) => /^(status|transactionHash)/.test(l)).join("\n"));

console.log("\ndepositing…");
const out = cast(["send", dep.pool,
  "deposit(uint256,bytes32,uint256[2],uint256[2][2],uint256[2],uint256[11],uint256[2],uint256[2][2],uint256[2],uint256[3])",
  amount.toString(), commitmentHex,
  fmt(pA), fmt2(pB), fmt(pC), fmt(pub),
  fmt(bA), fmt2(bB), fmt(bC), fmt(bind),
  // Monad's estimator replays this against a state where the approve above has not
  // settled, and reports the failure as InvalidProof rather than as a missing allowance.
  // The same calldata simulates clean with eth_call, so the estimate is what is wrong.
  // Fixed limit, generously above the ~2.91M two Groth16 verifications actually cost.
  "--gas-limit", "3100000",   // actual is ~2.91M; Monad charges the limit, so do not pad it
  "--rpc-url", RPC, "--chain", "10143", "--private-key", pk]);
const lines = out.split("\n").filter((l) => /^(status|transactionHash|gasUsed|blockNumber)/.test(l));
console.log(lines.join("\n"));

// A mined-but-reverted deposit still prints a transaction hash. Recording the note anyway
// would leave notes.json holding a position the pool never stored, and the next audit
// would prove against a commitment the contract has never heard of.
if (!succeeded(out)) {
  throw new Error("deposit transaction reverted — refusing to record a position the register does not hold");
}

const txHash = txHashOf(out);
artifact.depositTx = txHash;
saveNote(artifact);
writeJson(ARTIFACT, artifact);
// The published index is derived from the ledgers, and a deposit never touched it — only
// transfer.mjs rewrote it. So evidence.mjs, which counts rows in notes.public.json, reported
// a register smaller than the one the pool actually held until someone happened to transfer.
writePublicIndex();
// A deposit inserts a leaf, and a leaf outside the published note root has no Merkle path —
// so the position cannot be spent until someone advances the root. transfer.mjs republishes
// before it spends and therefore self-heals; a deposit does not, so every position entered
// since the last publish sat unspendable with nothing saying so. Two of them did.
//
// One owner transaction. The alternative is a register that quietly accepts value it cannot
// move, which is the failure a holder discovers at exactly the wrong moment.
{
  const { makePoseidon, buildTree } = await import("./merkle.mjs");
  // wallets.json is gitignored, so a clone does not have it. Unguarded, this threw ENOENT
  // AFTER the deposit had landed — leaving the position on chain with no known root
  // containing its leaf, which is the exact unspendable state this block exists to prevent.
  const wf = path.join(ROOT, "wallets.json");
  const wl = fs.existsSync(wf) ? JSON.parse(fs.readFileSync(wf, "utf8")) : [];
  const owner = [...wl].reverse().find((w) => w.label === "issuer" && w.priv)
    ?? { priv: process.env.DEPLOYER_PK };
  const onChain = cast(["call", dep.pool, "allCommitments()(bytes32[])", "--rpc-url", RPC])
    .replace(/[[\]\s]/g, "").split(",").filter(Boolean).map((c) => BigInt(c));
  const { h2 } = await makePoseidon();
  const root = buildTree(h2, onChain, asp.levels ?? 10).root.toString();
  if (cast(["call", dep.pool, "knownNoteRoot(uint256)(bool)", root, "--rpc-url", RPC]).trim() !== "true") {
    console.log("\nadvancing the note root so this position can be spent…");
    const out = cast(["send", dep.pool, "publishNoteRoot(uint256)", root,
      "--rpc-url", RPC, "--chain", "10143", "--private-key", owner.priv]);
    console.log("  " + out.split("\n").filter((l) => /^(status|blockNumber)/.test(l)).join("  "));
  }
}

console.log(`\nposition recorded. tx ${txHash}`);

// snarkjs leaves worker threads alive, so the process will not exit on its own.
process.exit(0);
