import fs from "node:fs";
import path from "node:path";
import Console from "@/components/Console";
import type { Asp, AuditEntry, Deployment, Measurement, Position } from "@/lib/types";

// The snapshot the ops scripts produced. Everything live — roots, rules, eligibility,
// balances — is read from Monad in the browser, so this only carries what the chain
// cannot tell you: which credential each membership rests on, and what was asked.
function read<T>(file: string, fallback: T): T {
  const p = path.join(process.cwd(), "public", "data", file);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export default function Page() {
  const deployment = read<Deployment>("deployment.json", {});
  const asp = read<Asp | null>("asp.json", null);
  const audit = read<AuditEntry[]>("audit-log.json", []);
  const positions = read<Position[]>("notes.json", []);

  // A half-written snapshot must render as absent, not crash the page: check the field
  // the view actually dereferences rather than trusting the file to be well formed.
  const raw = read<Measurement | null>("measurement.json", null);
  const measurement = raw && typeof raw.measuredAt === "string" && raw.assets ? raw : null;

  return (
    <Console
      deployment={deployment}
      asp={asp}
      audit={audit}
      positions={positions}
      measurement={measurement}
    />
  );
}
