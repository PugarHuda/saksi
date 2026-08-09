import fs from "node:fs";
import path from "node:path";

/** The snapshot the ops scripts produced. Everything live — roots, rules, eligibility,
 *  balances — is read from Monad in the browser, so these files only carry what the chain
 *  cannot tell you: which credential each membership rests on, and what was asked.
 *
 *  A missing or half-written file must render as absent rather than crash the page, so
 *  every caller passes a fallback and gets it on any read or parse failure.
 */
export function read<T>(file: string, fallback: T): T {
  const p = path.join(process.cwd(), "public", "data", file);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}
