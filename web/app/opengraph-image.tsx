// The card a scraper shows when this link is pasted into Slack, Telegram or a DM.
//
// Without it the unfurl is a grey bar with a title, which is what every judge who shares the
// link would have seen. Generated rather than shipped as a PNG so it cannot drift from the
// palette: the colours below are the same tokens globals.css defines, written literally
// because ImageResponse resolves no CSS variables.
//
// Deliberately plain. A card is read at thumbnail size in a scrolling list, so it carries the
// name, the one sentence, and the three facts a reader needs to decide whether to click.
import { ImageResponse } from "next/og";

export const alt = "Saksi — a confidential holder register for tokenized real-world assets";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  // Copied from globals.css :root, which is the authority. Written literally because
  // ImageResponse resolves no CSS variables — so if the palette moves, this moves by hand.
  const ink = "#0b0f1a";        // --foreground
  const muted = "#5b6478";     // --muted
  const paper = "#f7f8fa";     // --background
  const rule = "#dce0e8";      // --border
  const accent = "#8a6508";    // --accent

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: paper,
          color: ink,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              fontSize: 22,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: accent,
              fontFamily: "monospace",
              display: "flex",
            }}
          >
            Cleanverse CVI · CVA — Monad testnet
          </div>
          <div style={{ fontSize: 104, lineHeight: 1.02, display: "flex" }}>Saksi</div>
          <div style={{ fontSize: 40, lineHeight: 1.28, maxWidth: 900, color: ink, display: "flex" }}>
            Every position witnessed. Disclosure only when asked.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ height: 1, background: rule, display: "flex" }} />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 24,
              color: muted,
              fontFamily: "monospace",
            }}
          >
            <div style={{ display: "flex" }}>A confidential holder register for tokenized RWAs</div>
            <div style={{ display: "flex" }}>saksi-gilt.vercel.app</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
