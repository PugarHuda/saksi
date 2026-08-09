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

/** A figure the register is holding but deliberately not showing. Not a zero, not a dash
 *  — those mean "nothing here", and something is very much here. */
export function Redacted({ width = 6 }: { width?: number }) {
  return (
    <span className="redacted mono" title="shielded — the register holds this figure and does not publish it">
      {"•".repeat(width)}
      <span className="sr-only">shielded</span>
    </span>
  );
}

export function Skeleton({ w = "6em" }: { w?: string }) {
  return <span className="skeleton" style={{ width: w }} aria-hidden="true" />;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
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
