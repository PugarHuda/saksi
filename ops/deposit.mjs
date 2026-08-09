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
import { noteTools, randomField, saveNote, FIELD } from "./note.mjs";
import { sourceKeyOf } from "./asp.mjs";
import { ROOT, RPC, readDeployment } from "./env.mjs";

const dep = readDeployment();
const asp = JSON.parse(fs.readFileSync(path.join(ROOT, "asp.json"), "utf8"));
// Which holder is entering. The register's whole point is that several PEOPLE hold
// positions in it, not that one wallet holds several notes, so the depositor has to be
// selectable:  node ops/deposit.mjs 640 --as fund
const asLabel = (() => {
  const i = process.argv.indexOf("--as");
  return i > 0 ? process.argv[i + 1] : null;
})();
const holder = (() => {
  if (!asLabel) return { address: process.env.DEPLOYER_ADDRESS, priv: process.env.DEPLOYER_PK };
  const ws = JSON.parse(fs.readFileSync(path.join(ROOT, "wallets.json"), "utf8"));
  // Last match wins: seed-holders appends, so the freshest wallet for a label is the live
  // one — an older entry for the same label has already spent its balance.
  const w = [...ws].reverse().find((x) => x.label === asLabel && x.priv);
  if (!w) throw new Error(`no wallet labelled ${asLabel} carrying a key in wallets.json`);
  return w;
})();
const who = holder.address;
const pk = holder.priv;
const dry = process.argv.includes("--dry");
const amountUnits = Number(process.argv[2] ?? 250);
const amount = BigInt(Math.round(amountUnits * 1e6));      // 6 decimals

const CAST = fs.existsSync(path.join(process.env.USERPROFILE ?? "", ".foundry", "bin", "cast.exe"))
  ? path.join(process.env.USERPROFILE, ".foundry", "bin", "cast.exe")
  : "cast";
const cast = (args) => execFileSync(CAST, args, { encoding: "utf8" }).trim();

// ---- 1. membership witness -------------------------------------------------

const member = asp.members.find((m) => m.wallet.toLowerCase() === who.toLowerCase());
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
const denyList = new Array(8).fill(0n);       // must equal the pool's on-chain list

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
fs.writeFileSync(path.join(ROOT, ".artifacts", "last-deposit.json"), JSON.stringify(artifact, null, 2));

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
  "--gas-limit", "3600000",
  "--rpc-url", RPC, "--chain", "10143", "--private-key", pk]);
const lines = out.split("\n").filter((l) => /^(status|transactionHash|gasUsed|blockNumber)/.test(l));
console.log(lines.join("\n"));

// A mined-but-reverted deposit still prints a transaction hash. Recording the note anyway
// would leave notes.json holding a position the pool never stored, and the next audit
// would prove against a commitment the contract has never heard of.
if (!/^status\s+1/m.test(out)) {
  throw new Error("deposit transaction reverted — refusing to record a position the register does not hold");
}

const txHash = /transactionHash\s+(0x[0-9a-f]+)/.exec(out)?.[1];
artifact.depositTx = txHash;
saveNote(artifact);
fs.writeFileSync(path.join(ROOT, ".artifacts", "last-deposit.json"), JSON.stringify(artifact, null, 2));
console.log(`\nposition recorded. tx ${txHash}`);

// snarkjs leaves worker threads alive, so the process will not exit on its own.
process.exit(0);
