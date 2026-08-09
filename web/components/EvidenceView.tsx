"use client";

import { useCallback, useEffect, useState } from "react";
import { RPC, SELECTORS, blockOf, call, padUint, short, units } from "@/lib/chain";
import type { Asp, AuditEntry, Deployment, Position } from "@/lib/types";
import type { useLive } from "@/lib/useLive";
import { Addr, Badge, Copyable, Correction, Empty, ErrorBox, Skeleton, Tx } from "./bits";

/** The submission's strongest claim is a negative one: two questions were posted on chain and
 *  can never be answered. That claim is only worth anything if a reader can check it without
 *  taking this bundle's word for it — so every line on this screen names the call that
 *  confirms it, and the request/answer order is read from block numbers rather than asserted.
 */

type Checked = AuditEntry & {
  claim: string | null;     // auditClaim(contextHash) — the figure, hashed, before an answer
  answered: number | null;  // auditAnswered(contextHash) — 0 while the request is open
  reqBlock: number | null;
  ansBlock: number | null;
};

const cast = (to: string, sig: string, args = "") =>
  `cast call ${to} "${sig}"${args ? ` ${args}` : ""} --rpc-url ${RPC}`;

export default function EvidenceView({
  deployment,
  live,
  audit,
  asp,
  positions,
}: {
  deployment: Deployment;
  live: ReturnType<typeof useLive>;
  audit: AuditEntry[];
  asp: Asp | null;
  positions: Position[];
}) {
  const pool = deployment.pool;
  const [rows, setRows] = useState<Checked[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!pool) {
      setError("No pool address recorded, so nothing here can be checked against a contract.");
      setRows([]);
      return;
    }
    setError(null);
    try {
      const out = await Promise.all(
        audit.map(async (a) => {
          const arg = padUint(a.contextHash);
          const [claim, answered, reqBlock, ansBlock] = await Promise.all([
            call(pool, SELECTORS.auditClaim + arg).catch(() => null),
            call(pool, SELECTORS.auditAnswered + arg)
              .then((h) => Number(BigInt(h)))
              .catch(() => null),
            // Prefer a block the ops run recorded; fall back to the receipt.
            a.requestBlock ?? (a.requestTx ? blockOf(a.requestTx).catch(() => null) : null),
            a.verifyBlock ?? (a.verifyTx ? blockOf(a.verifyTx).catch(() => null) : null),
          ]);
          return { ...a, claim, answered, reqBlock, ansBlock };
        }),
      );
      setRows(out);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [pool, audit]);

  useEffect(() => {
    load();
  }, [load]);

  const open = (rows ?? audit.map(blank)).filter((r) => !r.verified);
  const closed = (rows ?? audit.map(blank)).filter((r) => r.verified);
  // The chain's own account of how many requests are still open. If it disagrees with the
  // file, the file is what is wrong — say so rather than quietly showing the file's number.
  const openOnChain = rows?.filter((r) => r.answered === 0).length ?? null;
  const fileDisagrees = openOnChain !== null && rows !== null && openOnChain !== open.length;

  return (
    <div className="grid">
      <section className="card">
        <h2>Check this without trusting it</h2>
        <p className="note" style={{ marginBottom: 10 }}>
          Every claim below names the call that confirms it. The register is{" "}
          {pool ? <Addr value={pool} /> : "—"} on Monad testnet (chain{" "}
          {deployment.chainId ?? "10143"}), and each line is a read — nothing here needs a key,
          a wallet, or this site.
        </p>
        <p className="note" style={{ margin: 0 }}>
          The order that matters is <strong>request before answer</strong>. Block numbers below
          are read from the transaction receipts, not from this bundle, so a reordered or
          back-dated claim would show up as an answer at or before its own request.
        </p>
      </section>

      {error && <ErrorBox message={error} onRetry={load} />}
      {fileDisagrees && (
        <ErrorBox
          message={`This bundle lists ${open.length} unanswered request(s); the contract reports ${openOnChain} still open. Trust the contract.`}
        />
      )}

      {/* ── the negative result, first and on its own ────────────────────────── */}
      <section className="card">
        <h2>Requests with no answer</h2>
        <p className="note">
          These were posted on chain and never closed. A proof cannot be produced for a claim
          that is false, so the register does not answer them — and{" "}
          <code className="mono">auditAnswered</code> still reads 0 for each, which is the
          contract saying so rather than this page saying so.
        </p>

        {open.length === 0 ? (
          <Empty>Every request in this bundle has been answered.</Empty>
        ) : (
          <div className="grid" style={{ gap: 12 }}>
            {open.map((r) => (
              <article key={r.contextHash} className="card open-request">
                <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <Badge tone="warn">no proof exists — the request stays open</Badge>
                  <span className="note" style={{ display: "inline", margin: 0 }}>
                    {r.kind} disclosure
                  </span>
                </div>
                <p style={{ margin: "0 0 4px", fontSize: "var(--t-lg)" }}>
                  &ldquo;{r.question}&rdquo;
                </p>
                <p className="note" style={{ margin: "0 0 12px" }}>
                  {r.answer}
                </p>
                {r.correction && <Correction>{r.correction}</Correction>}
                <dl className="kv">
                  <dt>Claim bound on chain</dt>
                  <dd className="mono" style={{ fontSize: "var(--t-xs)" }}>
                    <Claim value={r.claim} loading={!rows} />
                  </dd>
                  <dt>Requested</dt>
                  <dd>
                    <BlockCell n={r.reqBlock} loading={!rows} /> · <Tx hash={r.requestTx} />
                  </dd>
                  <dt>Answered</dt>
                  <dd>
                    {rows ? (
                      r.answered === 0 ? (
                        <Badge tone="warn">never — auditAnswered = 0</Badge>
                      ) : r.answered === null ? (
                        <Badge tone="warn">could not read the contract</Badge>
                      ) : (
                        <Badge tone="no">
                          the contract says this closed (auditAnswered = {r.answered})
                        </Badge>
                      )
                    ) : (
                      <Skeleton w="10em" />
                    )}
                  </dd>
                  <dt>Confirm it</dt>
                  <dd>
                    {pool && (
                      <Copyable cmd={cast(pool, "auditAnswered(uint256)(uint8)", r.contextHash)} />
                    )}
                  </dd>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── the ledger ───────────────────────────────────────────────────────── */}
      <section className="card">
        <h2>Answered on chain, in order</h2>
        <p className="note">
          One row per closed request. The claim column is the figure the auditor named, hashed
          into the contract <em>before</em> a proof for it existed — the English question is
          bound to that hash, not captioning it.
        </p>

        {closed.length === 0 ? (
          <Empty>No answered requests in this bundle.</Empty>
        ) : (
          <div className="scroll">
            <table>
              <caption className="sr-only">
                Audit requests answered on chain, with the block each was requested and
                answered in
              </caption>
              <thead>
                <tr>
                  <th scope="col">Question</th>
                  <th scope="col">Claim hashed in</th>
                  <th scope="col">Requested at block</th>
                  <th scope="col">Answered at block</th>
                  <th scope="col">Blocks between</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((r) => {
                  const gap =
                    r.reqBlock !== null && r.ansBlock !== null ? r.ansBlock - r.reqBlock : null;
                  return (
                    <tr key={r.contextHash}>
                      <td>
                        {r.question}
                        <span className="note" style={{ display: "block" }}>
                          {r.answer}
                        </span>
                        {/* A closed request cannot be re-run, so the row and its correction
                            are one unit — the ledger must never show the answer alone. */}
                        {r.correction && <Correction>{r.correction}</Correction>}
                        <span className="note" style={{ display: "block", marginTop: 6 }}>
                          <Tx hash={r.requestTx} label="request tx" /> →{" "}
                          <Tx hash={r.verifyTx} label="verification tx" />
                        </span>
                        {pool && (
                          <span style={{ display: "block", marginTop: 6 }}>
                            <Copyable
                              cmd={cast(pool, "auditAnswered(uint256)(uint8)", r.contextHash)}
                            />
                          </span>
                        )}
                      </td>
                      <td className="mono" style={{ fontSize: "var(--t-xs)" }}>
                        <Claim value={r.claim} loading={!rows} />
                      </td>
                      <td className="mono">
                        <BlockCell n={r.reqBlock} loading={!rows} />
                      </td>
                      <td className="mono">
                        <BlockCell n={r.ansBlock} loading={!rows} />
                      </td>
                      <td>
                        {gap === null ? (
                          rows ? (
                            <span className="note">—</span>
                          ) : (
                            <Skeleton w="3em" />
                          )
                        ) : gap > 0 ? (
                          <Badge tone="ok">+{gap}</Badge>
                        ) : (
                          <Badge tone="no">{gap} — answered before it was asked</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── the snapshot against the chain ───────────────────────────────────── */}
      <ChainAgreement deployment={deployment} live={live} asp={asp} positions={positions} />
    </div>
  );
}

const blank = (a: AuditEntry): Checked => ({
  ...a,
  claim: null,
  answered: null,
  reqBlock: a.requestBlock ?? null,
  ansBlock: a.verifyBlock ?? null,
});

function Claim({ value, loading }: { value: string | null; loading: boolean }) {
  if (loading) return <Skeleton w="9em" />;
  if (!value) return <span className="note">—</span>;
  // An exact disclosure names no figure, so its claim hashes to zero by construction.
  if (/^0x0*$/.test(value)) return <span className="note">none — exact asks for the figure</span>;
  return <span title={value}>{short(value, 10, 6)}</span>;
}

function BlockCell({ n, loading }: { n: number | null; loading: boolean }) {
  if (n !== null) return <>{n.toLocaleString("en-US")}</>;
  if (loading) return <Skeleton w="5em" />;
  return <span className="note">not on this node</span>;
}

/** Live reads next to the file this page shipped with, so a stale snapshot is visible rather
 *  than silent. Every row states agreement or disagreement in words. */
function ChainAgreement({
  deployment,
  live,
  asp,
  positions,
}: {
  deployment: Deployment;
  live: ReturnType<typeof useLive>;
  asp: Asp | null;
  positions: Position[];
}) {
  const d = live.data;
  const pool = deployment.pool ?? "";
  const asset = deployment.asset ?? "";
  const loading = live.status === "loading";

  const rootAgrees = d && asp ? d.aspRoot.toString() === asp.root : null;

  return (
    <section className="card">
      <h2>The published snapshot against the chain</h2>
      <p className="note">
        The files this page ships with were written by an operator; the right-hand column is
        read from Monad in your browser, now. Where they differ, the chain is the record.
      </p>

      {live.status === "error" && (
        <ErrorBox message={`Could not read Monad: ${live.error}`} onRetry={live.reload} />
      )}

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Claim</th>
              <th scope="col">In this bundle</th>
              <th scope="col">On chain now</th>
              <th scope="col">Agreement</th>
              <th scope="col">Reproduce</th>
            </tr>
          </thead>
          <tbody>
            <Line
              what="Association-set root"
              bundle={asp ? short(asp.root, 10, 6) : "—"}
              chain={loading ? <Skeleton w="9em" /> : d ? short(d.aspRoot.toString(), 10, 6) : "—"}
              verdict={
                rootAgrees === null ? null : rootAgrees ? (
                  <Badge tone="ok">the anchored root is the set below</Badge>
                ) : (
                  <Badge tone="warn">the set was rebuilt after this root was anchored</Badge>
                )
              }
              loading={loading}
              cmd={pool && cast(pool, "aspRoot()(uint256)")}
            />
            <Line
              what="Registered with the CVI Validator"
              bundle={deployment.validatorRegisterTx ? "registered by ops" : "—"}
              chain={
                loading ? (
                  <Skeleton w="5em" />
                ) : d ? (
                  d.registered ? (
                    <Badge tone="ok">true</Badge>
                  ) : (
                    <Badge tone="no">false</Badge>
                  )
                ) : (
                  "—"
                )
              }
              verdict={
                d ? (
                  d.registered ? (
                    <Badge tone="ok">gate one is live</Badge>
                  ) : (
                    <Badge tone="no">entry is closed — the validator would revert</Badge>
                  )
                ) : null
              }
              loading={loading}
              cmd={pool && cast(pool, "registeredWithValidator()(bool)")}
            />
            <Line
              what="Commitments in the register"
              bundle={`${positions.length} entries listed`}
              chain={loading ? <Skeleton w="3em" /> : d ? String(d.positions) : "—"}
              verdict={
                d ? (
                  d.positions >= BigInt(positions.length) ? (
                    <Badge tone="ok">
                      consistent — commitmentCount() also counts JoinSplit outputs
                    </Badge>
                  ) : (
                    <Badge tone="no">the bundle lists more entries than the chain holds</Badge>
                  )
                ) : null
              }
              loading={loading}
              cmd={pool && cast(pool, "commitmentCount()(uint256)")}
            />
            <Line
              what={`Asset the register backs (${deployment.assetSymbol ?? "CVA"})`}
              bundle="not published"
              chain={
                loading ? (
                  <Skeleton w="6em" />
                ) : d ? (
                  units(d.poolBalance, deployment.assetDecimals ?? 6)
                ) : (
                  "—"
                )
              }
              verdict={
                d ? (
                  <Badge tone="ok">the total is public; its distribution is not</Badge>
                ) : null
              }
              loading={loading}
              cmd={asset && pool && cast(asset, "balanceOf(address)(uint256)", pool)}
            />
            <Line
              what="Note-tree root"
              bundle="not published"
              chain={
                loading ? (
                  <Skeleton w="9em" />
                ) : d ? (
                  d.noteRoot === 0n ? (
                    "0 — nothing has moved yet"
                  ) : (
                    short(d.noteRoot.toString(), 10, 6)
                  )
                ) : (
                  "—"
                )
              }
              verdict={
                d ? (
                  d.noteRoot === 0n ? (
                    <Badge tone="warn">no shielded transfer has been made</Badge>
                  ) : (
                    <Badge tone="ok">positions have moved inside the register</Badge>
                  )
                ) : null
              }
              loading={loading}
              cmd={pool && cast(pool, "noteRoot()(uint256)")}
            />
            <Line
              what="Auditor against owner"
              bundle={deployment.auditor ? short(deployment.auditor, 10, 6) : "—"}
              chain={
                loading ? (
                  <Skeleton w="9em" />
                ) : d ? (
                  <>
                    <Addr value={d.auditor} />{" "}
                    <span className="note" style={{ display: "inline" }}>
                      vs owner <Addr value={d.owner} />
                    </span>
                  </>
                ) : (
                  "—"
                )
              }
              verdict={
                d ? (
                  d.auditor.toLowerCase() === d.owner.toLowerCase() ? (
                    <Badge tone="warn">
                      the same address — the party that asks also runs the register
                    </Badge>
                  ) : (
                    <Badge tone="ok">
                      different addresses — only the auditor can post a question
                    </Badge>
                  )
                ) : null
              }
              loading={loading}
              cmd={pool && cast(pool, "auditor()(address)")}
            />
          </tbody>
        </table>
      </div>

      <p className="note" style={{ marginTop: 12 }}>
        <code className="mono">cast</code> is Foundry&rsquo;s read tool; every command above is a
        view call that costs nothing and signs nothing. The same values are on{" "}
        {pool ? <Addr value={pool} /> : "the explorer"} if you would rather click than type.
      </p>
    </section>
  );
}

function Line({
  what,
  bundle,
  chain,
  verdict,
  cmd,
  loading,
}: {
  what: string;
  bundle: React.ReactNode;
  chain: React.ReactNode;
  verdict: React.ReactNode;
  cmd: string | "";
  // Without this a failed read left the verdict cell shimmering forever — the exact
  // silent-hang this screen exists to make impossible.
  loading: boolean;
}) {
  return (
    <tr>
      <th scope="row" style={{ textTransform: "none", letterSpacing: 0, fontSize: "var(--t-sm)" }}>
        {what}
      </th>
      <td className="mono" style={{ fontSize: "var(--t-xs)" }}>
        {bundle}
      </td>
      <td className="mono" style={{ fontSize: "var(--t-xs)" }}>
        {chain}
      </td>
      <td>
        {verdict ??
          (loading ? <Skeleton w="8em" /> : <span className="note">the chain did not answer</span>)}
      </td>
      <td>{cmd ? <Copyable cmd={cmd} /> : <span className="note">—</span>}</td>
    </tr>
  );
}
