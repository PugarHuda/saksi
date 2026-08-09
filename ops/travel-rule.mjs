// Pull the real Travel Rule document Cleanverse generates for a settlement.
//
//   node ops/travel-rule.mjs <txHash>
//
// The audit pack ships genuine Travel Rule references rather than a mocked PDF: the
// attribution for a value transfer is Cleanverse's to produce, not ours to invent.

import "./env.mjs";
import { client } from "./cleanverse.mjs";
import { CHAIN } from "./env.mjs";

const cv = client();
const [tx, address = process.env.DEPLOYER_ADDRESS] = process.argv.slice(2);
if (!tx) {
  console.error("usage: node ops/travel-rule.mjs <txHash> [walletAddress]");
  process.exit(1);
}

// The report is per party, so the wallet is required alongside the transaction: the
// document attributes one side of the transfer, not the transfer in the abstract.
try {
  const res = await cv.downloadTravelRule({
    txHash: tx,
    wallet: { chain: CHAIN, address },
  });
  console.log(`fileName    ${res.fileName}`);
  console.log(`downloadUrl ${res.downloadUrl}`);
} catch (e) {
  console.error(`${tx} for ${address}: ${e.message}`);
  process.exit(1);
}
