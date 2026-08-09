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

  // notes.json holds the secrets that open each commitment, and the wallet that created
  // it. The console renders the holder column as shielded, so shipping the mapping in
  // the same bundle would make the interface contradict itself. It publishes that a
  // position exists and when — never who, and never how to open it.
  //
  // Note honestly: entry is public by construction. The deposit transaction has a
  // visible sender and moves a visible ERC-20 amount, so anyone reading the chain can
  // reconstruct this mapping for the entry itself. What the register conceals is the
  // book AFTER positions move, which is where a JoinSplit breaks the link. Withholding
  // it here is about not doing the observer's work for them, not about a guarantee.
  if (f === "notes.json") {
    data = data.map((n) => ({
      commitment: n.commitment,
      depositTx: n.depositTx,
      provedAt: n.provedAt,
      aspRoot: n.aspRoot,
    }));
  }
  fs.writeFileSync(dst, JSON.stringify(data, null, 2));
  console.log(`sync-data: ${f}`);
}
