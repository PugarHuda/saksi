# Saksi — one-page summary

**A confidential holder register for tokenized real-world assets.**
Built on Cleanverse CVI and CVA · deployed on Monad testnet (chain `10143`)
Live: [saksi-gilt.vercel.app](https://saksi-gilt.vercel.app) · Repo: [github.com/PugarHuda/saksi](https://github.com/PugarHuda/saksi)

*Saksi* is Indonesian for **witness**. In zero knowledge the private input is called the
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

An anonymity set of three is not anonymity. This is not a quiet-testnet artefact, it is the
mechanism: **the tighter an asset's holder rule, the smaller the crowd its holders hide
in.** Eligibility restricts the population by design, so compliance and confidentiality pull
against each other structurally.

The obvious fix — a privacy pool — destroys what made the asset legitimate. The issuer can
no longer prove who holds what, enforce a concentration cap, or find a revoked holder.

## Solution

Private in the middle, accountable at both edges. Positions are commitments; they move by
JoinSplit so amounts and owners are not published; entry is gated twice; and the register
answers a regulator with proofs rather than spreadsheets.

**Who it is for:** a CVA issuer or tokenization platform that must report concentration to a
regulator but cannot publish its holder book. **Three actors:** a *holder* deposits and
moves a position; an *issuer* builds the eligibility set and anchors its root; a *regulator*
posts a question on-chain and waits for a proof that answers exactly it.

## CVI · CVA integration points

1. **Gate one is Cleanverse's contract, not ours.** The pool is registered with the CVI
   Compliance Validator (`0xaC7e5179…`) and `deposit()` calls `complianceVerify(pool,
   msg.sender)` on it, live, inside the transaction that moves value. An unregistered pool
   reverts rather than returning false, so the register fails closed.
2. **The asset is a real CVA.** `SAKSIAZEV` was issued through `atoken/launch` carrying a
   `min_tier 30` rule from issuance. `activeRules()` on our pool and `getRulesV2()` on
   theirs return the identical `(0x0000, 0x0000, 30, 0, false, 0)`.
3. **The association set is derived from live CVI.** 524 members admitted from a population
   of 602, rebuilt from A-Pass state on every run, root anchored on-chain. `ops/gate-gap.mjs`
   asks the validator about **every one of the 524** — all are admitted by Cleanverse too,
   which is the only acceptable answer: a set derived from their registry must never be more
   permissive than it. Earlier today fifteen frozen credentials were in it and the check was
   sampling four addresses.
4. **Revocation is a rebuild, not a blacklist.** Freeze an A-Pass and the next set is built
   without it; the holder can no longer produce an entry proof.
5. **A third, independent control.** The entry circuit also proves non-membership of an
   on-chain sanctions list, which now carries a real entry.
6. **Every holder is credentialed on both edges.** Seeding holders moves CVA between two
   A-Pass wallets, which is itself a compliance event on Cleanverse's rails.

## What is deployed and exercised

| | |
|---|---|
| SaksiPool | [`0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA`](https://testnet.monadexplorer.com/address/0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA) |
| Saksi Series A Note (our CVA) | [`0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B`](https://testnet.monadexplorer.com/address/0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B) |
| Register | 6 commitments · 4 live positions · 1,680 CVA backed |
| Foundry tests | **64 passing**, including an external audit's own exploit POCs |

**The shielded middle runs.** One JoinSplit spent two of the issuer's positions and created
two new ones (block 52209800). The inputs were 250 and 480; the outputs are **not published
anywhere** — only their commitments and the two spent nullifiers are on-chain. Nothing links
an input to an output.

## The strongest evidence is a refusal

Every audit answer is bound to a request the auditor — a **different key from the issuer** —
posted on-chain *before the answer existed*. Every request block precedes its answer block,
checkable with any RPC endpoint:

| question | request | answer |
|---|---|---|
| position at most 500? | 52210266 | 52210275 · proved, figure hidden |
| disclose position in full | 52210345 | 52210355 · 459.9 |
| inside the 400–500 bracket? | 52210670 | 52210679 · proved, figure hidden |
| total exposure ≤ 2,000? | 52210870 | 52210883 · proved, no position disclosed |
| inside the 100–400 bracket? | 52210333 | **never — no proof exists** |
| **total exposure ≤ 1,000?** | **52210907** | **never — the true total is 1,680** |

The register cannot answer falsely. It can only fail to answer, and the failure is on the
record permanently.

## Scalability — the ceilings, named

Merkle depth 10 → **1,024 leaves**; the association set is at 524 of them today. Deposit
costs ~2.9M gas (two Groth16 verifications plus the live validator call); verification 264k;
proving 610–1,676 ms client-side. The aggregate circuit is fixed at **5 slots**, so it
already cannot span a register of six commitments — after the shielded transfer the auditor
enumerates the four live positions and the tool *refuses* rather than answering over a
subset. Upgrades are known: depth 20 gives a million leaves at roughly double the compliance
constraints; the aggregate widens with recursion.

## Related work

The confidentiality half is being solved: **Zama × T-REX** brought FHE to ERC-3643 and
**Polymesh Confidential Assets** shipped protocol-level ZK with a regulator carve-out; Canton
and ADDX avoid the problem by never publishing plaintext. Our claim is narrower and, we
think, unoccupied: **privacy plus issuer accountability** — a concentration cap, revocation
by rebuild, and an auditor who can compel a bounded answer and get a *recorded non-answer*.

## Honest limits

- **Entry is public.** `deposit()` takes a plaintext amount from a visible sender. The
  commitment buys confidentiality over a position's *life*, not at its creation — which is
  why the JoinSplit above matters and why we ran it.
- **The exit is gated operationally, not cryptographically.** The transfer circuit carries no
  association-set input and the proof is not bound to `msg.sender`, so an eligible party
  could relay a revoked holder's exit. Closing it is a recompile and a new ceremony —
  roughly a day, not a patch. Two tests assert this limitation rather than pretending it is
  closed.
- **The note root is owner-published.** `merkleUpdate.circom` exists and is keyed but is not
  wired to `publishNoteRoot`, so nothing on-chain ties the root to `commitments[]`. Every
  leaf is emitted, so a wrong root is *detectable*; it is not *prevented*.
- **One trust domain in the setup.** Three contributions and a closing beacon, all snarkjs
  defaults — one operator, one machine. If that operator kept the phase-2 randomness, forged
  proofs are possible and undetectable.
- **Both gates root in one authority.** They diverge in *time*, not in trust: a compromised
  Cleanverse sandbox defeats both.
- **Single-EOA owner**, no timelock or multisig, who can rotate roots and set the auditor.
- **We leaked our own secrets twice.** Testnet note keys for a superseded pool reached the
  public repo and survived two history rewrites, because GitHub serves orphaned commits by
  SHA. The repository was destroyed and recreated to purge the object store. Zero key reuse
  into the live pool; treat those seven notes as burned.

## What an adversarial review found, and what we did

Six agents audited this build. The sharpest finding was ours to fix twice over: `requestAudit`
pinned *who* a question was about and *what kind* of answer it took, but not the **figure** —
so "is this position at most 1,000?" was answerable with "at most 2⁶⁴−1", closing the request
permanently with the record reading ANSWERED. The circuits make that vacuous claim genuinely
provable. The contract now pins a claim hash and each prover recomputes it.

The second: our association set was admitting fifteen credentials Cleanverse had **frozen** —
the set was *more permissive* than the compliance provider, the one direction it must never
be. The instrument that was supposed to catch this had been sampling four hardcoded addresses
and reporting "0 disagreements" for a set of five hundred. It sweeps every member now.

## Prior work, declared

The seven Circom circuits and their proving keys are carried over from an earlier public
Stellar/Soroban build and are committed as the first commit under that description.
Everything that makes them a Cleanverse product — the CVI and CVA integration, the Solidity
pool and its two gates, the association-set builder, the disclosure flow, the deployment and
the consoles — was built inside the 8–9 Aug window.
