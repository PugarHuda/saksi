# Saksi — summary

**A confidential holder register for tokenized real-world assets.**
Built on Cleanverse CVI and CVA · deployed on Monad testnet (chain `10143`)
Live: [saksi-gilt.vercel.app](https://saksi-gilt.vercel.app) · Repo: [github.com/PugarHuda/saksi](https://github.com/PugarHuda/saksi)

*Saksi* is Indonesian for **witness**: in zero knowledge the private input is called the
witness; in law a witness testifies to a fact without disclosing everything they know.

---

## Problem

Every tokenized-RWA platform publishes its holder register in the clear, and the standard
reply is that a public chain is pseudonymous so this costs nothing. We measured instead of
assuming — every wallet holding an active A-Pass, against every A-Token on Monad:

| | |
|---|---|
| median holders per asset | **3** |
| assets with fewer than five holders | **35 of 45** |
| assets where one wallet holds 90%+ | **16** |
| credentialed wallets enumerated | 562 |

An anonymity set of three is not anonymity, and it is the mechanism rather than a quiet-testnet
artefact: **the tighter an asset's holder rule, the smaller the crowd its holders hide in.**
Eligibility restricts the population by design, so compliance and confidentiality pull against
each other structurally. The obvious fix — a privacy pool — destroys what made the asset
legitimate: the issuer can no longer prove who holds what, cap concentration, or find a revoked
holder.

Saksi refuses the trade-off instead of picking a side. **Private in the middle, accountable at
both edges:** positions are commitments that move by JoinSplit, so amounts and owners are not
published; entry is gated twice; and a regulator gets proofs rather than spreadsheets. A *holder*
deposits and moves a position, an *issuer* builds the eligibility set and anchors its root, a
*regulator* posts a question on-chain and waits for a proof that answers exactly it.

## CVI · CVA integration points

1. **Gate one is Cleanverse's contract, not ours.** `deposit()` calls `complianceVerify(pool,
   msg.sender)` on the CVI Compliance Validator (`0xaC7e5179…`) live, inside the transaction that
   moves value. An unregistered pool reverts rather than returning false: the register fails closed.
2. **The asset is a real CVA.** `SAKSIAZEV` was issued through `atoken/launch` carrying `min_tier
   30`; `activeRules()` forwards to `getRulesV2()` on theirs and returns `(0x0000, 0x0000, 30, 0,
   false, 0)` — their rule, read live, not a copy kept in step here.
3. **The association set is derived from live CVI** — 524 members from a population of 602 at
   10:07 UTC (the census an hour earlier enumerated 562, which is why the two differ), rebuilt
   every run, root anchored on-chain. `ops/gate-gap.mjs` asks the validator about **all 524** and
   reports the direction of any disagreement, because a set derived from their registry must never
   be *more permissive* than it. It currently names one member frozen since the root was anchored,
   and two it would not answer about, counted as unknown rather than agreement — the staleness gate
   one exists to close. Earlier today fifteen were frozen and the check sampled four addresses.
4. **Revocation is a rebuild, not a blacklist.** Freeze an A-Pass and the next set is built
   without it; the holder can no longer produce an entry proof.
5. **A third, independent control** — the entry circuit proves non-membership of an on-chain
   sanctions list carrying a real entry: the burn address, which both gates admit and only this
   refuses.
6. **It answers in ERC-3643's shape, with ERC-1400 reason codes.** `isVerified` and `canTransfer`
   compose all three entry controls in T-REX's spelling — the cheapest adoption path from the
   incumbent. `canTransferWithReason` adds an ERC-1066 status byte, because this register refuses
   for three different causes and an integrator handed a bare `false` cannot tell which, though
   each demands a different action. **Written and tested, not deployed**; see limits.

## What is deployed and exercised

| | |
|---|---|
| SaksiPool | [`0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA`](https://testnet.monadexplorer.com/address/0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA) |
| Saksi Series A Note (our CVA) | [`0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B`](https://testnet.monadexplorer.com/address/0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B) |
| Register | 12 commitments · 6 live positions · 2,315 CVA backed, at block 52266233 |
| Foundry tests | **131 passing**, 87 of them three adversarial reviews' own exploit POCs |

The register is still being deposited into, so those four figures are stamped with the block they
were read at rather than left to rot. `node ops/evidence.mjs` prints the current ones, and
`allCommitments()` and `balanceOf(pool)` are the two calls behind them.

**This register can mint a position the minting process cannot spend.** Until this afternoon every
JoinSplit output was keyed to the sender's own fresh key. Then `ops/keygen.mjs` generated a
spending key held in a separate ledger, the sender got only its public half, and a JoinSplit paid
an output to it — `0x78168fda…`, block 52244580. The private half is not in the sender's ledger
and never was, so the sender cannot spend that position.

Say only that much: an adversarial review took the stronger claim apart and deserved to. The
recipient is a key in a file with no address and no credential, both transactions were signed by
the same wallet, and every disclosure circuit takes `(amount, pubKey, blinding)` and no private
key — so whoever holds the opening, including the sender who built it, can still *answer* about
the position. **Spend authority separated; answer authority did not.**

**Value enters and leaves under the same rules.** One JoinSplit spent positions of 250 and 480
and published neither output (block 52209800) until the auditor asked and block 52210355
disclosed 459.9, ten blocks later. A second *redeemed* 50 out (block 52220592) — 49.5 to a
credentialed recipient, 0.5 to a credentialed relayer — calling Cleanverse's validator twice more
on that path, because their model holds that every address receiving a CVA needs a credential.
Deposits come from more than one credentialed wallet: the most recent, 420 CVA at block 52262994,
was opened by a different EOA. Nothing links an input to an output on any of the three transfers.

## The strongest evidence is a refusal

Every answer is bound to a request the auditor — a **different key from the issuer** — posted
on-chain *before the answer existed*. Every request block precedes its answer block:

| question | request | answer |
|---|---|---|
| position at most 500? | 52210266 | 52210275 · proved, figure hidden |
| inside the 100–400 bracket? | 52210333 | **never — no proof exists** |
| disclose position in full | 52210345 | 52210355 · 459.9 |
| inside the 400–500 bracket? | 52210670 | 52210679 · proved, figure hidden |
| total exposure ≤ 2,000? | 52210870 | 52210883 · proved, no position disclosed |
| **total exposure ≤ 1,000?** | **52210907** | **never — those positions summed to 1,680** |
| the separately-keyed position at most 600? | 52244758 | 52244768 · proved, figure hidden |
| total exposure across "all 3"? | 52245857 | 52245878 · **answered, then corrected** — see limits |

Five clean answers, two that can never be given, one given wrongly and impossible to take back.
The register cannot answer falsely; it can answer a narrower question than its words claimed, and
the record of that is as permanent as the rest. The English is not decoration either: each figure
is hashed into `auditClaim` before an answer exists, so `claimHash(kind, cap)` recomputed from
the words equals what the contract stored — a reader can check that the question asked is the
question the contract will accept an answer to, without trusting this document.

## Scalability — the ceilings, priced

Naming compile-time constants is half an answer. `node ops/gas.mjs` prices them with Monad's own
estimator against proofs this register actually submitted — `verifyProof` is a view, so anyone
can replay every one. Threshold and exact cost 1,034,215 and 1,034,228 at 3 public signals; range
1,065,516 at 4; the JoinSplit 1,160,784 at 7; the aggregate 1,347,154 at 13. Those fit a line to
within 1,092 gas: **a Groth16 verification on Monad costs about 940,500 gas plus 31,300 per
public signal.** The cause is directly measurable — `ecPairing` marginal cost is 172,124 gas per
pair against 34,000 under EIP-1108, so **Monad prices the BN254 precompiles at roughly 5× the
Ethereum schedule**, the entire gap between the ~264k a disclosure verification measures locally
in Foundry and what it costs here.

That law prices every ceiling. **Merkle depth is free** — depth is a private-witness dimension,
so depth 20 gives a million leaves at this same price and only proving time doubles; the
1,024-leaf ceiling is a rebuild, not an economic wall. **The aggregate costs ~62,600 gas per extra
position** (a commitment and its active flag are two signals each), bounding one proof at ~2,300
positions against a 150M block — the real argument for recursion over a wider circuit. A deposit
verifies two proofs, 11 signals and 3, for ~2.3M gas. Proving runs 610–1,730 ms client-side.

> An earlier version of this section said no on-chain gas number here could be reproduced, because
> Monad charges the submitted limit and reports it back as `gasUsed`. The receipts are indeed
> useless; the conclusion drawn from them was wrong, and a judge who reached for `eth_estimateGas`
> would have found that out before we did.

## Related work

**Zama × T-REX** brought FHE to ERC-3643 and **Polymesh Confidential Assets** shipped
protocol-level ZK with a regulator carve-out; Canton and ADDX never publish plaintext at all. Our
claim is narrower and, we think, unoccupied: **privacy plus issuer accountability** — revocation
by rebuild, and an auditor who can compel a bounded answer and get a *recorded non-answer*.

## Honest limits

- **Entry is public.** `deposit()` takes a plaintext amount from a visible sender; the commitment
  protects a position's *life*, not its creation.
- **The exit is gated operationally, not cryptographically.** The transfer circuit takes no
  association-set input and the proof is not bound to `msg.sender`, so an eligible party could
  relay a revoked holder's exit. A recompile and a new ceremony to close; two tests assert it.
- **The aggregate is single-prover, and we published a wrong answer proving it.** Block 52245878
  answered "total exposure across all **3** registered positions" while four were live: the
  enumerator counted retirements by what the issuer's ledger could open, which is circular, so it
  filed the separately-keyed position as retired. The answer is true of the three it names and is
  not a statement about the register. It cannot be retracted, so `audit-log.json` carries the
  correction beside it rather than the row being quietly re-run. `ops/audit.mjs` now counts
  retirements from the chain and refuses when a live position belongs to a key that has not
  contributed an opening. A real concentration cap needs multi-party proving; this has none.
- **The register is one operator's machine.** Every ledger, including the separately-keyed one,
  lives in the same working directory, which is what makes the single-prover aggregate possible at
  all and why the honest claim above is about key separation rather than custody.
- **Answer authority does not move with a position.** Every disclosure circuit takes `(amount,
  pubKey, blinding)` and no private key, so anyone holding a note's opening — including whoever
  built the output — can prove things about it.
- **The ERC-3643 views, the reason codes and the `TREE_CAPACITY` guard are not deployed.** All are
  in `SaksiPool.sol` and tested, and all revert on the live pool; redeploying would reset the two
  permanently open audit requests whose entire value is that they have been open since a block.
- **Which commitments are live is public**, and an earlier version of this page implied otherwise:
  `notes.public.json` publishes them, so set-differencing against `allCommitments()` names the
  spent ones. What is hidden is which input became which output, and what any is worth.
- **This register's amounts are derivable, and that is our bug.** `ops/transfer.mjs` split each
  JoinSplit 37/63 — a constant in a public repo — and deposits are plaintext, so every note
  follows from the deposit log: 730 × 0.37 = 270.1. The splitter now draws from the CSPRNG; the
  existing notes do not. Assume these amounts are readable.
- **The note root is owner-published.** `merkleUpdate.circom` is keyed but unwired, so a wrong
  root is *detectable* from the emitted leaves, not *prevented*; and because a nullifier binds the
  leaf *index*, republishing a tree that moved a commitment would mint a second valid nullifier
  for the same note. The builder is append-only, so it never happened.
- **One trust domain in the setup** — three contributions and a closing beacon, all snarkjs
  defaults, one operator, one machine. If that operator kept the phase-2 randomness, forged proofs
  are possible and undetectable.
- **Both gates root in one authority**, diverging in *time* rather than trust, so a compromised
  Cleanverse sandbox defeats both. **Single-EOA owner**, no timelock.
- **The tree can be filled for the price of gas.** A zero-amount input skips the Merkle check, so
  an all-dummy transaction still inserted two commitments, and every deposit past leaf 1023 would
  be unspendable forever. `transfer.circom` now demands one real input and `SaksiPool` now reverts
  instead of losing value silently; **neither is deployed**, and at a dozen of 1,024 leaves the
  attack is ~500 transactions away. Tested at `contracts/test/Audit3.t.sol`.
- **A spent position can still answer an audit** — `_requireKnown` consults the commitment set and
  structurally cannot consult the nullifier set. The auditor picks the subject, so this is a
  caveat, not a hole.
- **The revocation demonstration is historical.** The credential it froze has been reactivated in
  Cleanverse's shared sandbox, so a live `complianceVerify` on that wallet returns true today; the
  drop is in `asp.public.json`, the superseded set in `asp.previous.json`. Other credentials are
  frozen right now and both gates refuse them.
- **The transfer circuit bounds amounts to 248 bits, every disclosure circuit to 64.** A JoinSplit
  merging notes past 2⁶⁴ could never be disclosed. Unreachable at this size; one line to close.
- **We leaked our own secrets twice.** Testnet note keys for a superseded pool reached the public
  repo and survived two history rewrites, because GitHub serves orphaned commits by SHA. The
  repository was destroyed and recreated to purge the object store. Zero key reuse into the live
  pool; treat those seven notes as burned.

## What the tests prove, and what an adversarial review found

The 131 Foundry tests run against a mock verifier returning a settable boolean: they prove the
contract's logic, not the Groth16 cryptography. The chain proves the cryptography instead — every
deposit, transfer, withdrawal and disclosure above was accepted by a deployed verifier whose key
is committed here. Eighty-seven are three adversarial reviews' own exploit proofs, kept as
regressions, and twelve assert limitations that remain open.

The sharpest finding: `requestAudit` pinned *who* a question was about and *what kind* of answer
it took but not the **figure**, so "is this position at most 1,000?" was answerable with "at most
2⁶⁴−1" — true, provable, and it closed the request with the record reading ANSWERED. The contract
now pins a claim hash every prover recomputes.

## Prior work, declared

The seven Circom circuits and their proving keys are carried over from an earlier public
Stellar/Soroban build, committed as the first commit under that description. Everything that
makes them a Cleanverse product — the CVI and CVA integration, the Solidity pool and its two
gates, the association-set builder, the disclosure flow, the deployment and the consoles — was
built inside the 8–9 Aug window.
