# circuits/

Seven Circom 2.1.6 circuits on BN254, Groth16. Merkle depth 10 → **1024 leaves,
and that is a real ceiling** on both the note tree and the association set.

Build artefacts live in `build/` and are **committed** — 21 files, every zkey,
wasm and verification key. Deliberate: the ceremony is not reproducible from
this repo alone, so shipping the keys is the only way a reader can check a
proof. `git ls-files circuits/build` is the list.

## The note scheme — shared by every circuit

```
pubKey     = Poseidon(privKey)
commitment = Poseidon(amount, pubKey, blinding)
nullifier  = Poseidon(commitment, leafIndex, privKey)
```

**Spending needs `privKey`. Disclosure needs only `(amount, pubKey, blinding)`.**
That asymmetry is the whole design: an auditor can be given the power to verify
a statement about a position without being given the power to move it. It is
also the trap — a blinding handed over is a full disclosure witness handed over.

## The circuits

| File | Proves |
|---|---|
| `compliance.circom` | the depositor is in the association set, bound to `sourceKeyOf(msg.sender)` |
| `transfer.circom` | JoinSplit, `Transfer(10,2,2)` — value conservation, ownership, non-double-spend |
| `disclosure.circom` | exact balance of a named position |
| `thresholdDisclosure.circom` | balance ≥ T |
| `rangeDisclosure.circom` | balance ∈ [lo, hi] |
| `aggregateDisclosure.circom` | sum over a declared set, `AGG_SLOTS = 5`, `DENY_SLOTS = 8` |
| `merkleUpdate.circom` | **NOT WIRED** — says so in its own header. Present, unused. |

## Read the headers before changing anything

Each header states what the circuit proves, what it does **not** prove, and
which limit is load-bearing. They were rewritten after an audit found several
describing a different system entirely (carried-over Soroban prior work —
`require_auth(from)`, USDC in stroops). A header that lies about a security
argument is worse than no header.

The four that matter most:

**`aggregateDisclosure`** — thirteen public signals, and `ctxNonce` is one of
them. Sizing a verifier from an incomplete list puts you off by one and the
proof does not decode. Its binding is over the **declared** set only; `cap` is
outside it, nothing ties a commitment to a holder, and completeness is an
assumption about the auditor's enumeration.

**`thresholdDisclosure` / `rangeDisclosure`** — the figure is **prover-chosen**.
`claimHash` in Solidity is what gives an answer meaning. Do not describe these
as proving a fact about a balance without that sentence attached.

**`transfer`** — `publicAmount` is not range-checked in-circuit. Conservation is
wrap-free because inputs and outputs are `Num2Bits(248)`-bounded and the
contract enforces `withdrawn <= balanceOf(this)`. **Widen 248 and it breaks
silently.** The margin is the proof.

Also in `transfer`: at least one input must be real. A zero-amount input skips
its Merkle check — that is what makes it a dummy and how a 1-in transfer is
expressed in a fixed 2-in circuit — but an *all*-dummy transaction still inserts
two leaves. Without the guard, anyone the pool admits could fill a 2^10 tree for
the price of gas in ~508 transactions, and every deposit past leaf 1023 is
unspendable forever because `inLeafIndex` is `Num2Bits(levels)`-bounded. The
guard does not make appending impossible; it makes it cost a real note.

## If you rebuild

A rebuilt circuit needs a redeployed verifier, and the pool holds verifier
addresses — see `contracts/CLAUDE.md` on why the pool is not redeployable.
Rebuilding is therefore a bigger decision than it looks.
