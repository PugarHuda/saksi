import Link from "next/link";
import { read } from "@/lib/snapshot";
import { addrUrl } from "@/lib/chain";
import type { AuditEntry, Deployment, Measurement, Position } from "@/lib/types";

const DESCRIPTION =
  "Compliant assets have tiny holder sets, so pseudonymity protects nobody. Saksi shields " +
  "the positions and keeps entry, exit and audit answerable — on Cleanverse CVI and CVA.";

export const metadata = {
  title: "Saksi — a confidential holder register for tokenized assets",
  description: DESCRIPTION,
  metadataBase: new URL("https://saksi-gilt.vercel.app"),
  // A submission that travels as a pasted link renders as a bare grey card without these.
  openGraph: {
    title: "Saksi — a confidential holder register",
    description: DESCRIPTION,
    url: "https://saksi-gilt.vercel.app",
    siteName: "Saksi",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Saksi — a confidential holder register",
    description: DESCRIPTION,
  },
};

export default function Landing() {
  const dep = read<Deployment>("deployment.json", {});
  const audit = read<AuditEntry[]>("audit-log.json", []);
  const positions = read<Position[]>("notes.json", []);
  const m = read<Measurement | null>("measurement.json", null);

  // The one request nobody could answer. It is the strongest thing on this page, so it is
  // read from the evidence file rather than written into the copy — if a future run ever
  // answers it, this section disappears instead of quietly becoming a lie.
  const unanswered = audit.find((a) => !a.verified);

  // The visual is not decoration and not stock art: it is the register's own commitments,
  // tiled into a field. This is what the chain actually shows an observer — the positions
  // are there, they are counted, and not one of them is readable.
  const cipher = (() => {
    const src = positions.map((p) => p.commitment.replace(/^0x/, "")).join("");
    if (!src) return "";
    const COLS = 46;
    const ROWS = 26;
    const rows: string[] = [];
    for (let r = 0; r < ROWS; r++) {
      let line = "";
      for (let c = 0; c < COLS; c++) {
        const i = (r * COLS + c) % src.length;
        // Thin it towards the edges so the field reads as a mass rather than a wall.
        const dx = (c - COLS / 2) / (COLS / 2);
        const dy = (r - ROWS / 2) / (ROWS / 2);
        const edge = Math.sqrt(dx * dx + dy * dy);
        line += edge > 0.92 ? " " : edge > 0.66 && (i % 3 === 0) ? " " : src[i];
      }
      rows.push(line);
    }
    return rows.join("\n");
  })();

  return (
    <div className="land">
      <section className="split">
        {/* LEFT — the claim, on a clean ground. */}
        <div className="split-panel">
          <div className="split-head">
            <Link href="/" className="wordmark" aria-label="Saksi, home">
              <SaksiMark />
              <strong>Saksi</strong>
            </Link>
            <span className="split-chain mono">monad · 10143</span>
          </div>

          <div className="split-body">
            <span className="dots" aria-hidden="true">
              <i /><i /><i />
            </span>
            {/* One noun phrase, cut by its own italic. "Keeps" carries both senses — the
                register maintains its positions and it keeps them to itself. */}
            {/* .cap is a block, and so is the em — the <br>s that used to separate them
                added an empty line box between "that keeps" and "ITS POSITIONS", and left
                the tracking correction in .cap unapplied because nothing carried the class. */}
            <h1 className="display">
              <span className="cap">THE HOLDER REGISTER</span>
              <em>that keeps</em>
              <span className="cap">ITS POSITIONS</span>
            </h1>
            <p className="display-sub">
              A confidential holder register for tokenized real-world assets. Entry is gated
              by Cleanverse, the middle is shielded, and a regulator still gets an answer.
            </p>
            <Link href="/console" className="btn slab">
              CHECK A WALLET
            </Link>
          </div>

          <div className="split-foot">
            <span className="strip-label">BUILT ON</span>
            <ul className="strip" role="list">
              <li>Cleanverse CVI</li>
              <li>CVA</li>
              <li>Monad</li>
              <li>Groth16</li>
              <li>Circom</li>
            </ul>
          </div>
        </div>

        {/* RIGHT — the register itself, rendered as what an observer actually sees. */}
        <div className="split-visual">
          <nav className="visual-nav" aria-label="Primary">
            <Link href="/console">Console</Link>
            <a href="https://github.com/PugarHuda/saksi#readme" target="_blank" rel="noreferrer">
              How it works
            </a>
            <a href="https://github.com/PugarHuda/saksi" target="_blank" rel="noreferrer">
              Source
            </a>
          </nav>

          <pre className="cipher mono" aria-hidden="true">{cipher}</pre>
          <p className="sr-only">
            A field of the register&rsquo;s own commitment hashes, unreadable by design.
          </p>

          {unanswered && (
            <aside className="visual-card">
              <span className="dots gold" aria-hidden="true">
                <i /><i /><i />
              </span>
              <h2>A QUESTION WITH NO ANSWER</h2>
              <p>
                The auditor asked it on-chain. No proof exists, so it stays open — permanently,
                and in public.
              </p>
              <p className="mono card-q">&ldquo;{unanswered.question}&rdquo;</p>
            </aside>
          )}
        </div>
      </section>

      <main>
        {m && (
          <section className="band" aria-labelledby="measured">
            <h2 id="measured">The problem, measured</h2>
            <p className="lede">
              The usual reply is that a public chain is pseudonymous, so an open register
              costs nothing. We ran a census instead of assuming: every wallet holding an
              active A-Pass, against every A-Token on this chain.
            </p>

            <ul className="stats" role="list">
              <Stat n={m.medianHolders} label="median holders per asset" />
              <Stat n={`${m.assetsUnderFiveHolders}/${m.assetsWithHolders}`} label="assets with fewer than five holders" />
              <Stat n={m.singleHolderAssets} label="assets held by exactly one wallet" />
              <Stat n={m.assetsWithDominantHolder} label="assets where one wallet holds 90%+" />
            </ul>

            <p className="reads">
              An anonymity set of {m.medianHolders} is not anonymity. Know the asset, watch
              one transfer, and you have identified the position and its size.
            </p>
            <p className="note">
              {m.walletsEnumerated} credentialed wallets enumerated{" "}
              {m.measuredAt ? `on ${m.measuredAt.slice(0, 10)}` : ""}. The census can miss a
              holder but never invent one, so each figure is a floor — the real registers
              are at least this exposed.
            </p>
          </section>
        )}

        <section className="band" aria-labelledby="tension">
          <h2 id="tension">Why this does not fix itself</h2>
          <p className="lede">
            It is not a quiet-testnet artefact, it is the mechanism.{" "}
            <strong>
              The tighter an asset&rsquo;s holder rule, the smaller the crowd its holders
              hide in.
            </strong>{" "}
            Eligibility restricts the population by design, so every compliant-asset design
            makes each remaining holder more exposed, not less.
          </p>
          <p className="lede">
            The obvious fix — a privacy pool — destroys what made the asset legitimate. The
            issuer can no longer prove who holds what, cannot enforce a concentration cap,
            and cannot find a holder whose credential was revoked. Saksi refuses the
            trade-off rather than picking a side of it:{" "}
            <strong>private in the middle, accountable at both edges.</strong>
          </p>
        </section>

        <section className="band" aria-labelledby="actors">
          <h2 id="actors">Three people, one register</h2>
          <p className="lede">
            Every screen in the console belongs to one of them. The point of the design is
            that what each can see is different, and none of them has to trust the others.
          </p>

          <div className="actors">
            <Actor
              role="Holder"
              does="Deposits into the register and later moves or exits the position."
              sees="Their own figure, and nothing about anyone else's."
              hidden="Their balance, from every other holder and from the public."
            />
            <Actor
              role="Issuer"
              does="Builds the association set from live Cleanverse credentials and anchors its root on-chain."
              sees="Who is eligible, how many positions exist, and the total the register backs."
              hidden="Which position belongs to which holder, and every individual figure."
            />
            <Actor
              role="Regulator"
              does="Registers a question on-chain, then waits for a proof that answers exactly it."
              sees="Only the answer to the question they asked — and the fact they asked first."
              hidden="Everything they did not ask about."
            />
          </div>
        </section>

        <section className="band" aria-labelledby="gates">
          <h2 id="gates">Entry is gated twice</h2>
          <div className="pair">
            <div className="card">
              <h3>Gate one is not ours</h3>
              <p>
                The pool is registered with Cleanverse&rsquo;s own CVI Compliance Validator,
                and <code className="mono">deposit()</code> calls{" "}
                <code className="mono">complianceVerify(pool, msg.sender)</code> on their
                contract, live, in the transaction that moves the value. A credential frozen
                one block ago fails here.
              </p>
            </div>
            <div className="card">
              <h3>Gate two is a proof</h3>
              <p>
                The depositor proves in zero knowledge that their key is a leaf in the
                association set the issuer anchored, and is absent from the sanctions list.
                The proof is pinned to the sender and to the exact commitment, so it is
                useless from another wallet.
              </p>
            </div>
          </div>
          <p className="note">
            The difference between the two is <em>time</em>. Holding a live credential is not
            membership of the set the issuer anchored, and neither gate subsumes the other —
            which is why both are there.
          </p>
        </section>

        {unanswered && (
          <section className="band" aria-labelledby="refusal">
            <h2 id="refusal">The strongest evidence is a refusal</h2>
            <p className="lede">
              A register that can be made to say anything proves nothing. Every audit answer
              here is bound to a request the regulator posted on-chain{" "}
              <em>before the answer existed</em>. One of those requests has never been
              answered, and cannot be:
            </p>
            <blockquote className="refusal">
              <p className="q">&ldquo;{unanswered.question}&rdquo;</p>
              <p className="a mono">{unanswered.answer}</p>
            </blockquote>
            <p className="reads">
              The claim was false, so no proof exists. The register cannot answer falsely —
              it can only fail to answer.
            </p>
          </section>
        )}

        <section className="band" aria-labelledby="live">
          <h2 id="live">Live on Monad testnet</h2>
          <dl className="deployed">
            <Row label="Pool" value={dep.pool} explorer />
            <Row label={`Asset (${dep.assetSymbol ?? "CVA"})`} value={dep.asset} explorer />
            <Row label="Cleanverse CVI Validator" value={dep.validator} explorer />
            <Row label="Association set" value={`${dep.aspAdmitted ?? "—"} members admitted`} />
            {/* Not "shielded positions": the console reads commitmentCount() live, which
                counts JoinSplit outputs too, so the same label carried two numbers. */}
            <Row label="Entries recorded" value={`${positions.length}`} />
          </dl>
          <p className="cta">
            <Link href="/console" className="btn primary">
              Open the console
            </Link>
          </p>
        </section>
      </main>

      <footer className="foot">
        <p style={{ margin: "0 0 6px" }}>
          Saksi is a hackathon build on Cleanverse infrastructure. It is not affiliated with
          Cleanverse International Pte Ltd, and nothing here is a security offering. All
          addresses are Monad testnet.
        </p>
        <p style={{ margin: 0 }}>
          Zero-knowledge core ported from an earlier public Stellar build; the Cleanverse
          integration, the pool, and the consoles were built during the window.
        </p>
      </footer>
    </div>
  );
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <li className="stat-big">
      <span className="n mono">{n}</span>
      <span className="l">{label}</span>
    </li>
  );
}

function Actor({
  role,
  does,
  sees,
  hidden,
}: {
  role: string;
  does: string;
  sees: string;
  hidden: string;
}) {
  return (
    <article className="actor card">
      <h3>{role}</h3>
      <dl>
        <dt>Does</dt>
        <dd>{does}</dd>
        <dt>Sees</dt>
        <dd>{sees}</dd>
        <dt>Stays hidden</dt>
        <dd className="hid">{hidden}</dd>
      </dl>
    </article>
  );
}

function Row({ label, value, explorer }: { label: string; value?: string; explorer?: boolean }) {
  if (!value) return null;
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd className="mono">
        {explorer ? (
          <a href={addrUrl(value)} target="_blank" rel="noreferrer">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function SaksiMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 512 512" role="img" aria-label="Saksi">
      <rect width="512" height="512" rx="112" fill="#0B0F1A" />
      <path d="M124 256 Q 256 84 388 256" fill="none" stroke="#E9B949" strokeWidth="24" strokeLinecap="round" />
      <path
        d="M124 256 Q 256 428 388 256"
        fill="none"
        stroke="#E9B949"
        strokeWidth="24"
        strokeLinecap="round"
        strokeDasharray="1 39"
        opacity="0.6"
      />
      <circle cx="256" cy="256" r="46" fill="#E9B949" />
    </svg>
  );
}
