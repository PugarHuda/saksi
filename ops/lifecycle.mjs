// The life of one position, assembled from the chain.
//
//   node ops/lifecycle.mjs
//
// Four tabs of tables make this register look like four separate claims. It is one claim,
// and this is it: a position enters in public, moves so that nothing links it to what it
// was, becomes readable only because a regulator asked, and leaves under the same rules it
// entered by. Every step below is a transaction anyone can open.
//
// Written as an artefact rather than as copy, because the alternative is a paragraph in a
// README asserting a sequence that nobody can check. Each entry carries the transaction, the
// block, and what the chain itself shows at that block — so the story is the evidence rather
// than a caption on it.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CAST, ROOT, RPC, readDeployment, readOrExit, writeJson } from "./env.mjs";

const dep = readDeployment();
const cast = (args) => execFileSync(CAST, [...args, "--rpc-url", RPC], { encoding: "utf8" });

const receipt = (hash) => {
  const out = cast(["receipt", hash]);
  return {
    block: Number(/blockNumber\s+(\d+)/.exec(out)?.[1]),
    ok: /status\s+1/.test(out),
    from: /from\s+(0x[0-9a-fA-F]{40})/.exec(out)?.[1] ?? null,
  };
};

const audit = readOrExit("audit-log.json", "no disclosures recorded — run `node ops/audit.mjs exact` first.");
const exact = audit.find((a) => a.kind === "exact");

// The four transactions, in the order they happened. The hashes are the ones the other
// artefacts already cite — this file does not invent a trail, it reads the one that exists.
const STEPS = [
  {
    step: "enters",
    tx: "0xdc0da65b298d7e224528e365b4ee960d7fea0676dde495a74f1b323f88a0cecd",
    title: "The position enters, in public",
    body:
      "A deposit takes a plaintext amount from a visible sender, and both are emitted. " +
      "Anyone reading this transaction knows a position of 250 was opened, and by whom. " +
      "The register does not pretend otherwise: what a commitment protects is everything " +
      "after this moment, not this moment.",
    shows: "250 SAKSIAZEV, sender visible",
  },
  {
    step: "moves",
    tx: "0x30a74be85a99b68c4bd0a40a1beb7575b0b06686ed610993ed7f6aa38a8cac68",
    title: "It moves, and the link breaks",
    body:
      "A JoinSplit spends this position and one other, and creates two new ones. What the " +
      "chain records is two nullifiers and two commitments. Nothing on it says which input " +
      "became which output, or what either is worth. The 250 that entered is gone as a " +
      "traceable object.",
    shows: "2 nullifiers published, 2 commitments inserted, nothing withdrawn",
  },
  {
    step: "answers",
    tx: exact?.verifyTx ?? null,
    requestTx: exact?.requestTx ?? null,
    title: "It becomes readable — because someone asked",
    body:
      "The auditor posted a question on-chain. Ten blocks later a proof answered exactly " +
      "that question and 459.9 became public. That is the only route by which a figure " +
      "leaves this register, and the chain records that the question came first. The " +
      "register cannot be made to volunteer it.",
    shows: `${exact?.answer ?? "an exact figure"}, in answer to a request posted first`,
  },
  {
    step: "leaves",
    tx: "0x08b6801b1cbcaa681f2a81d77628e4c88dcec9bf70793492663fa605422d0e3a",
    title: "It leaves under the rules it entered by",
    body:
      "A second JoinSplit redeems 50 out of the register: 49.5 to the recipient and 0.5 to " +
      "the relayer that carried the transaction. Both are checked against Cleanverse's " +
      "validator by the contract, because their model holds that every address receiving a " +
      "CVA needs a credential. The exit is a compliance event, not an escape from one.",
    shows: "50 out — 49.5 to a credentialed recipient, 0.5 to a credentialed relayer",
  },
];

const out = { chain: dep.chain, pool: dep.pool, asset: dep.asset, builtAt: new Date().toISOString(), steps: [] };

console.log("the life of one position\n");
for (const s of STEPS) {
  if (!s.tx) {
    console.log(`  ${s.step.padEnd(8)} SKIPPED — no transaction recorded for this step`);
    continue;
  }
  const r = receipt(s.tx);
  if (!r.ok) throw new Error(`${s.step}: ${s.tx} did not succeed — refusing to publish a trail that includes a failed transaction`);
  const entry = { ...s, block: r.block, from: r.from };
  if (s.requestTx) entry.requestBlock = receipt(s.requestTx).block;
  out.steps.push(entry);
  console.log(`  ${s.step.padEnd(8)} block ${r.block}  ${s.title}`);
  console.log(`           ${s.shows}`);
}

// Blocks must run forward. A trail that reads out of order is either wrong or a different
// story than the one being told, and either way it should not ship.
const blocks = out.steps.map((s) => s.block);
if (blocks.some((b, i) => i > 0 && b <= blocks[i - 1])) {
  throw new Error("the steps are not in block order — refusing to publish");
}
const answers = out.steps.find((s) => s.step === "answers");
if (answers?.requestBlock && answers.requestBlock >= answers.block) {
  throw new Error("the disclosure precedes its own request — refusing to publish");
}

writeJson(path.join(ROOT, "lifecycle.json"), out);
console.log(`\n${out.steps.length} steps, blocks ${blocks[0]} → ${blocks[blocks.length - 1]}`);
console.log("written to lifecycle.json");
