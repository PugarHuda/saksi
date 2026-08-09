<div align="center">
<img src="docs/saksi-logo.svg" width="88" alt="Saksi" />

# Saksi

**Every position witnessed. Disclosure only when asked.**

A confidential holder register for tokenized real-world assets.
Built on Cleanverse CVI and CVA · deployed on Monad testnet.

[Live console](https://saksi-gilt.vercel.app) · [Pool on explorer](https://testnet.monadexplorer.com/address/0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA) · [Summary](SUMMARY.md)

</div>

---

## The problem, measured

Every tokenized RWA platform publishes its holder register in the clear. The usual reply
is that a public chain is pseudonymous, so this costs nothing. We checked.

```
$ node ops/measure-register.mjs
562 credentialed wallets × every CVA on Monad — an exhaustive census, not a sample

median holders per asset                       3
held by exactly one wallet                     9
fewer than five holders                       35 of 45  (78%)
one wallet holding 90%+ of the counted supply 16
```

An anonymity set of three is not anonymity. Knowing the asset and watching one transfer
identifies the position and its size.

This is not an artefact of a quiet testnet — it is the mechanism. **The tighter an
asset's holder rule, the smaller the crowd its holders hide in.** Eligibility restricts
the population by design, so compliance and confidentiality pull against each other
structurally. Every compliant-asset design tightens the rule; tightening it makes each
remaining holder more exposed, not less.

The obvious fix — a privacy pool — destroys the thing that made the asset legitimate.
The issuer can no longer prove who holds what, cannot enforce a concentration cap, and
cannot find a holder whose credential was revoked.

Saksi refuses the trade-off rather than picking a side of it.
**Private in the middle, accountable at both edges.**

## How it works

```
                      ┌──────────── ENTRY, gated twice ────────────┐
                      │                                            │
  verified wallet ────┤  1. Cleanverse Validator, called live      ├──▶ commitment
                      │     complianceVerify(pool, msg.sender)     │      in the
                      │                                            │     register
                      │  2. Groth16 proof of membership in the     │
                      │     association set built from live CVI    │
                      └────────────────────────────────────────────┘
                                          │
                            shielded transfers (JoinSplit)
                            amount and holder never published
                                          │
    ┌──────── ANSWERABILITY, four ways ────┴──────────────────────┐
    │  exact · threshold · two-sided range · aggregate            │
    │  each bound to an audit request registered on-chain FIRST   │
    └─────────────────────────────────────────────────────────────┘
```

### Entry is gated twice, and the gates ask different questions

**Gate one is not ours.** The pool is registered with Cleanverse's own CVI Compliance
Validator, and `deposit()` calls `complianceVerify(pool, msg.sender)` on their contract,
live, in the same transaction that moves the value. Not an off-chain lookup performed
beforehand and trusted afterwards — a credential frozen one block ago fails here. If the
pool were ever unregistered the call reverts rather than returning false, so the register
fails closed instead of quietly becoming an open one.

**Gate two is a zero-knowledge proof.** The caller proves their key is a leaf in the
association-set root the issuer anchored — a Merkle tree whose members are derived, every
build, from live Cleanverse A-Pass state — and is absent from the on-chain sanctions
list. The proof is pinned to `msg.sender` and to the exact commitment being inserted, so
a proof for one wallet is useless from another and cannot be detached from its note.

Holding a live credential is not membership of the set the issuer anchored, and vice
versa. That is the point of having both.

### Revocation is a rebuild, not a blacklist

There is no revocation list to maintain. Freeze an A-Pass at Cleanverse and the next
association set is simply built without it. The holder can no longer produce an entry
proof, so the position cannot be re-entered or topped up. Be precise about the other
edge, though: the exit is gated on whoever *submits* the transfer, not on the note's
owner, so an eligible party could relay a revoked holder out. Entry is gated
cryptographically; the exit is gated operationally, and the difference is real. We ran this end to end:
see [the demonstrations](#six-demonstrations) below.

### Answerability without disclosure

Four proof types, each verified by this contract, each bound to an audit request the
auditor registered **before the answer existed**:

| Type | Reveals | Keeps hidden |
|---|---|---|
| `proveExact` | the figure itself | every other position, and the holder's keys |
| `proveThreshold` | that the position is at or under a cap | the figure |
| `proveRange` | that it falls inside a reporting bracket | the figure |
| `proveAggregate` | that total exposure across a named set is under a cap | every individual position |

The aggregate case is the strict one. Its context hash is a Poseidon commitment over the
enumerated positions *and* their active flags, and the circuit recomputes that hash — so a
holder cannot answer by leaving a position out. The report is complete or there is no
proof. What the circuit cannot check is whether the *enumeration* was complete; that is a
tooling job, and it is where we got it wrong today. See the limits.

### It answers in the incumbent's shape

ERC-3643 (T-REX) carries most of the tokenized-RWA supply in existence, so the cheapest
adoption path is to answer its two questions rather than invent new ones. `isVerified(address)`
and `canTransfer(from, to, amount)` compose all three entry controls — credential, anchored set,
sanctions list — in T-REX's spelling, and `canTransferWithReason` returns an ERC-1066 status
byte plus a reason so an integrator can tell *which* control refused. A bare `false` collapses
three situations that demand three different actions: sort your credential out, wait for the
issuer to rebuild, or you are sanctioned.

These are the admission predicate, not the shielded ledger — they answer about addresses, which
is what ERC-3643 asks about, while the positions inside the register are commitments no standard
has a question for yet. **They are written and tested but not deployed**; see the limits.

## What is deployed

Monad testnet, chain `10143`.

| | Address |
|---|---|
| **SaksiPool** | [`0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA`](https://testnet.monadexplorer.com/address/0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA) |
| **Saksi Series A Note** (our CVA, `SAKSIAZEV`) | [`0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B`](https://testnet.monadexplorer.com/address/0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B) |
| Cleanverse CVI Compliance Validator | `0xaC7e5179C2C7f03f209136886c172eb34F161792` |
| complianceVerifier | `0xd9911689e884598f563fffa6e3d2166963d731fd` |
| transferVerifier | `0xa98cee28c6eb35b6ee7440b7490e265f23975d61` |
| exactVerifier | `0x2960aece70bb3e80ed389147c79de1f6ff822563` |
| thresholdVerifier | `0xfb6aa86244babf35ee6e5a4b359cf59cd9e8cad7` |
| rangeVerifier | `0x2b81cd713fb98622c0d14f2019d68b21e39a6a1e` |
| aggregateVerifier | `0x7e7684bb2e7fc1790bfbfed80d01fc51b4f3b969` |

Read the live state yourself:

```bash
cast call 0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA "registeredWithValidator()(bool)" --rpc-url https://testnet-rpc.monad.xyz
cast call 0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA "activeRules()((bytes2,bytes2,uint8,uint8,bool,uint256)[])" --rpc-url https://testnet-rpc.monad.xyz
cast call 0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA "isEligible(address)(bool)" 0x4490CcB0abdE3D2E494dE5cC118F7D0D74b44639 --rpc-url https://testnet-rpc.monad.xyz
```

## Six demonstrations

**1. The question comes first.** Four disclosure types, all verified on-chain, in
[`audit-log.json`](audit-log.json). Every request block precedes its answer block — 52210266
asks, 52210275 answers — which anyone can check with an RPC endpoint and no access to this
repo. The strongest row is a failure: asked whether total exposure across four positions
was at most 1,000 when it was in fact 1,680, **no proof could be produced**, and request
`52210907` is still open. The register cannot answer falsely; it can only fail to answer.

**2. The set is faithful, and we can now check it over the whole population.**
`node ops/gate-gap.mjs` asks Cleanverse's validator about **every member of the set**, not a
sample, and reports the direction of any disagreement — because the set is *derived* from their
registry and must never be more permissive than it. The root was anchored at 10:07 UTC and the
sweep names whichever members Cleanverse has frozen since — **two of the 524 at the last run,
with no read left unanswered**. Do not quote that number, run the script: it moves with their
registry, and a read their endpoint rate-limits is counted as unknown rather than as agreement,
so what the sweep reports is a floor on the disagreement and never a clean bill. Gate one
refuses those members at deposit, so no position can be opened on a stale witness — which is the
entire reason gate one is a live call and not a cached one.

It was more permissive, earlier today. Fifteen credentials Cleanverse had **frozen** were
holding valid membership witnesses in our set, because removing a broken server-side status
filter had taken the client-side status check out with it. The instrument that should have
caught this was checking four hardcoded addresses and printing "0 disagreements" for a set
of five hundred. Both are fixed; the sweep is the evidence.

> An earlier version of this section pointed at the burn address, claiming the ZK gate
> caught what the live gate missed. That was wrong, and it was our bug: the same status
> filter had dropped seven eighths of the eligible population, and `0x…dEaD` fell out
> because of it. With the population enumerated correctly both gates admit it.

So why two gates? Because they diverge in **time**. The anchored root is a snapshot and
credentials move continuously: freeze one and the live call refuses immediately, while the
anchored root still admits until the issuer rebuilds. The live gate closes that window; the
anchored set is what still binds when an operator never rotates. And a third control is
neither of them — the entry proof also shows the depositor is absent from an on-chain
sanctions list, which refuses `0x…dEaD` even though both gates admit it.

**3. Revoke and freeze.** A verified holder deposited, then had its A-Pass frozen
(`update_status` → live record `status: 2`). Both gates closed independently:
`complianceVerify(pool, holder)` on Cleanverse's validator went `true → false`, and the
association set rebuilt without it — recorded in the `dropped` list of `asp.public.json`, whose
`previousRoot` field is the root the pool was still accepting proofs against until that rebuild.
Both are in the repo; the raw pre-rebuild set is a local build artefact and is not, because it
carries other teams' wallets. The next deposit reverts `ValidatorRefused` at gate one and has no
witness at gate two.

> Reproduce it on a wallet that is frozen **now**, not on that one. The credential used for this
> run has since been reactivated in Cleanverse's shared sandbox, so `complianceVerify` on it
> returns `true` again; the artefacts above are the record of the run. `gate-gap.mjs` names the
> wallets both gates refuse at the moment you run it.

> `isEligible(address)` is **Saksi's** view on the pool, which forwards to Cleanverse's
> `complianceVerify(pool, wallet)`. The validator itself exposes no `isEligible` — that
> call reverts on their contract. The distinction matters when reproducing these results.

**4. The shielded middle runs.** One JoinSplit
([`0x30a74be8…`](https://testnet.monadexplorer.com/tx/0x30a74be85a99b68c4bd0a40a1beb7575b0b06686ed610993ed7f6aa38a8cac68),
block 52209800) spent two of the issuer's positions and created two new ones. The inputs
were 250 and 480, both public from their deposit transactions. What the transfer put on
chain is two nullifiers and two commitments, and nothing links an input to an output.

The outputs are 270.1 and 459.9, and **neither figure was on this chain until a regulator
asked for one.** Block 52210355 is where 459.9 became public — an exact disclosure answering
a request posted ten blocks earlier — and once it is public the sibling follows by
arithmetic. That is the design working rather than failing: a figure leaves this register
only in answer to a question, and the chain records that the question came first.

```bash
node ops/transfer.mjs --as issuer          # prove, publish the note root, spend
```

This is the operation the whole commitment scheme exists for, and it had never been executed
on-chain until this build: `noteRoot()` was `0`, which made `transact()` unreachable rather
than merely undemonstrated. At block 52266233 the register held twelve commitments, six of them
live positions backing 2,315 CVA — it is still being deposited into, so read it rather than
trusting that line: `node ops/evidence.mjs`.

**5. And value leaves it under the same rules.** A second JoinSplit
([`0x08b6801b…`](https://testnet.monadexplorer.com/tx/0x08b6801b1cbcaa681f2a81d77628e4c88dcec9bf70793492663fa605422d0e3a),
block 52220592) redeemed 50 units out of the register: 49.5 to a credentialed recipient and
0.5 to a credentialed relayer, with 680 staying shielded inside. The exit is where
Cleanverse's model is most opinionated — every address receiving a CVA needs a credential —
so `transact()` calls `complianceVerify` twice more on that path, once for the recipient
and once for the relayer. That transaction took the pool's backing from 1,680 to 1,630 — later
deposits have since raised it — and the `Transacted` event records `withdrawn = 50000000`. The chain does not say which position paid for it — though on
*this* register you can work it out anyway, for a reason we own up to in the limits below.

**6. And the register can mint a position it cannot itself spend.** Every JoinSplit before today
keyed its outputs to the sender's own fresh key, so the mechanism ran but no position had ever
left the sender's control. `ops/keygen.mjs` generates a spending key into a separate ledger; the
sender is given only the public half; and one JoinSplit
([`0x78168fda…`](https://testnet.monadexplorer.com/tx/0x78168fda9282e1d7933c942c102ab2d53b4049a98cda272b0eb7f23167f1291c),
block 52244580) paid an output to it. The private half is not in the sender's ledger and never
was, so the sender cannot spend that position.

```bash
node ops/keygen.mjs holder2
node ops/transfer.mjs --as issuer --to-pubkey <pub> --to-label holder2
```

Claim exactly that and no more. An adversarial review took the stronger version apart, correctly:
the recipient is a key in a file with no address and no credential, both transactions were signed
by the same wallet, and every disclosure circuit takes `(amount, pubKey, blinding)` and **no
private key** — so anyone holding the note's opening, the sender included, can still *answer*
about it. **Spend authority separated; answer authority did not.** Blocks 52244758 → 52244768
show that position answered to the auditor under a 600 cap, which demonstrates the disclosure
path over a separately-keyed note; it does not demonstrate a second party.


## Repository

```
contracts/     Foundry. SaksiPool + the seven exported Groth16 verifiers. 173 tests,
               nine of them invariants driven by a fuzzing handler.
circuits/      Circom sources, proving keys, witness calculators.
ops/           The register's operations — issuance, association set, validator
               registration, deposits, disclosures, revocation.
web/           The console, six tabs: Evidence, Am I eligible?, Register,
               Two gates, Issuer, Regulator.
docs/          Cleanverse API notes, findings, the business plan.
```

## Running it

```bash
# contracts
cd contracts && forge test          # 173 passed

# ops — install once, then set CV_API_ID / CV_API_KEY and a funded Monad key in .env
npm install
node ops/smoke.mjs                  # live sandbox check
node ops/asp.mjs build              # rebuild the association set from live CVI
node ops/deposit.mjs 250            # prove eligibility, enter the register
node ops/audit.mjs threshold 500    # regulator asks, holder answers, contract checks
node ops/apass.mjs freeze 0x…       # revoke a credential and watch both gates close

# console
cd web && npm install && npm run dev
```

## Prior work, declared

The seven Circom circuits and their proving keys are carried over from an earlier public
Stellar/Soroban build and are committed as the first commit under that description. What
was built during the 8–9 Aug window is everything that makes them a Cleanverse product:
the CVI and CVA integration, the Solidity pool and its two gates, the association-set
builder, the disclosure flow, the deployment, and the consoles.

## Honest limits

- **Entry is public.** `deposit()` takes a plaintext amount from a visible sender and emits
  both, so the map from a commitment to its opening amount and its first owner is readable
  by anyone. The commitment buys confidentiality over a position's *life*, not at its
  creation — which is exactly what the shielded transfer above demonstrates.
- **The exit is gated operationally, not cryptographically.** The transfer circuit carries no
  association-set input and the proof is not bound to `msg.sender`, so an eligible party
  could relay a revoked holder's exit. Closing it is a recompile and a new phase-2 ceremony,
  roughly a day. Two Foundry tests assert this gap rather than pretending it is closed.
- **The note root is owner-published.** `merkleUpdate.circom` exists and is keyed, but its
  verifier is not wired to `publishNoteRoot`, so nothing on-chain ties the root to
  `commitments[]`. Every leaf is emitted, so a wrong root is detectable by any observer —
  it is not prevented.
- **The trusted setup is one trust domain.** Three contributions and a closing beacon, all
  carrying snarkjs default labels: one operator, one machine. If that operator kept the
  phase-2 randomness, forged proofs are possible and undetectable.
- **Both gates root in one authority.** They diverge in *time*, not in trust. A compromised
  Cleanverse sandbox defeats both.
- **Answer authority does not move with a position.** Every disclosure circuit takes
  `(amount, pubKey, blinding)` and no private key, so anyone holding a note's opening —
  including whoever built the output — can prove things about it. Only *spend* authority is
  separable today; binding the spending key into the disclosure circuits is a recompile and a
  new ceremony.
- **The aggregate is single-prover, and we published a wrong answer proving it.** Block
  52245878 answered "total exposure across all **3** registered positions" while four were
  live: the enumerator counted retirements by what the issuer's ledger could open, which is
  circular, so it filed the separately-keyed position as retired. The answer is true of the
  three it names and is not a statement about the register. It cannot be retracted, so
  `audit-log.json` carries the correction beside the row rather than the row being quietly
  re-run. `ops/audit.mjs` now counts retirements from the chain and refuses when a live
  position belongs to a key that has not contributed an opening.
- **The ERC-3643 views, the ERC-1400 reason codes, the `TREE_CAPACITY` guard and the `subject`
  field on `DisclosureProved` are not deployed.** All are in `SaksiPool.sol` and tested, and all
  revert — or, for the event, simply do not match — on the pool at `0xeBBA114d…`. Redeploying
  would reset the evidence chain above: two permanently open audit requests whose entire value
  is that they have been open since a specific block. The event is the one that bites a third
  party, because an indexer built from this repo's ABI matches **zero** logs on the live pool:

  ```
  deployed   DisclosureProved(uint256,uint8,uint256,uint256)
             0x9579a4d26804d84c8c061d5d86e659dad5bb249b255dffa53cf5983a1c00dec3
  this repo  DisclosureProved(uint256,uint8,uint256,uint256,uint256)
             0x06bd1b30042910e35141596b27c70896f579048c77927e10273773a3eda723f8
  ```

  Index on the deployed topic0; recompute either with `cast keccak "<signature>"`. On the
  deployed shape the range path spends both value slots on its bounds, so a range answer's log
  never names the position it was about — which is exactly why the field was added.
- **Which commitments are live is public.** `notes.public.json` publishes them, so
  set-differencing against `allCommitments()` names the spent ones. What is hidden is which
  input became which output, and what any of them is worth.
- **This register's amounts are derivable, and that is our bug.** `ops/transfer.mjs` split
  each JoinSplit 37/63 — a constant in a public repository — and deposits are plaintext, so
  every note follows from the deposit log: 730 × 0.37 = 270.1. The splitter now draws from the
  CSPRNG; the notes already inserted do not. Assume these amounts are readable.
- **`denyList` is an 8-slot fixed array** and the aggregate circuit is fixed at 5 slots — and
  the register now holds **six** live positions, so the ceiling is already crossed: an
  aggregate over the whole register no longer fits in one proof, and every aggregate answer
  from here is a statement about a named subset. Widening the circuit is a recompile and a
  new ceremony; the gas law above prices the alternative at ~62,600 gas per extra slot.
  Merkle depth 10 caps every tree at 1,024 leaves.
- **Single-EOA owner**, no timelock or multisig, who can rotate roots and set the auditor.
- Everything is Monad testnet, and the Cleanverse sandbox is shared across hackathon teams,
  so the association set contains other participants' credentials as well as ours. That is
  why it has 524 members and not 4.


## Licence

MIT.
