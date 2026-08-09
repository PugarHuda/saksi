# Saksi — one-page summary

**Track:** RWA · **Chain deployed:** Monad testnet (10143) · **Builder:** Pugar Huda Mantoro (solo)
**Repo:** github.com/PugarHuda/saksi · **Live console:** https://saksi-gilt.vercel.app

---

## Problem

Every tokenized RWA platform publishes its holder register in the clear. An institution
buying a tokenized note broadcasts its position size, entry timing and counterparty to
every competitor watching the chain. That is a principal reason institutional private
credit stays on permissioned ledgers or never issues.

The obvious fix — a privacy pool — destroys what made the asset legitimate: the issuer
can no longer prove who holds what, enforce a concentration cap, or act on a revoked
credential.

## Solution

**Saksi is a confidential holder register: private in the middle, accountable at both edges.**
Positions in a Cleanverse Verified Asset are held as Poseidon commitments, so amount and
holder are absent from the chain — while entry, exit and audit remain answerable.

## CVI · CVA integration points

Cleanverse is not a layer Saksi calls; it is the thing the cryptography binds to.

**1. CVA, issued by us, from the issuance stage.** `atoken/launch` created *Saksi Series A
Note* (`SAKSIAZEV`, `0xb9c53B57…4d6B`) with a `min_tier 30` RuleV2 attached at launch —
not added afterwards. We hold `MINTER_ROLE` and minted the supply the register holds.

**2. The pool is registered with Cleanverse's on-chain Validator, and calls it live.**
`validator/grant` + `validator/register` with an EIP-191 owner signature over
`monad0x9bb3…`. `deposit()` then calls `complianceVerify(pool, msg.sender)` on Cleanverse's
contract `0xaC7e5179…1792` **inside the transaction that moves the value** — so a
credential frozen one block ago fails, and an unregistered pool reverts rather than
silently opening. The rule set shown in the console is read from their `getRulesV2()`, not
mirrored from ours, so the screen cannot drift from the policy.

**3. The pool contract itself holds a CVI.** Cleanverse enforce a credential on both sides
of every CVA transfer, so a contract cannot custody one without its own A-Pass. We issued
the pool one via `generate_apass`. This is what makes a pooled venue for a CVA possible at
all.

**4. CVI membership is a constraint inside the ZK circuit, not a lookup beside it.** The
association set is derived on every build from live A-Pass state (`query_apass_list` +
per-wallet `query_apass`); each admitted wallet becomes a leaf, and the compliance proof
must show membership *and* non-membership of the sanctions list, bound to `msg.sender` and
to the exact commitment. Without a revocable, wallet-bound credential there is no set to
prove membership in and the circuit has nothing to bite on.

**5. CVI revocation is the freeze mechanism.** `update_status` → the credential goes to
`status: 2` → the next association set is built without it → `rotateRoot` / `retireRoot`.
No blacklist is maintained; revocation *is* the rebuild.

**6. CVA is the only asset in and the only asset out**, and the exit re-gates the
*recipient* through Cleanverse before the transfer, because leaving is an edge too.

## What is running, with evidence

| | |
|---|---|
| SaksiPool | `0x9BB3af71497304506Be2810915016742394f72f2` |
| Our CVA | `0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B` — launch tx `0xa372e150…c3d0` |
| Validator registration | tx `0x4288e845…9dcb` · `isRegistered → true` · `getRulesV2 → (0x0000,0x0000,30,0,0)` |
| Shielded positions | 4 deposits, each with a real Groth16 proof verified on-chain |
| Tests | 34 Foundry tests, incl. a real proof against the exported verifier at 264k gas |

**Answerability — four contract-verified disclosure types, each bound to an audit request
registered on-chain before the answer existed:**

| Proof | Question | Verified on-chain |
|---|---|---|
| threshold | position ≤ 500? | `0x547628ba…e4c7` |
| range | inside the 100–600 bracket? | `0x08342d27…ef53` |
| exact | disclose in full | `0xa480a39b…edff` |
| aggregate | total across 4 positions ≤ 1,500? | `0x924d8288…ab1e` |
| aggregate | total across 4 positions ≤ 1,000? | **no proof exists** — the true total is 1,150, so the request `0x34519e32…ead2` stays open |

That last row is the one to read. The register cannot answer a question falsely; it can
only fail to answer.

**Revocation, executed:** a verified holder deposited, its A-Pass was frozen at
Cleanverse, and both gates closed independently — `isEligible()` on Cleanverse's validator
went `true → false`, and the association set rebuilt 45 → 44 members without it. The next
deposit reverts `ValidatorRefused(0xD578…)` at gate one and has no witness at gate two.

## Why it is not another gated pool

Most compliant-RWA designs check identity at the door and publish everything behind it.
Saksi inverts the disclosure: the chain reveals nothing about a position, and the issuer
answers regulators with proofs that a contract checks rather than with a spreadsheet a
regulator has to trust. The four disclosure types bound to pre-registered audit requests
are, as far as we can find in this cohort, unmatched.

## Scalability

The disclosure layer is asset-agnostic: any CVA issuer can attach a confidential register
to an existing token without changing issuance. Verification is 264k gas on BN254
precompiles, and proving runs in under a second on a laptop. Position as an Infrastructure
Partner — a module, not a destination.

## Declared prior work

The seven Circom circuits and proving keys are carried over from an earlier public
Stellar/Soroban build and are committed as the first commit under that description.
Everything that makes them a Cleanverse product — the CVI/CVA integration, the pool, the
association-set builder, the disclosure flow, the deployment, the consoles — was built in
the 8–9 Aug window.

## Honest limits

The note-tree root is owner-published rather than advanced by the `merkleUpdate` proof
(every leaf is emitted, so a wrong root is detectable); the deny list is a fixed 8-slot
array suited to a pilot, not a live sanctions feed; and the Cleanverse sandbox is shared
across hackathon teams, which is why the association set holds 44 credentials rather than
our own four.
