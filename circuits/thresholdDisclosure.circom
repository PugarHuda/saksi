pragma circom 2.1.6;

// Saksi — Threshold (range) Selective Disclosure circuit
// -----------------------------------------------------------------------------
// A stronger-privacy sibling of disclosure.circom. Instead of revealing the EXACT
// amount to a regulator, the holder proves a *predicate* about it — "this payment
// is at most the reporting threshold" — WITHOUT disclosing the amount itself.
//
// This is the compliance primitive real reporting rules want: prove you are under
// (or over) a threshold, keep the exact figure private. The regulator learns only
// the public threshold and that the commitment satisfies it.
//
//     commitment = Poseidon(amount, pubKey, blinding)   (same binding as deposit)
//     proven fact: amount <= threshold                  (amount stays hidden)
//
// Public  inputs : commitment, threshold, auditContextHash
// Private inputs : amount, pubKey, blinding
// -----------------------------------------------------------------------------

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

template ThresholdDisclosure() {
    // ---- PUBLIC INPUTS ----
    signal input commitment;          // the on-chain confidential commitment
    signal input threshold;           // the reporting threshold being tested (public)
    signal input auditContextHash;    // binds proof to one audit request

    // ---- PRIVATE INPUTS (holder secrets) ----
    signal input amount;              // true amount inside the commitment (NEVER disclosed)
    signal input pubKey;              // owner public key
    signal input blinding;            // commitment randomness

    // 1. Re-open the commitment from its secret preimage (same as disclosure/deposit),
    //    so the predicate is about the SAME amount that is on-chain.
    component hasher = Poseidon(3);
    hasher.inputs[0] <== amount;
    hasher.inputs[1] <== pubKey;
    hasher.inputs[2] <== blinding;
    commitment === hasher.out;

    // 2. Range-check amount AND threshold to 64 bits, so the comparison below is a real
    //    integer comparison and cannot be gamed by field wrap-around.
    component ra = Num2Bits(64);
    ra.in <== amount;
    component rt = Num2Bits(64);
    rt.in <== threshold;

    // 3. THE PREDICATE: amount <= threshold. A valid proof exists ONLY when this holds,
    //    and it reveals nothing about `amount` beyond that fact.
    component le = LessEqThan(64);
    le.in[0] <== amount;
    le.in[1] <== threshold;
    le.out === 1;

    // 4. Bind the audit context so a disclosure for one request can't be replayed.
    signal ctxSq;
    ctxSq <== auditContextHash * auditContextHash;
}

component main { public [ commitment, threshold, auditContextHash ] } = ThresholdDisclosure();
