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
import { ROOT, writeJson } from "./env.mjs";
import { noteTools, randomField } from "./note.mjs";

// A label becomes a filename, so it is a path fragment with no validation between it and
// the disk. "public" resolves to notes.public.json, which .gitignore deliberately
// un-ignores — so it would write a live spending key into a tracked file. "../../x"
// escapes the repository altogether. This project has leaked commitment openings twice;
// this was a third route to the same place.
const LABEL_OK = (l) =>
  /^[a-z0-9_-]{1,32}$/i.test(l) && l.toLowerCase() !== "public";   // notes.public.json is tracked
const label = process.argv[2];
if (!label || !LABEL_OK(label)) {
  console.error("usage: node ops/keygen.mjs <label>   (letters, digits, _ and - only)");
  process.exit(1);
}

const file = path.join(ROOT, `notes.${label}.json`);
if (fs.existsSync(file)) {
  console.error(`${file} already exists — refusing to overwrite a ledger that may hold keys.`);
  process.exit(1);
}

const t = await noteTools();
const privKey = randomField();
const pubKey = t.pubKey(privKey);

// The ledger starts with the key and no positions. saveNote appends to it as notes arrive.
writeJson(file, { label, privKey: privKey.toString(), pubKey: pubKey.toString(), notes: [] });

console.log(`${label} generated their own spending key.`);
console.log(`  ledger   notes.${label}.json   (gitignored — it holds the key)`);
console.log(`  pubKey   ${pubKey}`);
console.log("");
console.log("Give the sender the pubKey and nothing else:");
console.log(`  node ops/transfer.mjs --as issuer --to-pubkey ${pubKey} --to-label ${label}`);
