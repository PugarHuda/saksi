// CVI fixtures — the identities this register admits, revokes, and answers about.
//
//   node ops/apass.mjs new issuer SG        # fresh keypair + A-Pass, saved to wallets.json
//   node ops/apass.mjs bind 0xPool SG pool  # A-Pass for an address we do not hold a key for
//   node ops/apass.mjs status 0x...         # live A-Pass record
//   node ops/apass.mjs freeze 0x...         # status 2 — drives the revocation demo
//   node ops/apass.mjs unfreeze 0x...
//   node ops/apass.mjs list
//
// Two things about this are load-bearing rather than convenience.
//
// First, a contract that holds a CVA needs a CVI of its own — Cleanverse enforce that
// on every transfer, both sides. So SaksiPool itself is issued an A-Pass under `bind`,
// which is why the register can custody the asset at all.
//
// Second, `freeze` is not a mock. It flips the real A-Pass status to 2, and everything
// downstream — the association-set rebuild, the refused deposit — follows from that one
// change to Cleanverse's own record.

import "./env.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { secp256k1 } from "./secp.mjs";
import { Cleanverse } from "./cleanverse.mjs";
import { CHAIN, ROOT } from "./env.mjs";

const cv = new Cleanverse();
const FILE = path.join(ROOT, "wallets.json");

const load = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : []);
const save = (w) => fs.writeFileSync(FILE, JSON.stringify(w, null, 2) + "\n");

/** 12+ chars, A-Za-z0-9 only — the platform rejects anything else. */
const customerId = (label) =>
  ("SAKSI" + label.replace(/[^A-Za-z0-9]/g, "") + crypto.randomBytes(6).toString("hex")).slice(0, 32);

const NAMES = {
  issuer: "Saksi Issuance Pte Ltd",
  pool: "Saksi Confidential Register",
  auditor: "Monetary Authority Observer",
};

async function generate(address, country, label, extra = {}) {
  const body = {
    customerId: customerId(label),
    // subTier must be a STRING. Sent as a number the gateway returns 0000 and silently
    // drops it, which costs an hour to notice because the tx hash looks real.
    subTier: "10",
    override: false,
    expirationTime: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
    wallet: { address, chain: CHAIN },
    identityDataList: [
      {
        idType: "PASSPORT",
        fullName: NAMES[label] ?? `Saksi ${label}`,
        idNumber: crypto.createHash("sha256").update(address).digest("hex"),
        validUntil: "2031-12-31",
        issuingCountryISO2: country.toUpperCase(),
      },
    ],
    ...extra,
  };
  try {
    return await cv.post("generate_apass", body);
  } catch (e) {
    if (e.code === "1000") return cv.post("generate_apass", { ...body, override: true });
    throw e;
  }
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "new") {
  const [label, country = "SG"] = args;
  const priv = secp256k1.newPrivateKey();
  const address = secp256k1.addressFromPrivateKey(priv);
  const res = await generate(address, country, label);
  const wallets = load();
  wallets.push({
    label, address, priv, country: country.toUpperCase(),
    chain: CHAIN,
    cvRecordId: res.cvRecordId,
    customerId: res.customerId,
    tier: res.tier,
    depositAddress: res.wallet?.depositUSDCWallet ?? null,
    apassTx: res.wallet?.txHash ?? null,
  });
  save(wallets);
  console.log(`${label.padEnd(10)} ${address}  tier ${res.tier}  ${country.toUpperCase()}`);
  console.log(`  deposit address: ${res.wallet?.depositUSDCWallet}`);
  console.log(`  apass tx:        ${res.wallet?.txHash}`);
}

else if (cmd === "bind") {
  const [address, country = "SG", label = "pool"] = args;
  const res = await generate(address, country, label);
  const wallets = load();
  wallets.push({
    label, address, priv: null, country: country.toUpperCase(), chain: CHAIN,
    cvRecordId: res.cvRecordId, customerId: res.customerId, tier: res.tier,
    depositAddress: res.wallet?.depositUSDCWallet ?? null,
    apassTx: res.wallet?.txHash ?? null,
  });
  save(wallets);
  console.log(`${label.padEnd(10)} ${address}  tier ${res.tier}  ${country.toUpperCase()}`);
  console.log(`  apass tx: ${res.wallet?.txHash}`);
}

else if (cmd === "status") {
  console.log(JSON.stringify(await cv.queryApass(CHAIN, args[0]), null, 2));
}

else if (cmd === "freeze" || cmd === "unfreeze") {
  const w = load().find((x) => x.address.toLowerCase() === args[0].toLowerCase());
  const body = {
    // status is a STRING here. Sent as a number the call is accepted and does nothing.
    status: cmd === "freeze" ? "2" : "1",
    wallet: { address: args[0], chain: CHAIN },
  };
  if (w?.customerId) body.customerId = w.customerId;
  if (w?.cvRecordId) body.cvRecordId = String(w.cvRecordId);
  if (cmd === "freeze") body.blacklistReason = args[1] ?? "credential withdrawn by issuer";

  const res = await cv.post("update_status", body);
  console.log(`${cmd} ${args[0]}  tx ${res?.txHash ?? JSON.stringify(res)}`);

  const after = await cv.queryApass(CHAIN, args[0]);
  console.log(`  live A-Pass status now: ${after.status} (1 = active, 2 = frozen)`);
}

else if (cmd === "list") {
  for (const w of load()) {
    let live = "";
    try {
      const r = await cv.queryApass(CHAIN, w.address);
      live = `status ${r.status}  tier ${r.tier}  kyc ${String(r.currentKycHash).slice(0, 18)}…`;
    } catch (e) { live = e.message; }
    console.log(`${String(w.label).padEnd(10)} ${w.address}  ${w.country}  ${live}`);
  }
}

else {
  console.log("usage: new <label> <ISO2> | bind <addr> <ISO2> <label> | status <addr> | freeze <addr> | unfreeze <addr> | list");
  process.exit(1);
}
