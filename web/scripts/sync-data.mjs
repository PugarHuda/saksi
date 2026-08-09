// Copy the register's on-disk state into the app so the console ships with the same
// snapshot the ops scripts produced. Live values are read from the chain at runtime;
// these files supply what only the operator has — the association set, the audit log,
// and the deployment record.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(web, "..");
const out = path.join(web, "public", "data");
fs.mkdirSync(out, { recursive: true });

// asp.public.json, not asp.json: the raw set carries other teams' wallet addresses and
// record ids, which are not ours to publish. See the note in ops/asp.mjs.
const files = [
  "deployment.json",
  ["asp.public.json", "asp.json"],
  "audit-log.json",
  // the redacted source, so the console can never be wired to the file holding secrets
  ["notes.public.json", "notes.json"],
  "measurement.json",
];
for (const entry of files) {
  // A pair means "read this, publish it under that name".
  const [from, f] = Array.isArray(entry) ? entry : [entry, entry];
  const src = path.join(root, from);
  const dst = path.join(out, f);

  // On a build host only `web/` is uploaded, so the repo-root sources are absent. The
  // committed copy in public/data is then the authoritative one — overwriting it with a
  // placeholder is how the deployed console silently lost its data.
  if (!fs.existsSync(src)) {
    if (fs.existsSync(dst)) {
      console.log(`sync-data: ${f} source absent, keeping the committed copy`);
    } else {
      console.warn(`sync-data: ${f} missing entirely, writing an empty placeholder`);
      fs.writeFileSync(dst, f === "notes.json" || f === "audit-log.json" ? "[]" : "null");
    }
    continue;
  }
  let data = JSON.parse(fs.readFileSync(src, "utf8"));

  // The source of this file is now `ops/publish-index.mjs`, which reads it out of the
  // chain's own CommitmentInserted log and never opens a ledger, so there is nothing here
  // to redact — every field is already public to anyone with an RPC endpoint. The
  // whitelist stays anyway: it is what stops a future field from reaching the browser
  // because somebody added it upstream, and this list is cheaper to review than the
  // producer is.
  //
  // The names are load-bearing. This mapping used to spell the OLD field names, and after
  // the producer changed, every row shipped as a lone `commitment` with the rest undefined
  // — JSON.stringify drops those — so the Register tab threw on the first row and took the
  // console down. A whitelist silently rewrites the shape it does not recognise.
  //
  // Note honestly: entry is public by construction. The deposit transaction has a visible
  // sender and moves a visible ERC-20 amount, so anyone reading the chain can reconstruct
  // that mapping for the entry itself. What the register conceals is the book AFTER
  // positions move, which is where a JoinSplit breaks the link — and which is why liveness
  // is no longer published here at all.
  if (f === "notes.json") {
    const KEEP = ["commitment", "leafIndex", "tx", "block", "origin"];
    const missing = data.length
      ? KEEP.filter((k) => data[0][k] === undefined)
      : [];
    if (missing.length) {
      console.error(`sync-data: notes.public.json has no ${missing.join(", ")} — regenerate it`);
      console.error("with `node ops/publish-index.mjs`. Refusing to ship rows the console cannot render.");
      process.exit(1);
    }
    data = data.map((n) => Object.fromEntries(KEEP.map((k) => [k, n[k]])));
  }
  fs.writeFileSync(dst, JSON.stringify(data, null, 2));
  console.log(`sync-data: ${f}`);
}
