import { NextResponse } from "next/server";

// A-Pass lookups are proxied so the api-id stays on the server. The read endpoints take
// plain JSON — the api-key is only ever used locally for AES on write endpoints, and
// this route has no write path at all.

// Env values can arrive with a UTF-8 BOM or trailing newline depending on how they were
// piped in. A BOM in a header value throws before the request is even made, so clean
// every value that ends up on the wire.
const clean = (v: string | undefined) => v?.replace(/^﻿/, "").trim();

const BASE = clean(process.env.CV_BASE) || "https://uatapi.cleanverse.com/api/cooperate";
const CHAIN = clean(process.env.CHAIN) || "monad";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address")?.trim();
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "pass a 20-byte hex address" }, { status: 400 });
  }
  const apiId = clean(process.env.CV_API_ID);
  if (!apiId) {
    return NextResponse.json({ error: "CV_API_ID is not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${BASE}/query_apass`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-id": apiId },
      body: JSON.stringify({ chain: CHAIN, address }),
      cache: "no-store",
    });
    const body = await res.json();
    if (body.code !== "0000") {
      // No credential is a legitimate answer, not a failure of the lookup.
      return NextResponse.json({ found: false, code: body.code, message: body.message });
    }
    const d = body.data ?? {};
    return NextResponse.json({
      found: true,
      status: d.status,                 // 1 active, 2 frozen
      tier: d.tier,
      subTier: d.subTier,
      group: d.group,
      subGroup: d.subGroup,
      countries: d.countries ?? [],
      expirationTime: d.expirationTime,
      cvRecordId: d.cvRecordId,
      currentKycHash: d.currentKycHash, // the credential evidence, never the PII behind it
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
