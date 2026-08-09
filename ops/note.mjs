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
import { ROOT, writeJson } from "./env.mjs";

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

/** Append to the ledger the process is actually working with.
 *
 *  This read through notesFile() and wrote back to FILE, so `NOTES=notes.holder2.json node
 *  ops/deposit.mjs …` loaded the recipient's ledger and saved it into the operator's —
 *  copying another holder's positions, and their spending key with them, into notes.json.
 *  Read and write have to name the same file. */
export function saveNote(note, file = notesFile()) {
  const all = loadNotes(file);
  all.push(note);
  const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : all;
  // Preserve the recipient shape: a per-holder ledger is an object carrying its spending
  // key, and flattening it to a bare array would drop the key.
  // writeJson, not writeFileSync: this file is the only copy of every position's blinding,
  // and a truncated write loses all of them, not just the one being appended.
  writeJson(file, Array.isArray(raw) ? all : { ...raw, notes: all });
  return all.length - 1;
}

/** Every position on this machine, across every holder ledger.
 *
 *  An aggregate that enumerates one ledger cannot honestly say "across ALL registered
 *  positions" — a note paid to another holder lives in notes.<label>.json, and reading only
 *  notes.json silently leaves it out of the total.
 *
 *  ponytail: local ledger files, which is what a single-machine demo has. A register with
 *  holders on separate machines needs each of them to contribute their own openings; the
 *  refusal in ops/audit.mjs is what keeps that honest rather than guessed at. */
export function loadAllNotes() {
  const files = fs.readdirSync(ROOT)
    .filter((f) => f === "notes.json" || (/^notes\..+\.json$/.test(f) && f !== "notes.public.json"))
    .map((f) => path.join(ROOT, f));
  return files.flatMap((f) => loadNotes(f).map((n) => ({ ...n, ledger: path.basename(f) })));
}

export { FIELD };

/** Rebuild the published index from every ledger on disk.
 *
 *  The private ledger is one holder's view; the register is all of them. Writing the index
 *  from `notes.json` alone published four positions while the chain held six, and the
 *  console then reported a retirement count that was a subtraction against the wrong
 *  numerator. Nothing here is secret — a commitment, the transaction that created it, and
 *  how it was created — so the index is derivable and should be derived rather than
 *  maintained by hand.
 */
export function writePublicIndex() {
  const rows = loadAllNotes().map((n) => ({
    commitment: n.commitment,
    depositTx: n.depositTx ?? null,
    provedAt: n.provedAt ?? n.receivedAt ?? null,
    aspRoot: n.aspRoot ?? null,          // a transact carries no association-set proof
    origin: n.origin ?? "deposit",
  }));
  writeJson(path.join(ROOT, "notes.public.json"), rows);
  return rows.length;
}
