// Issue the CVA this register is built over.
//
// Track 1 asks for CVI and CVA "integrated from the issuance stage". Saksi does not
// borrow someone else's A-Token — it launches its own, carrying a compliance rule from
// the first block. Every later gate in the system refers back to this asset.
//
//   node ops/launch-atoken.mjs            # launch + poll to a terminal status
//   node ops/launch-atoken.mjs --poll ID  # resume polling an existing requestId
//
// Launch on Monad is flaky in the sandbox (roughly half the applications we observed
// today ended ISSUE_FAILED), so a failed application is retried rather than fatal.

import "./env.mjs";
import { client, rule } from "./cleanverse.mjs";
import { writeDeployment, readDeployment, CHAIN } from "./env.mjs";

const cv = client();
const admin = process.env.DEPLOYER_ADDRESS;
if (!admin) throw new Error("DEPLOYER_ADDRESS missing from .env");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** min_tier 30: the sandbox A-Pass population sits at tier 50, so this admits real
 *  verified identities and refuses anything below an institutional tier. Country
 *  scoping lives on the Validator pool rule, where we can demonstrate it moving. */
const NOTE_RULE = rule({ minTier: 30, minSubTier: 0 });

async function poll(requestId, { tries = 40, waitMs = 15000 } = {}) {
  for (let i = 1; i <= tries; i++) {
    const st = await cv.applyStatus(requestId);
    const status = st.applyStatus ?? st.status;
    console.log(`  [${i}/${tries}] ${requestId} → ${status}${st.atokenAddress ? "  " + st.atokenAddress : ""}`);
    if (status === "ISSUED") return st;
    if (status === "ISSUE_FAILED" || status === "REJECTED") return null;
    await sleep(waitMs);
  }
  throw new Error(`${requestId} never reached a terminal status`);
}

const resume = process.argv.indexOf("--poll");
if (resume !== -1) {
  const got = await poll(process.argv[resume + 1]);
  if (got) {
    writeDeployment({ atoken: got.atokenAddress, atokenSymbol: got.tokenSymbol, atokenTx: got.txHash, chain: CHAIN });
    console.log("\nISSUED:", got.atokenAddress);
  }
  process.exit(got ? 0 : 1);
}

for (let attempt = 1; attempt <= 4; attempt++) {
  // A fresh symbol per attempt: the platform rejects a symbol that already exists.
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const symbol = `SAKSI${suffix}`;
  console.log(`\nattempt ${attempt}: launching ${symbol} on ${CHAIN}`);

  const res = await cv.launchAtoken({
    chain: CHAIN,
    token_name: "Saksi Series A Note",
    token_symbol: symbol,
    decimals: 6,
    admin_address: admin,
    rule: NOTE_RULE,
    icon: "https://images.cleanverse.com/app/token_icon/usdc.png",
  });
  console.log("  submitted:", res.requestId);
  writeDeployment({ atokenRequestId: res.requestId, atokenSymbolRequested: symbol });

  const got = await poll(res.requestId);
  if (got) {
    writeDeployment({
      chain: CHAIN,
      atoken: got.atokenAddress,
      atokenSymbol: got.tokenSymbol,
      atokenName: got.tokenName,
      atokenTx: got.txHash,
      atokenRule: NOTE_RULE,
      atokenAdmin: admin,
    });
    console.log(`\nISSUED  ${got.tokenSymbol}  ${got.atokenAddress}`);
    console.log("deployment.json:", JSON.stringify(readDeployment(), null, 2));
    process.exit(0);
  }
  console.log("  ISSUE_FAILED — retrying");
}

console.error("\nfour launch attempts failed; check the Member platform");
process.exit(1);
