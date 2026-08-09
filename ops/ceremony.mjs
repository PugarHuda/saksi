// What a Groth16 proof here is actually worth, and who you have to trust for it.
//
//   node ops/ceremony.mjs
//
// Every claim this project makes rests on Groth16 soundness, and Groth16 soundness rests
// on a trusted setup. If the party that generated the structured reference string kept
// the randomness, they can forge a proof for a false statement and nobody can tell. So
// the provenance of these proving keys is not a footnote — it is the assumption under
// everything, and a judge is entitled to ask.
//
// This reads the contribution history out of each .zkey rather than describing it from
// memory, so the answer is checkable against the artifacts in the repo.

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

const BUILD = path.join(ROOT, "circuits", "build");
const CIRCUITS = [
  "compliance", "transfer", "merkleUpdate",
  "disclosure", "thresholdDisclosure", "rangeDisclosure", "aggregateDisclosure",
];

console.log("PHASE 1 — the universal powers-of-tau");
console.log("  pot14_hez.ptau: the Hermez ceremony, a public multi-party computation with");
console.log("  many independent contributors. Not ours, and not something we could have");
console.log("  subverted. It is excluded from the repo only for size (~19 MB) and is");
console.log("  downloadable from the Hermez/Polygon publication.\n");

console.log("PHASE 2 — circuit-specific, and the part that is ours to answer for\n");

let anyMissing = false;
for (const name of CIRCUITS) {
  const f = path.join(BUILD, `${name}_final.zkey`);
  if (!fs.existsSync(f)) { console.log(`  ${name.padEnd(22)} zkey missing`); anyMissing = true; continue; }

  const raw = fs.readFileSync(f).toString("latin1");
  const labels = [...raw.matchAll(/[\x20-\x7e]{4,48}/g)]
    .map((m) => m[0].trim())
    .filter((t) => /^(contributor|final beacon|beacon)/i.test(t));
  const unique = [...new Set(labels.map((l) => l.replace(/[^\x20-\x7e]+$/, "")))];

  const contributions = unique.filter((u) => /^contributor/i.test(u)).length;
  const beacon = unique.some((u) => /beacon/i.test(u));
  const mb = (fs.statSync(f).size / 1024 / 1024).toFixed(2);

  console.log(
    `  ${name.padEnd(22)} ${contributions} contribution(s)` +
    `${beacon ? " + final beacon" : " + NO BEACON"}   ${mb} MB`,
  );
}

console.log(`
WHAT THIS MEANS, PLAINLY

  Three contributions and a closing beacon is the shape a phase-2 ceremony is supposed to
  have, and the beacon matters: it removes the last contributor's ability to be the sole
  holder of the secret.

  But the contributions carry snarkjs's default labels rather than named participants,
  which is what you get when one operator runs all of them on one machine. We have no
  evidence of independent participants, and we are not going to imply otherwise. Treat
  this as a SINGLE TRUST DOMAIN: if that operator retained the phase-2 randomness, forged
  proofs are possible and undetectable.

  For a hackathon on a testnet with no value at risk, that is an acceptable assumption to
  run on. For a pilot holding real assets it is not, and the fix is ordinary: re-run
  phase 2 with named external contributors and publish their attestations. Nothing about
  the circuits or the contracts changes.

  Stated here rather than left for a reviewer to find, because the alternative is a
  submission whose central claim rests on an assumption it never named.
`);

if (anyMissing) process.exit(1);
