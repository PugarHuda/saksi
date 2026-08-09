pragma circom 2.1.6;

// Saksi — Two-sided Range Selective Disclosure circuit
// -----------------------------------------------------------------------------
// Prove a confidential payment's amount lies within a BAND [lower, upper] WITHOUT
// revealing the exact amount. The regulator learns only the public band and that the
// commitment satisfies it — the shape of "this transaction is in the reportable
// bracket" reporting, in zero-knowledge. Sibling of thresholdDisclosure (one-sided).
//
//     commitment = Poseidon(amount, pubKey, blinding)   (same binding as deposit)
//     proven fact: lower <= amount <= upper             (amount stays hidden)
//
// Public  inputs : commitment, lower, upper, auditContextHash
// Private inputs : amount, pubKey, blinding
// -----------------------------------------------------------------------------

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

// THE BAND IS PROVER-CHOSEN. Both bounds are free public inputs, so `0 .. 2^64-1` always
// has a witness. As with the threshold circuit, the figure only means something because
// SaksiPool.claimHash pins it before an answer exists.

template RangeDisclosure() {
    // ---- PUBLIC INPUTS ----
    signal input commitment;          // the on-chain confidential commitment
    signal input lower;               // inclusive lower bound of the band (public)
    signal input upper;               // inclusive upper bound of the band (public)
    signal input auditContextHash;    // binds proof to one audit request

    // ---- PRIVATE INPUTS (holder secrets) ----
    signal input amount;              // true amount inside the commitment (NEVER disclosed)
    signal input pubKey;              // owner public key
    signal input blinding;            // commitment randomness

    // 1. Re-open the commitment from its secret preimage (same as disclosure/deposit).
    component hasher = Poseidon(3);
    hasher.inputs[0] <== amount;
    hasher.inputs[1] <== pubKey;
    hasher.inputs[2] <== blinding;
    commitment === hasher.out;

    // 2. Range-check amount AND both bounds to 64 bits, so the comparisons are real
    //    integer comparisons that cannot be gamed by field wrap-around.
    component ra = Num2Bits(64); ra.in <== amount;
    component rl = Num2Bits(64); rl.in <== lower;
    component ru = Num2Bits(64); ru.in <== upper;

    // 3. THE PREDICATE: lower <= amount AND amount <= upper. A valid proof exists ONLY
    //    when the amount is inside the band, and it reveals nothing else about it.
    component geLo = LessEqThan(64);
    geLo.in[0] <== lower;
    geLo.in[1] <== amount;
    geLo.out === 1;
    component leHi = LessEqThan(64);
    leHi.in[0] <== amount;
    leHi.in[1] <== upper;
    leHi.out === 1;

    // 4. Bind the audit context so a disclosure for one request can't be replayed.
    signal ctxSq;
    ctxSq <== auditContextHash * auditContextHash;
}

component main { public [ commitment, lower, upper, auditContextHash ] } = RangeDisclosure();
