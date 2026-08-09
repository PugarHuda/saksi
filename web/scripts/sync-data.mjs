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

const files = ["deployment.json", "asp.json", "audit-log.json", "notes.json", "measurement.json"];
for (const f of files) {
  const src = path.join(root, f);
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

  // notes.json holds the secrets that open each commitment. The console only needs to
  // know a position exists and when it entered — never how to open it.
  if (f === "notes.json") {
    data = data.map((n) => ({
      commitment: n.commitment,
      wallet: n.wallet,
      depositTx: n.depositTx,
      provedAt: n.provedAt,
      aspRoot: n.aspRoot,
      leafIndex: n.leafIndex,
    }));
  }
  fs.writeFileSync(dst, JSON.stringify(data, null, 2));
  console.log(`sync-data: ${f}`);
}
