// Does every operator script still parse?
//
// ops/note.mjs shipped in a state the ESM loader rejects — a newline written into a
// double-quoted string by a patch script — and three scripts that import it died before
// their first line. Nothing caught it because nothing ever parsed these files: the tests
// are Foundry's, and Foundry does not read JavaScript. A judge cloning the repo would have
// been the first to find out.
//
// ponytail: node --check per file, which is the parse the loader itself does. Not a linter,
// not a type-checker — the bug that shipped was "this is not JavaScript", and that is the
// check that catches it. Reach for more only when something subtler gets through.

import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith(".mjs"));

let bad = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", path.join(here, f)], { stdio: "pipe" });
  } catch (e) {
    bad++;
    // The loader's own message names the line and the token; reprinting it beats summarising.
    console.error(`${f}\n${(e.stderr ?? "").toString().trim()}\n`);
  }
}

console.log(bad ? `${bad} of ${files.length} ops scripts do not parse` : `${files.length} ops scripts parse`);
process.exit(bad ? 1 : 0);
