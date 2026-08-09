// What is on Monad right now: our gas balance, and the canonical aUSDC pair.
//   node ops/chain-recon.mjs
import "./env.mjs";
import { Cleanverse } from "./cleanverse.mjs";
import { RPC, CHAIN } from "./env.mjs";

const cv = new Cleanverse();

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

const deployer = process.env.DEPLOYER_ADDRESS;
const wei = BigInt(await rpc("eth_getBalance", [deployer, "latest"]));
console.log(`chainId    ${parseInt(await rpc("eth_chainId", []), 16)}`);
console.log(`deployer   ${deployer}`);
console.log(`MON        ${(Number(wei) / 1e18).toFixed(6)}   ${wei === 0n ? "<-- NEEDS GAS" : "ok"}`);

console.log("\n--- deposit atoken list ---");
try {
  console.log(JSON.stringify(await cv.post("query_deposit_atoken_list", { chain: CHAIN }), null, 2));
} catch (e) { console.log(e.message); }
