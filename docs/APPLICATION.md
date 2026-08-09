# Saksi — Cleanverse Build: Trusted Assets Hackathon

Application draft. Deadline: **7 Aug 2026, 23:59 UTC**.

---

## Team / Project Icon
`saksi-logo.png` (512×512) — SVG source in `saksi-logo.svg`.

## Project Name
```
Saksi
```

## Team / Company
```
Pugar Huda Mantoro
```

## Contact Email
```
hudapugar@gmail.com
```

## Track
```
RWA — Real-World Assets, Verified
```

---

## Team Background

```
Solo builder. I ship zero-knowledge financial infrastructure, end to end — circuits,
contracts, and the app on top — and I have done it repeatedly under hackathon
constraints.

Most relevant prior build: a privacy-pool payment corridor on Stellar with seven
Circom/Groth16/BN254 circuits and eight Soroban contracts live on testnet, including
four contract-verified selective-disclosure proof types (exact, threshold, aggregate,
and two-sided range) and an in-circuit compliance proof over an allow-list root with
sanctions non-membership. Settlement was gated by an on-chain oracle read, failing
closed. Live app: https://tukar-six.vercel.app

Other confidential-finance builds: a sealed-bid OTC desk on Stellar, and a
confidential OTC desk on Zama's fhEVM. Beyond ZK I have shipped on Sui, Monad-class
EVMs, EIP-7702 account abstraction, and TEE-based systems.

That prior circuit work is the foundation Saksi extends. The hackathon work is
porting it to EVM and rebuilding the gate on CVI and CVA — stated up front so the
scope is honest.
```

## Project Description

```
Every tokenized RWA platform publishes its holder register in the clear. An
institution that buys a tokenized note broadcasts its position size, its entry
timing, and its counterparty to every competitor watching the chain. This is a
principal reason institutional RWA stays on permissioned ledgers or never issues at
all. The naive fix — a privacy pool — destroys compliance: the issuer can no longer
prove who holds what, and a revoked holder can no longer be found.

Saksi is a confidential holder register for tokenized real-world assets. Positions
are held and transferred in CVA with amount and holder shielded on-chain, while
entry, transfer, and exit remain fully answerable to the issuer and the regulator.

Cleanverse is not a feature here; it is the thing the cryptography binds to.

CVI is the membership set proven inside the circuit. The compliance proof shows the
depositor's key is in the CVI registry and absent from the sanctions set, with the
source key pinned to the authenticated sender so no one can enter as someone else.
This is not an off-chain KYC lookup before a transaction — it is a constraint the
proof cannot satisfy without a valid credential. Without a revocable, wallet-bound,
bank-verified identity there is no set to prove membership in, and the circuit has
nothing to bite on.

CVA is the only asset the pool accepts and the only thing it releases; the shielded
leg moves A-Tokens strictly between verified wallets. CCP runs the pre-transaction
rule check at both edges, and Travel Rule attribution rides every entry and exit.
Private in the middle, accountable at the edges.

CVI revocation becomes a live protocol event. A revoked key enters the deny set, the
next proof fails non-membership, and the position freezes — enforced by an on-chain
verifier, not by an off-chain watcher that may be hours behind.

The signature demo: an issuer proves on-chain that no single holder exceeds the
concentration cap and that aggregate exposure for a restricted jurisdiction stays
under its limit — without revealing one position. Then a holder's CVI is revoked and
their next transfer fails in front of the judges, live.

Honest scope: the ZK core is prior work being ported from Stellar to EVM. The
hackathon build is the CVI/CVA gating, the Solidity pool, and the issuer and
regulator consoles.
```

## Cleanverse Integration Plan

```
During the hackathon.

The CVI registry becomes the allow-list the compliance circuit proves membership
against. I build a Merkle tree over verified credential keys, anchor its root
on-chain, and refresh it per epoch; revoked and sanctioned keys populate the
non-membership set the same proof must clear. If the API exposes a canonical root
directly I consume that instead and drop my own tree — first question for the
developer channel.

CVA is the sole asset the pool custodies. Deposits accept A-Tokens only, withdrawals
release A-Tokens only, and every edge transaction is submitted through the CCP
pre-transaction rule check with Travel Rule attribution attached. A blocked check
means no proof is even built.

Reporting produces an audit pack where each line is a claim verified on-chain rather
than a CSV asking to be trusted: the disclosure proof, its verification transaction
hash, and the audit request it was bound to. The four disclosure circuits are ported
to Solidity Groth16 verifiers via snarkjs, which is a natural fit — BN254 has EVM
precompiles, so verification is cheaper on Monad than on the platform this code came
from. Deployment target is Monad testnet.

After the hackathon.

The disclosure layer is asset-agnostic. Any CVA issuer should be able to attach a
confidential register to an existing token without changing their issuance flow, so
the path is to package it as a module rather than a destination platform — which
positions it as an Infrastructure Partner in the Cleanverse membership model.

The pilot I want is one tokenized-note issuer with a real concentration or
jurisdiction limit to report against, ideally from the Founding Circle, since the
value only becomes legible where a register is currently public and the issuer
wishes it were not.
```

## Business Plan / Deck
Optional but worth filling — free points on Scalability (10) and Concept (20).

---

## Open questions for the dev Telegram (ask on day 1)
1. API version: docs site says **v3**, but a registered project cites **v5.6**
   (country allow/deny rules, `is_black_list`, minimum A-Pass tier). Which do we get?
2. Is the CVI registry exposed as a **Merkle root**, or only as a REST lookup?
   Determines whether in-circuit gating is native or needs our own tree.
3. Is there a **revocation feed/webhook**, or must we poll credential state?
