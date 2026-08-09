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

const files = ["deployment.json", "asp.json", "audit-log.json", "notes.json"];
for (const f of files) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) {
    console.warn(`sync-data: ${f} missing, writing an empty placeholder`);
    fs.writeFileSync(path.join(out, f), f === "deployment.json" ? "{}" : "[]");
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
  fs.writeFileSync(path.join(out, f), JSON.stringify(data, null, 2));
  console.log(`sync-data: ${f}`);
}
