"use client";

import { useState } from "react";
import type { Asp, AuditEntry, Deployment, Measurement, Position } from "@/lib/types";
import { useLive } from "@/lib/useLive";
import HolderView from "./HolderView";
import RegisterView from "./RegisterView";
import IssuerView from "./IssuerView";
import RegulatorView from "./RegulatorView";
import GatesView from "./GatesView";
import { Badge } from "./bits";

const TABS = [
  // The holder first. Every other tab is evidence about the register; this one is the
  // only screen that answers a question about the person looking at it.
  { id: "holder", label: "Am I eligible?" },
  { id: "register", label: "Register" },
  { id: "gates", label: "Two gates" },
  { id: "issuer", label: "Issuer" },
  { id: "regulator", label: "Regulator" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Console({
  deployment,
  asp,
  audit,
  positions,
  measurement,
}: {
  deployment: Deployment;
  asp: Asp | null;
  audit: AuditEntry[];
  positions: Position[];
  measurement: Measurement | null;
}) {
  const [tab, setTab] = useState<TabId>("holder");
  const live = useLive(deployment);

  return (
    <div className="shell">
      <header className="masthead">
        <div className="wordmark">
          <SaksiMark />
          <div>
            <h1>Saksi</h1>
            <div className="tag">Every position witnessed. Disclosure only when asked.</div>
          </div>
        </div>

        <div className="builton">
          <span>Monad testnet</span>
          <span className="rule" aria-hidden="true" />
          <span>
            {live.status === "ready" ? (
              live.data.registered ? (
                <Badge tone="ok">Registered with Cleanverse</Badge>
              ) : (
                <Badge tone="no">Not registered</Badge>
              )
            ) : live.status === "error" ? (
              <Badge tone="no">Chain unreachable</Badge>
            ) : (
              <Badge tone="warn">Reading chain…</Badge>
            )}
          </span>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Consoles">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            // Roving tabindex: the tablist is one Tab stop, arrows move within it.
            tabIndex={tab === t.id ? 0 : -1}
            className="tab"
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!delta) return;
              e.preventDefault();
              const next = TABS[(i + delta + TABS.length) % TABS.length];
              setTab(next.id);
              document.getElementById(`tab-${next.id}`)?.focus();
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "holder" && <HolderView deployment={deployment} asp={asp} />}
        {tab === "register" && (
          <RegisterView
            deployment={deployment}
            live={live}
            positions={positions}
            measurement={measurement}
          />
        )}
        {tab === "gates" && <GatesView deployment={deployment} asp={asp} />}
        {tab === "issuer" && <IssuerView deployment={deployment} live={live} asp={asp} />}
        {tab === "regulator" && (
          <RegulatorView deployment={deployment} audit={audit} positions={positions} />
        )}
      </main>

      <footer className="foot">
        <p style={{ margin: "0 0 6px" }}>
          Saksi is a hackathon build on Cleanverse infrastructure. It is not affiliated with
          Cleanverse International Pte Ltd, and nothing here is a security offering. All
          addresses are Monad testnet.
        </p>
        <p style={{ margin: 0 }}>
          Zero-knowledge core ported from an earlier public Stellar build; the Cleanverse
          integration, the pool, and these consoles were built during the window.
        </p>
      </footer>
    </div>
  );
}

function SaksiMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 512 512" role="img" aria-label="Saksi">
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
