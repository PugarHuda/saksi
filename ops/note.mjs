// The note scheme, shared by every circuit in the register.
//
//   pubKey     = Poseidon(privKey)
//   commitment = Poseidon(amount, pubKey, blinding)
//   nullifier  = Poseidon(commitment, leafIndex, privKey)
//
// A position is a commitment and nothing else. The amount and the owner live only in
// the holder's own note file; the chain sees one field element. Every later proof —
// transfer, exact, threshold, range, aggregate — re-opens this same commitment, which
// is what stops a holder answering an audit about a position they do not hold.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { makePoseidon } from "./merkle.mjs";
import { ROOT } from "./env.mjs";

const FILE = path.join(ROOT, "notes.json");
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export const randomField = () =>
  BigInt("0x" + crypto.randomBytes(31).toString("hex")) % FIELD;

export async function noteTools() {
  const { h1, h3, h2 } = await makePoseidon();
  return {
    h1, h2, h3,
    pubKey: (priv) => h1(priv),
    commitment: (amount, pub, blinding) => h3(amount, pub, blinding),
    nullifier: (commitment, leafIndex, priv) => h3(commitment, BigInt(leafIndex), priv),
  };
}

// A register with one ledger file has one holder. The recipient of a shielded transfer
// keeps their own, because the whole point is that the sender cannot spend what they sent —
// so the file that carries the spending key must not be the sender's.
//   NOTES=notes.holder2.json node ops/audit.mjs threshold 200
export const notesFile = () =>
  process.env.NOTES ? path.resolve(ROOT, process.env.NOTES) : FILE;

export const loadNotes = (file = notesFile()) => {
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  // Two shapes on purpose. The operator's ledger is a bare array of positions; a recipient's
  // is an object carrying their spending key and the notes that arrived, because the key is
  // the thing that makes it theirs and it should not be one entry among many.
  return Array.isArray(raw) ? raw : (raw.notes ?? []);
};

export function saveNote(note) {
  const all = loadNotes();
  all.push(note);
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2) + "\n");
  return all.length - 1;
}

export function replaceNotes(all) {
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2) + "\n");
}

export { FIELD, FILE as NOTES_FILE };
