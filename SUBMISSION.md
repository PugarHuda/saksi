# Submission email — ready to send

**To:** isaac@cleanverse.com
**Subject:** Saksi — Cleanverse Build submission (RWA track)
**Attach:** `ONEPAGE.pdf`

---

Hi Isaac,

Submitting **Saksi** for the Trusted Assets build, RWA track.

- **Repo** — https://github.com/PugarHuda/saksi
- **Demo video** — _[paste link]_
- **One-page summary** — attached as `ONEPAGE.pdf`
- **Live** — https://saksi-gilt.vercel.app · deck at https://saksi-gilt.vercel.app/deck
- **Deployed chain** — Monad testnet, chain `10143`

```
SaksiPool                     0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA
SAKSIAZEV, the CVA            0xb9c53B57Cd47Bd3b55143647BeF8297d1C5f4d6B
CVI Compliance Validator      0xaC7e5179C2C7f03f209136886c172eb34F161792   (yours)
Auditor key                   0x63CB403b716111c249d4D11312c15c5744CcC4e4   (a different key from the issuer)
```

**What it is.** A tokenized asset has to publish its holder register or it cannot be audited — and we measured what that costs rather than assuming it. An exhaustive census of every A-Pass wallet against all 104 A-Tokens on Monad: median holders per asset is **3**, and 16 assets have a single wallet above 90% of supply. Eligibility restricts the population by design, so the tighter the compliance rule, the smaller the crowd each holder hides in. A privacy pool fixes that by destroying what made the asset legitimate.

Saksi holds positions as commitments that move by JoinSplit, so amounts and owners are never published — and stays answerable at both edges. Entry calls `complianceVerify` on your CVI Compliance Validator inside the same transaction that moves the value; the exit calls it twice more, on the recipient and the relayer. A regulator registers a question **on-chain before any answer exists**, and gets back a Groth16 proof bound to that exact question: exact, threshold, range, or aggregate.

**On the integration.** The asset is a real CVA — `SAKSIAZEV`, issued through `atoken/launch`, its rule registered through `validator/register` and read back live from `getRulesV2`. The association set is derived from live A-Pass state on every build, never curated: 524 admitted of 602 queried. Revocation is a rebuild, not a blacklist. One note for your team — `RuleV2` is **six** fields; a five-word decoder reads the country bitmap out of the wrong slot and fails silently, which it did here until both were checked against a non-zero value.

**The strongest thing in it is a failure.** The auditor asked whether total exposure was at most 1,000 when the positions summed to 1,680. No proof exists, so that request has been open since block `52210907` and stays open. The register cannot answer falsely; it can only fail to answer, and the failure is permanent and public.

**Two things you should have from us.** The repository was deleted and recreated during the window: testnet note secrets for a superseded pool reached it and survived two history rewrites, because GitHub serves orphaned commits by SHA. Destroying the object store was the only way to purge them. The commit history and its timestamps are preserved and all sit inside the hacking window. There was no key reuse into the live pool.

And the limits are written down rather than left to be found — twelve of them, on the deck's own slide and in `SUMMARY.md`. Entry is public by construction. An adversarial review broke our confidentiality claim from public data alone and recovered an amount no audit had disclosed; the leak is closed and the finding is published. Four contract fixes are in the source and deliberately not deployed, because redeploying would reset the two open audit requests whose entire value is that they have been open since a named block.

Everything above is a command in the repo. `node ops/evidence.mjs` rebuilds the whole evidence table from the chain.

Thanks for running this — the sandbox and your team's responsiveness in Telegram made the integration depth possible.

Pugar Huda Mantoro
Solo builder

---

## Before sending

- [ ] Video uploaded and the link pasted above, **set to public or anyone-with-link**
- [ ] `ONEPAGE.pdf` attached
- [ ] Open the repo link in a private window — it must load without a login
