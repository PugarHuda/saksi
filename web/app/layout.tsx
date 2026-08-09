import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

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
    <html lang="en" data-theme="light" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
