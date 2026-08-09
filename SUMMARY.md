# Saksi — one-page summary

**Track** RWA · **Deployed** Monad testnet (10143) · **Builder** Pugar Huda Mantoro, solo
**Repo** github.com/PugarHuda/saksi · **Console** https://saksi-gilt.vercel.app

---

## The one sentence

**Saksi is the only entry where the auditor's question is registered on-chain *before the
answer exists* — block 52157468 asks whether a position is under the cap, block 52157475
answers with a Groth16 proof that it is, without ever revealing the position — and the
only one whose compliance gate is a constraint inside a circuit over the live Cleanverse
A-Pass registry rather than a lookup performed before the transaction.**

Anyone can check that ordering with an RPC endpoint and no access to this repository.

## Problem — measured, not asserted

Every tokenized RWA platform publishes its holder register in the clear. The usual reply
is that a public chain is pseudonymous, so this costs the holder nothing. We measured
whether that is true for this asset class. `node ops/measure-register.mjs` runs an
exhaustive census: a CVA transfer requires a credential on both sides, so the set of
wallets holding an A-Pass is not a sample of possible holders — it is all of them.

**545 credentialed wallets × every CVA on Monad, every balance read, no failed reads:**

| | |
|---|---|
| Assets with at least one holder | 9 |
| **Median holders per asset** | **2** |
| Held by exactly one wallet | 2 |
| Fewer than five holders | 6 of 9 — **67%** |
| One wallet holding 90%+ of supply | 3 |

An anonymity set of two is not anonymity. Knowing the asset and watching one transfer
identifies the position and its size.

And this is not a testnet artefact — it is the mechanism. **The tighter an asset's holder
rule, the smaller the crowd its holders hide in.** Eligibility restricts the population by
design, so compliance and confidentiality are structurally in tension. Every project here
tightens the rule. None of them notice that doing so makes each remaining holder more
exposed, not less.

The obvious fix — a privacy pool — destroys what made the asset legitimate: the issuer can
no longer prove who holds what, enforce a concentration cap, or act on a revoked
credential.

Saksi refuses the trade-off rather than picking a side of it.

## Solution

A **confidential holder register**: positions in a Cleanverse Verified Asset are held as
Poseidon commitments, so amount and holder are absent from the chain, while entry, exit
and audit stay answerable. Private in the middle, accountable at both edges.

## CVI · CVA integration — six points, each load-bearing

**1 · The CVA is ours, from the issuance stage.** `atoken/launch` created *Saksi Series A
Note* (`SAKSIAZEV`) with a `min_tier 30` RuleV2 attached at launch, not bolted on after.
We hold `MINTER_ROLE` and minted the supply the register holds.

**2 · The pool is a registered Cleanverse compliance pool, and calls their contract live.**
`validator/grant` + `validator/register` with an EIP-191 owner signature over
`monad0x9bb3…`. `deposit()` then calls `complianceVerify(pool, msg.sender)` on Cleanverse's
validator **inside the transaction that moves the value**. An unregistered pool makes that
call revert, so the register fails closed rather than quietly becoming an open one.

**3 · The pool contract itself holds a CVI.** Cleanverse enforce a credential on both sides
of a CVA transfer, so a contract cannot custody one without an A-Pass of its own. We
issued the pool one via `generate_apass`. This is what makes a pooled venue for a CVA
possible at all — and it is worth noting because another entry in this cohort built its
entire thesis on the premise that a contract "cannot get one."

**4 · CVI membership is a constraint inside the circuit, not a check beside it.** The
association set is derived on every build from live A-Pass state; each admitted wallet
becomes a leaf, and the compliance proof must show membership *and* non-membership of the
sanctions list, bound to `msg.sender` and to the exact commitment. Without a revocable,
wallet-bound credential there is no set to prove membership in.

**5 · Revocation is a rebuild, not a list.** `update_status` freezes the credential, the
next set is built without it, `rotateRoot` / `retireRoot` anchor the change. No blacklist
is maintained.

Stated precisely, because an audit caught us overstating it: **entry is gated
cryptographically** — no membership witness exists, so no proof exists, and nothing an
operator does or forgets can change that. **The exit is gated operationally** — `transact()`
now calls `complianceVerify` on the spender, but the transfer circuit carries no
association-set input, so the proof is not bound to `msg.sender` and an eligible party
could in principle relay a revoked holder's withdrawal. Closing that properly means adding
the association set to the transfer circuit: a recompile and a new ceremony, not a patch.
Better to name the asymmetry than let "the position freezes" stand as if both edges were
equally strong.

**6 · CVA is the only asset in and out**, and both the spender and the recipient are
re-gated through Cleanverse before the transfer, because leaving is an edge too.

## Why two gates, demonstrated live

`node ops/gate-gap.mjs` prints this, and any judge can reproduce it:

```
subject                                   gate 1 · Cleanverse   gate 2 · association set   admitted?
0x00000000…00dEaD   the burn address      ADMITS                no witness                 no
0x11111111…111111   0x1111…1111           ADMITS                ADMITS                     yes
0x4490CcB0…b44639   issuer                ADMITS                ADMITS                     yes
0xa132a1BB…ac6483   revoked holder        refuses               no witness                 no
```

**Cleanverse's own validator answers that the burn address satisfies this pool's rule.**
Someone in the shared sandbox issued `0x…dEaD` a credential; `complianceVerify` returns
true for it today. Gate one admits it. Gate two has no membership witness for it, so no
proof exists and it does not enter. That is the argument for two gates, in one call.

The honest half: `0x1111…1111` **is** in our set, because it is in the registry. The
association set is faithful to Cleanverse, not cleaner than it. What the second gate adds
is not better identity data — it is a second, independent question, anchored by the issuer
at a point in time, that an address must also satisfy.

## Answerability — and the strongest row is a failure

Four contract-verified disclosure types, each bound to an audit request the auditor
registered on-chain before any answer existed. Request block always precedes answer block.

| Proof | Question | Request blk | Answer blk |
|---|---|---|---|
| threshold | position ≤ 500? | 52157468 | 52157475 |
| range | inside the 100–600 bracket? | 52157484 | 52157491 |
| exact | disclose in full | 52157500 | 52157507 |
| aggregate | total across 4 positions ≤ 1,500? | 52163021 | 52163029 |
| aggregate | total across 5 positions ≤ 2,000? | 52165119 | 52165128 |
| **aggregate** | **total across 4 positions ≤ 1,000?** | **52163014** | **never — no proof exists** |

That last row is the one to read. The true total exceeded the cap. The context hash is a
Poseidon commitment over the enumerated positions *and* their active flags, and the circuit
recomputes it, so a holder who drops a position computes a different hash and no proof
exists. **There is no proof, so the request stays open on-chain.** Every other system here
answers or reverts; this one records that it could not answer.

**The precise version of the completeness claim**, because the loose version is a common
way to be wrong: the circuit guarantees the answer covers *the set the context hash names*.
That is only worth something if the **auditor** fixed the hash. Our first implementation
let the prover choose the set and then had the auditor register the prover's own hash —
which proves the answer matches the declared set and says nothing about whether the set was
complete. It now reads the required set from the register itself, on-chain, on the
auditor's side (`allCommitments()`), so the holder is answering a question it did not get
to shape. If the register holds more positions than the circuit has slots, or contains a
position this holder cannot open, the tool refuses to answer rather than answering over a
subset — trimming the set would be precisely the cherry-picking the design exists to stop.

The distinction worth naming: **a log is a claim, a proof is a check.** A compliance
system that writes its decisions to a ledger asks you to trust the thing doing the
writing — drop a row and nobody knows. Saksi asks for no trust at all. When the total was
1,150 and the cap was 1,000, no private key, no honest operator and no privileged party
could have produced that answer, because the witness does not exist.

## What is running

| | |
|---|---|
| SaksiPool | `0x9BB3af71497304506Be2810915016742394f72f2` — 7 shielded positions, 5 verified holders |
| Saksi Series A Note (our CVA) | `0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B` · `totalSupply` 1,000,000 · pool holds 2,275 |
| Cleanverse CVI Validator | `0xaC7e5179C2C7f03f209136886c172eb34F161792` — `isRegistered(pool)` → true · `getRulesV2(pool)` → `(0x0000,0x0000,30,0,0)` |
| Verifiers | compliance `0xd9911689…` transfer `0xa98cee28…` exact `0x2960aece…` threshold `0xfb6aa862…` range `0x2b81cd71…` aggregate `0x7e7684bb…` |
| Deposits | 7 × status 1, ~1.85M gas each — a Groth16 proof verified inside every one |
| Tests | 34 Foundry tests, incl. a real proof against the exported verifier at 264k gas |

Regenerate this table from the chain yourself: `node ops/evidence.mjs`.

## The obvious question

*"If I hold the note outside your pool, my position is public again — so what is
confidential, the asset or the pool?"*

The pool. Confidentiality is opt-in, and that is the correct shape rather than a
limitation: it is how a nominee account works in traditional markets. A holder who wants
to be visible stays on the token's own balance map; a holder who does not enters the
register and becomes one commitment among many. What Saksi adds is that entering the
nominee does not cost the issuer or the regulator anything — the position stays
answerable, which is precisely what a real nominee account cannot promise.

## Scalability

Asset-agnostic: any CVA issuer attaches a confidential register to an existing token
without changing issuance. Verification is 264k gas on BN254 precompiles; proving runs in
under a second on a laptop. Positions as an Infrastructure Partner — a module, not a
destination.

## Declared prior work

The seven Circom circuits and their proving keys are prior public work from a Soroban
build, committed as the first commit under exactly that description. Everything that
touches Cleanverse — the Solidity pool and its two gates, the association-set builder, the
four disclosure flows, the deployment, the consoles — is this window.

## What an adversarial audit found, and what we did

We ran the contract through an adversarial review with working proof-of-concept exploits
rather than shipping it unexamined. Three findings were serious; all three are closed and
covered by tests.

| Finding | What it allowed | Fix |
|---|---|---|
| Commitment not bound to the deposited amount | Transfer one unit, commit to a million, let the JoinSplit carry the forgery out. The register was drainable. | `deposit()` now requires a second Groth16 proof opening the commitment to exactly the amount transferred |
| `uint256(commitment) % FIELD` is not injective — six `bytes32` share each residue | A position that spends normally but that **no disclosure can ever name**: a silent, free opt-out from the answerability guarantee | commitments must *be* field elements, not merely reduce to one |
| Audit requests were opaque flags any known commitment could answer | One unit bought the permanent right to close someone else's audit with a vacuous proof about a throwaway note, and to write a false answer into the record | a request names its subject and the kind of answer it accepts; both are enforced |

Also closed: a fee silently pocketed on internal transfers, a withdrawal not bounded by
the register's actual backing, two identical output commitments inserting the same leaf
twice, ownership renounceable to the zero address, and a published note root with no undo.

The one finding we did **not** fully close is the exit-gating asymmetry described in
integration point 5 — it needs a new circuit, and saying so is better than pretending.

## Honest limits

- The note-tree root is owner-published rather than advanced by the `merkleUpdate` proof.
  Every leaf is emitted, so a wrong root is detectable, but a pilot should close this with
  the circuit that already exists.
- The deny list is a fixed 8-slot array — right for a pilot, wrong for a live sanctions
  feed; the upgrade is a non-membership proof against a second tree.
- The Cleanverse sandbox is shared across hackathon teams, so the association set holds 46
  credentials rather than our five. Two observed sandbox quirks, reported rather than
  hidden: `update_status` returns `[500] System Error` while the on-chain freeze
  nonetheless succeeds, and `download_travel_rule` requires a plain-JSON body although it
  is not listed among the plain endpoints.
