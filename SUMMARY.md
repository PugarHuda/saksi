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

1. **Gate one is Cleanverse's contract, not ours.** The pool is registered with the CVI
   Compliance Validator (`0xaC7e5179…`) and `deposit()` calls `complianceVerify(pool,
   msg.sender)` on it, live, inside the transaction that moves value. An unregistered pool
   reverts rather than returning false, so the register fails closed.
2. **The asset is a real CVA.** `SAKSIAZEV` was issued through `atoken/launch` carrying a
   `min_tier 30` rule from issuance. `activeRules()` on our pool forwards to
   `getRulesV2()` on theirs and returns `(0x0000, 0x0000, 30, 0, false, 0)` — the rule is
   theirs, read live, not a copy kept in step here.
3. **The association set is derived from live CVI.** 524 members admitted from a population
   of 602 at 10:07 UTC — the census an hour earlier enumerated 562, which is why the two
   figures differ — rebuilt from A-Pass state on every run, root anchored on-chain.
   `ops/gate-gap.mjs` asks the validator about **every one of the 524** and reports the
   direction of any disagreement: a set derived from their registry must never be *more
   permissive* than it. Earlier today fifteen frozen credentials were in it and the check was
   sampling four addresses.
4. **Revocation is a rebuild, not a blacklist.** Freeze an A-Pass and the next set is built
   without it; the holder can no longer produce an entry proof.
5. **A third, independent control.** The entry circuit also proves non-membership of an
   on-chain sanctions list, which carries a real entry — the burn address, which both gates
   admit and only this control refuses.
6. **It answers in ERC-3643's shape.** `isVerified(address)` and
   `canTransfer(from,to,amount)` compose all three entry controls in T-REX's spelling, so an
   existing integration can query this register without knowing anything about it. T-REX
   carries most of the tokenized-RWA supply in existence, which makes it the cheapest
   adoption path from the incumbent. **Written and tested, not deployed** — see limits.

## What is deployed and exercised

| | |
|---|---|
| SaksiPool | [`0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA`](https://testnet.monadexplorer.com/address/0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA) |
| Saksi Series A Note (our CVA) | [`0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B`](https://testnet.monadexplorer.com/address/0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B) |
| Register | 10 commitments · 4 live positions · 1,630 CVA backed · two holders |
| Foundry tests | **128 passing**, 84 of them three adversarial reviews' own exploit POCs |

**A position changed owner.** Until this afternoon every JoinSplit output was keyed to the
sender's own fresh key: the mechanism ran, but nothing had ever moved between people. A second
holder generated their own spending key (`ops/keygen.mjs`), gave the sender only the public
half, and was paid an output — tx `0x78168fda…`, block 52244580. That note is not in the
sender's ledger and its key never was, so only its owner can spend it. **Then the new owner
answered a regulator's question about it alone** (blocks 52244758 → 52244768), proving the
position is at most 600 without disclosing it. Be precise about the boundary: *spend authority*
moved. The sender built the output and so knows the amount they sent, which is inherent to any
note scheme.

**Value enters and leaves under the same rules.** One JoinSplit spent two of the issuer's
positions of 250 and 480 and published neither output (block 52209800) until the auditor asked
and block 52210355 disclosed 459.9, ten blocks after the request. A second *redeemed* 50 out of
the register (block 52220592) — 49.5 to a credentialed recipient, 0.5 to a credentialed relayer
— and that path calls Cleanverse's validator twice more, because their model holds that every
address receiving a CVA needs a credential. Nothing links an input to an output on any of the
three.

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
| the new holder's position at most 600? | 52244758 | 52244768 · proved *by its owner*, figure hidden |
| total exposure across "all 3"? | 52245857 | 52245878 · proved over 3 of 4 live positions — see limits |

The register cannot answer falsely. It can only fail to answer, and the failure is on the
record permanently. The English is not decoration either: each figure is hashed into
`auditClaim` on-chain before an answer exists, so `claimHash(kind, cap)` recomputed from the
words — "at most 500", "the 400–500 bracket" — equals what the contract stored. A reader can
check that the question asked is the question the contract will accept an answer to, without
trusting this document.

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

- **Entry is public.** `deposit()` takes a plaintext amount from a visible sender. The
  commitment buys confidentiality over a position's *life*, not at its creation.
- **The exit is gated operationally, not cryptographically.** The transfer circuit carries no
  association-set input and the proof is not bound to `msg.sender`, so an eligible party could
  relay a revoked holder's exit. Closing it is a recompile and a new ceremony — roughly a day,
  not a patch. Two tests assert this rather than pretending it is closed.
- **The aggregate is single-prover, and we broke that today.** Block 52245878 answered "total
  exposure across all **3** registered positions" while four were live — the fourth being the
  new holder's, which the issuer's ledger cannot open. A subset was reported as a total, it is
  permanently on-chain, and it is exactly the cherry-picking this design exists to refuse.
  `ops/audit.mjs` now takes the retirement count from the chain instead of inferring it from
  "commitments this ledger cannot open", which was circular, and refuses outright when a live
  position belongs to a holder who has not contributed their opening. A real multi-holder
  concentration cap needs multi-party proving, which this does not have.
- **The ERC-3643 views are not deployed.** They are in `SaksiPool.sol` and compile, but
  `isVerified` and `canTransfer` revert on the pool at `0xeBBA114d…`, as does the
  `TREE_CAPACITY` guard below. Redeploying would reset the evidence chain above — two
  permanently open audit requests whose entire value is that they have been open since a
  specific block.
- **Which commitments are live is public**, and an earlier version of this page implied
  otherwise. `notes.public.json` publishes the issuer's live commitments and the new holder's
  is named in its own audit request, so set-differencing against `allCommitments()` identifies
  the spent ones. What is hidden is which input became which output, and what any of them are
  worth.
- **The four positions on chain today are arithmetically derivable, and that is our bug, not
  the design's.** `ops/transfer.mjs` split each JoinSplit 37/63 — a constant in a public
  repository — and deposits are plaintext, so anyone can compute every note from the deposit
  log: 730 × 0.37 = 270.1, down to a checksum that matches the pool's balance. The splitter now
  draws from the CSPRNG, but the notes already inserted were created under the old one. Assume
  this register's amounts are readable; the property is only as good as the randomness the
  operator's tooling supplies, and ours was not random until an audit said so.
- **The note root is owner-published.** `merkleUpdate.circom` exists and is keyed but is not
  wired to `publishNoteRoot`, so nothing on-chain ties the root to `commitments[]`. Every leaf
  is emitted, so a wrong root is *detectable*; it is not *prevented*. Every root ever published
  also stayed spendable, and because a nullifier binds the leaf *index*, republishing a tree
  that moved an existing commitment would mint a second valid nullifier for the same note. The
  builder is append-only so this never happened; the contract does not enforce it.
- **One trust domain in the setup.** Three contributions and a closing beacon, all snarkjs
  defaults — one operator, one machine. If that operator kept the phase-2 randomness, forged
  proofs are possible and undetectable.
- **Both gates root in one authority.** They diverge in *time*, not in trust: a compromised
  Cleanverse sandbox defeats both. **Single-EOA owner**, no timelock or multisig, who can
  rotate roots and set the auditor.
- **The tree can be filled for the price of gas, and the fix is in the source rather than on
  the chain.** A zero-amount input skips the Merkle check — that is how a 1-in transfer is
  expressed in a fixed 2-in circuit — but nothing stopped a transaction being *all* dummies
  while still inserting two commitments, so any wallet the pool admits could append leaves for
  gas alone. Every deposit landing past leaf 1023 is then unspendable forever, because
  `inLeafIndex` is `Num2Bits(levels)`-bounded and no witness exists for it. `transfer.circom`
  now requires at least one real input and `SaksiPool` now reverts rather than losing value
  silently; **neither is deployed**, and at 10 of 1,024 leaves the attack is 507 transactions
  away. Tested at `contracts/test/Audit3.t.sol`; stated here rather than quietly shipped.
- **A spent position can still answer an audit.** `_requireKnown` consults the commitment set
  and structurally cannot consult the nullifier set — deriving one from the other on-chain is
  exactly what the design prevents. The auditor picks the subject, so this is a caveat to state
  rather than a hole to plug.
- **The revocation demonstration is historical.** The credential it froze has since been
  reactivated in Cleanverse's shared sandbox, so a live `complianceVerify` on that wallet now
  returns true; the drop is recorded in `asp.public.json` and the superseded set in
  `asp.previous.json`. Other credentials are frozen right now and both gates refuse them, which
  is what `ops/gate-gap.mjs` shows.
- **The transfer circuit bounds amounts to 248 bits while every disclosure circuit bounds
  them to 64.** A JoinSplit that merged notes past 2⁶⁴ would spend and redeem normally and
  could never be disclosed. Unreachable at this register's size; one line in
  `transfer.circom` to close.
- **We leaked our own secrets twice.** Testnet note keys for a superseded pool reached the
  public repo and survived two history rewrites, because GitHub serves orphaned commits by
  SHA. The repository was destroyed and recreated to purge the object store. Zero key reuse
  into the live pool; treat those seven notes as burned.

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
