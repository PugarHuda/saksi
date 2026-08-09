// Bring more verified holders into the register, so the aggregate proof is a statement
// about several people rather than about one wallet's several notes.
//
//   node ops/seed-holders.mjs
//
// Each holder gets a real A-Pass from Cleanverse, real gas, and a real CVA transfer from
// the issuer — which is itself a compliance event, since the note only moves between two
// wallets that both hold a credential.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CAST, ROOT, RPC, readDeployment } from "./env.mjs";

const dep = readDeployment();
const run = (args, env) =>
  execFileSync(args[0], args.slice(1), { encoding: "utf8", env: { ...process.env, ...env } });
const cast = (args) => run([CAST, ...args, "--rpc-url", RPC, "--chain", "10143",
  "--private-key", process.env.DEPLOYER_PK]);

/** label → country tag, so the register holds more than one jurisdiction. */
const HOLDERS = [
  ["fund", "SG", 640],
  ["family", "ID", 310],
  ["treasury", "US", 175],
];

for (const [label, country, amount] of HOLDERS) {
  console.log(`\n=== ${label} (${country}) ===`);
  run(["node", "ops/apass.mjs", "new", label, country]);

  const wallets = JSON.parse(fs.readFileSync(path.join(ROOT, "wallets.json"), "utf8"));
  const w = wallets.filter((x) => x.label === label).at(-1);

  console.log("  funding gas");
  cast(["send", w.address, "--value", "0.25ether"]);

  console.log(`  transferring ${amount} ${dep.assetSymbol} — a CVA move between two credentialed wallets`);
  cast(["send", dep.asset, "transfer(address,uint256)", w.address, String(amount * 1e6)]);
  console.log(`  ${w.address} ready`);
}

console.log("\nrebuild the association set, rotate the root, then deposit from each holder.");
