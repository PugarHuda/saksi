// Which chains actually succeed at atoken/launch right now?
//   node ops/atoken-recon.mjs
import "./env.mjs";
import { client } from "./cleanverse.mjs";

const cv = client();
// Every row, not the server's default first 20. The tally below reads as a statement about
// the whole population — "monad/ISSUED 14" — and against 357 rows it was a statement about
// the first page.
const items = await cv.listAllMyAtokens();
console.log(`${items.length} application rows\n`);

const tally = {};
for (const it of items) {
  const k = `${it.chain}/${it.applyStatus}`;
  (tally[k] ??= []).push(`${it.tokenSymbol} ${it.createTime ?? ""}`.trim());
}
for (const k of Object.keys(tally).sort()) {
  console.log(`${k.padEnd(28)} ${String(tally[k].length).padStart(3)}   e.g. ${tally[k][0]}`);
}

console.log("\n--- most recent 12 rows ---");
for (const it of items.slice(0, 12)) {
  console.log(`${(it.createTime ?? "").padEnd(20)} ${String(it.chain).padEnd(8)} ${String(it.applyStatus).padEnd(14)} ${it.tokenSymbol ?? ""} ${it.atokenAddress ?? ""}`);
}

console.log("\n--- supported tokens per chain (query_supported_atoken_list) ---");
for (const chain of ["monad", "base"]) {
  for (const path of ["query_supported_atoken_list", "query_atoken_list", "atoken/list"]) {
    try {
      const d = await cv.post(path, { chain });
      console.log(`${chain} via ${path}:`, JSON.stringify(d).slice(0, 600));
      break;
    } catch (e) { console.log(`${chain} ${path}: ${e.message}`); }
  }
}
