"use client";

import { useState } from "react";
import { addrUrl, txUrl, short } from "@/lib/chain";

export function Badge({
  tone,
  children,
}: {
  tone: "ok" | "no" | "warn" | "hidden";
  children: React.ReactNode;
}) {
  return (
    <span className={`badge ${tone}`}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Tx({ hash, label }: { hash?: string | null; label?: string }) {
  if (!hash) return <span className="hash">—</span>;
  return (
    <span className="hash mono">
      <a href={txUrl(hash)} target="_blank" rel="noreferrer">
        {label ?? short(hash)}
      </a>
    </span>
  );
}

export function Addr({ value }: { value: string }) {
  return (
    <span className="hash mono">
      <a href={addrUrl(value)} target="_blank" rel="noreferrer">
        {short(value, 10, 8)}
      </a>
    </span>
  );
}

/** A figure the register is holding but not showing here. Not a zero, not a dash — those
 *  mean "nothing here", and something is very much here.
 *
 *  Deliberately does NOT claim the figure is unreadable: for an entry it is reconstructible
 *  from the deposit transaction, and a tooltip that says otherwise is refutable in one
 *  click. The claim the product actually earns is about what happens after a position moves.
 */
export function Redacted({ width = 6 }: { width?: number }) {
  return (
    <span className="redacted mono" title="held by the register; not shown here">
      {"•".repeat(width)}
      <span className="sr-only">not shown</span>
    </span>
  );
}

export function Skeleton({ w = "6em" }: { w?: string }) {
  return <span className="skeleton" style={{ width: w }} aria-hidden="true" />;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** A command a reader is meant to run, not read. The text stays selectable — the button is
 *  the shortcut, not the only way to get the line out. */
export function Copyable({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="copyable">
      <code className="mono">{cmd}</code>
      <button
        type="button"
        className="btn ghost copy"
        // aria-label, not an .sr-only span: a 1200px unbreakable command inside one made
        // the whole document scroll sideways at 375px, clip rule notwithstanding.
        aria-label={`Copy command: ${cmd}`}
        onClick={() => {
          navigator.clipboard?.writeText(cmd).then(
            () => {
              setDone(true);
              setTimeout(() => setDone(false), 1600);
            },
            () => setDone(false),
          );
        }}
      >
        {done ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error" role="alert">
      <div style={{ marginBottom: onRetry ? 10 : 0 }}>{message}</div>
      {onRetry && (
        <button type="button" className="btn ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
