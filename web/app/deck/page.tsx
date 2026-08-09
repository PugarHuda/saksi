import Link from "next/link";
import { addrUrl, txUrl } from "@/lib/chain";
import { read } from "@/lib/snapshot";
import type { Deployment, Measurement } from "@/lib/types";
import DeckKeys from "./keys";
import "./deck.css";

/* The submission deck.
 *
 * Server-rendered as a stacked document: every slide is a <section> with a numeric id, every
 * next/previous control is an <a href="#n">, and the only client JavaScript on the route is
 * arrow-key navigation. With scripting off you get the whole deck; with a print dialogue you
 * get one slide a page.
 *
 * Every figure below is either read from the repo's own artefacts at build time or was
 * verified against Monad before it was written down. Where a number could not be checked it
 * is not on a slide. Nothing here is rounded up. */

export const metadata = {
  title: "Deck — Saksi",
  description:
    "The Saksi submission deck: the measured problem, the CVI and CVA integration, the audit record, the ceilings priced, and the limits.",
};

const TOTAL = 15;

/** Read at the block named on the slide, with `eth_call` against the live pool. */
const READ_BLOCK = "52289541";

export default function Deck() {
  const dep = read<Deployment>("deployment.json", {});
  // tokensEnumerated is in the artefact but not in the shared type, which the console has no
  // use for. Widening it here rather than editing a type four other screens depend on.
  const m = read<(Measurement & { tokensEnumerated?: number }) | null>("measurement.json", null);

  const V = dep.verifiers ?? {};
  const sym = dep.assetSymbol ?? "SAKSIAZEV";

  return (
    <div className="d-deck">
      <DeckKeys count={TOTAL} />

      {/* ── 1 ─────────────────────────────────────────────────────────────── */}
      <Slide n={1}>
        <div className="d-grid wide">
          <div className="d-cover">
            <span className="dots gold" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <h1 className="display" id="h1">
              <span className="cap">SAKSI</span>
              <em>every position witnessed</em>
              <span className="cap">DISCLOSURE ONLY WHEN ASKED</span>
            </h1>
            <p className="d-sub">
              A confidential holder register for tokenized real-world assets. Built on
              Cleanverse CVI and CVA, deployed on Monad testnet.
            </p>
            <ul className="d-meta mono" role="list">
              <li>Cleanverse Build: Trusted Assets · RWA</li>
              <li>monad · 10143</li>
              <li>{sym}</li>
              <li>{TOTAL} slides</li>
            </ul>
            <p className="d-hint">Arrow keys, or scroll · print this page for the PDF</p>
          </div>
        </div>
      </Slide>

      {/* ── 2 ─────────────────────────────────────────────────────────────── */}
      <Slide n={2}>
        <div className="d-grid">
          <div>
            <p className="d-eyebrow">01 · The problem</p>
            <h2 className="d-h" id="h2">
              A compliant asset has no crowd to hide in.
            </h2>
            <p className="d-sub">
              Every tokenized-RWA platform publishes its holder register in the clear, and the
              standard reply is that a public chain is pseudonymous so this costs nothing.{" "}
              <strong>We measured instead of assuming.</strong>
            </p>
            <p className="d-sub">
              An exhaustive census, not a sample: every wallet holding an active A-Pass,
              against every A-Token on this chain.
            </p>
          </div>

          <div>
            {m ? (
              <>
                <ul className="d-figs" role="list">
                  <Fig k="median holders per asset" v={m.medianHolders} />
                  <Fig
                    k="assets with fewer than five holders"
                    v={`${m.assetsUnderFiveHolders} of ${m.assetsWithHolders}`}
                  />
                  <Fig k="assets held by exactly one wallet" v={m.singleHolderAssets} />
                  <Fig k="assets where one wallet holds 90%+" v={m.assetsWithDominantHolder} />
                  <Fig k="credentialed wallets enumerated" v={m.walletsEnumerated} />
                  {m.tokensEnumerated ? <Fig k="A-Tokens enumerated" v={m.tokensEnumerated} /> : null}
                </ul>
                <p className="d-note">
                  <code className="mono">node ops/measure-register.mjs</code> · {m.chain} head
                  block 52181672, {m.measuredAt.slice(0, 10)}. The census can miss a holder but
                  never invent one, so every figure is a floor: the real registers are at least
                  this exposed.
                </p>
              </>
            ) : (
              <p className="d-note">
                Run <code className="mono">node ops/measure-register.mjs</code> to rebuild the
                census this slide reads.
              </p>
            )}
          </div>
        </div>
      </Slide>

      {/* ── 3 ─────────────────────────────────────────────────────────────── */}
      <Slide n={3}>
        <div className="d-grid">
          <div>
            <p className="d-eyebrow">02 · Why it does not fix itself</p>
            <h2 className="d-h" id="h3">
              The tighter the holder rule, the smaller the crowd.
            </h2>
            <p className="d-sub">
              An anonymity set of {m?.medianHolders ?? "three"} is not anonymity — know the
              asset, watch one transfer, and you have identified the position and its size.
            </p>
            <p className="d-sub">
              This is not a quiet-testnet artefact, it is the mechanism. Eligibility restricts
              the population <em>by design</em>, so compliance and confidentiality pull against
              each other structurally. Every compliant-asset design tightens the rule, and
              tightening it makes each remaining holder more exposed, not less.
            </p>
          </div>

          <div>
            <p className="d-sect">The obvious fix breaks the asset</p>
            <p className="d-sub">
              Put the register in a privacy pool and you destroy what made it legitimate: the
              issuer can no longer prove who holds what, cannot enforce a concentration cap,
              and cannot find a holder whose credential was revoked.
            </p>
            <p className="d-sect d-gap">
              Saksi, in one sentence
            </p>
            <p className="d-quote">
              A holder register whose positions are commitments nobody can read, whose entry
              and exit are gated by Cleanverse&rsquo;s own credential check, and which answers
              a regulator with a proof bound to a question they registered on-chain first.
            </p>
            <p className="d-note">
              Saksi refuses the trade-off rather than picking a side of it:{" "}
              <strong>private in the middle, accountable at both edges.</strong>{" "}
              <em>Saksi</em> is Indonesian for <em>witness</em> — in zero knowledge the private
              input is called the witness, and in law a witness testifies to a fact without
              disclosing everything they know.
            </p>
          </div>
        </div>
      </Slide>

      {/* ── 4 ─────────────────────────────────────────────────────────────── */}
      <Slide n={4}>
        <div className="d-grid">
          <div>
            <p className="d-eyebrow">03 · How a position enters</p>
            <h2 className="d-h" id="h4">
              Two gates, and they ask different questions.
            </h2>
            <p className="d-sub">
              Holding a live credential is not membership of the set the issuer anchored, and
              membership of that set is not holding a live credential.{" "}
              <strong>Neither gate subsumes the other.</strong> That is the point of having
              both.
            </p>
            <p className="d-note">
              A third control is neither of them. All three run inside{" "}
              <code className="mono">deposit()</code>, in the transaction that moves the value.
            </p>
          </div>

          <ol className="d-steps">
            <li>
              <h3>Gate one is not ours</h3>
              <p>
                The pool is registered with Cleanverse&rsquo;s CVI Compliance Validator, and{" "}
                <code className="mono">deposit()</code> calls{" "}
                <code className="mono">complianceVerify(pool, msg.sender)</code> on their
                contract, live. Not an off-chain lookup trusted afterwards — a credential
                frozen one block ago fails here. An unregistered pool makes the call{" "}
                <em>revert</em> rather than return false, so the register fails closed instead
                of quietly becoming an open one.
              </p>
            </li>
            <li>
              <h3>Gate two is a zero-knowledge proof</h3>
              <p>
                The caller proves their key is a leaf in the association-set root the issuer
                anchored — a Merkle tree derived, every build, from live Cleanverse A-Pass
                state. The proof is pinned to <code className="mono">msg.sender</code> and to
                the exact commitment being inserted, so a proof for one wallet is useless from
                another and cannot be detached from its note.
              </p>
            </li>
            <li>
              <h3>And a sanctions list, on chain</h3>
              <p>
                The same entry proof shows the depositor is absent from{" "}
                <code className="mono">denyList</code>, eight fixed slots held by the pool. It
                carries a real entry — the burn address, which both gates admit and only this
                refuses.
              </p>
            </li>
          </ol>
        </div>
      </Slide>

      {/* ── 5 ─────────────────────────────────────────────────────────────── */}
      <Slide n={5}>
        <div className="d-grid">
          <div>
            <p className="d-eyebrow">04 · What is public, and what is not</p>
            <h2 className="d-h" id="h5">
              The chain counts the positions. It cannot read them.
            </h2>
            <p className="d-sub">
              Block <span className="mono">52209800</span>: one JoinSplit spent two positions
              of 250 and 480 — both public from their deposits — and created two new ones. What
              it put on chain is two nullifiers and two commitments. Nothing links an input to
              an output.
            </p>
            <p className="d-note">
              Neither output figure was on this chain until a regulator asked for one. Block{" "}
              <span className="mono">52210355</span> is where 459.9 became public, answering a
              request posted ten blocks earlier — and once one is public the sibling follows by
              arithmetic. That is the design working: a figure leaves this register only in
              answer to a question, and the chain records that the question came first.
            </p>
          </div>

          <div className="d-pair">
            <div>
              <p className="d-sect seen">On chain, for anyone</p>
              <ul className="d-list" role="list">
                <li>Every commitment, and the leaf index it took</li>
                <li>Every nullifier a transfer published</li>
                <li>
                  The deposit amount and its sender — <strong>entry is public</strong>, by
                  construction
                </li>
                <li>The anchored association-set root and the active rule</li>
                <li>Every audit request, and every answer or the absence of one</li>
              </ul>
            </div>
            <div>
              <p className="d-sect unseen">Not on chain at all</p>
              <ul className="d-list" role="list">
                <li>Which input became which output on any transfer</li>
                <li>What any position inside the register is worth</li>
                <li>
                  Which holder a position <em>created by a transfer</em> belongs to — a
                  deposit&rsquo;s first owner is public, and slide 14 says so
                </li>
                <li>
                  Which Cleanverse credential a membership witness rests on — the published set
                  reduces other teams&rsquo; members to leaves
                </li>
              </ul>
            </div>
          </div>
        </div>
      </Slide>

      {/* ── 6 ─────────────────────────────────────────────────────────────── */}
      <Slide n={6}>
        <div className="d-grid">
          <div>
            <p className="d-eyebrow gold">Integration 01 · The asset</p>
            <h2 className="d-h" id="h6">
              The asset is theirs, and so is the rule.
            </h2>
            <p className="d-sub">
              Not an ERC-20 with a compliance story attached. The register holds a Cleanverse
              Verified Asset issued through their own issuance endpoint, and the rule it
              enforces is read back out of their validator rather than kept in step here.
            </p>
            <p className="d-note">
              <strong>
                <code className="mono">RuleV2</code> is six fields
              </strong>
              , not five:{" "}
              <code className="mono">
                bytes2 allowedGroup, bytes2 allowedSubGroup, uint8 minTier, uint8 minSubTier,
                bool isBlackList, uint256 countryBitmap
              </code>
              . Cleanverse published the missing <code className="mono">isBlackList</code> field
              on 9 Aug; a five-word decoder reads the country bitmap out of the wrong slot and
              fails silently, which it did here until both were checked against a non-zero
              value.
            </p>
          </div>

          <div>
            <ul className="d-figs" role="list">
              <Fig k="issued through" v={<code className="mono">atoken/launch</code>} small />
              <Fig k="request id" v={dep.atokenRequestId ?? "—"} small />
              <Fig k="launch transaction" v="block 52147977" small />
              <Fig k="asset" v={`${dep.assetName ?? "Saksi Series A Note"} · ${sym}`} small />
              <Fig k="rule carried at launch" v="min_tier 30" small />
            </ul>
            <p className="d-note">
              <Addr label="CVA" value={dep.asset} />
            </p>
            <p className="d-note">
              <code className="mono">activeRules()</code> on the pool forwards to{" "}
              <code className="mono">getRulesV2(pool)</code> on Cleanverse&rsquo;s validator and
              returns{" "}
              <strong className="mono">(0x0000, 0x0000, 30, 0, false, 0)</strong> — their rule,
              read live at block {READ_BLOCK}, not a copy this repo keeps in step.
            </p>
          </div>
        </div>
      </Slide>

      {/* ── 7 ─────────────────────────────────────────────────────────────── */}
      <Slide n={7}>
        <div className="d-grid">
          <div>
            <p className="d-eyebrow gold">Integration 02 · Gate one</p>
            <h2 className="d-h" id="h7">
              Their contract, called inside the transaction that moves the value.
            </h2>
            <p className="d-sub">
              The pool was registered with the CVI Compliance Validator through{" "}
              <code className="mono">validator/register</code>, and{" "}
              <code className="mono">registeredWithValidator()</code> answers <span className="d-yes">true</span>{" "}
              at block {READ_BLOCK}. A refusal surfaces as{" "}
              <code className="mono">ValidatorRefused(address)</code>, naming who was refused.
            </p>
            <p className="d-note">
              The exit is where Cleanverse&rsquo;s model is most opinionated — every address
              receiving a CVA needs a credential — so{" "}
              <code className="mono">transact()</code> calls{" "}
              <code className="mono">complianceVerify</code> twice more on that path. Block{" "}
              <span className="mono">52220592</span> redeemed 50 units out: 49.5 to a
              credentialed recipient, 0.5 to a credentialed relayer, both checked by the
              contract.
            </p>
          </div>

          <div>
            <ul className="d-figs" role="list">
              <Fig k="registered through" v={<code className="mono">validator/register</code>} small />
              <Fig k="registration" v="block 52207150" small />
              <Fig
                k="called by deposit()"
                v={<code className="mono">complianceVerify(pool, msg.sender)</code>}
                small
              />
              <Fig k="called by transact()" v="recipient and relayer, one call each" small />
            </ul>
            <p className="d-note">
              <Addr label="CVI Compliance Validator" value={dep.validator} />
              <br />
              <Addr label="SaksiPool" value={dep.pool} />
            </p>
            <p className="d-note">
              Revocation needs no list here. Freeze an A-Pass at Cleanverse and this call goes{" "}
              <span className="mono">true → false</span> in the same block, with nothing to
              maintain on our side.
            </p>
          </div>
        </div>
      </Slide>

      {/* ── 8 ─────────────────────────────────────────────────────────────── */}
      <Slide n={8}>
        <div className="d-grid">
          <div>
            <p className="d-eyebrow gold">Integration 03 · The association set</p>
            <h2 className="d-h" id="h8">
              A set derived from their registry, not a list we keep.
            </h2>
            <p className="d-sub">
              Every build queries live A-Pass state, admits by the rule the asset was launched
              under, and anchors the root on chain. Revocation is a rebuild:{" "}
              <strong>freeze an A-Pass and the next set is simply built without it</strong>, so
              the holder can no longer produce an entry proof at all.
            </p>
            <p className="d-note">
              The set is {dep.aspAdmitted ?? 524} people and not four because the Cleanverse
              sandbox is shared across hackathon teams. That is the set being faithful to their
              registry rather than to us — and it is why the published bundle reduces members
              this project does not operate to bare leaves. The census on slide 2 enumerated
              562 an hour before this build, which is why the two populations differ.
            </p>
          </div>

          <div>
            <ul className="d-figs" role="list">
              <Fig k="population queried" v="602" />
              <Fig k="admitted by the rule" v={dep.aspAdmitted ?? 524} />
              <Fig k="dropped since the previous set" v="1" />
              <Fig k="Merkle depth" v="10" />
            </ul>
            <p className="d-note">
              Root, anchored on chain and read back from{" "}
              <code className="mono">aspRoot()</code> at block {READ_BLOCK}:
            </p>
            <p className="d-addr mono">{dep.aspRoot ?? "—"}</p>
            <p className="d-note">
              Built {dep.aspBuiltAt?.slice(0, 16).replace("T", " ") ?? "—"} UTC. The bundle also
              carries <code className="mono">previousRoot</code> — the root the pool was still
              accepting proofs against until this rebuild — and the one member this build
              dropped, which is what a revocation looks like from the set&rsquo;s side.
            </p>
          </div>
        </div>
      </Slide>

      {/* ── 9 ─────────────────────────────────────────────────────────────── */}
      <Slide n={9}>
        <div className="d-grid">
          <div>
            <p className="d-eyebrow gold">Integration 04 · When the gates disagree</p>
            <h2 className="d-h" id="h9">
              They diverge in time, not in trust.
            </h2>
            <p className="d-sub">
              The anchored root is a snapshot and credentials move continuously. Freeze one and
              the live call refuses immediately, while the anchored root still admits until the
              issuer rebuilds. <strong>Gate one closes that window</strong>; the anchored set is
              what still binds when an operator never rotates.
            </p>
            <p className="d-sub">
              <code className="mono">node ops/gate-gap.mjs</code> asks Cleanverse&rsquo;s
              validator about <strong>every member of the set</strong> — all{" "}
              {dep.aspAdmitted ?? 524}, one call each, about four and a half minutes. Not a
              sample.
            </p>
          </div>

          <div>
            <ul className="d-figs" role="list">
              <Fig k="members swept" v={dep.aspAdmitted ?? 524} />
              <Fig k="frozen since the root was anchored" v="2" />
              <Fig k="reads left unanswered" v="0" />
            </ul>
            <p className="d-note">
              Do not quote that two — run the script. It moves with their registry, and a read
              their endpoint rate-limits is counted as <em>unknown</em> rather than as
              agreement, so what the sweep reports is a floor on the disagreement and never a
              clean bill. Gate one refuses those members at deposit, so no position can be
              opened on a stale witness.
            </p>
            <p className="d-note">
              <strong>We got this wrong first.</strong> Fifteen credentials Cleanverse had
              frozen were holding valid membership witnesses, because removing a broken
              server-side status filter took the client-side status check out with it — and the
              instrument that should have caught it was checking four hardcoded addresses and
              printing &ldquo;0 disagreements&rdquo; for a set of five hundred. Both are fixed.
              The sweep is the evidence.
            </p>
          </div>
        </div>
      </Slide>

      {/* ── 10 ────────────────────────────────────────────────────────────── */}
      <Slide n={10}>
        <div className="d-grid wide">
          <div>
            <p className="d-eyebrow gold">Integration 05 · The disclosure protocol</p>
            <h2 className="d-h long" id="h10">
              Four answers, each verified by a deployed circuit.
            </h2>
            <div className="scroll">
              <table className="d-table">
                <thead>
                  <tr>
                    <th scope="col">Call</th>
                    <th scope="col">Reveals</th>
                    <th scope="col">Keeps hidden</th>
                    <th scope="col">Verifier on Monad</th>
                  </tr>
                </thead>
                <tbody>
                  <ProofRow
                    call="proveExact"
                    reveals="the figure itself"
                    hidden="every other position, and the holder's keys"
                    verifier={V.exact}
                  />
                  <ProofRow
                    call="proveThreshold"
                    reveals="that the position is at or under a cap"
                    hidden="the figure"
                    verifier={V.threshold}
                  />
                  <ProofRow
                    call="proveRange"
                    reveals="that it falls inside a reporting bracket"
                    hidden="the figure"
                    verifier={V.range}
                  />
                  <ProofRow
                    call="proveAggregate"
                    reveals="that total exposure across a named set is under a cap"
                    hidden="every individual position"
                    verifier={V.aggregate}
                  />
                </tbody>
              </table>
            </div>
            <div className="d-pair d-gap">
              <p className="d-note">
                Every answer carries the context hash of a request the auditor registered
                first, and the contract pins{" "}
                <code className="mono">claimHash(kind, cap)</code> before an answer exists — so
                a reader can recompute it from the English on this slide and check that the
                question asked is the question the contract will accept an answer to.
              </p>
              <p className="d-note">
                <strong>The aggregate is the strict one.</strong> Its context hash is a Poseidon
                commitment over the enumerated positions <em>and</em> their active flags, and
                the circuit recomputes that hash — so a holder cannot answer by leaving a
                position out. The report is complete or there is no proof. What the circuit
                cannot check is whether the <em>enumeration</em> was complete; that is a tooling
                job, and slide 14 is where we own up to getting it wrong.
              </p>
            </div>
          </div>
        </div>
      </Slide>

      {/* ── 11 ────────────────────────────────────────────────────────────── */}
      <Slide n={11}>
        <div className="d-grid wide">
          <div>
            <p className="d-eyebrow">05 · The audit record</p>
            <h2 className="d-h long" id="h11">
              The question is registered before the answer exists.
            </h2>
            <div className="scroll">
              <table className="d-table">
                <thead>
                  <tr>
                    <th scope="col">Question the auditor registered</th>
                    <th scope="col">Request block</th>
                    <th scope="col">Answer</th>
                  </tr>
                </thead>
                <tbody>
                  {AUDIT.map((a) => (
                    <tr key={a.req} className={a.ans ? undefined : "open"}>
                      <th scope="row">{a.q}</th>
                      <td className="num mono">{a.req}</td>
                      <td className={a.ans ? "num mono" : "num mono d-open"}>
                        {a.ans ?? "never — no proof exists"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="d-pair d-gap">
              <p className="d-note">
                Five clean answers, <strong>two that can never be given</strong>, and one given
                more narrowly than its words claimed. Every request block precedes its answer
                block, which anyone can check with an RPC endpoint and no access to this repo.
                The auditor is a different key from the issuer.
              </p>
              <p className="d-note">
                Request <span className="mono">52210907</span> asked whether total exposure
                across four positions was at most 1,000. They summed to 1,680, so no proof could
                be produced and the request is still open. Request{" "}
                <span className="mono">52210333</span> has been open just as long.{" "}
                <strong>The register cannot answer falsely; it can only fail to answer</strong>,
                and the failure is on the record permanently.
              </p>
            </div>
          </div>
        </div>
      </Slide>

      {/* ── 12 ────────────────────────────────────────────────────────────── */}
      <Slide n={12}>
        <div className="d-grid">
          <div>
            <p className="d-eyebrow">06 · Build quality</p>
            <h2 className="d-h" id="h12">
              What the tests prove, and what the chain proves.
            </h2>
            <p className="d-sub">
              The Foundry suite runs against a mock verifier returning a settable boolean: it
              proves the <em>contract&rsquo;s logic</em>, not the Groth16 cryptography. The
              chain proves the cryptography instead — every deposit, transfer, withdrawal and
              disclosure in this deck was accepted by a deployed verifier whose key is committed
              in the repo.
            </p>
            <p className="d-note">
              <strong>The sharpest adversarial finding:</strong>{" "}
              <code className="mono">requestAudit</code> pinned <em>who</em> a question was
              about and <em>what kind</em> of answer it took, but not the{" "}
              <strong>figure</strong> — so &ldquo;is this position at most 1,000?&rdquo; was
              answerable with &ldquo;at most 2⁶⁴−1&rdquo;: true, provable, and it closed the
              request with the record reading ANSWERED. The contract now pins a claim hash every
              prover recomputes, and the exploit is kept as a regression test.
            </p>
          </div>

          <div>
            <ul className="d-figs" role="list">
              <Fig k="Foundry tests passing" v="173" gold />
              <Fig k="test suites · 0 failing" v="7" />
              <Fig k="of those, invariant tests" v="9" />
              <Fig k="Circom circuits, Groth16 over BN254" v="7" />
              <Fig k="proving time, client-side" v="610–1,730 ms" small />
            </ul>
            <p className="d-note">
              <code className="mono">cd contracts &amp;&amp; forge test</code> — 173 passed, 0
              failed, 0 skipped. The proving times are the measured spread across the six
              proofs this register has produced, in{" "}
              <code className="mono">audit-log.json</code>.
            </p>
            <p className="d-note">
              Register state, read live at block {READ_BLOCK}:{" "}
              <strong>12 commitments</strong> recorded and{" "}
              <strong>2,315 {sym} backed</strong>, from{" "}
              <code className="mono">allCommitments()</code> and{" "}
              <code className="mono">balanceOf(pool)</code>. It is still being deposited into,
              so read it rather than trusting this line:{" "}
              <code className="mono">node ops/evidence.mjs</code>.
            </p>
          </div>
        </div>
      </Slide>

      {/* ── 13 ────────────────────────────────────────────────────────────── */}
      <Slide n={13}>
        <div className="d-grid">
          <div>
            <p className="d-eyebrow">07 · Scalability</p>
            <h2 className="d-h" id="h13">
              Naming a compile-time constant is half an answer.
            </h2>
            <p className="d-sub">
              <code className="mono">node ops/gas.mjs</code> prices every ceiling with
              Monad&rsquo;s own estimator against proofs this register actually submitted.{" "}
              <code className="mono">verifyProof</code> is a view, so anyone can replay every
              one of them.
            </p>
            <p className="d-sub">
              Five points fit a line to within <strong>1,092 gas</strong>:{" "}
              <strong>a Groth16 verification on Monad costs 940,504 gas plus 31,313 per public
              signal.</strong>
            </p>
            <p className="d-note">
              The cause is directly measurable. <code className="mono">ecPairing</code> marginal
              cost is 172,124 gas per pair here against 34,000 under EIP-1108 — Monad prices the
              BN254 precompiles at about <strong>5.06×</strong> the Ethereum schedule, which is
              the whole gap between the ~264k a disclosure verification measures locally in
              Foundry and what it costs on this chain.
            </p>
          </div>

          <div>
            <div className="scroll">
              <table className="d-table">
                <thead>
                  <tr>
                    <th scope="col">Circuit</th>
                    <th scope="col">Public signals</th>
                    <th scope="col">Gas</th>
                  </tr>
                </thead>
                <tbody>
                  {GAS.map((g) => (
                    <tr key={g.c}>
                      <th scope="row">{g.c}</th>
                      <td className="num mono">{g.n}</td>
                      <td className="num mono">{g.g}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="d-list tight d-gap" role="list">
              <li>
                <strong>Merkle depth is free.</strong> Depth is a private-witness dimension, so
                depth 20 gives 1,048,576 leaves at exactly this price and only proving time
                doubles. Today&rsquo;s 1,024-leaf ceiling is a rebuild, not an economic wall.
              </li>
              <li>
                <strong>The aggregate costs 62,625 gas per extra position</strong> — a
                commitment and its active flag are two signals each — bounding one proof at
                roughly 2,300 positions against a 150M block. That is the real argument for
                recursion over a wider circuit.
              </li>
              <li>
                Ceilings as deployed: <code className="mono">TREE_CAPACITY</code> 1,024 leaves,{" "}
                <code className="mono">DENY_SLOTS</code> 8,{" "}
                <code className="mono">AGG_SLOTS</code> 5. A deposit verifies two proofs, 11
                signals and 3.
              </li>
            </ul>
          </div>
        </div>
      </Slide>

      {/* ── 14 ────────────────────────────────────────────────────────────── */}
      <Slide n={14}>
        <div className="d-grid wide">
          <div>
            <p className="d-eyebrow">08 · Honest limits</p>
            <h2 className="d-h long" id="h14">
              A limit a judge finds is worth less than one we name.
            </h2>
            <ul className="d-list tight d-cols" role="list">
              <li>
                <strong>Entry is public.</strong>{" "}
                <code className="mono">deposit()</code> takes a plaintext amount from a visible
                sender and emits both. The commitment buys confidentiality over a
                position&rsquo;s life, not at its creation.
              </li>
              <li>
                <strong>The exit is gated operationally, not cryptographically.</strong> The
                transfer circuit carries no association-set input and the proof is not bound to{" "}
                <code className="mono">msg.sender</code>, so an eligible party could relay a
                revoked holder&rsquo;s exit. Two tests assert the gap rather than pretend it is
                closed.
              </li>
              <li>
                <strong>This register&rsquo;s amounts are derivable, and that is our bug.</strong>{" "}
                <code className="mono">ops/transfer.mjs</code> split each JoinSplit 37/63 — a
                constant in a public repository — and deposits are plaintext, so every note
                follows from the deposit log. The splitter now draws from the CSPRNG; the notes
                already inserted do not.
              </li>
              <li>
                <strong>We published a wrong aggregate answer.</strong> Block{" "}
                <span className="mono">52245878</span> answered &ldquo;total exposure across all
                3 registered positions&rdquo; while four were live: the enumerator counted
                retirements by what the issuer&rsquo;s ledger could open, which is circular. It
                cannot be retracted, so the correction sits beside the row in{" "}
                <code className="mono">audit-log.json</code> rather than the row being quietly
                re-run.
              </li>
              <li>
                <strong>The aggregate is single-prover</strong> and its circuit is fixed at 5
                slots, while the register now holds six live positions — so an aggregate over
                the whole register no longer fits in one proof. A real concentration cap needs
                multi-party proving; this has none.
              </li>
              <li>
                <strong>Answer authority does not move with a position.</strong> Every
                disclosure circuit takes <code className="mono">(amount, pubKey, blinding)</code>{" "}
                and no private key, so anyone holding a note&rsquo;s opening — including whoever
                built the output — can prove things about it. Spend authority is separable
                today; answer authority is not.
              </li>
              <li>
                <strong>The note root is owner-published.</strong>{" "}
                <code className="mono">merkleUpdate.circom</code> exists and is keyed, but its
                verifier is not wired to <code className="mono">publishNoteRoot</code>. Every
                leaf is emitted, so a wrong root is <em>detectable</em> by any observer — it is
                not prevented.
              </li>
              <li>
                <strong>One trust domain in the setup.</strong> Three contributions and a
                closing beacon, all carrying snarkjs default labels: one operator, one machine.
                If that operator kept the phase-2 randomness, forged proofs are possible and
                undetectable.
              </li>
              <li>
                <strong>Both gates root in one authority.</strong> They diverge in time, not in
                trust — a compromised Cleanverse sandbox defeats both. The pool has a{" "}
                <strong>single-EOA owner</strong>, no timelock and no multisig, who can rotate
                roots and set the auditor.
              </li>
              <li>
                <strong>The ERC-3643 views are written and tested, not deployed.</strong>{" "}
                <code className="mono">isVerified</code>,{" "}
                <code className="mono">canTransfer</code>, the ERC-1066 reason codes, the{" "}
                <code className="mono">TREE_CAPACITY</code> guard and the{" "}
                <code className="mono">subject</code> field on{" "}
                <code className="mono">DisclosureProved</code> all revert, or simply do not
                match, on the live pool. An indexer built from this repo&rsquo;s ABI matches
                zero logs: index on topic0{" "}
                <span className="mono">0x9579a4d2…</span>, not{" "}
                <span className="mono">0x06bd1b30…</span>. Redeploying would reset the two
                permanently open audit requests, whose entire value is that they have been open
                since a named block.
              </li>
              <li>
                <strong>Which commitments are live is public.</strong>{" "}
                <code className="mono">notes.public.json</code> publishes them, so
                set-differencing against <code className="mono">allCommitments()</code> names
                the spent ones. What is hidden is which input became which output, and what any
                of them is worth.
              </li>
              <li>
                <strong>Prior work, declared.</strong> The seven Circom circuits and their
                proving keys are carried over from an earlier public Stellar/Soroban build and
                are committed as the first commit under that description. Everything that makes
                them a Cleanverse product was built inside the 8–9 Aug window. Everything here
                is Monad testnet, on a sandbox shared across hackathon teams.
              </li>
            </ul>
          </div>
        </div>
      </Slide>

      {/* ── 15 ────────────────────────────────────────────────────────────── */}
      <Slide n={15}>
        <div className="d-grid">
          <div>
            <p className="d-eyebrow">09 · Check it yourself</p>
            <h2 className="d-h" id="h15">
              Every claim on this deck has an address behind it.
            </h2>
            <p className="d-sub">
              The console reads the pool and Cleanverse&rsquo;s validator directly from Monad in
              the browser, so what it shows is what the chain will do — not a cached index.
            </p>
            <p className="d-links">
              <Link href="/console" className="btn primary">
                Open the console
              </Link>
              <a
                className="btn ghost"
                href="https://github.com/PugarHuda/saksi"
                target="_blank"
                rel="noreferrer"
              >
                Source
              </a>
            </p>
            <p className="d-note">
              Saksi is a hackathon build on Cleanverse infrastructure. It is not affiliated with
              Cleanverse International Pte Ltd, and nothing here is a security offering. All
              addresses are Monad testnet.
            </p>
          </div>

          <div>
            <ul className="d-figs" role="list">
              <Fig
                k="console"
                v={
                  <a href="https://saksi-gilt.vercel.app" target="_blank" rel="noreferrer">
                    saksi-gilt.vercel.app
                  </a>
                }
                small
              />
              <Fig
                k="repository"
                v={
                  <a href="https://github.com/PugarHuda/saksi" target="_blank" rel="noreferrer">
                    github.com/PugarHuda/saksi
                  </a>
                }
                small
              />
              <Fig k="chain" v={`monad testnet · ${dep.chainId ?? 10143}`} small />
            </ul>
            <p className="d-note d-gap">
              <Addr label="SaksiPool" value={dep.pool} />
              <br />
              <Addr label={`${sym} (the CVA)`} value={dep.asset} />
              <br />
              <Addr label="CVI Compliance Validator" value={dep.validator} />
              <br />
              <Addr label="Auditor key" value={dep.auditor} />
            </p>
            <p className="d-note">
              The two requests that have never been answered, on the explorer:{" "}
              <a className="mono" href={txUrl(UNANSWERED[0])} target="_blank" rel="noreferrer">
                52210333
              </a>{" "}
              and{" "}
              <a className="mono" href={txUrl(UNANSWERED[1])} target="_blank" rel="noreferrer">
                52210907
              </a>
              .
            </p>
            <p className="d-quote d-gap">
              Every position witnessed. Disclosure only when asked.
            </p>
          </div>
        </div>
      </Slide>
    </div>
  );
}

/* ── data the slides state ──────────────────────────────────────────────────
   Blocks below were read from Monad with `eth_getTransactionReceipt` against every
   transaction hash in audit-log.json, not copied out of a document. The questions are the
   `question` field of that file, shortened only where the unit repeats. */

const AUDIT: { q: string; req: number; ans: string | null }[] = [
  { q: "is this position at most 500?", req: 52210266, ans: "52210275 · proved, figure hidden" },
  { q: "is this position inside the 100–400 reporting bracket?", req: 52210333, ans: null },
  { q: "disclose this position in full", req: 52210345, ans: "52210355 · 459.9" },
  { q: "is this position inside the 400–500 reporting bracket?", req: 52210670, ans: "52210679 · proved, figure hidden" },
  { q: "is total exposure across all 4 registered positions at most 2,000?", req: 52210870, ans: "52210883 · proved, no position disclosed" },
  { q: "is total exposure across all 4 registered positions at most 1,000?", req: 52210907, ans: null },
  { q: "is the separately-keyed position at most 600?", req: 52244758, ans: "52244768 · proved, figure hidden" },
  { q: "is total exposure across all 3 registered positions at most 2,000?", req: 52245857, ans: "52245878 · answered, then corrected — slide 14" },
];

/** The two request transactions that have never been answered. */
const UNANSWERED = [
  "0x67143a69e5aedca0cdfff68c0a9388ccbf8f0ba4d58df09fdda0676fc7d08f4f",
  "0x13e6655bd6f10555ec906e62195a6df46982c93e55cbe2ac3f882caea2cca06c",
] as const;

/** `node ops/gas.mjs`, re-run against the deployed verifiers. Every proof priced is one this
 *  register submitted, and every figure is `eth_estimateGas` — Monad charges the gas limit
 *  you submit and reports it back as `gasUsed`, so receipts are useless here. */
const GAS = [
  { c: "threshold", n: 3, g: "1,034,215" },
  { c: "exact", n: 3, g: "1,034,228" },
  { c: "range", n: 4, g: "1,065,516" },
  { c: "transfer (JoinSplit)", n: 7, g: "1,160,784" },
  { c: "aggregate", n: 13, g: "1,347,154" },
];

/* ── pieces ─────────────────────────────────────────────────────────────── */

/** One slide, one viewport, and its own navigation rendered on the server. The rail is a
 *  pair of ordinary anchors so the deck is fully navigable — by click, by Tab, by Enter —
 *  before any JavaScript loads or if none ever does. */
function Slide({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <section className="d-slide" id={String(n)} aria-labelledby={`h${n}`}>
      <div className="d-body">{children}</div>
      <nav className="d-rail" aria-label={`Slide ${n} of ${TOTAL}`}>
        {n > 1 ? (
          <a href={`#${n - 1}`}>&lsaquo; Previous</a>
        ) : (
          <span className="off" aria-hidden="true">
            &lsaquo; Previous
          </span>
        )}
        <span className="d-count mono">
          {n} / {TOTAL}
        </span>
        {n < TOTAL ? (
          <a href={`#${n + 1}`}>Next &rsaquo;</a>
        ) : (
          <span className="off" aria-hidden="true">
            Next &rsaquo;
          </span>
        )}
      </nav>
    </section>
  );
}

function Fig({
  k,
  v,
  small,
  gold,
}: {
  k: string;
  v: React.ReactNode;
  small?: boolean;
  gold?: boolean;
}) {
  return (
    <li>
      <span className="k">{k}</span>
      <span className={`v mono${small ? " small" : ""}${gold ? " gold" : ""}`}>{v}</span>
    </li>
  );
}

/** A full address, never shortened: this page is printed to PDF, and a truncated hash on
 *  paper is decoration rather than something a reader can check. */
function Addr({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <span className="d-addr">
      {label} —{" "}
      <a className="mono" href={addrUrl(value)} target="_blank" rel="noreferrer">
        {value}
      </a>
    </span>
  );
}

function ProofRow({
  call,
  reveals,
  hidden,
  verifier,
}: {
  call: string;
  reveals: string;
  hidden: string;
  verifier?: string;
}) {
  return (
    <tr>
      <th scope="row" className="mono">
        {call}
      </th>
      <td>{reveals}</td>
      <td className="d-hid">{hidden}</td>
      <td className="d-addr">
        {verifier ? (
          <a className="mono" href={addrUrl(verifier)} target="_blank" rel="noreferrer">
            {verifier}
          </a>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
