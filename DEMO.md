# Demo script

Everything below is live against Monad testnet, except two commands that are pre-recorded
and named as recordings on camera. No slides, no mockups, no "imagine that".

Pool `0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA` · CVA `SAKSIAZEV` · chain `10143`

Set `RPC=https://testnet-rpc.monad.xyz` and `POOL=0xeBBA114d9870c98250239aCaFbcccc4dA09AF1CA`
before you start, so no line in this script wraps on camera.

---

## Before you shoot: what is pre-recorded, and why

Two commands cannot be run inside a beat, and pretending otherwise wastes ninety seconds of
tape or corrupts an artefact.

| command | why it is recorded |
|---|---|
| `node ops/measure-register.mjs` | ~4 minutes, and it **overwrites `measurement.json`** while it runs. Record it once; the artefact it wrote is in the repo and is what the summary quotes. |
| `node ops/gate-gap.mjs` | asks Cleanverse's validator about all 524 members one call at a time — **~4.5 minutes**. Record the sweep. Its header table prints instantly and *is* shot live. |

Everything else finishes inside a beat, measured: `evidence.mjs` 14 s, `gas.mjs` 5 s,
`forge test` under a second, `cast call` instant.

Say the word "recording" out loud when you play one. The whole submission rests on being
the kind of project that tells you which frame is which.

---

## Cold open — the problem, measured · 35 seconds

Play the recorded census tail, or read the artefact it wrote:

```bash
node -e "const m=require('./measurement.json');console.log(m.walletsEnumerated,'credentialed wallets ×',m.tokensEnumerated,'A-Tokens');console.log('median holders per asset  ',m.medianHolders);console.log('under five holders        ',m.assetsUnderFiveHolders,'of',m.assetsWithHolders);console.log('one wallet over 90%       ',m.assetsWithDominantHolder)"
```

> "Every tokenized-RWA platform publishes its holder register in the clear, and the answer
> you always get is that a public chain is pseudonymous so it costs nothing. I checked
> instead — every wallet with an active A-Pass, against every A-Token on this chain. Median
> holders per asset: three. Thirty-five of forty-five assets have fewer than five holders.
> Sixteen have a single wallet over ninety percent."

> "An anonymity set of three is not anonymity. And it does not fix itself, because it *is*
> the mechanism: the tighter an asset's holder rule, the smaller the crowd its holders hide
> in. The obvious fix — a privacy pool — destroys the thing that made the asset legitimate."

---

## Beat 1 — the register can mint a position it cannot spend · 80 seconds

**Newest material, and the beat where being precise is worth more than being impressive.**

> "Until this afternoon every transfer in this register paid its outputs back to a key the
> sender already held. The mechanism ran, but no position had ever left the sender's control.
> So I generated a spending key into a separate ledger, kept only the public half on the
> sending side, and paid a JoinSplit output to it."

```bash
cast call $POOL "allCommitments()(uint256[])" --rpc-url $RPC | tr ',' '\n' | wc -l
```

> "Twelve commitments at the block I read it. Six are live positions backing 2,315 units — and
> it is still being deposited into, so check it live rather than against my slide."

Show `0x78168fda9282e1d7933c942c102ab2d53b4049a98cda272b0eb7f23167f1291c`, block 52244580.

```bash
node -e "const s=require('./notes.json'),h=require('./notes.holder2.json');console.log('sending ledger:',s.length,'positions',s.map(n=>n.commitment.slice(0,14)).join(' '));console.log('paid out:     ',h.notes[0].commitment.slice(0,14),'— not in that list, and its private key is not there either')"
```

> "That output is not in the sending ledger, and its private key never was. **This register can
> mint a position the minting process cannot spend.** That is the claim. It is worth having and
> it is the whole of what I am claiming."

**Then retract the bigger version before anyone else does — this is the strongest thirty
seconds in the script:**

> "I wanted to tell you a position changed hands between two people. An adversarial review took
> that apart and it was right. The recipient is a key in a file — no address, no credential.
> Both transactions were signed by the same wallet. And every disclosure circuit in this build
> takes amount, public key and blinding, and **no private key** — so anyone holding the note's
> opening, me included, can still *answer* about that position."

> "**Spend authority separated. Answer authority did not.** A real second holder needs their own
> credentialed wallet, their own gas, and a disclosure circuit that binds the spending key. That
> is a recompile and a new ceremony, and it is in the limits. I would rather you heard the exact
> claim from me than the inflated one from my README."

```bash
cast receipt 0x6b243d35d0525e49162e4af76a0bc579eb17c9456c7f3f17dd0a9ee1af446c11 --rpc-url $RPC   # auditor asks,  block 52244758
cast receipt 0xb7332187dc04833dad65f30b387fbf8ae83aa3e3ae56ec624485ffc49a01cfb7 --rpc-url $RPC   # answered,      block 52244768
```

> "The auditor did post a question about that separately-keyed position and it was answered
> under a 600 cap without disclosing the figure. That demonstrates the disclosure path over a
> note the sender cannot spend. It does not demonstrate a second party, and I am not going to
> say it does."

---

## Beat 2 — the question comes before the answer · 80 seconds

```bash
node ops/evidence.mjs
```

Point at the `DISCLOSURES` block.

> "A regulator posts a question on-chain. Only then does the holder produce a proof that
> answers exactly that question, carrying the request's context hash — so an answer to one
> question cannot be presented as the answer to another. Request block always before answer
> block, checkable with any RPC endpoint and no access to my repo."

Then point at the two rows that read `NEVER`.

> "These are the rows I care about. The auditor asked whether this position sits inside the
> hundred-to-four-hundred bracket. It does not. **No proof exists**, so that request has been
> open since block 52210333 and it will be open forever."

> "And the last one: total exposure across four named positions, at most one thousand. They
> summed to one thousand six hundred and eighty. Open since block 52210907. This register
> cannot answer falsely. It can only fail to answer, and the failure is on the record."

> "That is the whole product in two rows. Everything else is machinery for making those rows
> possible."

**If asked how it could cheat:** an earlier version of this contract could be cheated, and
we found it. The request pinned *who* and *what kind of answer*, but not the **figure** — so
"is this at most 1,000?" was answerable with "at most 2⁶⁴−1", which is true, provable, and
closes the request. The contract now pins a hash of the figure and each prover recomputes
it. There is an exploit test in the repo that fails against the old contract and passes
against the fix.

**Get to the last aggregate row before they do.** Block 52245878 answered "total exposure
across all **3** registered positions" while four were live — the fourth being the
separately-keyed one from Beat 1, which this ledger cannot open. The enumerator counted
retirements by what the ledger could open, which is circular, so it filed a live position as
retired. The answer is true of the three it names and is **not** a statement about the register.

> "I cannot retract it — it is on-chain and it stays there. So `audit-log.json` carries the
> correction attached to that row rather than me quietly re-running it. A register that
> publishes its own wrong answer with the correction next to it is worth more than one that
> only ever shows you the clean rows."

`ops/audit.mjs` now counts retirements from the chain and refuses outright when a live position
belongs to a key that has not contributed an opening. **The honest ceiling of the
concentration-cap claim is that it is single-prover.**

---

## Beat 3 — three controls, and they ask different questions · 70 seconds

Show the header table live — it prints before the sweep starts:

```bash
node ops/gate-gap.mjs        # header is instant; cut to the recording for the sweep
```

> "Gate one is Cleanverse's own validator. I did not write it. I registered my pool with it,
> and my deposit function calls it inside the transaction that moves the money. Gate two is a
> zero-knowledge proof of membership in an association set I build from live A-Pass state and
> anchor on-chain."

Read the burn-address row across, then run the third control live:

```bash
cast call $POOL "sourceKeyOf(address)(uint256)" 0x000000000000000000000000000000000000dEaD --rpc-url $RPC
cast call $POOL "denyList(uint256)(uint256)" 0 --rpc-url $RPC
```

> "Same number. Cleanverse admits the burn address, my set holds a witness for it, and the
> sanctions list refuses it. Three questions, and only the third one stops it."

> **Say this out loud:** "An earlier version of this demo claimed the ZK gate caught the burn
> address where Cleanverse missed it. That was wrong, and it was my bug — a status filter had
> dropped seven eighths of the eligible population, and the tool that should have caught it
> was checking four hardcoded addresses and printing zero disagreements for a set of five
> hundred. It sweeps all 524 now. I would rather show you the retraction than the claim."

Now revocation, live, on a credential that is frozen right now:

```bash
cast call 0xaC7e5179C2C7f03f209136886c172eb34F161792 \
  "complianceVerify(address,address)(bool)" $POOL 0xa132a1BB7EEA9523Ce08a3D933A20d54AEac6483 --rpc-url $RPC
```

> "False. There is no revocation list to maintain — freeze the A-Pass at Cleanverse and the
> next association set is simply built without it, so the holder can no longer produce an
> entry proof either. Both gates close, independently, from one change to *their* record."

> "So why two gates, if they mostly agree? Because they diverge in **time**. The anchored root
> is a snapshot; credentials move continuously. Freeze one and the live call refuses
> immediately, while the anchored root still admits until I rebuild. The sweep shows exactly
> one member in that window right now. Neither gate subsumes the other."

> "Honest boundary, and it is in the summary: entry is gated cryptographically, the exit is
> gated operationally. The transfer circuit has no association-set input and the proof is not
> bound to the sender, so an eligible party could relay a revoked holder's exit. Closing it is
> a recompile and a new ceremony — about a day. Two tests assert that gap rather than
> pretend it is closed."

---

## Beat 4 — what the ceilings cost · 45 seconds

```bash
node ops/gas.mjs
```

> "Every project this weekend will tell you its limits are compile-time constants. Naming
> them is half an answer. This replays every proof this register actually submitted against
> its own deployed verifier — `verifyProof` is a view, so you can replay them too — and fits
> a line: a Groth16 verification on Monad costs about 940,500 gas plus 31,300 per public
> signal, to within 1,092 gas across five points."

> "So Merkle depth is free. Depth is a private-witness dimension — depth twenty gives a
> million leaves at exactly the same price, and only proving time doubles. The 1,024-leaf
> ceiling is a rebuild, not an economic wall. The aggregate costs about 62,600 gas per extra
> position, which bounds one proof at roughly 2,300 positions against a 150M block — and that
> is the real argument for recursion rather than a wider circuit."

> "And the root cause is measurable: `ecPairing` costs 172,124 gas per pair here against
> 34,000 under EIP-1108. Monad prices the BN254 precompiles at about five times the Ethereum
> schedule. That is the whole gap between the 264k a disclosure verification measures locally
> and what it costs on this chain."

**If asked why not just read the receipts:** an earlier version of this section said no gas
number here could be reproduced, because Monad charges the submitted limit and reports it
back as `gasUsed`. The receipts are indeed useless. The conclusion drawn from them was wrong,
and a judge who reached for `eth_estimateGas` would have found that out before we did.

---

## Close — 30 seconds

```bash
cd contracts && forge test
```

> "A hundred and thirty-one tests, including the exploit proofs from three adversarial reviews
> of this codebase — kept as regression tests, and twelve of them assert limitations that are
> still open."

> "Saksi. Every position witnessed. Disclosure only when asked."

---

## Do not say

- "audit pack" — many other entries promise one
- "compliance is not bolted on" / "not decorative" — the field's verbal tic
- "trustless", "revolutionary", "military-grade"
- "the sender cannot see it" about the transferred position — the sender built the output
- anything implying the chain hides *which* commitments are live: `notes.public.json`
  publishes the issuer's live ones and the holder's is named in its own audit request, so
  set-differencing against `allCommitments()` identifies the spent ones. What is hidden is
  which input became which output, and what any of them are worth.

## Have ready

- **"Is the ZK yours?"** — the seven Circom circuits are prior public work from a Soroban
  build, committed as the first commit under that description. Everything touching Cleanverse
  is this window. Say it before they ask.
- **"Why is the association set 524 people?"** — the sandbox is shared across teams, so it
  holds other participants' credentials. That is the set being faithful to the registry.
- **"Does it speak ERC-3643?"** — the pool answers `isVerified(address)` and
  `canTransfer(from,to,amount)` in T-REX's shape, composing all three entry controls, plus
  `canTransferWithReason` returning an ERC-1066 status byte so an integrator can tell *which*
  control refused — credential, anchored set, or sanctions list — instead of getting one
  boolean for three situations that need three different actions. **Written and tested, not
  deployed** — redeploying would reset the two permanently-open audit requests, whose entire
  value is that they have been open since a specific block.
- **"What is not finished?"** — the note root is owner-published rather than advanced by the
  `merkleUpdate` proof; the exit is gated operationally; the deny list is a fixed 8 slots; the
  aggregate is single-prover. All four are in the summary.
- **"Has anyone done this?"** — Zama × T-REX and Polymesh both shipped confidentiality for
  regulated assets this year. What I have not seen bundled with it is issuer accountability: a
  concentration cap, revocation by rebuild, and a recorded non-answer.
