// Bring a freshly deployed pool into service, in the order the dependencies require.
//
//   node ops/setup-pool.mjs 0xNewPoolAddress
//
// A pool is not usable the moment it is deployed. It needs a credential of its own before
// it can hold a verified asset, registration with Cleanverse's validator before its
// eligibility gate answers anything but a revert, and an auditor who is not the issuer
// before its audit trail proves anything about separation of parties.
//
// Doing this by hand is four commands in a specific order with a confirmation wait in the
// middle, which is exactly the kind of thing that goes wrong at 3am before a deadline.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, RPC, CHAIN, readDeployment, writeDeployment } from "./env.mjs";

const pool = process.argv[2];
if (!/^0x[0-9a-fA-F]{40}$/.test(pool ?? "")) {
  console.error("usage: node ops/setup-pool.mjs 0xNewPoolAddress");
  process.exit(1);
}

const CAST = fs.existsSync(path.join(process.env.USERPROFILE ?? "", ".foundry", "bin", "cast.exe"))
  ? path.join(process.env.USERPROFILE, ".foundry", "bin", "cast.exe")
  : "cast";
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const cast = (args) =>
  run(CAST, [...args, "--rpc-url", RPC, "--chain", "10143", "--private-key", process.env.DEPLOYER_PK]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const step = (n, what) => console.log(`\n${n}. ${what}`);
const txOf = (out) => /transactionHash\s+(0x[0-9a-f]+)/.exec(out)?.[1] ?? "?";

step(1, "record the new pool");
writeDeployment({ pool, poolHistory: [...(readDeployment().poolHistory ?? []), readDeployment().pool].filter(Boolean) });
console.log(`   ${pool}`);

step(2, "issue the pool its own A-Pass — a contract cannot hold a CVA without one");
run("node", [path.join(ROOT, "ops/apass.mjs"), "bind", pool, "SG", "pool"]);

step(3, "register with Cleanverse's validator and attach the rule");
run("node", [path.join(ROOT, "ops/validator.mjs"), "register"]);

step(4, "hand the audit seat to a party that is not the issuer");
const auditor = process.env.AUDITOR_ADDRESS;
if (!auditor) {
  console.log("   AUDITOR_ADDRESS not set — the issuer would be auditing itself. Run:");
  console.log("   node ops/apass.mjs new auditor SG   then add AUDITOR_ADDRESS/AUDITOR_PK to .env");
} else {
  const out = cast(["send", pool, "setAuditor(address)", auditor]);
  console.log(`   auditor ${auditor}  tx ${txOf(out)}`);
  writeDeployment({ auditor });
}

step(5, "anchor the current association-set root");
const asp = JSON.parse(fs.readFileSync(path.join(ROOT, "asp.json"), "utf8"));
const out = cast(["send", pool, "rotateRoot(uint256)", asp.root]);
console.log(`   root ${asp.root.slice(0, 24)}…  tx ${txOf(out)}`);

await sleep(2000);
console.log("\nready. Next: deposits, then disclosures.");
console.log("  node ops/deposit.mjs 250");
console.log("  node ops/audit.mjs threshold 500");
process.exit(0);
