pragma circom 2.1.6;

// Saksi — Aggregate (portfolio) Selective Disclosure circuit — VARIABLE COUNT
// -----------------------------------------------------------------------------
// Prove that the SUM of a VARIABLE number (1..N) of confidential payments over a period
// is at most a reporting cap, WITHOUT revealing any individual amount — the shape of a
// periodic CTR / threshold report, in zero-knowledge, over the same note commitments the
// register already publishes.
//
// A Groth16 circuit is fixed-width, so we support 1..N via public per-slot `active` flags:
// an ACTIVE slot must open its commitment and contributes its amount to the sum; an
// INACTIVE slot is ignored (contributes 0, its commitment is unconstrained). The pool only
// requires the ACTIVE slots' commitments to be known on-chain deposits.
//
//     commitment[i] = Poseidon(amount[i], pubKey[i], blinding[i])   (same as deposit)
//     proven fact  : sum over active[i]=1 of amount[i]  <=  cap      (each amount hidden)
//
// Public  inputs : commitments[N], active[N], cap, auditContextHash, ctxNonce
//                  (13 signals at N=5. The nonce is public too and was missing from this
//                  list — an integrator sizing the verifier from this comment would be off
//                  by one and the proof would not decode.)
// Private inputs : amounts[N], pubKeys[N], blindings[N]
// -----------------------------------------------------------------------------

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

template AggregateDisclosure(N) {
    // ---- PUBLIC INPUTS ----
    signal input commitments[N];      // the N slot commitments (active ones are real deposits)
    signal input active[N];           // per-slot flag: 1 = real payment, 0 = padding
    signal input cap;                 // the reporting cap the total is tested against (public)
    signal input auditContextHash;    // = Poseidon(ctxNonce, commitments, active) — see below
    signal input ctxNonce;            // the audit request's period/regulator id (public)

    // ---- PRIVATE INPUTS (holder secrets) ----
    signal input amounts[N];
    signal input pubKeys[N];
    signal input blindings[N];

    component hasher[N];
    component ra[N];
    signal contrib[N];
    signal partial[N];

    for (var i = 0; i < N; i++) {
        // active[i] is a boolean.
        active[i] * (active[i] - 1) === 0;

        // Re-open the commitment; an ACTIVE slot MUST match (so the aggregate is over the
        // SAME amounts committed on-chain), an inactive slot is left unconstrained.
        hasher[i] = Poseidon(3);
        hasher[i].inputs[0] <== amounts[i];
        hasher[i].inputs[1] <== pubKeys[i];
        hasher[i].inputs[2] <== blindings[i];
        active[i] * (commitments[i] - hasher[i].out) === 0;

        // Range-check every amount to 64 bits so the running sum can't wrap the field.
        ra[i] = Num2Bits(64);
        ra[i].in <== amounts[i];

        // Only active slots contribute to the total.
        contrib[i] <== active[i] * amounts[i];
    }

    // Accumulate the total of the active amounts.
    partial[0] <== contrib[0];
    for (var i = 1; i < N; i++) {
        partial[i] <== partial[i - 1] + contrib[i];
    }

    // Bound the cap (72 bits holds a sum of N 64-bit amounts for N<=64), then prove total <= cap.
    component capRange = Num2Bits(72);
    capRange.in <== cap;
    component le = LessEqThan(72);
    le.in[0] <== partial[N - 1];
    le.in[1] <== cap;
    le.out === 1;

    // COMPLETENESS BINDING: the audit request (auditContextHash) commits to the EXACT required
    // set — the commitments AND active flags — plus a nonce (period/regulator id). The regulator
    // ISSUES this hash for the full required set (enumerated from the depositor's on-chain
    // deposits). A holder who tries to omit a payment (flip an active flag or swap a commitment)
    // recomputes a DIFFERENT hash than the one issued, so `auditContextHash === ctxHasher.out`
    // fails and no proof exists. This closes the cherry-picking gap OVER THE DECLARED SET, which is a narrower claim
//   than it reads. The hash binds every commitment and every flag, so a holder cannot drop
//   a position from a set the auditor fixed. It says nothing about whether that set was
//   complete: `cap` is NOT inside the hash, nothing ties a commitment to a holder, and
//   `_requireKnown` proves deposited rather than unspent — the chain structurally cannot
//   tell a live position from a retired one, which is the confidentiality this register is
//   for. Completeness is an assumption about the auditor's enumeration, not a property of
//   the proof.
    component ctxHasher = Poseidon(2 * N + 1);
    ctxHasher.inputs[0] <== ctxNonce;
    for (var i = 0; i < N; i++) {
        ctxHasher.inputs[1 + i] <== commitments[i];
        ctxHasher.inputs[1 + N + i] <== active[i];
    }
    auditContextHash === ctxHasher.out;
}

component main { public [ commitments, active, cap, auditContextHash, ctxNonce ] } = AggregateDisclosure(5);
