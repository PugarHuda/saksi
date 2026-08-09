"use client";

import { short } from "@/lib/chain";
import type { AuditEntry, Deployment, Position } from "@/lib/types";
import { Badge, Empty, Tx } from "./bits";

const KIND_COPY: Record<AuditEntry["kind"], { title: string; reveals: string; hides: string }> = {
  exact: {
    title: "Exact",
    reveals: "the figure itself",
    hides: "every other position, and the holder's keys",
  },
  threshold: {
    title: "Threshold",
    reveals: "that the position is at or under a cap",
    hides: "the figure",
  },
  range: {
    title: "Range",
    reveals: "that the position falls inside a reporting bracket",
    hides: "the figure",
  },
  aggregate: {
    title: "Aggregate",
    reveals: "that total exposure across a named set is under a cap",
    hides: "every individual position in the set",
  },
};

export default function RegulatorView({
  deployment,
  audit,
  positions,
}: {
  deployment: Deployment;
  audit: AuditEntry[];
  positions: Position[];
}) {
  const answered = audit.filter((a) => a.verified);

  return (
    <div className="grid">
      <section className="card">
        <h2>How an answer is bound to its question</h2>
        <p className="note" style={{ marginBottom: 0 }}>
          The auditor registers the question on chain first, and the proof carries that
          request&apos;s context hash as a public signal. So an answer cannot be produced for a
          question nobody asked, and an answer to one question cannot be presented as the answer
          to another. Once answered, the request closes — the record is the answer.
        </p>
      </section>

      <section className="grid three">
        <div className="card">
          <h2>Questions asked</h2>
          <p className="stat mono">{audit.length}</p>
        </div>
        <div className="card">
          <h2>Answered on chain</h2>
          <p className="stat mono" style={{ color: "var(--verified)" }}>
            {answered.length}
          </p>
        </div>
        <div className="card">
          <h2>Positions disclosed</h2>
          <p className="stat mono">
            {audit.filter((a) => a.kind === "exact").length}
            <span style={{ fontSize: 15, color: "var(--muted)" }}> / {positions.length}</span>
          </p>
          <p className="note" style={{ margin: "8px 0 0" }}>
            Only the exact disclosures reveal a figure. The rest answered without one.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Audit trail</h2>
        <p className="note">
          Each line is checkable: open the request transaction to see the question being
          registered, then the verification transaction to see this contract accept the proof.
        </p>

        {audit.length === 0 ? (
          <Empty>
            No audit requests yet. Run <code className="mono">node ops/audit.mjs threshold 500</code>.
          </Empty>
        ) : (
          <div className="grid" style={{ gap: 12 }}>
            {audit
              .slice()
              .reverse()
              .map((a) => {
                const copy = KIND_COPY[a.kind];
                return (
                  <article
                    key={a.contextHash}
                    className="card"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        flexWrap: "wrap",
                        marginBottom: 8,
                      }}
                    >
                      <Badge tone={a.verified ? "ok" : "warn"}>
                        {a.verified ? "Verified on chain" : "Open — no proof exists"}
                      </Badge>
                      <strong style={{ fontSize: 14 }}>{copy.title} disclosure</strong>
                      <span className="note" style={{ display: "inline", marginLeft: "auto" }}>
                        proved in {a.proveMs} ms
                      </span>
                    </div>

                    <p style={{ margin: "0 0 4px" }}>
                      <span style={{ color: "var(--muted)" }}>Question — </span>
                      {a.question}
                    </p>
                    <p style={{ margin: "0 0 10px" }}>
                      <span style={{ color: "var(--muted)" }}>Answer — </span>
                      {a.answer}
                    </p>

                    <dl className="kv">
                      <dt>Reveals</dt>
                      <dd>{copy.reveals}</dd>
                      <dt>Keeps hidden</dt>
                      <dd style={{ color: "var(--shielded)" }}>{copy.hides}</dd>
                      <dt>Circuit</dt>
                      <dd className="mono">{a.circuit}</dd>
                      <dt>Context</dt>
                      <dd className="mono" style={{ fontSize: 12 }}>
                        {short(a.contextHash, 14, 10)}
                      </dd>
                      <dt>Request</dt>
                      <dd>
                        <Tx hash={a.requestTx} />
                      </dd>
                      <dt>Verification</dt>
                      <dd>
                        <Tx hash={a.verifyTx} />
                      </dd>
                    </dl>
                  </article>
                );
              })}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Export</h2>
        <p className="note">
          The audit pack is the deliverable: every question, the proof that answered it, and the
          transaction a regulator can check it against. It contains questions and proofs — no
          keys, and no note openings.
        </p>
        <a
          className="btn"
          href="/data/audit-log.json"
          download="saksi-audit-pack.json"
          style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
        >
          Download audit pack
        </a>
        {deployment.pool && (
          <p className="note" style={{ margin: "12px 0 0" }}>
            Verify independently against the pool at{" "}
            <code className="mono">{deployment.pool}</code> on Monad testnet.
          </p>
        )}
      </section>
    </div>
  );
}
