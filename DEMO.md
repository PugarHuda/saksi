# Demo script

Target 4–5 minutes. Three beats, in this order. Screen recording plus voice; no slides
until the last twenty seconds.

Open two windows side by side: a terminal in the repo root, and
https://saksi-gilt.vercel.app. Have `https://testnet.monadexplorer.com` in a third tab.

---

## Cold open — 40 seconds, terminal only, no product yet

Start in the terminal. Do not show the product until the problem is a number.

```bash
node ops/measure-register.mjs
```

While it runs:

> "Every tokenized asset platform publishes its holder register in the clear, and the
> usual answer is that a public chain is pseudonymous so it costs nothing. I checked."

> "A verified asset can only move between wallets that hold a credential, so the
> credentialed set isn't a sample of possible holders — it's all of them. This reads every
> balance, for every one of them, against every verified asset on Monad."

Let the table land. Point at the median.

> "Median holders per asset: two. Six of the nine have fewer than five. Three have one
> wallet holding over ninety percent. An anonymity set of two is not anonymity — knowing
> the asset and watching one transfer identifies the position and its size."

> "And this isn't a quiet testnet. It's the mechanism. The tighter you make an asset's
> holder rule, the smaller the crowd its holders hide in. Every project in this hackathon
> tightens that rule. Tightening it makes each remaining holder more exposed, not less."

Now switch to the **Register** tab. Point at the Amount and Holder columns — six dots each.

> "Same asset class, same public chain. Seven positions, five verified holders. The total
> is public. Who holds what is not."

---

## Beat 1 — the question comes before the answer · 90 seconds

**This is the strongest beat. Lead with it, not with the technology.**

Go to the **Regulator** tab. Scroll to the aggregate entry marked *request stays open*.

> "A regulator asked whether total exposure across four positions was at most one
> thousand. The register did not answer. It could not — the true total was 1,150, and the
> proof for that claim does not exist. So the request is still open on chain."

Open block 52163014 in the explorer.

> "That is the question, registered by the auditor, at block 52163014. There is no
> answering transaction. A register that could have answered that question anyway would be
> worth nothing."

Now scroll up to the threshold row and open both transactions.

> "Here is one it could answer. Block 52157468 is the auditor asking whether a position is
> under the cap. Block 52157475 is the answer — a zero-knowledge proof, checked by the
> contract, that the position is under the cap. It never reveals the position."

Pause on the two block numbers.

> "The question is on chain seven blocks before the answer exists. You do not have to
> trust me about the ordering — the chain records it, and you can check it without my
> code."

---

## Beat 2 — why the compliance gate is two gates · 90 seconds

Terminal:

```bash
node ops/gate-gap.mjs
```

Let the table print. Point at the burn address row.

> "Gate one is Cleanverse's own validator. I did not write it, I registered my pool with
> it, and my deposit function calls it inside the transaction that moves the money."

> "It says the burn address is compliant. Someone in the shared sandbox issued
> `0x000…dEaD` a credential, so it satisfies my min-tier-30 rule. Check it yourself —"

```bash
cast call 0xaC7e5179C2C7f03f209136886c172eb34F161792 \
  "complianceVerify(address,address)(bool)" \
  0x9BB3af71497304506Be2810915016742394f72f2 \
  0x000000000000000000000000000000000000dEaD \
  --rpc-url https://testnet-rpc.monad.xyz
```

> "True. Gate one lets it in. Gate two is a zero-knowledge proof of membership in an
> association set I build from the live A-Pass registry — and there is no membership
> witness for the burn address, so no proof exists and it does not enter."

Point at the `0x1111…1111` row.

> "And the honest half, in the same table: this one *is* in my set, because it is in
> Cleanverse's registry. My set is faithful to theirs, not cleaner than theirs. The second
> gate is not better data — it is a second, independent question, anchored at a moment in
> time, that an address also has to satisfy."

Switch to the **Two gates** tab in the console and show the same result rendered live.

---

## Beat 3 — revocation, briefly · 60 seconds

> "Fifty other teams here are showing you a freeze, so I will be quick."

Terminal — show the record, not the ceremony:

```bash
node ops/apass.mjs status 0xa132a1BB7EEA9523Ce08a3D933A20d54AEac6483
```

Point at `"status": 2`.

> "This holder deposited while verified. Then the issuer withdrew the credential at
> Cleanverse. No blacklist was written anywhere. The next association set is simply built
> without them —"

```bash
node -e "const a=require('./asp.json');console.log(a.dropped)"
```

> "— and the root rotates. Both gates close independently: Cleanverse's validator now
> refuses them, and there is no membership witness for them either. Their position freezes
> without anyone moving it."

---

## Close — 40 seconds

Terminal:

```bash
node ops/evidence.mjs
cd contracts && forge test
```

> "Everything I have shown is on Monad testnet and regenerates from the chain — that table
> is not typed by hand. Thirty-four tests, including a real Groth16 proof verifying against
> the deployed verifier at 264,000 gas."

> "The asset is mine: I launched it through `atoken/launch` with its compliance rule
> attached at issuance. The pool holds its own A-Pass, which is what lets a contract
> custody a verified asset at all. And the compliance check is a constraint inside a
> circuit over Cleanverse's live identity registry, not a lookup performed beforehand and
> trusted afterwards."

> "Saksi. Every position witnessed. Disclosure only when asked."

## Say this before a judge finds it

Do not let anyone discover this in your devtools. Say it in beat one, in your own words:

> "Entry here is public and I am not going to pretend otherwise — a deposit has a visible
> sender and moves a visible amount, so the chain already links this commitment to the
> wallet that opened it. What the commitment buys is the next hop: once a position moves
> through a JoinSplit, nothing links the new note to this row. That is the layer I'm asking
> you to judge, and I'll show it running."

Volunteering the boundary is worth more than the boundary being wider. A reviewer who finds
an overclaim discounts everything else you said; one who hears you name your own limit
believes the rest.

---

## Do not say

- "audit pack" — 54 other entries promise one
- "compliance is not bolted on" / "not decorative" — the field's verbal tic
- "Travel Rule attribution rides every transfer" — 71 others say it
- anything about revocation before beat 3

## Have ready in case a judge asks

- **"Is the ZK yours?"** — the seven Circom circuits are prior public work from a Soroban
  build, committed as the first commit under that description. Everything touching
  Cleanverse is this window. Say it before they ask.
- **"Why is the association set 46 people?"** — the sandbox is shared across teams, so it
  contains other participants' credentials. That is the registry being faithful.
- **"What is not finished?"** — the note-tree root is owner-published rather than advanced
  by the merkleUpdate proof; the deny list is a fixed 8 slots. Both are in the README.
