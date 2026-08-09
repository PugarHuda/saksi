import Console from "@/components/Console";
import { read } from "@/lib/snapshot";
import type { Asp, AuditEntry, Deployment, Measurement, Position } from "@/lib/types";

export const metadata = {
  title: "Console — Saksi",
  description:
    "The register, the two gates, the issuer's set and the regulator's questions, read live from Monad testnet.",
};

export default function ConsolePage() {
  const deployment = read<Deployment>("deployment.json", {});
  const asp = read<Asp | null>("asp.json", null);
  const audit = read<AuditEntry[]>("audit-log.json", []);
  const positions = read<Position[]>("notes.json", []);

  // Check the field the view actually dereferences rather than trusting the file to be
  // well formed: a truncated write should read as "no measurement", not as a crash.
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
