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

export const loadNotes = () =>
  fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : [];

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
