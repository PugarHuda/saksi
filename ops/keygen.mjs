// A holder generates their own spending key. Nobody else ever sees it.
//
//   node ops/keygen.mjs holder2
//
// This exists so a shielded transfer can have a real recipient. The sender needs the
// recipient's PUBLIC key to build the output commitment, and must never hold the private
// one — otherwise the note has two people who can spend it and ownership has not moved at
// all, which is exactly what every transfer in this register did until now.

import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { noteTools, randomField } from "./note.mjs";

const label = process.argv[2];
if (!label) { console.error("usage: node ops/keygen.mjs <label>"); process.exit(1); }

const file = path.join(ROOT, `notes.${label}.json`);
if (fs.existsSync(file)) {
  console.error(`${file} already exists — refusing to overwrite a ledger that may hold keys.`);
  process.exit(1);
}

const t = await noteTools();
const privKey = randomField();
const pubKey = t.pubKey(privKey);

// The ledger starts with the key and no positions. saveNote appends to it as notes arrive.
fs.writeFileSync(file, JSON.stringify({ label, privKey: privKey.toString(), pubKey: pubKey.toString(), notes: [] }, null, 2) + "\n");

console.log(`${label} generated their own spending key.`);
console.log(`  ledger   notes.${label}.json   (gitignored — it holds the key)`);
console.log(`  pubKey   ${pubKey}`);
console.log("");
console.log("Give the sender the pubKey and nothing else:");
console.log(`  node ops/transfer.mjs --as issuer --to-pubkey ${pubKey} --to-label ${label}`);
