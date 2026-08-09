// Build the association set — the ZK half of the entry gate.
//
//   node ops/asp.mjs build     # pull live CVI records, apply the rule, write asp.json
//   node ops/asp.mjs show
//
// The set is not a list we maintain. It is derived, every time, from Cleanverse's own
// A-Pass registry: every wallet that currently holds an active, unexpired credential
// meeting the register's rule becomes a leaf. Drop a credential and the next root is
// built without it — which is the whole revocation mechanism, expressed as a rebuild
// rather than as a blacklist.
//
// Leaves are sourceKey = keccak256(wallet) mod FIELD, because that is exactly what the
// compliance circuit proves membership of and what SaksiPool pins to msg.sender. The
// A-Pass currentKycHash is carried alongside as evidence for the audit pack, not as the
// leaf — using it as the leaf would break the binding to the depositing wallet.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { keccak_256 } from "./keccak.mjs";
import { makePoseidon, buildTree } from "./merkle.mjs";
import { Cleanverse } from "./cleanverse.mjs";
import { CHAIN, ROOT, readDeployment, writeDeployment } from "./env.mjs";

const cv = new Cleanverse();
const FILE = path.join(ROOT, "asp.json");
const WALLETS = path.join(ROOT, "wallets.json");
const LEVELS = 10;                       // 1024 leaves, matching Compliance(10, 8)
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** The register's admission rule. Mirrors the rule registered with the Cleanverse
 *  Validator, so the ZK gate and the on-chain gate answer the same question. */
export const RULE = {
  minTier: 30,
  countries: [],                          // empty = no country constraint at this layer
  requireActive: true,
};

export const sourceKeyOf = (addr) =>
  BigInt("0x" + keccak_256(Buffer.from(addr.replace(/^0x/, ""), "hex"))) % FIELD;

async function pullApassPopulation() {
  const seen = new Map();
  for (let page = 1; page <= 20; page++) {
    const res = await cv.queryApassList({ chain: CHAIN, status: 1, page, pageSize: 100 });
    const items = res.items ?? [];
    for (const it of items) {
      const addr = it.walletAddress;
      if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) continue;
      // Several rows can share a wallet (re-registrations). Keep the newest.
      const prev = seen.get(addr.toLowerCase());
      if (!prev || (it.registeredAt ?? "") > (prev.registeredAt ?? "")) {
        seen.set(addr.toLowerCase(), it);
      }
    }
    if (items.length < 100 || page * 100 >= (res.total ?? 0)) break;
  }

  // The bulk list lags: a credential issued minutes ago is live on query_apass but has
  // not appeared in query_apass_list yet. Re-read every wallet this register knows
  // about directly, because the per-wallet record is the authoritative one — and
  // because status is returned there and is null in the list.
  const known = fs.existsSync(WALLETS) ? JSON.parse(fs.readFileSync(WALLETS, "utf8")) : [];
  for (const w of known) {
    try {
      const rec = await cv.queryApass(CHAIN, w.address);
      if (rec.status !== 1) { seen.delete(w.address.toLowerCase()); continue; }
      seen.set(w.address.toLowerCase(), {
        walletAddress: w.address,
        tier: rec.tier,
        countries: rec.countries ?? [],
        expirationTime: rec.expirationTime,
        cvRecordId: rec.cvRecordId,
        currentKycHash: rec.currentKycHash,
        registeredAt: new Date().toISOString(),
        label: w.label,
      });
    } catch { /* no record on this chain — leave whatever the list said */ }
  }
  return [...seen.values()];
}

const admits = (rec) => {
  if (RULE.requireActive && Number(rec.expirationTime) * 1000 <= Date.now()) return false;
  if (Number(rec.tier) <= RULE.minTier) return false;
  if (RULE.countries.length) {
    const tags = (rec.countries ?? []).map((c) => c.toUpperCase());
    if (!tags.some((c) => RULE.countries.includes(c))) return false;
  }
  return true;
};

// Other scripts import sourceKeyOf and RULE from here, so the CLI must not run on import.
const isCli = /asp\.mjs$/.test(process.argv[1] ?? "");
const [cmd = "build", ...args] = process.argv.slice(2);

if (isCli && cmd === "build") {
  const excluded = new Set(args.map((a) => a.toLowerCase()));   // wallets to drop this round
  const population = await pullApassPopulation();
  const admitted = population.filter(admits)
    .filter((r) => !excluded.has(r.walletAddress.toLowerCase()));

  // Deterministic order, so anyone re-running this against the same registry state
  // reproduces the same root.
  admitted.sort((a, b) => a.walletAddress.toLowerCase() < b.walletAddress.toLowerCase() ? -1 : 1);

  const { h2 } = await makePoseidon();
  const leaves = admitted.map((r) => sourceKeyOf(r.walletAddress));
  if (leaves.length > (1 << LEVELS)) throw new Error(`${leaves.length} leaves exceeds 2^${LEVELS}`);
  const tree = buildTree(h2, leaves, LEVELS);

  const out = {
    chain: CHAIN,
    builtAt: new Date().toISOString(),
    levels: LEVELS,
    rule: RULE,
    excluded: [...excluded],
    populationQueried: population.length,
    admitted: admitted.length,
    root: tree.root.toString(),
    members: admitted.map((r, i) => ({
      index: i,
      wallet: r.walletAddress,
      sourceKey: leaves[i].toString(),
      tier: r.tier,
      countries: r.countries ?? [],
      cvRecordId: r.cvRecordId,
      // Not the leaf — the leaf must bind to the depositing wallet — but carried as the
      // credential evidence each membership rests on, for the audit pack.
      currentKycHash: r.currentKycHash ?? null,
      label: r.label ?? null,
      registeredAt: r.registeredAt,
    })),
  };
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + "\n");
  writeDeployment({ aspRoot: out.root, aspBuiltAt: out.builtAt, aspAdmitted: out.admitted });

  console.log(`population (active A-Pass on ${CHAIN})   ${population.length}`);
  console.log(`admitted by rule (tier > ${RULE.minTier})            ${admitted.length}`);
  if (excluded.size) console.log(`excluded this round                     ${[...excluded].join(", ")}`);
  console.log(`root                                    ${out.root}`);
  const dep = readDeployment();
  if (dep.pool) console.log(`\nnext: cast send ${dep.pool} "rotateRoot(uint256)" ${out.root}`);
}

else if (isCli && cmd === "show") {
  const a = JSON.parse(fs.readFileSync(FILE, "utf8"));
  console.log(`root ${a.root}   ${a.admitted} members   built ${a.builtAt}`);
  for (const m of a.members.slice(0, 15)) {
    console.log(`  [${String(m.index).padStart(3)}] ${m.wallet}  tier ${m.tier}  ${m.countries.join(",")}`);
  }
  if (a.members.length > 15) console.log(`  … ${a.members.length - 15} more`);
}
