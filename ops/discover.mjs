// Read-only reconnaissance of what our institution already has in the sandbox.
//   node ops/discover.mjs
import "./env.mjs";
import { client } from "./cleanverse.mjs";

const cv = client();
const show = (label, v) => console.log(`\n=== ${label} ===\n` + JSON.stringify(v, null, 2));

for (const chain of ["monad", "base"]) {
  try {
    show(`apass_list ${chain}`, await cv.queryApassList({ chain, page: 1, pageSize: 100 }));
  } catch (e) { console.log(`apass_list ${chain}: ${e.message}`); }
}

try { show("apass_list (no chain filter)", await cv.queryApassList({ page: 1, pageSize: 100 })); }
catch (e) { console.log(`apass_list all: ${e.message}`); }

// Swept, not sampled. The bare call takes the server's default page size of 20 against a
// total in the hundreds, and reconnaissance that reports 20 of 357 rows as "my atokens" is
// how a wrong assumption gets made early and carried everywhere.
try {
  const all = await cv.listAllMyAtokens();
  show(`my atokens (${all.length})`, all);
} catch (e) { console.log(`list_my_atokens: ${e.message}`); }

for (const chain of ["monad", "base"]) {
  try { show(`supported atokens ${chain}`, await cv.post("query_atoken_list", { chain })); }
  catch (e) { console.log(`query_atoken_list ${chain}: ${e.message}`); }
}
