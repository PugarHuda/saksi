# Demo script

Everything below is live against Monad testnet. No slides, no mockups, no "imagine that".
Run the commands; the numbers on screen are the numbers in this file.

Pool `0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA` · CVA `SAKSIAZEV` · chain `10143`

---

## Cold open — 40 seconds, terminal only

```bash
node ops/measure-register.mjs
```

> "Every tokenized-RWA platform publishes its holder register in the clear, and the answer
> you always get is that a public chain is pseudonymous so it costs nothing. I checked
> instead. This is every wallet with an active A-Pass, against every A-Token on this chain."

Point at three numbers.

> "Median holders per asset: three. Thirty-five of forty-five assets have fewer than five
> holders. Sixteen have a single wallet holding over ninety percent. An anonymity set of
> three is not anonymity — know the asset, watch one transfer, and you have the position
> and its size."

> "And it does not fix itself, because it *is* the mechanism. The tighter an asset's holder
> rule, the smaller the crowd its holders hide in. Compliance and confidentiality pull
> against each other structurally. The obvious fix — a privacy pool — destroys the thing
> that made the asset legitimate."

---

## Beat 1 — the question comes before the answer · 90 seconds

```bash
node ops/evidence.mjs
```

> "A regulator posts a question on-chain. Then, and only then, the holder produces a proof
> that answers exactly that question. The contract checks that the proof carries the
> request's context hash, so an answer to one question cannot be presented as the answer to
> another."

Point at the request and answer block numbers.

> "Request block always before answer block. You can check that with any RPC endpoint and
> no access to my repo."

Then point at the last row.

> "This is the row I care about. The auditor asked whether total exposure across the four
> positions it named is at most one thousand. Those positions summed to one thousand six
> hundred and eighty, and the register backs one thousand six hundred and thirty today after
> a redemption — either way, over the cap. **No proof exists**, so the request is still open at block 52210907 and it will be
> open forever. This register cannot answer falsely. It can only fail to answer, and the
> failure is on the record."

> "That is the whole product in one row. Everything else is machinery for making that row
> possible."

**If asked how it could cheat:** an earlier version of this contract could be cheated, and
we found it. The request pinned *who* and *what kind of answer*, but not the **figure** — so
"is this at most 1,000?" was answerable with "at most 2⁶⁴−1", which is true, provable, and
closes the request. The contract now pins a hash of the figure and each prover recomputes
it. There is a failing exploit test in the repo that passes against the fix.

---

## Beat 2 — three controls, and they ask different questions · 90 seconds

```bash
node ops/gate-gap.mjs
```

> "Gate one is Cleanverse's own validator. I did not write it. I registered my pool with it,
> and my deposit function calls it inside the transaction that moves the money."

> "Gate two is a zero-knowledge proof of membership in an association set I build from live
> A-Pass state and anchor on-chain."

Let the sweep finish — it asks the validator about **every** member, not a sample.

> "Every member of my set is admitted by Cleanverse too. That is the correct result: my set
> is *derived* from their registry, so it must never be more permissive than it. Earlier
> today it was — fifteen frozen credentials were sitting in my set holding valid witnesses,
> and the tool that was supposed to catch that was checking four hardcoded addresses and
> reporting zero disagreements for a set of five hundred. It sweeps all of them now."

Point at the burn address row.

> "So why two gates, if they agree? Because they diverge in **time**. The anchored root is a
> snapshot; credentials move continuously. Freeze a credential and the live call refuses
> immediately, while the anchored root still admits until I rebuild. Neither one subsumes
> the other."

> "And there is a third control that is neither, in the last two columns. The entry proof
> also shows the depositor is absent from an on-chain sanctions list. Read the burn address
> row across: Cleanverse admits it, my set holds a witness for it, the deny list refuses it,
> and the verdict is no. Three questions, and only the third one stops it."

> **Say this out loud:** "An earlier version of this demo claimed the ZK gate caught the
> burn address where Cleanverse missed it. That was wrong, and it was my bug — a status
> filter had dropped seven eighths of the eligible population. With the population
> enumerated properly both gates admit it. I would rather show you the retraction than the
> claim."

---

## Beat 3 — the shielded middle, running · 60 seconds

```bash
cast call 0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA "noteRoot()(uint256)" \
  --rpc-url https://testnet-rpc.monad.xyz
```

> "Entry is public and I am not going to pretend otherwise: a deposit has a visible sender
> and moves a visible amount, so the chain links that commitment to the wallet that opened
> it. What the commitment buys is the next hop."

Show the transfer transaction `0x30a74be85a99b68c4bd0a40a1beb7575b0b06686ed610993ed7f6aa38a8cac68`.

> "This is a JoinSplit. Two of the issuer's positions — 250 and 480, both public from their
> deposits — were spent, and two new positions were created. What is on-chain is two
> nullifiers and two commitments. Nothing links an input to an output."

> "One of the new amounts is 459.9, and you can read it — at block 52210355, because the
> auditor asked for it ten blocks earlier. That is the point. It was unreadable until a
> regulator posted a question, and the chain records that the question came first."

> "The register still backs every unit it held and the total is unchanged by this. Four of
> its commitments are live positions."

---

## Beat 4 — revocation, briefly · 45 seconds

```bash
node ops/apass.mjs freeze <holder>
node ops/asp.mjs build
```

> "There is no revocation list to maintain. Freeze the A-Pass at Cleanverse and the next
> association set is simply built without it. The holder can no longer produce an entry
> proof."

> "Honest boundary: entry is gated cryptographically, the exit is gated operationally. The
> transfer circuit has no association-set input and the proof is not bound to the sender, so
> an eligible party could relay a revoked holder's exit. Closing that is a recompile and a
> new ceremony — about a day. It is in the summary, and there are two tests that assert the
> gap rather than pretend it is closed."

---

## Close — 30 seconds

```bash
cd contracts && forge test
```

> "Eighty-nine tests, including the exploit proofs from an adversarial review of this
> codebase — kept as regression tests, and seven of them assert limitations that are still
> open."

> "Saksi. Every position witnessed. Disclosure only when asked."

---

## Do not say

- "audit pack" — many other entries promise one
- "compliance is not bolted on" / "not decorative" — the field's verbal tic
- "trustless", "revolutionary", "military-grade"
- anything about revocation before beat 4

## Have ready

- **"Is the ZK yours?"** — the seven Circom circuits are prior public work from a Soroban
  build, committed as the first commit under that description. Everything touching
  Cleanverse is this window. Say it before they ask.
- **"Why is the association set 524 people?"** — the sandbox is shared across teams, so it
  holds other participants' credentials. That is the set being faithful to the registry.
- **"What is not finished?"** — the note root is owner-published rather than advanced by the
  `merkleUpdate` proof; the exit is gated operationally; the deny list is a fixed 8 slots;
  the aggregate circuit is 5 slots and the register already exceeds it. All four are in the
  summary.
- **"Has anyone done this?"** — Zama × T-REX and Polymesh both shipped confidentiality for
  regulated assets this year. What I have not seen bundled with it is issuer accountability:
  a concentration cap, revocation by rebuild, and a recorded non-answer.
