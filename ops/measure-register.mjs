// How large is the crowd a holder of a compliant tokenized asset hides in?
//
//   node ops/measure-register.mjs
//
// The case for a confidential register rests on a claim usually left as an assertion:
// that publishing the holder book costs the holder something real. So measure it, on the
// asset class this hackathon is about — every CVA issued on Monad.
//
// METHOD. Log scraping is unavailable: the public Monad RPC caps eth_getLogs at a
// 100-block range, and the chain is past 52 million. So instead of sampling the history,
// enumerate the population.
//
// A CVA transfer requires a credential on BOTH sides — Cleanverse enforce it in the
// asset's own transfer hook. The set of wallets holding an active A-Pass is therefore not
// a sample of possible holders; it is the complete set of them. Calling balanceOf for
// every eligible wallet against every A-Token is an exhaustive census, not an estimate.
//
// CAVEAT, stated rather than buried, and stated in the right direction. The census can
// only MISS holders, never invent them: a wallet credentialed through another integration,
// or holding through a Cleanverse deposit address rather than its own, is not enumerated.
// Missing holders makes each anonymity set look SMALLER than it truly is. So every count
// here is a floor: the real crowd is at least this large, and the real picture is at MOST
// this exposed.
//
// An earlier version of this comment said the opposite, which had the convenient property
// of flattering the argument the measurement exists to support. Worth naming.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { Cleanverse } from "./cleanverse.mjs";
import { ROOT, RPC, CHAIN } from "./env.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One POST, with retries — a public endpoint resets the connection under load. */
async function post(payload, attempt = 0) {
  try {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await r.json();
  } catch (e) {
    if (attempt >= 5) throw e;
    await sleep(400 * 2 ** attempt);
    return post(payload, attempt + 1);
  }
}

async function rpc(method, params, attempt = 0) {
  const j = await post({ jsonrpc: "2.0", id: 1, method, params });
  if (j.error) {
    // Rate limiting arrives as a JSON-RPC error, not a transport failure. Retrying the
    // transport alone would leave it as a silent zero balance — which is exactly the
    // failure that would make this measurement lie in our own favour.
    if (attempt < 6) {
      await sleep(500 * 2 ** attempt);
      return rpc(method, params, attempt + 1);
    }
    throw new Error(j.error.message);
  }
  return j.result;
}

const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

/** Bounded concurrency, and failures counted rather than swallowed. An unread balance is
 *  not a zero balance; if any read fails the row is reported incomplete instead of low. */
async function balancesOf(token, addrs) {
  const out = [];
  let next = 0, failed = 0;
  const worker = async () => {
    while (next < addrs.length) {
      const who = addrs[next++];
      try {
        const v = uint(await call(token, "0x70a08231" + pad(who)));
        if (v > 0n) out.push({ who, v });
      } catch { failed++; }
      await sleep(15);
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  return { held: out, failed };
}
const pad = (a) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const uint = (hex) => BigInt(hex === "0x" || !hex ? "0x0" : hex);

const cv = new Cleanverse();
const head = Number(await rpc("eth_blockNumber", []));

// ---- the eligible population -------------------------------------------------

const wallets = new Map(); // address -> label
const asp = JSON.parse(fs.readFileSync(path.join(ROOT, "asp.json"), "utf8"));
for (const m of asp.members) wallets.set(m.wallet.toLowerCase(), m.label ?? "");

// The association set applies our own min_tier rule and an active-status filter, which
// would make this a sample rather than a census. Widen it to EVERY credential the
// registry has ever listed on this chain — frozen and expired included — because a wallet
// that once held a credential could have received the asset while it was valid and may
// still hold it. Anything narrower would undercount holders and flatter the result.
for (let page = 1; page <= 20; page++) {
  const res = await cv.queryApassList({ chain: CHAIN, page, pageSize: 100 });
  const items = res.items ?? [];
  for (const it of items) {
    if (/^0x[0-9a-fA-F]{40}$/.test(it.walletAddress ?? "")) {
      if (!wallets.has(it.walletAddress.toLowerCase())) wallets.set(it.walletAddress.toLowerCase(), "");
    }
  }
  if (items.length < 100 || page * 100 >= (res.total ?? 0)) break;
}

// ---- every CVA on this chain -------------------------------------------------

const tokens = new Map(); // address -> symbol
// Paginate. The documented default page size is 20 against hundreds of rows, so a single
// unparameterised call quietly measured the first page and called it the population.
for (let page = 1; page <= 20; page++) {
  let batch;
  try { batch = await cv.listMyAtokens({ page, page_size: 100 }); }
  catch (e) { console.log(`list_my_atokens page ${page}: ${e.message}`); break; }
  const items = batch.items ?? batch.list ?? batch ?? [];
  for (const it of items) {
    if (it.chain === CHAIN && it.applyStatus === "ISSUED" && /^0x[0-9a-fA-F]{40}$/.test(it.atokenAddress ?? "")) {
      tokens.set(it.atokenAddress.toLowerCase(), it.tokenSymbol ?? "?");
    }
  }
  if (items.length < 100) break;
}
try {
  const pairs = await cv.post("query_deposit_atoken_list", { chain: CHAIN });
  for (const p of pairs.tokens ?? []) {
    const a = p.atoken?.address;
    if (/^0x[0-9a-fA-F]{40}$/.test(a ?? "")) tokens.set(a.toLowerCase(), p.atoken.symbol ?? "?");
  }
} catch (e) { console.log(`query_deposit_atoken_list: ${e.message}`); }

// Only assets that actually exist economically. A token with no supply has no holder
// book to expose, and including it would pad the count of "private" assets.
const live = [];
for (const [token, symbol] of tokens) {
  try {
    const supply = uint(await call(token, "0x18160ddd"));
    if (supply > 0n) live.push([token, symbol, supply]);
  } catch { /* unreachable contract */ }
}

console.log(`${CHAIN} head block ${head.toLocaleString("en-US")}`);
console.log(`${tokens.size} A-Tokens found, ${live.length} with non-zero supply`);
console.log(`census: ${live.length} assets × ${wallets.size} credentialed wallets = ${(live.length * wallets.size).toLocaleString("en-US")} balance reads\n`);

// ---- the census ---------------------------------------------------------------

const addresses = [...wallets.keys()];

// Self-check before trusting any of this. We know four balances on our own asset from
// having created them; if the read path cannot reproduce those, the census is measuring
// the endpoint's rate limiter rather than the chain, and must not be published.
// The issuer minted the supply and has never spent all of it, so a zero here means the
// read path is lying rather than the balance being zero. The pool is deliberately NOT
// used as a probe: after a redeploy it legitimately holds nothing, and a self-check that
// fires on a true zero teaches you to ignore it.
const dep0 = JSON.parse(fs.readFileSync(path.join(ROOT, "deployment.json"), "utf8"));
const OURS = dep0.asset;
const issuer = process.env.DEPLOYER_ADDRESS;

const probe = uint(await call(OURS, "0x70a08231" + pad(issuer)));
if (probe === 0n) {
  console.error(`self-check failed: the issuer reads a zero balance on our own asset.`);
  console.error("The read path is unreliable; refusing to publish a census built on it.");
  process.exit(1);
}
if (!wallets.has(issuer.toLowerCase())) {
  console.error("self-check failed: the issuer holds the asset but is not in the enumerated population.");
  console.error("The population is incomplete; the census would overstate confidentiality.");
  process.exit(1);
}
console.log("self-check passed: a known balance reproduces and its holder is enumerated\n");

const rows = [];
for (const [token, symbol, supply] of live) {
  const { held, failed } = await balancesOf(token, addresses);
  console.log(
    `  ${symbol.slice(0, 14).padEnd(14)} ${String(held.length).padStart(4)} holders` +
    (failed ? `   (${failed} reads failed — row dropped)` : ""),
  );
  if (failed) continue;          // an incomplete row is worse than no row
  if (!held.length) continue;

  held.sort((a, b) => (a.v < b.v ? 1 : -1));
  const counted = held.reduce((s, h) => s + h.v, 0n);
  const topShare = counted > 0n ? Number((held[0].v * 10000n) / counted) / 100 : 0;
  rows.push({ symbol, token, holders: held.length, topShare, supply: supply.toString() });
}

rows.sort((a, b) => a.holders - b.holders || b.topShare - a.topShare);

console.log("symbol           credentialed holders   largest holder   address");
console.log("-".repeat(92));
for (const r of rows) {
  console.log(
    `${r.symbol.slice(0, 15).padEnd(15)}  ${String(r.holders).padStart(19)}   ${(r.topShare.toFixed(1) + "%").padStart(14)}   ${r.token}`,
  );
}

const counts = rows.map((r) => r.holders).sort((a, b) => a - b);
const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
const one = rows.filter((r) => r.holders === 1).length;
const underFive = rows.filter((r) => r.holders < 5).length;
const dominated = rows.filter((r) => r.topShare >= 90).length;

console.log(`\nassets with at least one credentialed holder   ${rows.length}`);
console.log(`median holders per asset                       ${median}`);
console.log(`held by exactly one wallet                     ${one}`);
console.log(`fewer than five holders                        ${underFive}  (${((underFive / rows.length) * 100).toFixed(0)}% of assets)`);
console.log(`one wallet holding 90%+ of the counted supply  ${dominated}`);
console.log(
  `\nAn anonymity set of ${median} is not anonymity. At these counts, knowing the asset and\n` +
  `watching a single transfer identifies the position and its size.`,
);

fs.writeFileSync(
  path.join(ROOT, "measurement.json"),
  JSON.stringify(
    {
      chain: CHAIN,
      headBlock: head,
      measuredAt: new Date().toISOString(),
      method:
        "exhaustive census: balanceOf for every wallet holding an active A-Pass, against " +
        "every A-Token on this chain. A CVA transfer requires a credential on both sides, " +
        "so the credentialed set is the complete set of possible holders.",
      caveat:
        "the census can only miss holders, never invent them, so every count is a floor: " +
        "the true anonymity set is at least this large and the real picture at most this exposed",
      walletsEnumerated: wallets.size,
      tokensEnumerated: tokens.size,
      assetsWithHolders: rows.length,
      medianHolders: median,
      singleHolderAssets: one,
      assetsUnderFiveHolders: underFive,
      assetsWithDominantHolder: dominated,
      assets: rows,
    },
    null, 2,
  ) + "\n",
);
console.log("\nwritten to measurement.json");
process.exit(0);
