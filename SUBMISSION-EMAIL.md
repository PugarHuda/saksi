# Submission email — draft

**To:** isaac@cleanverse.com
**Subject:** Saksi — RWA track submission (confidential holder register, Monad testnet)

---

Hi Isaac,

Submitting **Saksi** for the RWA track.

**Repo** https://github.com/PugarHuda/saksi
**Live demo** https://saksi-gilt.vercel.app
**Demo video** _[paste link]_
**One-page summary** https://github.com/PugarHuda/saksi/blob/main/SUMMARY.md — also attached

**Deployed chain:** Monad testnet (10143)

Saksi is a confidential holder register for tokenized RWAs. Positions in a Cleanverse
Verified Asset are held as commitments, so amount and holder are absent from the chain,
while entry, exit and audit stay answerable.

Three things I would point a judge at first:

0. **The problem is measured, not asserted.** `node ops/measure-register.mjs` runs an
   exhaustive census — a CVA transfer needs a credential on both sides, so the 545
   credentialed wallets on Monad are the complete set of possible holders, not a sample.
   Result: **median holders per verified asset is 2**, six of nine assets have fewer than
   five holders, and three have a single wallet holding over 90% of supply. That is the
   mechanism rather than a testnet artefact — the tighter an asset's holder rule, the
   smaller the crowd its holders hide in. Compliance and confidentiality pull against each
   other structurally, and Saksi is the entry that refuses the trade-off instead of
   picking a side.


1. **The auditor's question is registered on-chain before the answer exists.** Block
   52157468 asks whether a position is under a cap; block 52157475 answers with a Groth16
   proof that it is, without revealing the position. The ordering is checkable by anyone
   with an RPC endpoint. And one request has no answer at all — asked whether total
   exposure across four positions was at most 1,000 when it was 1,150, no proof could be
   produced, so request 52163014 is still open. The register cannot answer falsely; it can
   only fail to answer.

2. **Cleanverse's validator says the burn address is compliant.**
   `complianceVerify(0x9BB3af71…, 0x…dEaD)` returns true on Monad testnet right now —
   someone in the shared sandbox issued `0x…dEaD` a credential. Gate one admits it; the ZK
   membership gate has no witness for it, so it does not enter. That is a live argument for
   why the compliance gate is two gates, reproducible with `node ops/gate-gap.mjs`. I have
   also written up the honest half: `0x1111…1111` *is* in our set because it is in the
   registry — the set is faithful to Cleanverse, not cleaner than it.

**Key addresses**

| | |
|---|---|
| SaksiPool | `0x9BB3af71497304506Be2810915016742394f72f2` |
| Saksi Series A Note — our own CVA, launched via `atoken/launch` | `0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B` |
| Registered with your CVI Validator | `0xaC7e5179C2C7f03f209136886c172eb34F161792` · `isRegistered(pool)` → true · `getRulesV2(pool)` → `(0x0000,0x0000,30,0,0)` |

`node ops/evidence.mjs` regenerates the full evidence table straight from the chain.

**Declared prior work:** the seven Circom circuits and their proving keys are prior public
work from an earlier Soroban build, and are committed as the first commit under exactly
that description. Everything that touches Cleanverse — the Solidity pool and its two gates,
the association-set builder, the four disclosure flows, the deployment and the consoles —
was built during the window.

**Two sandbox issues worth passing to the team**, both worked around rather than blocking:

- `POST /update_status` returns `[500] System Error` while the on-chain freeze nonetheless
  succeeds — the credential does go to `status: 2` and `complianceVerify` flips to false,
  so only the response path appears broken.
- `POST /download_travel_rule` only accepts a **plain JSON** body; sent encrypted like the
  other write endpoints it reports `The tx hash cannot be empty, The wallet cannot be null`.
  It is not listed among the plain endpoints in the docs.

Also, for completeness: the validator exposes `apass()` →
`0xbA82D189540CaC9DC6FF46B6837CaC1BFdEC58B9` on Monad, which is not documented anywhere I
could find and was useful.

Thanks for running this — the API access and the integration guides made a genuinely deep
integration possible in the window.

Best,
Pugar Huda Mantoro
hudapugar@gmail.com · github.com/PugarHuda

---

## Checklist before sending

- [ ] Demo video uploaded and the link is public (test in a private window)
- [ ] `SUMMARY.md` attached as a PDF or pasted inline — judges read this, not the repo
- [ ] Repo is public (test in a private window)
- [ ] Console loads and the Two gates tab renders live
- [ ] Send before **9 Aug 23:59 UTC**
