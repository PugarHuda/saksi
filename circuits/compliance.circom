pragma circom 2.1.6;

// Saksi — Compliance circuit (ASP membership + non-membership)
// -----------------------------------------------------------------------------
// Proves, at the register's entry, that the depositor is compliant — WITHOUT
// revealing which member it is:
//   * MEMBERSHIP: the source key is in the ASP allow-list (Merkle inclusion in
//     the allow-list tree, root public),
//   * NON-MEMBERSHIP: the source key is not any of the publicly known
//     sanctioned/deny-listed keys.
// `bindHash` is a public signal the POOL pins to the deposit commitment (it appears
// in-circuit only as a squaring so the optimizer can't drop it — it is NOT bound to
// sourceKey/path inside the circuit). Detach-resistance in the deposit flow comes from
// two other places: SaksiPool.deposit pins pubSignals[9] == sourceKeyOf(msg.sender), which is
// keccak256(abi.encodePacked(msg.sender)) % FIELD — msg.sender being the authenticated
// caller on an EVM chain, and
// a separate disclosure/binding proof ties commitment <-> amount.
//
// This is the direct on-chain realization of the Privacy Pools whitepaper's
// "association set" model (Buterin, Soleimani, et al.).
//
// Public  : aspRoot, denyList[nDeny], sourceKey, bindHash
// Private : pathElements[levels], leafIndex
//
// sourceKey is PUBLIC: the pool sets it to a field derived from the authenticated
// depositor (sourceKeyOf(msg.sender)), so the proof shows that *this depositor* is an
// allow-listed source — not merely that some allow-listed source exists. The
// membership witness (path) is still private.
// -----------------------------------------------------------------------------

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "./lib/merkleProof.circom";

template Compliance(levels, nDeny) {
    // ---- PUBLIC ----
    signal input aspRoot;            // allow-list Merkle root
    signal input denyList[nDeny];    // publicly known sanctioned keys
    signal input sourceKey;          // keccak256(depositor) % FIELD, pinned by the pool
    signal input bindHash;           // public signal the POOL pins to the commitment (see header)

    // ---- PRIVATE ----
    signal input pathElements[levels];
    signal input leafIndex;

    // MEMBERSHIP: sourceKey is in the allow-list tree -> root must equal aspRoot.
    component idxBits = Num2Bits(levels);
    idxBits.in <== leafIndex;

    component tree = MerkleProof(levels);
    tree.leaf <== sourceKey;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== idxBits.out[i];
    }
    aspRoot === tree.root;

    // NON-MEMBERSHIP: sourceKey differs from every deny-listed key.
    component eq[nDeny];
    for (var j = 0; j < nDeny; j++) {
        eq[j] = IsEqual();
        eq[j].in[0] <== sourceKey;
        eq[j].in[1] <== denyList[j];
        eq[j].out === 0;   // must NOT equal any sanctioned key
    }

    // Keep bindHash as a live public signal (a squaring the optimizer can't drop). The
    // actual binding is the pool pinning bindHash == commitment as a public input.
    signal bindSq;
    bindSq <== bindHash * bindHash;
}

component main { public [ aspRoot, denyList, sourceKey, bindHash ] } = Compliance(10, 8);
