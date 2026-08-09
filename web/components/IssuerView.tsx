"use client";

import { useState } from "react";
import { short } from "@/lib/chain";
import type { Asp, Deployment } from "@/lib/types";
import { useEligibility, type useLive } from "@/lib/useLive";
import { Addr, Badge, Empty, ErrorBox, Skeleton, Tx } from "./bits";

export default function IssuerView({
  deployment,
  live,
  asp,
}: {
  deployment: Deployment;
  live: ReturnType<typeof useLive>;
  asp: Asp | null;
}) {
  const [address, setAddress] = useState("");
  const [touched, setTouched] = useState(false);
  const { busy, result, check } = useEligibility(deployment.pool);
  const d = live.data;

  const valid = /^0x[0-9a-fA-F]{40}$/.test(address.trim());
  const showError = touched && address.length > 0 && !valid;

  return (
    <div className="grid">
      <section className="card">
        <h2>Admission rules, as Cleanverse holds them</h2>
        <p className="note">
          Read from the CVI Compliance Validator on Monad, not mirrored here. Rules are OR-ed:
          a wallet is admitted if it satisfies any one of them.
        </p>

        {live.status === "loading" && <Skeleton w="14em" />}
        {live.status === "error" && (
          <ErrorBox message={`Could not read the rule set: ${live.error}`} onRetry={live.reload} />
        )}
        {d &&
          (d.rules.length === 0 ? (
            <Empty>No rules registered — the register admits nobody until one is set.</Empty>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Min tier</th>
                    <th scope="col">Min sub-tier</th>
                    <th scope="col">Group</th>
                    <th scope="col">Sub-group</th>
                    <th scope="col">Country bitmap</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rules.map((r, i) => (
                    <tr key={i}>
                      <td className="mono">{i}</td>
                      <td className="mono">{r.minTier || <Unrestricted />}</td>
                      <td className="mono">{r.minSubTier || <Unrestricted />}</td>
                      <td className="mono">
                        {r.allowedGroup === "0x0000" ? <Unrestricted /> : r.allowedGroup}
                      </td>
                      <td className="mono">
                        {r.allowedSubGroup === "0x0000" ? <Unrestricted /> : r.allowedSubGroup}
                      </td>
                      <td className="mono">
                        {r.countryBitmap === 0n ? <Unrestricted /> : r.countryBitmap.toString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </section>

      <section className="card">
        <h2>Will this wallet be admitted?</h2>
        <p className="note">
          Two answers, because they are two questions. The left is the decision the pool will
          actually make on chain. The right is the credential it rests on.
        </p>

        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (valid) check(address.trim());
          }}
        >
          <div className="field" style={{ flex: "1 1 380px" }}>
            <label htmlFor="wallet">Wallet address</label>
            <input
              id="wallet"
              name="wallet"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              className="mono"
              placeholder="0x…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={showError}
              aria-describedby={showError ? "wallet-error" : undefined}
            />
            {showError && (
              <span id="wallet-error" style={{ color: "var(--refused)", fontSize: "var(--t-xs)" }}>
                Needs a 20-byte hex address, like 0x4490…4639.
              </span>
            )}
          </div>
          <button type="submit" className="btn" disabled={!valid || busy}>
            {busy ? "Checking…" : "Check eligibility"}
          </button>
          {deployment.issuer && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setAddress(deployment.issuer!);
                setTouched(true);
                check(deployment.issuer!);
              }}
            >
              Use the issuer wallet
            </button>
          )}
        </form>

        {result && (
          <div className="grid two" style={{ marginTop: 16 }}>
            <div className="card" style={{ background: "var(--surface-2)" }}>
              <h3>On chain — the pool&apos;s decision</h3>
              <p style={{ margin: "8px 0 0" }}>
                {result.onChain === null ? (
                  <Badge tone="warn">Validator did not answer</Badge>
                ) : result.onChain ? (
                  <Badge tone="ok">Admitted</Badge>
                ) : (
                  <Badge tone="no">Refused</Badge>
                )}
              </p>
              <p className="note" style={{ margin: "10px 0 0" }}>
                <code className="mono">complianceVerify(pool, wallet)</code> on{" "}
                {deployment.validator ? <Addr value={deployment.validator} /> : "the validator"},
                called live.
              </p>
            </div>

            <div className="card" style={{ background: "var(--surface-2)" }}>
              <h3>Credential — why</h3>
              {"error" in (result.apass ?? {}) ? (
                <ErrorBox message={(result.apass as { error: string }).error} />
              ) : result.apass && "found" in result.apass && result.apass.found ? (
                <dl className="kv" style={{ marginTop: 8 }}>
                  <dt>Status</dt>
                  <dd>
                    {result.apass.status === 1 ? (
                      <Badge tone="ok">Active</Badge>
                    ) : (
                      <Badge tone="no">Frozen</Badge>
                    )}
                  </dd>
                  <dt>Tier</dt>
                  <dd className="mono">
                    {result.apass.tier} / sub {result.apass.subTier}
                  </dd>
                  <dt>Countries</dt>
                  <dd className="mono">{result.apass.countries.join(", ") || "—"}</dd>
                  <dt>Expires</dt>
                  <dd className="mono">
                    {new Date(Number(result.apass.expirationTime) * 1000)
                      .toISOString()
                      .slice(0, 10)}
                  </dd>
                  <dt>KYC hash</dt>
                  <dd className="mono" style={{ fontSize: "var(--t-xs)" }}>
                    {short(result.apass.currentKycHash, 12, 8)}
                  </dd>
                </dl>
              ) : (
                <p style={{ marginTop: 8 }}>
                  <Badge tone="no">No credential on this chain</Badge>
                </p>
              )}
              <p className="note" style={{ margin: "10px 0 0" }}>
                No personal data is fetched or stored — the hash is the evidence, the identity
                behind it stays with Cleanverse.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Association set</h2>
        <p className="note">
          Derived from live A-Pass state, not maintained by hand. Every wallet holding an active
          credential that meets the rule becomes a leaf; a frozen credential is simply absent
          from the next build, and its holder can no longer produce an entry proof.
        </p>

        {!asp ? (
          <Empty>
            No association set yet. Run <code className="mono">node ops/asp.mjs build</code>.
          </Empty>
        ) : (
          <>
            <dl className="kv" style={{ marginBottom: 14 }}>
              <dt>Members</dt>
              <dd className="mono">
                {asp.admitted} admitted of {asp.populationQueried} credentials queried
              </dd>
              <dt>Rule applied</dt>
              <dd className="mono">
                tier &gt; {asp.rule.minTier}
                {asp.rule.countries.length ? ` · ${asp.rule.countries.join(", ")}` : ""}
              </dd>
              <dt>Built</dt>
              <dd className="mono">{asp.builtAt.replace("T", " ").slice(0, 19)} UTC</dd>
              <dt>Root anchored</dt>
              <dd>
                {d && d.aspRoot.toString() === asp.root ? (
                  <Badge tone="ok">Matches the chain</Badge>
                ) : live.status === "loading" ? (
                  <Skeleton w="8em" />
                ) : (
                  <Badge tone="warn">Rebuilt — rotate the root to anchor it</Badge>
                )}
              </dd>
            </dl>

            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Leaf</th>
                    <th scope="col">Wallet</th>
                    <th scope="col">Tier</th>
                    <th scope="col">Countries</th>
                    <th scope="col">Credential</th>
                  </tr>
                </thead>
                <tbody>
                  {asp.members.slice(0, 12).map((m) => (
                    <tr key={m.index}>
                      <td className="mono">{m.index}</td>
                      <td>
                        {/* The published set carries an address only for members this
                            project operates; everyone else is a leaf, which is all the
                            circuit ever sees. Rendering Addr on the absent field threw
                            inside render and took the whole tab down in production. */}
                        {m.wallet ? (
                          <Addr value={m.wallet} />
                        ) : (
                          <span className="mono" title="published as a leaf only">
                            leaf {short(m.sourceKey, 8, 6)}
                          </span>
                        )}
                        {m.label && (
                          <span className="note" style={{ display: "inline", marginLeft: 8 }}>
                            {m.label}
                          </span>
                        )}
                      </td>
                      <td className="mono">{m.tier}</td>
                      <td className="mono">{m.countries.join(", ") || "—"}</td>
                      <td className="mono" style={{ fontSize: "var(--t-xs)" }}>
                        {m.currentKycHash ? short(m.currentKycHash, 10, 6) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {asp.members.length > 12 && (
              <p className="note" style={{ margin: "10px 0 0" }}>
                Showing 12 of {asp.members.length}.
              </p>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Issuance</h2>
        <p className="note">
          The register is built over an asset we issued, with its compliance rule attached at
          launch rather than added afterwards.
        </p>
        <dl className="kv">
          <dt>Note</dt>
          <dd>
            {deployment.assetName ?? "—"}{" "}
            <span className="mono">({deployment.assetSymbol ?? "—"})</span>
          </dd>
          <dt>Issued</dt>
          <dd>
            <Tx hash={deployment.atokenTx} label="atoken/launch transaction" />
          </dd>
          <dt>Registered</dt>
          <dd>
            <Tx hash={deployment.validatorRegisterTx} label="validator/register transaction" />
          </dd>
          <dt>Owner</dt>
          <dd>{d ? <Addr value={d.owner} /> : <Skeleton w="10em" />}</dd>
        </dl>
      </section>
    </div>
  );
}

function Unrestricted() {
  return <span style={{ color: "var(--muted)" }}>any</span>;
}
