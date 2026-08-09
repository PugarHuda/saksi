<div align="center">
<img src="docs/saksi-logo.svg" width="88" alt="Saksi" />

# Saksi

**Every position witnessed. Disclosure only when asked.**

A confidential holder register for tokenized real-world assets.
Built on Cleanverse CVI and CVA · deployed on Monad testnet.

[Live console](https://saksi-gilt.vercel.app) · [Pool on explorer](https://testnet.monadexplorer.com/address/0x9BB3af71497304506Be2810915016742394f72f2) · [One-page summary](SUMMARY.md)

</div>

---

## The problem, measured

Every tokenized RWA platform publishes its holder register in the clear. The usual reply
is that a public chain is pseudonymous, so this costs nothing. We checked.

```
$ node ops/measure-register.mjs
545 credentialed wallets × every CVA on Monad — an exhaustive census, not a sample

median holders per asset                       2
held by exactly one wallet                     2
fewer than five holders                        6 of 9   (67%)
one wallet holding 90%+ of the counted supply  3
```

An anonymity set of two is not anonymity. Knowing the asset and watching one transfer
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
proof, and the position freezes with nobody having to move it. We ran this end to end:
see [the revocation section](#the-two-demonstrations) below.

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
| **SaksiPool** | [`0x9BB3af71497304506Be2810915016742394f72f2`](https://testnet.monadexplorer.com/address/0x9BB3af71497304506Be2810915016742394f72f2) |
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
cast call 0x9BB3af71497304506Be2810915016742394f72f2 "registeredWithValidator()(bool)" --rpc-url https://testnet-rpc.monad.xyz
cast call 0x9BB3af71497304506Be2810915016742394f72f2 "activeRules()((bytes2,bytes2,uint8,uint8,uint256)[])" --rpc-url https://testnet-rpc.monad.xyz
cast call 0x9BB3af71497304506Be2810915016742394f72f2 "isEligible(address)(bool)" 0x4490CcB0abdE3D2E494dE5cC118F7D0D74b44639 --rpc-url https://testnet-rpc.monad.xyz
```

## Three demonstrations

**1. The question comes first.** Four disclosure types, all verified on-chain, in
[`audit-log.json`](audit-log.json). Every request block precedes its answer block — 52157468
asks, 52157475 answers — which anyone can check with an RPC endpoint and no access to this
repo. The strongest row is a failure: asked whether total exposure across four positions
was at most 1,000 when it was in fact 1,150, **no proof could be produced**, and request
`52163014` is still open. The register cannot answer falsely; it can only fail to answer.

**2. Why two gates.** `node ops/gate-gap.mjs` finds an address the gates disagree about.
Cleanverse's own validator answers that the **burn address** satisfies this pool's rule —
someone in the shared sandbox issued `0x…dEaD` a credential, and `complianceVerify` returns
true for it today. Gate one admits it; gate two has no membership witness, so it does not
enter. The honest half of the same result: `0x1111…1111` *is* in our set, because it is in
the registry. The set is faithful to Cleanverse, not cleaner than it.

**3. Revoke and freeze.** A verified holder deposited, then had its A-Pass frozen
(`update_status` → live record `status: 2`). Both gates closed independently:
`complianceVerify(pool, holder)` on Cleanverse's validator went `true → false`, and the
association set rebuilt 47 → 46 without it — recorded in `asp.json` as
`dropped: [{ label: "family", … }]`, with the previous set kept in `asp.previous.json`.
The next deposit reverts `ValidatorRefused(0xa132…)` at gate one and has no witness at gate
two.

> `isEligible(address)` is **Saksi's** view on the pool, which forwards to Cleanverse's
> `complianceVerify(pool, wallet)`. The validator itself exposes no `isEligible` — that
> call reverts on their contract. The distinction matters when reproducing these results.

## Repository

```
contracts/     Foundry. SaksiPool + the seven exported Groth16 verifiers. 34 tests.
circuits/      Circom sources, proving keys, witness calculators.
ops/           The register's operations — issuance, association set, validator
               registration, deposits, disclosures, revocation.
web/           The three consoles: register, issuer, regulator.
docs/          Cleanverse API notes, findings, the business plan.
```

## Running it

```bash
# contracts
cd contracts && forge test          # 34 passed

# ops — needs CV_API_ID / CV_API_KEY and a funded Monad key in .env
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

- The note tree root is published by the owner rather than advanced by the `merkleUpdate`
  proof. Every leaf is emitted on-chain, so a wrong root is detectable by any observer,
  but a production deployment should close this with the circuit that already exists.
- `denyList` is an 8-slot fixed array. Fine for a pilot, wrong for a real sanctions feed;
  the natural upgrade is a non-membership proof against a second tree.
- Everything is Monad testnet, and the Cleanverse sandbox is shared across hackathon
  teams, so the association set contains other participants' credentials as well as ours.
  That is why it has 44 members and not 4.

## Licence

MIT.
