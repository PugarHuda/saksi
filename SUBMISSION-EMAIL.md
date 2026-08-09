# Submission email — Cleanverse Build: Trusted Assets

**To:** isaac@cleanverse.com
**Subject:** Saksi — RWA track submission (Pugar Huda Mantoro)

---

Hi Isaac,

Submitting **Saksi** for the RWA track.

- **Repo:** https://github.com/PugarHuda/saksi
- **Live demo:** https://saksi-gilt.vercel.app
- **One-page summary:** [SUMMARY.md](https://github.com/PugarHuda/saksi/blob/main/SUMMARY.md) (also attached)
- **Demo video:** _[paste link]_
- **Deployed chain:** Monad testnet, chain `10143`

---

## What it is

A confidential holder register for tokenized real-world assets. Positions are held as
commitments; they move by JoinSplit so amounts and owners are not published; entry is gated
twice; and the register answers a regulator with zero-knowledge proofs rather than
spreadsheets.

## The problem, measured rather than asserted

We ran an exhaustive census — every wallet holding an active A-Pass, against every A-Token
on Monad — instead of assuming pseudonymity is protection.

Median holders per asset: **3**. Thirty-five of forty-five assets have fewer than five
holders. Sixteen are over 90% held by a single wallet.

An anonymity set of three is not anonymity, and it does not fix itself, because it is the
mechanism: the tighter an asset's holder rule, the smaller the crowd its holders hide in.
Compliance and confidentiality pull against each other structurally. The obvious fix — a
privacy pool — destroys the accountability that made the asset legitimate.

## CVI · CVA integration

1. **Gate one is your contract, not our reimplementation of one.** The pool is registered
   with the CVI Compliance Validator at `0xaC7e5179C2C7f03f209136886c172eb34F161792`, and
   `deposit()` calls `complianceVerify(pool, msg.sender)` on it live, inside the transaction
   that moves value. An unregistered pool reverts rather than returning false.
2. **The asset is a real CVA.** `SAKSIAZEV` issued through `atoken/launch` with a `min_tier
   30` rule from issuance. `activeRules()` on our pool and `getRulesV2()` on yours return the
   identical tuple.
3. **The association set is derived from live CVI** — 524 members from a population of 602,
   rebuilt from A-Pass state each run, root anchored on-chain.
4. **Revocation is a rebuild, not a blacklist.** Freeze an A-Pass and the next set is built
   without it; the holder can no longer produce an entry proof.
5. **A third control:** the entry proof also shows non-membership of an on-chain sanctions
   list, which carries a live entry.

## What is deployed and exercised

| | |
|---|---|
| SaksiPool | `0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA` |
| Saksi Series A Note (our CVA) | `0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B` |
| Register | 8 commitments · 4 live positions · 1,630 CVA |
| Tests | 89 passing, including an adversarial review's own exploit POCs |

Both halves run on-chain. One JoinSplit spent two positions of 250 and 480 and created two
whose amounts appear nowhere (block 52209800). A second redeemed 50 out of the register to a
credentialed recipient with 0.5 to a credentialed relayer (block 52220592) — the exit path
calls your validator twice more, on the recipient and on the relayer.

## The one thing worth clicking

Every audit answer is bound to a request the auditor — **a different key from the issuer** —
posted on-chain before the answer existed, and every request block precedes its answer block.

The strongest row is a failure. The auditor asked whether total exposure across the four live
positions is at most 1,000 when those positions in fact summed to 1,680. **No proof exists**, so request block
`52210907` is open and stays open. The register cannot answer falsely; it can only fail to
answer, and the failure is permanent and public.

## Two disclosures you should have from us

**The repository was deleted and recreated during the window.** Testnet note secrets for a
superseded pool reached the public repo and survived two history rewrites, because GitHub
serves orphaned commits by SHA and the SHAs are discoverable from the public Events API.
Destroying and recreating the repository was the only way to purge the object store, so the
final push is one push — the commit history and its timestamps are preserved and all sit
inside the hacking window. There was zero key reuse into the live pool.

**Limitations we would rather state than have found.** Entry is public by construction; the
exit is gated operationally rather than cryptographically; the note root is owner-published
because `merkleUpdate` is not wired to it; the trusted setup is a single trust domain; both
gates ultimately root in one authority. All five are in the summary, and two Foundry tests
assert the open limitations instead of pretending they are closed.

Thanks for running this — the sandbox and the Telegram support both held up well under a
lot of concurrent load.

Best,
Pugar Huda Mantoro

---

## Checklist before sending

- [ ] Demo video recorded and linked (script in `DEMO.md`)
- [ ] `SUMMARY.md` attached as well as linked
- [ ] Repo public and cloning anonymously
- [ ] Live URL loading
