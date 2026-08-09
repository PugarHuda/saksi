// Rebuild the evidence table from the chain, so nothing in the writeup is copied by hand.
//
//   node ops/evidence.mjs            # human table
//   node ops/evidence.mjs --md       # markdown, for the summary
//
// Every row is a call anyone can repeat. Where a claim rests on a transaction, the block
// number is printed, because the ordering of two blocks is the claim — the auditor's
// question is registered before the answer exists, and that is checkable by a stranger
// with an RPC endpoint and no access to this repository.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { ROOT, RPC, readDeployment } from "./env.mjs";

const dep = readDeployment();
const md = process.argv.includes("--md");
const audit = JSON.parse(fs.readFileSync(path.join(ROOT, "audit-log.json"), "utf8"));
const notes = JSON.parse(fs.readFileSync(path.join(ROOT, "notes.public.json"), "utf8"));
const aspPath = ["asp.json", "asp.public.json"]
  .map((f) => path.join(ROOT, f))
  .find((p) => fs.existsSync(p));
if (!aspPath) {
  console.error("no association set on disk — run `node ops/asp.mjs build` first.");
  process.exit(1);
}
const asp = JSON.parse(fs.readFileSync(aspPath, "utf8"));

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

const receipt = async (tx) => {
  if (!tx) return null;
  const r = await rpc("eth_getTransactionReceipt", [tx]);
  return r && { block: Number(r.blockNumber), gas: Number(r.gasUsed), ok: r.status === "0x1" };
};

const call = async (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const pad = (a) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");

const out = [];
const line = (s = "") => out.push(s);

line(md ? "### Live reads — repeat any of these against `https://testnet-rpc.monad.xyz`" : "LIVE READS");
line();
if (md) line("```");
const reads = [
  ["pool.registeredWithValidator()", dep.pool, "0x612f004d"],
  ["pool.commitmentCount()", dep.pool, "0xc44956d1"],
  ["pool.aspRoot()", dep.pool, "0xd4401eaa"],
  ["asset.totalSupply()", dep.asset, "0x18160ddd"],
  ["asset.balanceOf(pool)", dep.asset, "0x70a08231" + pad(dep.pool)],
];
for (const [name, to, data] of reads) {
  const v = await call(to, data);
  const n = BigInt(v === "0x" ? "0x0" : v);
  line(`${name.padEnd(34)} ${n === 0n || n === 1n ? (n === 1n ? "true" : "false") : n.toString()}`);
}
// complianceVerify(address,address) and isRegistered(address) on Cleanverse's validator.
const CV = "0xaf375463";
const IS_REG = "0xc3c5a547";

line(`validator.isRegistered(pool)`.padEnd(46) +
  (BigInt(await call(dep.validator, IS_REG + pad(dep.pool))) === 1n ? "true" : "false"));

// The negative control has to be a wallet Cleanverse genuinely refuses. 0x…dEaD is not
// one: somebody in the shared sandbox issued the burn address an active tier-50 A-Pass,
// so complianceVerify ADMITS it and printing it under a "refused" heading was a false row
// in a judged artefact. This address holds no credential at all.
const NO_CREDENTIAL = "0xe69B129724007C56A0BAcCDe1dAa7Aa2646D16b5";

for (const [who, addr] of [
  ["issuer", dep.issuer],
  ["a wallet with no A-Pass", NO_CREDENTIAL],
  ["burn address 0x…dEaD", "0x000000000000000000000000000000000000dEaD"],
  ...(asp.dropped ?? [])
    .filter((d) => d.wallet)
    .map((d) => [`revoked ${d.label ?? d.wallet.slice(0, 8)}`, d.wallet]),
]) {
  const v = await call(dep.validator, CV + pad(dep.pool) + pad(addr));
  line(`validator.complianceVerify(pool, ${who})`.padEnd(46) + (BigInt(v) === 1n ? "true" : "false"));
}
if (md) line("```");

// The ASSET gate, beside the POOL gate above.
//
// These are two different questions and the project's writeup says so, which is worth
// nothing unless both answers are on the same page. The pool gate asks whether a wallet
// satisfies THIS REGISTER's rule; verify_apass asks whether it may hold THIS A-TOKEN at
// all, under the rule the asset carried from issuance. A wallet can pass one and fail the
// other, and Cleanverse enforces the second on every transfer whether we call it or not.
//
// Skipped without credentials rather than failing: the chain half of this artefact must
// still render for someone who cloned the repo and has no API key.
try {
  const { Cleanverse } = await import("./cleanverse.mjs");
  const cv = new Cleanverse();
  line();
  line(md ? "### The asset gate — Cleanverse's rule on the A-Token itself" : "ASSET GATE (verify_apass)");
  line();
  if (md) line("```");
  // Posture, not rules: atoken/rules answers 0000 with an empty array for an address that
  // is not an A-Token at all, so an unknown asset would print as one that admits everyone.
  const { rules, paused } = await cv.atokenPosture(dep.chain, dep.asset);
  line(`atoken.rules(${dep.assetSymbol})`.padEnd(46) +
    (rules.length
      ? rules.map((r) => `min_tier ${r.min_tier}${r.countries?.length ? ` countries ${r.countries.join(",")}` : ""}`).join(" | ")
      : "none"));
  line(`atoken.is_paused(${dep.assetSymbol})`.padEnd(46) + String(paused));

  const wallets = fs.existsSync(path.join(ROOT, "wallets.json"))
    ? JSON.parse(fs.readFileSync(path.join(ROOT, "wallets.json"), "utf8"))
    : [];
  const seen = new Set();
  for (const w of wallets.filter((x) => x.label && x.label !== "pool")) {
    if (seen.has(w.address.toLowerCase())) continue;
    seen.add(w.address.toLowerCase());
    const r = await cv.verifyApass(dep.chain, dep.asset, w.address);
    const pool = await call(dep.validator, CV + pad(dep.pool) + pad(w.address));
    line(`  ${w.label.padEnd(10)} asset ${String(r.code).padEnd(2)} ${(r.message ?? "").padEnd(28)}pool ${BigInt(pool) === 1n}`);
  }
  if (md) line("```");
} catch (e) {
  line();
  line(`(asset gate skipped — ${e.message.split("\n")[0]})`);
}

line();
line(md ? "### Disclosures — the question is registered before the answer exists" : "DISCLOSURES");
line();
if (md) {
  line("| Proof | Question | Request block | Answer block | Verified |");
  line("|---|---|---|---|---|");
}
for (const a of audit) {
  const req = await receipt(a.requestTx);
  const ver = await receipt(a.verifyTx);
  if (md) {
    line(
      `| ${a.kind} | ${a.question} | ${req?.block ?? "—"} | ${ver?.block ?? "**never — no proof exists**"} | ${a.verified ? "on-chain" : "request stays open"} |`,
    );
  } else {
    line(
      `${a.kind.padEnd(10)} req blk ${String(req?.block ?? "-").padEnd(9)} ans blk ${String(ver?.block ?? "NEVER").padEnd(9)} ${a.verified ? "verified" : "unanswerable"}  ${a.question}`,
    );
  }
}

line();
line(md ? "### Positions" : "POSITIONS");
line();
// The public index no longer carries the wallet that opened each commitment — that was
// the mapping the console renders as shielded — so the holder count is not derivable here
// and is not going to be guessed at. Saying "positions" and stopping is the honest report.
const holders = new Set(notes.map((n) => n.wallet).filter(Boolean).map((w) => w.toLowerCase()));
line(
  holders.size
    ? `${notes.length} shielded positions across ${holders.size} verified holders`
    : `${notes.length} shielded positions (holders not published in this index)`,
);
for (const n of notes) {
  const r = await receipt(n.depositTx);
  line(`  ${n.commitment.slice(0, 12)}…  blk ${r?.block ?? "-"}  ${r?.gas?.toLocaleString("en-US") ?? "-"} gas  ${r?.ok ? "ok" : "FAILED"}`);
}

line();
line(`association set: ${asp.admitted} members, root ${asp.root.slice(0, 20)}…`);
if (asp.dropped?.length) {
  line(`last rebuild dropped: ${asp.dropped.map((d) => `${d.label ?? ""} ${d.wallet}`).join(", ")}`);
}

console.log(out.join("\n"));
