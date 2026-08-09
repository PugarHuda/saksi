// Read-only reconnaissance of what our institution already has in the sandbox.
//   node ops/discover.mjs
import { Cleanverse } from "./cleanverse.mjs";

const cv = new Cleanverse();
const show = (label, v) => console.log(`\n=== ${label} ===\n` + JSON.stringify(v, null, 2));

for (const chain of ["monad", "base"]) {
  try {
    show(`apass_list ${chain}`, await cv.queryApassList({ chain, page: 1, pageSize: 100 }));
  } catch (e) { console.log(`apass_list ${chain}: ${e.message}`); }
}

try { show("apass_list (no chain filter)", await cv.queryApassList({ page: 1, pageSize: 100 })); }
catch (e) { console.log(`apass_list all: ${e.message}`); }

try { show("my atokens", await cv.listMyAtokens()); }
catch (e) { console.log(`list_my_atokens: ${e.message}`); }

for (const chain of ["monad", "base"]) {
  try { show(`supported atokens ${chain}`, await cv.post("query_atoken_list", { chain })); }
  catch (e) { console.log(`query_atoken_list ${chain}: ${e.message}`); }
}
