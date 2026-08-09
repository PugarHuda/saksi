# Saksi — one-page summary

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

An anonymity set of three is not anonymity, and this is the mechanism rather than a
quiet-testnet artefact: **the tighter an asset's holder rule, the smaller the crowd its
holders hide in.** Eligibility restricts the population by design, so compliance and
confidentiality pull against each other structurally. The obvious fix — a privacy pool —
destroys what made the asset legitimate: the issuer can no longer prove who holds what,
enforce a concentration cap, or find a revoked holder.

## Solution

Private in the middle, accountable at both edges. Positions are commitments; they move by
JoinSplit so amounts and owners are not published; entry is gated twice; and the register
answers a regulator with proofs rather than spreadsheets. **Three actors:** a *holder*
deposits and moves a position; an *issuer* builds the eligibility set and anchors its root; a
*regulator* posts a question on-chain and waits for a proof that answers exactly it.

## CVI · CVA integration points

1. **Gate one is Cleanverse's contract, not ours.** `deposit()` calls `complianceVerify(pool,
   msg.sender)` on the CVI Compliance Validator (`0xaC7e5179…`) live, inside the transaction
   that moves value. An unregistered pool reverts rather than returning false, so the register
   fails closed.
2. **The asset is a real CVA.** `SAKSIAZEV` was issued through `atoken/launch` carrying
   `min_tier 30` from issuance; `activeRules()` forwards to `getRulesV2()` on theirs and returns
   `(0x0000, 0x0000, 30, 0, false, 0)` — their rule, read live, not a copy kept in step here.
3. **The association set is derived from live CVI** — 524 members admitted from a population of
   602 at 10:07 UTC (the census an hour earlier enumerated 562, which is why the two differ),
   rebuilt from A-Pass state every run, root anchored on-chain. `ops/gate-gap.mjs` asks the
   validator about **every one of the 524** and reports the direction of any disagreement: a set
   derived from their registry must never be *more permissive* than it. Earlier today fifteen
   frozen credentials were in it and the check was sampling four addresses.
4. **Revocation is a rebuild, not a blacklist.** Freeze an A-Pass and the next set is built
   without it; the holder can no longer produce an entry proof.
5. **A third, independent control** — the entry circuit proves non-membership of an on-chain
   sanctions list, which carries a real entry: the burn address, which both gates admit and only
   this refuses.
6. **It answers in ERC-3643's shape, with ERC-1400 reason codes.** `isVerified(address)` and
   `canTransfer(from,to,amount)` compose all three entry controls in T-REX's spelling — the
   cheapest adoption path from the incumbent, which carries most of the tokenized-RWA supply in
   existence. `canTransferWithReason` adds an ERC-1066 status byte and a reason, because this
   register refuses for three quite different causes — credential, anchored set, sanctions list —
   and an integrator handed a bare `false` cannot tell which, though each demands a different
   action. **Written and tested, not deployed**; see limits.

## What is deployed and exercised

| | |
|---|---|
| SaksiPool | [`0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA`](https://testnet.monadexplorer.com/address/0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA) |
| Saksi Series A Note (our CVA) | [`0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B`](https://testnet.monadexplorer.com/address/0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B) |
| Register | 11 commitments · 5 live positions · 2,050 CVA backed |
| Foundry tests | **131 passing**, 87 of them three adversarial reviews' own exploit POCs |

**This register can mint a position the minting process cannot spend.** Until this afternoon
every JoinSplit output was keyed to the sender's own fresh key. Then `ops/keygen.mjs` generated
a spending key held in a separate ledger, the sender was given only its public half, and a
JoinSplit paid an output to it — `0x78168fda…`, block 52244580. The private half is not in the
sender's ledger and never was, so the sender cannot spend that position.

Say only that much. An adversarial review took the stronger claim apart and it deserved it: the
recipient is a key in a file, with no address and no credential; both transactions were signed
by the same wallet; and every disclosure circuit takes `(amount, pubKey, blinding)` and no
private key, so whoever holds the opening — including the sender, who built it — can still
*answer* about the position. **Spend authority separated; answer authority did not.** A real
second holder needs their own credentialed wallet, their own gas, and a disclosure circuit that
binds the spending key. That is the honest distance between this and custody transfer.

**Value enters and leaves under the same rules.** One JoinSplit spent two of the issuer's
positions of 250 and 480 and published neither output (block 52209800) until the auditor asked
and block 52210355 disclosed 459.9, ten blocks after the request. A second *redeemed* 50 out of
the register (block 52220592) — 49.5 to a credentialed recipient, 0.5 to a credentialed relayer
— calling Cleanverse's validator twice more on that path, because their model holds that every
address receiving a CVA needs a credential. Deposits come from more than one credentialed
wallet: the most recent, 420 CVA at block 52262994, was opened by a different EOA from the
issuer's. Nothing links an input to an output on any of the three transfers.

## The strongest evidence is a refusal

Every audit answer is bound to a request the auditor — a **different key from the issuer** —
posted on-chain *before the answer existed*. Every request block precedes its answer block,
checkable with any RPC endpoint:

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

Five clean answers, two that can never be given, and one that was given wrongly and cannot be
taken back. The register cannot answer falsely; it can answer a narrower question than its words
claimed, and the record of that is as permanent as the rest. The English is not decoration
either: each figure is hashed into `auditClaim` before an answer exists, so `claimHash(kind,
cap)` recomputed from the words — "at most 500", "the 400–500 bracket" — equals what the
contract stored, so a reader can check that the question asked is the question the contract will
accept an answer to without trusting this document.

## Scalability — the ceilings, priced

The ceilings this project ships with are compile-time constants, and naming them is only
half an answer. Here is what they cost, measured with Monad's own estimator against proofs
this register actually submitted — `verifyProof` is a view, so every one of them is
replayable by anyone (`node ops/gas.mjs`):

| circuit | public signals | gas |
|---|---|---|
| threshold · exact | 3 | 1,034,215 · 1,034,228 |
| range | 4 | 1,065,516 |
| transfer (JoinSplit) | 7 | 1,160,784 |
| aggregate | 13 | 1,347,154 |

Those fit a line to within 1,092 gas: **a Groth16 verification on Monad costs about 940,500
gas plus 31,300 per public signal.** The root cause is measurable directly — `ecPairing`
marginal cost is 172,124 gas per pair against 34,000 under EIP-1108, so **Monad prices the
BN254 precompiles at roughly 5× the Ethereum schedule**, which is the entire gap between the
~264k a disclosure verification measures locally in Foundry and what it costs here.

That law prices every ceiling. **Merkle depth is free** — depth is a private-witness
dimension, so depth 20 gives a million leaves at exactly this price and only proving time
roughly doubles; the 1,024-leaf ceiling is a rebuild, not an economic wall. **The aggregate
costs ~62,600 gas per extra position** (a commitment and its active flag are two signals
each), which against a 150M block bounds one proof at roughly 2,300 positions — the real
argument for recursion rather than a wider circuit. **A deposit verifies two proofs**, 11
signals and 3, for about 2.3M gas before the two live `complianceVerify` calls and storage.
Proving runs 610–1,730 ms client-side, recorded per row in `audit-log.json`.

> An earlier version of this section said no on-chain gas number here could be reproduced,
> because Monad charges the submitted limit and reports it back as `gasUsed`. The receipts are
> indeed useless; the conclusion drawn from them was wrong, and a judge who reached for
> `eth_estimateGas` would have found that out before we did.


## Related work

**Zama × T-REX** brought FHE to ERC-3643 and **Polymesh Confidential Assets** shipped
protocol-level ZK with a regulator carve-out; Canton and ADDX avoid the problem by never
publishing plaintext. Our claim is narrower and, we think, unoccupied: **privacy plus issuer
accountability** — a concentration cap, revocation by rebuild, and an auditor who can compel a
bounded answer and get a *recorded non-answer*.

## Honest limits

- **Entry is public.** `deposit()` takes a plaintext amount from a visible sender; the
  commitment buys confidentiality over a position's *life*, not at its creation.
- **The exit is gated operationally, not cryptographically.** The transfer circuit carries no
  association-set input and the proof is not bound to `msg.sender`, so an eligible party could
  relay a revoked holder's exit. A recompile and a new ceremony to close — a day, not a patch.
  Two tests assert it rather than pretending it is closed.
- **The aggregate is single-prover, and we published a wrong answer proving it.** Block 52245878
  answered "total exposure across all **3** registered positions" while four were live — the
  enumerator reclassified the fourth, separately keyed, as *retired*, because it derived the
  retirement count from what the issuer's ledger could open, which is circular. The answer is
  true of the three it names and is not a statement about the register. It cannot be retracted,
  so `audit-log.json` carries the correction beside it rather than the row being re-run quietly.
  `ops/audit.mjs` now counts retirements from the chain and refuses outright when a live position
  belongs to a key that has not contributed an opening. A real multi-holder concentration cap
  needs multi-party proving; this has none.
- **The ERC-3643 views, the reason codes and the `TREE_CAPACITY` guard are not deployed.** All
  are in `SaksiPool.sol` and tested; `isVerified`, `canTransfer` and `canTransferWithReason`
  revert on the live pool. Redeploying would reset the evidence chain above — two permanently
  open audit requests whose entire value is that they have been open since a specific block.
- **Answer authority does not move with a position.** Every disclosure circuit takes `(amount,
  pubKey, blinding)` and no private key, so anyone holding a note's opening can prove things
  about it — including the party that created the output. Separating spend from answer needs the
  spending key bound into the disclosure circuits, which is a recompile and a new ceremony.
- **Which commitments are live is public**, and an earlier version of this page implied
  otherwise. `notes.public.json` publishes the issuer's live commitments and the new holder's is
  named in its own audit request, so set-differencing against `allCommitments()` identifies the
  spent ones. What is hidden is which input became which output, and what any is worth.
- **This register's amounts are derivable, and that is our bug, not the design's.**
  `ops/transfer.mjs` split each JoinSplit 37/63 — a constant in a public repository — and
  deposits are plaintext, so anyone can compute every note from the deposit log: 730 × 0.37 =
  270.1, down to a checksum matching the pool's balance. The splitter now draws from the CSPRNG;
  the notes already inserted do not. Assume these amounts are readable. The property is only as
  good as the operator's randomness, and ours was not random until an audit said so.
- **The note root is owner-published.** `merkleUpdate.circom` is keyed but unwired, so nothing
  on-chain ties the root to `commitments[]`; every leaf is emitted, so a wrong root is
  *detectable*, not *prevented*. Every root ever published also stayed spendable, and since a
  nullifier binds the leaf *index*, republishing a tree that moved a commitment would mint a
  second valid nullifier for the same note. The builder is append-only so it never happened; the
  contract does not enforce it.
- **One trust domain in the setup** — three contributions and a closing beacon, all snarkjs
  defaults, one operator, one machine. If that operator kept the phase-2 randomness, forged
  proofs are possible and undetectable.
- **Both gates root in one authority**, diverging in *time* rather than trust, so a compromised
  Cleanverse sandbox defeats both. **Single-EOA owner**, no timelock or multisig, who rotates
  roots and sets the auditor.
- **The tree can be filled for the price of gas, and the fix is in the source, not on the
  chain.** A zero-amount input skips the Merkle check — how a 1-in transfer is expressed in a
  fixed 2-in circuit — but nothing stopped an all-dummy transaction still inserting two
  commitments, and every deposit past leaf 1023 is unspendable forever because `inLeafIndex` is
  `Num2Bits(levels)`-bounded. `transfer.circom` now demands one real input and `SaksiPool` now
  reverts instead of losing value silently; **neither is deployed**, and at 10 of 1,024 leaves the
  attack is 507 transactions away. Tested at `contracts/test/Audit3.t.sol`.
- **A spent position can still answer an audit.** `_requireKnown` consults the commitment set and
  structurally cannot consult the nullifier set — deriving one from the other on-chain is what
  the design prevents. The auditor picks the subject, so this is a caveat, not a hole.
- **The revocation demonstration is historical.** The credential it froze has since been
  reactivated in Cleanverse's shared sandbox, so a live `complianceVerify` on that wallet returns
  true today; the drop is recorded in `asp.public.json`, the superseded set in
  `asp.previous.json`. Other credentials are frozen right now and both gates refuse them.
- **The transfer circuit bounds amounts to 248 bits while every disclosure circuit bounds them to
  64.** A JoinSplit merging notes past 2⁶⁴ would spend and redeem normally and could never be
  disclosed. Unreachable at this size; one line to close.
- **We leaked our own secrets twice.** Testnet note keys for a superseded pool reached the public
  repo and survived two history rewrites, because GitHub serves orphaned commits by SHA. The
  repository was destroyed and recreated to purge the object store. Zero key reuse into the live
  pool; treat those seven notes as burned.

## What the tests prove, and what an adversarial review found

The 128 Foundry tests exercise the pool's binding, accounting and access control against a
mock verifier that returns a settable boolean — they prove the contract's logic, not the
Groth16 cryptography. The cryptography is proved by the chain instead: every deposit,
transfer, withdrawal and disclosure above was accepted by a deployed verifier contract whose
verification key is committed in this repo. Eighty-four of the tests are three adversarial
reviews' own exploit proofs, kept as regression tests, and twelve of them assert limitations
that remain open rather than pretending they were closed.

Two findings changed the design. `requestAudit` pinned *who* a question was about and *what
kind* of answer it took, but not the **figure** — so "is this position at most 1,000?" was
answerable with "at most 2⁶⁴−1", closing the request permanently with the record reading
ANSWERED, and the circuits make that vacuous claim genuinely provable. The contract now pins a
claim hash and each prover recomputes it. And our association set was admitting fifteen
credentials Cleanverse had **frozen** — the set *more permissive* than the compliance provider,
the one direction it must never be — while the instrument meant to catch it sampled four
hardcoded addresses and reported "0 disagreements" for a set of five hundred. It sweeps every
member now.

## Prior work, declared

The seven Circom circuits and their proving keys are carried over from an earlier public
Stellar/Soroban build and are committed as the first commit under that description.
Everything that makes them a Cleanverse product — the CVI and CVA integration, the Solidity
pool and its two gates, the association-set builder, the disclosure flow, the deployment and
the consoles — was built inside the 8–9 Aug window.
