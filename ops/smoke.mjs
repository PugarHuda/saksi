// Live sandbox smoke test. Read-only: nothing here writes on-chain.
//   CV_API_ID=... CV_API_KEY=... node scripts/smoke.mjs

import { Cleanverse, rule } from "./cleanverse.mjs";

const cv = new Cleanverse();
const CHAINS = ["solana", "base", "avalanche", "arbitrum", "ethereum",
                "polygon", "bsc", "monad", "hashkey", "platon"];
const PROBE = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

// 1. api-id is accepted at all.
const countries = await cv.post("query_ramp_countries", {});
check("api-id accepted", Array.isArray(countries) && countries.length > 0,
      `${countries.length} ramp countries`);

// 2. The AES key decrypts server-side. A missing required field proves the
//    server read our plaintext; a bad key would give HTTP 403 instead.
let aesOk = false, aesDetail = "";
try {
  await cv.setRule("base", PROBE, undefined);
} catch (e) {
  aesOk = e.code === "10002" || e.code === "0001";
  aesDetail = `[${e.code}] ${e.body?.message ?? e.message}`;
}
check("AES-256-CBC key decrypts server-side", aesOk, aesDetail);

// 3. Which chains actually carry the Validator module.
const live = [];
for (const chain of CHAINS) {
  try { await cv.isRegistered(chain, PROBE); live.push(chain); }
  catch { /* 12027 — validator not deployed on this chain */ }
}
check("validator chains discovered", live.length > 0, live.join(", ") || "none");
check("deployment target is available", live.includes("base") || live.includes("monad"),
      live.includes("monad") ? "monad is live — prefer it (sponsor chain)"
                             : "monad NOT live — deploy on base");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
