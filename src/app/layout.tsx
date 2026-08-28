import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shield — Evidence-first safety for Base",
  description:
    "Autonomous on-chain pre-transaction security AI agent and verifiable evidence engine on Base Mainnet (8453).",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var saved = localStorage.getItem('shield-theme');
                  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var theme = saved || (prefersDark ? 'dark' : 'light');
                  document.documentElement.setAttribute('data-theme', theme);
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <a href="#main-content" className="skipLink">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
