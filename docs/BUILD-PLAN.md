# Saksi — build plan

Window: **Aug 8 00:00 – Aug 9 23:59 UTC**. Submission by email to isaac@cleanverse.com.

## The commit-history constraint, handled honestly

Cleanverse requires *"commit history during the hacking window (Aug 8–9 UTC)"*. Prior
work is allowed — several registered projects declare theirs — but the repo has to
show real work happening inside the window.

So: **the public repo is created on Aug 8**, and the prep in `saksi/` is not pushed as
one opening commit. Instead:

- **First commit** brings in the circuits and exported verifiers, with a message
  naming them as prior work carried over from a Stellar build.
- **Everything after** is written in the window: the pool, the CVI tree builder, the
  disclosure flow, the consoles, the deployment.

That produces a history a judge can read at face value, and it matches what the
application already told them.

## Submission checklist

- [ ] Public GitHub repo, commits dated inside the window
- [ ] Demo video (no time limit)
- [ ] One-page summary: problem / solution / CVI·CVA integration points / deployed chains
- [ ] Live demo URL or testnet deployment
- [ ] Email all of it to isaac@cleanverse.com before Aug 9 23:59 UTC

## Before the window (now → Aug 7)

- [x] ~~Q1: Validator on Monad?~~ **Resolved 6 Aug -- Monad is live. Deploy there.**
- [ ] Ask Q4 -- freezable sandbox A-Pass fixture. The demo depends on it.
- [ ] Get **Monad** testnet gas
- [ ] Re-run `saksi/scripts/smoke.mjs` right before deploying -- availability moved once already
- [ ] Read `docs-cleanverse.txt` sections for `atoken/launch` and `query_apass_list`
- [ ] Decide the asset: a tokenized note launched via `atoken/launch`, with a rule
      carrying `min_tier` and a country allow-list

Nothing else. Writing product code now just moves work outside the window where it
counts for less.

## Day 1 — Aug 8

**Morning — CVA issuance, so "from the issuance stage" is literal**
- `atoken/launch` our tokenized note with a compliance rule
- Poll `atoken/query_apply_status/{requestId}` to ISSUED
- Deploy `SaksiPool` bound to that A-Token

**Midday — CVI becomes load-bearing**
- `validator/grant` then `validator/register` the pool, owner-signed
- Rules: `min_tier`, allow-list countries, then a second rule with `is_black_list`
- `validator/verify` from the deposit path, so ineligible wallets never get a proof built
- Build the association-set tree over `query_apass_list`, leaves = `currentKycHash`,
  anchor the root with `rotateRoot()`

**Evening — the shielded middle**
- Wire `TransferVerifier` into `withdraw()`, closing the gap marked in the source
- Prove a full deposit → shielded transfer → withdraw cycle end to end

## Day 2 — Aug 9

**Morning — answerability**
- `requestAudit()` from the regulator, then threshold / aggregate / range disclosure
  proofs verified against the live contract
- Export the audit pack: each line carries its verification tx hash
- Pull a real Travel Rule PDF via `download_travel_rule`

**Midday — the two demo moments**
- Issuer proves no holder exceeds the concentration cap and jurisdiction exposure is
  under its limit, revealing nothing
- Freeze an A-Pass, rotate the root without it, watch the next transfer fail

**Afternoon — consoles and ship**
- Issuer console: register health, limits, revocation, audit export
- Regulator console: raise request, receive proof, verify on-chain
- Deploy the front end, record the video, write the one-pager, send the email

**Hard stop 20:00 UTC.** Last four hours are buffer, not scope.

## If time runs short, cut in this order

1. The Operator console — fold what matters into the Issuer view
2. `merkleUpdate` trustless root advance — owner-rotated root is honest for a pilot
3. Aggregate and range disclosure — threshold alone carries the demo
4. Never cut: the CVI gate, the revocation freeze, or the on-chain disclosure verify.
   Those are the 30 points.

## Deployment decision

**Monad.** The Validator module went live there between 2 and 6 Aug (confirmed twice by
probe), so the sponsor chain now also carries the deepest CVI integration. There is no
trade-off left to make.

The pool is chain-agnostic regardless: if Monad gives trouble on the day, Base,
Ethereum, Polygon, BSC and HashKey all carry the Validator too. Redeploy and
re-register; only the RPC and the addresses move.
