import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

// A display serif, and it is doing real work. Setting every level of a page in one
// geometric sans is the tell of an interface nobody chose the type for: headings end up as
// body copy at a larger size. A transitional serif in wide-tracked caps, cut once by its
// own italic, is the oldest editorial move there is and it is the right register for a
// document about a securities register.
const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Saksi — confidential holder register",
  description:
    "A confidential holder register for tokenized real-world assets. Positions in a Cleanverse Verified Asset are shielded on-chain; entry, exit and audit stay answerable.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Pinned light. The palette below still defines a full dark set and the CSS still
    // honours [data-theme="dark"], so a theme switch remains one attribute away — but the
    // product commits to one look rather than inheriting whatever the reader's OS is set to.
    <html lang="en" data-theme="light" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
