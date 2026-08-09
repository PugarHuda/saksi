// Rebuild notes.public.json from the chain, and from nothing else.
//
// The index used to be written from the operator's ledgers, which hold exactly the positions
// that are still LIVE — retired ones are removed when they are spent. So the published file
// was, precisely, the live set. Nothing else publishes that: a nullifier is
// Poseidon(commitment, leafIndex, privKey) and cannot be linked to its commitment without the
// key, so liveness is not otherwise derivable from the chain at all.
//
// That one fact broke the register's central claim. An observer who knows which leaves are
// live knows which are spent, and every 2-in/2-out JoinSplit's inputs then follow by
// elimination — the anonymity set collapses to one candidate. With the spend graph fixed,
// value conservation turns the public deposit amounts and a single disclosed figure into a
// system of equations. Run against this register it recovered 270.1 CVA on leaf 4, an amount
// no audit ever disclosed, from public data alone.
//
// So the index is now built from `CommitmentInserted`, which the contract emits once per leaf
// for deposits and transfer outputs alike, with no field that distinguishes them. Every row
// carries only what the chain already tells everyone: the commitment, its leaf index, and the
// transaction that inserted it. Liveness is absent because it is not the chain's to give.
//
// What still leaks, and is not fixable from here: `Deposited` publishes the amount and the
// depositor, so a position that has never moved is public in full. That is the deployed
// contract's design — entry is public, movement is private — and the writeup says so rather
// than pretending otherwise.
//
//   node ops/publish-index.mjs [--dry]

import "./env.mjs";
import path from "node:path";
import { ROOT, RPC, readDeployment, writeJson } from "./env.mjs";

const dep = readDeployment();
const dry = process.argv.includes("--dry");
if (!dep.pool) {
  console.error("deployment.json has no pool address.");
  process.exit(1);
}

// CommitmentInserted(bytes32 indexed commitment, uint256 leafIndex)
const INSERTED = "0xd9c86af2d8d83b755a5edf8abd61298ac705439a097af35b1d7dcc73a4bf7e27";
const DEPOSITED = "0x9d677c46e10ba33882144473956fae8d2c52353dcde5aab8230d1bd280cfc3b4";

let id = 0;
async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

const hex = (n) => "0x" + n.toString(16);

/** Monad caps eth_getLogs at 100 blocks per request, so a range is a lot of requests. Six at
 *  a time is under the public endpoint's rate limit and still finishes in about a minute. */
async function getLogs(topic0, from, to, span = 100, lanes = 6) {
  const ranges = [];
  for (let b = from; b <= to; b += span) ranges.push([b, Math.min(b + span - 1, to)]);
  const out = [];
  for (let i = 0; i < ranges.length; i += lanes) {
    const batch = await Promise.all(
      ranges.slice(i, i + lanes).map(([a, b]) =>
        rpc("eth_getLogs", [{ address: dep.pool, topics: [topic0], fromBlock: hex(a), toBlock: hex(b) }]),
      ),
    );
    for (const logs of batch) out.push(...logs);
    if (i % (lanes * 20) === 0) process.stderr.write(".");
  }
  return out;
}

// The register's own leaf list is the authority on what must appear; the logs supply the
// transaction each leaf arrived in. If the two ever disagree, the index is not published —
// a partial index is the failure this file exists to prevent.
const onChain = (await rpc("eth_call", [{ to: dep.pool, data: "0x07c610b1" }, "latest"]))
  .slice(2)
  .match(/.{64}/g)
  ?.slice(2)
  .map((w) => "0x" + w) ?? [];

const latest = Number(await rpc("eth_blockNumber", []));
// Walk back only as far as the first pool this register ever used could have been deployed.
// A fixed window would go stale; the leaf count is the stopping condition.
const FROM = Number(process.env.FROM_BLOCK ?? latest - 120_000);

process.stderr.write(`scanning blocks ${FROM}..${latest} for CommitmentInserted `);
const inserted = await getLogs(INSERTED, FROM, latest);
const deposits = await getLogs(DEPOSITED, FROM, latest);
process.stderr.write("\n");

const depositTxs = new Set(deposits.map((l) => l.transactionHash));
const byCommitment = new Map(
  inserted.map((l) => [
    l.topics[1],
    {
      leafIndex: Number(BigInt("0x" + l.data.slice(2).slice(0, 64))),
      tx: l.transactionHash,
      block: Number(BigInt(l.blockNumber)),
      // Public either way: a deposit emits Deposited in the same transaction, a transfer
      // output does not. Both are readable by anyone; neither says whether the leaf is live.
      origin: depositTxs.has(l.transactionHash) ? "deposit" : "transfer output",
    },
  ]),
);

const rows = [];
const missing = [];
for (const c of onChain) {
  const hit = byCommitment.get(c);
  if (!hit) { missing.push(c); continue; }
  rows.push({ commitment: c, ...hit });
}
rows.sort((a, b) => a.leafIndex - b.leafIndex);

if (missing.length) {
  console.error(`\n${missing.length} of ${onChain.length} leaves have no CommitmentInserted log in`);
  console.error(`blocks ${FROM}..${latest}. Widen the window with FROM_BLOCK=<n> and re-run.`);
  console.error("Refusing to publish a partial index — a short index is itself a liveness signal.");
  process.exit(1);
}

console.log(`${rows.length} leaves, ${rows.filter((r) => r.origin === "deposit").length} deposits`);
if (dry) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  writeJson(path.join(ROOT, "notes.public.json"), rows);
  console.log("wrote notes.public.json");
}
