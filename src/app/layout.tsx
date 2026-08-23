import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shield — Evidence-backed safety for Base",
  description:
    "Scan a Base wallet or contract and receive a block-referenced safety briefing.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
