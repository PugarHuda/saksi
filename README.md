<div align="center">
<img src="docs/saksi-logo.svg" width="88" alt="Saksi" />

# Saksi

**Every position witnessed. Disclosure only when asked.**

A confidential holder register for tokenized real-world assets.
Built on Cleanverse CVI and CVA · deployed on Monad testnet.

[Live console](https://saksi-gilt.vercel.app) · [Pool on explorer](https://testnet.monadexplorer.com/address/0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA) · [One-page summary](SUMMARY.md)

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
see [the demonstrations](#five-demonstrations) below.

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
proof.

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

## Five demonstrations

**1. The question comes first.** Four disclosure types, all verified on-chain, in
[`audit-log.json`](audit-log.json). Every request block precedes its answer block — 52210266
asks, 52210275 answers — which anyone can check with an RPC endpoint and no access to this
repo. The strongest row is a failure: asked whether total exposure across four positions
was at most 1,000 when it was in fact 1,680, **no proof could be produced**, and request
`52210907` is still open. The register cannot answer falsely; it can only fail to answer.

**2. The set is faithful, and we can now prove it over the whole population.**
`node ops/gate-gap.mjs` asks Cleanverse's validator about **every member of the set**, not a
sample, and reports the direction of any disagreement. **524 of 524 are admitted by
Cleanverse too** — the only acceptable result, because the set is *derived* from their
registry and must never be more permissive than it.

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
association set rebuilt without it — recorded in `asp.json` as
`its dropped list`, with the previous set kept in `asp.previous.json`.
The next deposit reverts `ValidatorRefused` at gate one and has no witness at gate
two.

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
than merely undemonstrated. The register now holds eight commitments, four of them live
positions.

**5. And value leaves it under the same rules.** A second JoinSplit
([`0x08b6801b…`](https://testnet.monadexplorer.com/tx/0x08b6801b1cbcaa681f2a81d77628e4c88dcec9bf70793492663fa605422d0e3a),
block 52220592) redeemed 50 units out of the register: 49.5 to a credentialed recipient and
0.5 to a credentialed relayer, with 680 staying shielded inside. The exit is where
Cleanverse's model is most opinionated — every address receiving a CVA needs a credential —
so `transact()` calls `complianceVerify` twice more on that path, once for the recipient
and once for the relayer. The pool's backing went 1,680 → 1,630 and the `Transacted` event
records `withdrawn = 50000000`; which of the register's positions paid for it does not
appear anywhere.


## Repository

```
contracts/     Foundry. SaksiPool + the seven exported Groth16 verifiers. 89 tests.
circuits/      Circom sources, proving keys, witness calculators.
ops/           The register's operations — issuance, association set, validator
               registration, deposits, disclosures, revocation.
web/           The three consoles: register, issuer, regulator.
docs/          Cleanverse API notes, findings, the business plan.
```

## Running it

```bash
# contracts
cd contracts && forge test          # 89 passed

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
- **`denyList` is an 8-slot fixed array**, and the aggregate circuit is fixed at 5 slots —
  the register already holds eight commitments, so the aggregate cannot span it and refuses
  rather than answering over a subset. Merkle depth 10 caps every tree at 1,024 leaves.
- **Single-EOA owner**, no timelock or multisig, who can rotate roots and set the auditor.
- Everything is Monad testnet, and the Cleanverse sandbox is shared across hackathon teams,
  so the association set contains other participants' credentials as well as ours. That is
  why it has 524 members and not 4.


## Licence

MIT.
