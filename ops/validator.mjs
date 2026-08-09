// Register SaksiPool as a Cleanverse Validator compliance pool.
//
//   node ops/validator.mjs register    # grant REGISTER_ROLE, then register + first rule
//   node ops/validator.mjs rules       # what the on-chain Validator currently enforces
//   node ops/validator.mjs setrule     # replace all rules with RULE below
//   node ops/validator.mjs verify 0x…  # ask Cleanverse whether a wallet may enter
//   node ops/validator.mjs status
//
// This is the half of the entry gate we do NOT implement. Cleanverse's own Validator
// contract holds the rule set and answers the eligibility question against each wallet's
// live A-Pass. Saksi supplies the pool address and the owner signature; the decision is
// theirs. That is a deliberate choice: a compliance gate a project wrote itself is a
// claim, and a compliance gate the compliance provider enforces is a control.
//
// The owner signature is EIP-191 personal_sign over `chain + contract_address`, both
// lowercase and concatenated with no separator — e.g. "monad0xdada618e…". The gateway
// recovers it against the pool's Ownable.owner(), which is why SaksiPool exposes one.

import "./env.mjs";
import { client, rule } from "./cleanverse.mjs";
import { secp256k1 } from "./secp.mjs";
import { CHAIN, readDeployment, writeDeployment } from "./env.mjs";

const cv = client();
const dep = readDeployment();
const pool = process.env.POOL ?? dep.pool;
const pk = process.env.DEPLOYER_PK;
if (!pool) throw new Error("no pool address — set POOL or run ops/record-deploy.mjs");

/** The register's admission rule, mirrored from ops/asp.mjs so the on-chain gate and
 *  the ZK gate answer the same question rather than drifting apart. */
const RULE = rule({ minTier: 30, minSubTier: 0 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ownerSignature() {
  const message = `${CHAIN.toLowerCase()}${pool.toLowerCase()}`;
  const sig = secp256k1.personalSign(pk, message);
  console.log(`  signed "${message}"`);
  return sig;
}

const [cmd = "status", ...args] = process.argv.slice(2);

if (cmd === "register") {
  const sig = ownerSignature();

  console.log("\n1. validator/grant — REGISTER_ROLE for the pool");
  try {
    const g = await cv.grant(CHAIN, pool, sig);
    console.log("   tx", g?.tx_hash ?? JSON.stringify(g));
  } catch (e) {
    console.log("   " + e.message + (e.code === "0002" ? "  (may already be granted)" : ""));
  }

  // The gateway writes on-chain; a second mutation before the first confirms fails.
  console.log("   waiting for confirmation…");
  await sleep(20000);

  console.log("\n2. validator/register — pool + first rule");
  const r = await cv.register(CHAIN, pool, RULE, sig);
  console.log("   tx", r?.tx_hash ?? JSON.stringify(r));
  writeDeployment({ validatorRegisterTx: r?.tx_hash ?? null, validatorRule: RULE });

  await sleep(20000);
  console.log("\n3. validator/is_register");
  console.log("  ", JSON.stringify(await cv.isRegistered(CHAIN, pool)));
  console.log("\n4. validator/rules");
  console.log("  ", JSON.stringify(await cv.rules(CHAIN, pool)));
}

else if (cmd === "setrule") {
  const r = await cv.setRule(CHAIN, pool, RULE);
  console.log("tx", r?.tx_hash ?? JSON.stringify(r));
}

else if (cmd === "addrule") {
  // Second rule, country-scoped: the AMBIT-style jurisdiction perimeter.
  const extra = rule({ minTier: 30, isBlackList: false, countries: args.length ? args : ["SG", "ID"] });
  const r = await cv.addRule(CHAIN, pool, extra);
  console.log("tx", r?.tx_hash ?? JSON.stringify(r), JSON.stringify(extra));
}

else if (cmd === "rules") {
  console.log(JSON.stringify(await cv.rules(CHAIN, pool), null, 2));
}

else if (cmd === "verify") {
  for (const who of args) {
    try {
      const v = await cv.verify(CHAIN, pool, who);
      console.log(`${who}  ${v.valid ? "ELIGIBLE" : "REFUSED"}  ${JSON.stringify(v)}`);
    } catch (e) { console.log(`${who}  error ${e.message}`); }
  }
}

else {
  console.log("pool       ", pool);
  console.log("is_register", JSON.stringify(await cv.isRegistered(CHAIN, pool)));
  try { console.log("rules      ", JSON.stringify(await cv.rules(CHAIN, pool))); }
  catch (e) { console.log("rules       " + e.message); }
  try { console.log("is_paused  ", JSON.stringify(await cv.isPaused(CHAIN, pool))); }
  catch (e) { console.log("is_paused   " + e.message); }
}
