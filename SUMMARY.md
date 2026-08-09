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

## Problem

Every tokenized RWA platform publishes its holder register in the clear. An institution
buying a tokenized note broadcasts its position size, entry timing and counterparty to
every competitor watching the chain. That is a principal reason institutional private
credit stays on permissioned ledgers or never issues.

The obvious fix — a privacy pool — destroys what made the asset legitimate: the issuer can
no longer prove who holds what, enforce a concentration cap, or act on a revoked
credential.

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

**6 · CVA is the only asset in and out**, and the exit re-gates the *recipient* through
Cleanverse before the transfer, because leaving is an edge too.

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

That last row is the one to read. The true total was 1,150. The context hash is a Poseidon
commitment over the enumerated positions *and* their active flags, and the circuit
recomputes it — so the holder cannot answer by leaving a position out, and cannot answer
falsely. **There is no proof, so the request is still open on-chain.** Every other system
here answers or reverts; this one records that it could not answer.

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
