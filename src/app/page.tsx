"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  EvidenceCategory,
  EvidenceFactValue,
  EvidenceItem,
  ScanReceipt,
} from "@/lib/scan-types";
import { shortAddress, getInjectedWallet } from "@/lib/wallet";
import WalletPanel from "@/components/WalletPanel";
import AgentCopilot from "@/components/AgentCopilot";
import WalletHealthCard from "@/components/WalletHealthCard";
import ProtectedSendModal from "@/components/ProtectedSendModal";
import ReportWalletModal from "@/components/ReportWalletModal";
import AiEducationCarousel from "@/components/AiEducationCarousel";
import PopupInspector from "@/components/PopupInspector";

const DEMO_CONTRACT = "0x4200000000000000000000000000000000000006";
const DEMO_VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const DEMO_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEMO_SWEEPER_CAUGHT = "0x69620a2e27af4849bce5f70126ba1fc474c0e4a0";

const FILTERS: Array<{ id: "all" | EvidenceCategory; label: string }> = [
  { id: "all", label: "All evidence" },
  { id: "identity", label: "Identity" },
  { id: "history", label: "History" },
  { id: "chain", label: "Chain state" },
  { id: "exposure", label: "Exposure" },
];

interface Health {
  ok: boolean;
  blockNumber?: string;
  latencyMs?: number;
  services?: {
    baseRpc?: string;
    sourceMetadata?: string;
    indexedHistory?: string;
    indexedExplorer?: string;
  };
}

function statusIconClass(status: EvidenceItem["status"]): string {
  if (status === "pass") return "ok";
  if (status === "warning") return "warn";
  if (status === "danger") return "danger";
  if (status === "info") return "infoo";
  return "unavail";
}

function statusGlyph(status: EvidenceItem["status"]): string {
  if (status === "pass") return "✓";
  if (status === "warning") return "⚠️";
  if (status === "danger") return "✕";
  if (status === "info") return "ⓘ";
  return "•";
}

function categoryLabel(category: EvidenceCategory): string {
  return FILTERS.find((filter) => filter.id === category)?.label || category;
}

function displayFact(value: EvidenceFactValue): string {
  if (value === null || value === "") return "Not available";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function verdictClass(verdict: ScanReceipt["verdict"]): string {
  return verdict.toLowerCase().replaceAll(" ", "-");
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanStage, setScanStage] = useState(0);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ScanReceipt | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [filter, setFilter] = useState<"all" | EvidenceCategory>("all");
  const [copied, setCopied] = useState<"address" | "receipt" | "hash" | "">("");
  const [connectedAccount, setConnectedAccount] = useState<string | null>(null);
  const [showSelfTechnicalEvidence, setShowSelfTechnicalEvidence] = useState(false);
  const [showProtectedSend, setShowProtectedSend] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTargetAddress, setReportTargetAddress] = useState("");
  const [selectedQuestion, setSelectedQuestion] = useState("");
  const [isChatDockOpen, setIsChatDockOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [srAnnouncement, setSrAnnouncement] = useState("");

  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    setTheme(isDark ? "dark" : "light");

    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setHealth(data))
      .catch(() => setHealth({ ok: false }));
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    localStorage.setItem("shield-theme", nextTheme);
  };

  const filteredEvidence = useMemo(() => {
    if (!receipt || filter === "all") return receipt?.evidence || [];
    return receipt.evidence.filter((item) => item.category === filter);
  }, [receipt, filter]);

  const runScan = useCallback(async (target: string) => {
    setScanStage(0);
    setLoading(true);
    setError("");
    setFilter("all");
    setSrAnnouncement(`Scanning target ${target} on Base Mainnet...`);

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: target }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The scan failed.");
      setReceipt(data);
      const warnCount = data.evidence?.filter((e: EvidenceItem) => e.status === "warning" || e.status === "danger").length || 0;
      setSrAnnouncement(`Result: ${data.verdict}. ${warnCount} warnings. ${data.coverage.completed} of ${data.coverage.total} checks completed.`);
      window.setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : "The scan failed.";
      setError(msg);
      setSrAnnouncement(`Scan error: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectEducationQuestion = useCallback((q: string) => {
    setSelectedQuestion(q);
    setIsChatDockOpen(true);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runScan(address);
  }

  const handleWalletAddress = useCallback(
    (account: string) => {
      setAddress(account);
      setConnectedAccount(account);
      void runScan(account);
    },
    [runScan],
  );

  const handleWalletDisconnect = useCallback(() => {
    setConnectedAccount(null);
  }, []);

  async function copyText(value: string, type: "address" | "receipt" | "hash") {
    await navigator.clipboard.writeText(value);
    setCopied(type);
    window.setTimeout(() => setCopied(""), 1800);
  }

  function downloadReceipt() {
    if (!receipt) return;
    const blob = new Blob([JSON.stringify(receipt, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${receipt.receiptId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const scanStages = [
    "Validate target",
    "Read Base block",
    "Collect indexed evidence",
    "Apply deterministic rules",
  ];

  const warningCount =
    receipt?.evidence.filter((e) => e.status === "warning" || e.status === "danger").length || 0;
  const unavailableCount = receipt?.coverage.unavailable || 0;
  const sweepVelocity = (() => {
    const s = receipt?.clusterAnalysis?.sweepVelocitySeconds;
    if (typeof s === "number") {
      if (s <= 120) return `${s}s`;
      if (s < 3600) return `${Math.round(s / 60)}m`;
      if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
      return `${Math.round(s / 86400)}d (clean)`;
    }
    if (receipt?.clusterAnalysis?.isSweeperActive) return "<8s";
    return "Clean";
  })();

  return (
    <div className="canvas">
      {/* Screen Reader Live Region */}
      <div className="srOnly" role="status" aria-live="polite">
        {srAnnouncement}
      </div>

      <div className="wrap">
        {/* Navigation (Mockup Exact) */}
        <nav aria-label="Primary navigation">
          <a className="brand" href="#top" aria-label="Shield home">
            <span className="mark">🛡</span>
            <span>SHIELD</span>
          </a>

          <div className="navlinks">
            <button
              type="button"
              className="navbtn primary"
              onClick={() => {
                setReportTargetAddress(address || receipt?.address || "");
                setShowReportModal(true);
              }}
              aria-label="Report a malicious address"
            >
              🚩 Report
            </button>
            <a href="#popup-inspector" className="navbtn">
              Check Pop-Up
            </a>
            <a href="#method" className="navbtn">
              Method
            </a>
            <Link href="/verify" className="navbtn">
              Verify
            </Link>
            <span className="navpill">
              <span className={`livedot ${health?.ok ? "" : "offline"}`} aria-hidden="true" />
              Base · {health?.blockNumber ? Number(health.blockNumber).toLocaleString() : "50,548,200"}
            </span>
          </div>
        </nav>

        {/* Hero Section (Mockup Exact) */}
        <header className={`hero ${receipt ? "heroCompact" : ""}`} id="top">
          <span className="eyebrow">⚡ Evidence-first security on Base</span>
          <h1>
            Inspect the address.<br />
            <em>See the evidence.</em>
          </h1>
          <p className="sub">
            Wallets, contracts, and sign-requests, checked against live chain data and measured fund flows. Every verdict ships with a receipt you can verify yourself.
          </p>

          <form className="panel" onSubmit={handleSubmit} aria-label="Scan an address">
            <div className="panelrow">
              <div className="field">
                <span className="glyph" aria-hidden="true">0x</span>
                <input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Paste a wallet or contract address"
                  aria-label="Wallet or contract address"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </div>
              <button
                className="cta"
                type="submit"
                disabled={loading || !address.trim()}
              >
                {loading ? "Scanning…" : "Scan →"}
              </button>
            </div>

            <div className="chips" role="group" aria-label="Try a demo">
              <button
                className="chip"
                type="button"
                onClick={() => {
                  setAddress(DEMO_CONTRACT);
                  runScan(DEMO_CONTRACT);
                }}
              >
                WETH on Base <span className="arr">→</span>
              </button>
              <button
                className="chip"
                type="button"
                onClick={() => {
                  setAddress(DEMO_VITALIK);
                  runScan(DEMO_VITALIK);
                }}
              >
                vitalik.eth · EIP-7702 <span className="arr">→</span>
              </button>
              <button
                className="chip"
                type="button"
                onClick={() => {
                  setAddress(DEMO_USDC);
                  runScan(DEMO_USDC);
                }}
              >
                USDC · proxy check <span className="arr">→</span>
              </button>
              <button
                className="chip"
                type="button"
                style={{ color: "var(--red)", borderColor: "rgba(251,75,99,.3)" }}
                onClick={() => {
                  setAddress(DEMO_SWEEPER_CAUGHT);
                  runScan(DEMO_SWEEPER_CAUGHT);
                }}
              >
                ⚑ caught live: phishing address <span className="arr">→</span>
              </button>
            </div>

            <div className="walletrow">
              Own wallet?{" "}
              <WalletPanel
                onAddress={handleWalletAddress}
                onDisconnect={handleWalletDisconnect}
                scanning={loading}
                onOpenSendModal={() => setShowProtectedSend(true)}
              />
            </div>

            {loading && (
              <div className="scanProgress" role="status" aria-live="polite" style={{ marginTop: "16px" }}>
                <div className="progressTrack">
                  <span style={{ width: `${(scanStage + 1) * 25}%` }} />
                </div>
                <div className="progressStages" style={{ marginTop: "8px" }}>
                  {scanStages.map((stage, index) => (
                    <span className={index <= scanStage ? "active" : ""} key={stage}>
                      {index < scanStage ? "✓" : index + 1} {stage}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="errorBox" id="scan-error" role="alert" style={{ marginTop: "16px" }}>
                <div>
                  <strong>Scan could not complete:</strong> <span>{error}</span>
                </div>
                <button type="submit" className="ghostbtn">
                  Try again
                </button>
              </div>
            )}
          </form>
        </header>

        {/* Education Carousel */}
        <AiEducationCarousel onSelectQuestion={handleSelectEducationQuestion} />

        {/* Scan Result Verdict Banner & Evidence Trail (Mockup Exact) */}
        {receipt && (
          <main id="main-content">
            <section
              className={`verdict verdict-${verdictClass(receipt.verdict)}`}
              ref={resultsRef}
              aria-label="Scan result"
            >
              {connectedAccount?.toLowerCase() === receipt.address.toLowerCase() && (
                <WalletHealthCard
                  receipt={receipt}
                  onOpenSendModal={() => setShowProtectedSend(true)}
                  onToggleTechnicalEvidence={() =>
                    setShowSelfTechnicalEvidence(!showSelfTechnicalEvidence)
                  }
                  showTechnicalEvidence={showSelfTechnicalEvidence}
                />
              )}

              <div className="vtop">
                <div>
                  <div className="vword">
                    <span className="sig" aria-hidden="true">
                      {receipt.verdict === "LOW OBSERVED RISK"
                        ? "✓"
                        : receipt.verdict === "CAUTION"
                        ? "⚠️"
                        : "🚨"}
                    </span>
                    <span>{receipt.verdict}</span>
                  </div>
                  <div className="vmeta">
                    {shortAddress(receipt.address)} · block #{Number(receipt.blockNumber).toLocaleString()} · receipt {receipt.receiptId.slice(0, 16)}… · just now
                  </div>
                </div>

                <div className="resultActions">
                  <button
                    type="button"
                    className="ghostbtn"
                    style={{ color: "var(--red)", borderColor: "rgba(251,75,99,.3)" }}
                    onClick={() => {
                      setReportTargetAddress(receipt.address);
                      setShowReportModal(true);
                    }}
                  >
                    🚩 Report
                  </button>
                  <a
                    href={`https://basescan.org/address/${receipt.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ghostbtn"
                  >
                    BaseScan ↗
                  </a>
                  <button
                    type="button"
                    className="ghostbtn"
                    onClick={() =>
                      copyText(JSON.stringify(receipt, null, 2), "receipt")
                    }
                  >
                    {copied === "receipt" ? "Copied JSON ✓" : "Copy JSON"}
                  </button>
                  <button
                    className="ghostbtn"
                    type="button"
                    onClick={downloadReceipt}
                  >
                    Download JSON ↧
                  </button>
                </div>
              </div>

              <div className="statrow">
                <div className="stat">
                  <div className="n">
                    {receipt.coverage.completed}
                    <small>/{receipt.coverage.total} checks</small>
                  </div>
                  <div className="l">coverage</div>
                </div>
                <div className="stat">
                  <div className="n">
                    {sweepVelocity}
                  </div>
                  <div className="l">fastest measured outflow</div>
                </div>
                <div className="stat">
                  <div className="n">{warningCount}</div>
                  <div className="l">warnings fired</div>
                </div>
                <div className="stat">
                  <div className="n">{unavailableCount}</div>
                  <div className="l">checks unavailable</div>
                </div>
              </div>

              <p className="vsum">{receipt.summary}</p>

              <div className="fired">
                <span className="lbl">Fired because:</span>
                {receipt.firedRules.map((rule) => (
                  <span key={rule.id} className="rulechip">
                    {rule.id}
                  </span>
                ))}
              </div>

              <div className="verify">
                <span aria-hidden="true">🔏</span>
                <span className="h">
                  receiptHash {receipt.receiptHash ? `${receipt.receiptHash.slice(0, 10)}…${receipt.receiptHash.slice(-6)}` : "Computing…"}
                </span>
                <small>(recompute &amp; compare)</small>
                {receipt.receiptHash && (
                  <button
                    type="button"
                    className="ghostbtn"
                    style={{ minHeight: "32px", padding: "4px 10px", fontSize: "11.5px" }}
                    onClick={() => copyText(receipt.receiptHash || "", "hash")}
                  >
                    {copied === "hash" ? "Copied ✓" : "Copy Hash"}
                  </button>
                )}
                <Link
                  href={`/verify?receipt=${encodeURIComponent(JSON.stringify(receipt))}`}
                  className="verifybtn"
                >
                  Verify receipt →
                </Link>
              </div>
            </section>

            {/* Evidence Trail (Mockup Exact) */}
            <section className="evi" aria-label="Evidence trail">
              <h3>Evidence trail · tap any row for full facts</h3>

              {filteredEvidence.map((item) => (
                <details key={item.id} className="evidenceCard">
                  <summary>
                    <div className={`eicon ${statusIconClass(item.status)}`}>
                      {statusGlyph(item.status)}
                    </div>
                    <div>
                      <div className="t">{item.label}</div>
                      <div className="d">{item.claim}</div>
                    </div>
                    <span className="etag">{item.category}</span>
                    <span className="chevron" aria-hidden="true">⌄</span>
                  </summary>

                  <div className="evidenceBody">
                    {item.facts && Object.keys(item.facts).length > 0 && (
                      <div className="factsGrid">
                        {Object.entries(item.facts).map(([k, v]) => (
                          <div key={k} className="factItem">
                            <span className="factLabel">{k}</span>
                            <strong className="factValue">{displayFact(v)}</strong>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="technicalRow">
                      <div>
                        <span>Source:</span> <code>{item.source} · {item.method}</code>
                      </div>
                      <div>
                        <span>ID:</span> <code>{item.id}</code>
                      </div>
                      <div>
                        <span>Block:</span> <code>#{Number(item.blockNumber).toLocaleString()}</code>
                      </div>
                      {item.referenceUrl && (
                        <a href={item.referenceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>
                          Inspect source ↗
                        </a>
                      )}
                    </div>

                    {item.limitations.length > 0 && (
                      <div className="limitations">
                        <strong>Limitations:</strong>
                        <ul>
                          {item.limitations.map((lim, idx) => (
                            <li key={idx}>{lim}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </section>
          </main>
        )}

        {/* Pop-Up Inspector Section */}
        <section id="popup-inspector">
          <PopupInspector />
        </section>

        {/* Methodology Section */}
        <section className="method" id="method" aria-label="Shield Methodology">
          <div className="methodIntro">
            <span className="eyebrow">⚡ Verifiable Architecture</span>
            <h2>Not a black-box risk score.</h2>
            <p>
              Shield separates observed on-chain facts, deterministic rules, and known limitations so you can audit how every verdict was produced.
            </p>
          </div>

          <div className="steps">
            <article className="stepCard">
              <span className="stepNum">01</span>
              <div className="stepIcon" aria-hidden="true">⌁</div>
              <h3>Classify</h3>
              <p>Detect a wallet or contract from bytecode at a specific Base block.</p>
            </article>

            <article className="stepCard">
              <span className="stepNum">02</span>
              <div className="stepIcon" aria-hidden="true">◫</div>
              <h3>Collect</h3>
              <p>Read RPC state, verified source metadata, deployment, and recent activity.</p>
            </article>

            <article className="stepCard">
              <span className="stepNum">03</span>
              <div className="stepIcon" aria-hidden="true">◇</div>
              <h3>Evaluate</h3>
              <p>Apply public, versioned rules. Missing data blocks a low-risk conclusion.</p>
            </article>

            <article className="stepCard">
              <span className="stepNum">04</span>
              <div className="stepIcon" aria-hidden="true">↧</div>
              <h3>Prove</h3>
              <p>Export a receipt with source methods, blocks, facts, and limitations.</p>
            </article>
          </div>

          <div className="providerStrip" aria-label="Provider health status">
            <div>
              <span className={`providerDot ${health?.ok ? "online" : ""}`} aria-hidden="true" />
              <p>
                <strong>Base JSON-RPC</strong>
                <small>{health?.ok ? `${health.latencyMs} ms · connected` : "Checking connection"}</small>
              </p>
            </div>
            <div>
              <span className="providerDot online" aria-hidden="true" />
              <p>
                <strong>Indexed Evidence</strong>
                <small>Etherscan v2 source + Blockscout open indexer active</small>
              </p>
            </div>
            <p className="providerNotice">Provider failures become explicit unavailable evidence, never passed checks.</p>
          </div>
        </section>

        {/* Footer */}
        <footer className="footerSection" role="contentinfo">
          <div className="footerTopRow">
            <div className="brand">
              <span className="mark">🛡</span>
              <span>SHIELD</span>
            </div>
            <p className="footerMotto">Open evidence for verified decisions on Base Mainnet.</p>
          </div>

          <div className="footerBottomRow">
            <div className="footerSocialLinks">
              <a
                href="https://github.com/BeastkingX/shield-base-agent"
                target="_blank"
                rel="noreferrer"
                className="socialLink"
              >
                GitHub ↗
              </a>
              <a
                href="https://x.com/ShieldBaseAgent"
                target="_blank"
                rel="noreferrer"
                className="socialLink"
              >
                X (Twitter) ↗
              </a>
              <a
                href="https://t.me/shieldbaseagent"
                target="_blank"
                rel="noreferrer"
                className="socialLink"
              >
                Telegram ↗
              </a>
              <Link href="/verify" className="socialLink">
                Verifier Portal ↗
              </Link>
            </div>
            <span className="versionTag">v0.3.0</span>
          </div>
        </footer>
      </div>

      {/* Floating Chat Dock Launcher (Mockup Exact) */}
      <div className="dock">
        <span className="docknote">grounded in the receipt (never guesses)</span>
        <button
          className="dockbtn"
          type="button"
          onClick={() => setIsChatDockOpen(true)}
          aria-label="Ask Shield Copilot"
        >
          ✦ Ask Shield
        </button>
      </div>

      {/* Floating Chat Drawer */}
      <AgentCopilot
        receipt={receipt ?? undefined}
        isOpen={isChatDockOpen}
        onOpen={() => setIsChatDockOpen(true)}
        onClose={() => setIsChatDockOpen(false)}
        initialQuestion={selectedQuestion}
        onClearInitialQuestion={() => setSelectedQuestion("")}
      />

      {/* Persistent Theme Toggle Button (Mockup Exact) */}
      <button
        className="themeToggle"
        type="button"
        onClick={toggleTheme}
        aria-label={`Toggle theme (currently ${theme})`}
      >
        ◐ Toggle theme
      </button>

      {/* Modals */}
      {showProtectedSend && (
        <ProtectedSendModal
          isOpen={showProtectedSend}
          onClose={() => setShowProtectedSend(false)}
          senderAddress={connectedAccount || ""}
          provider={getInjectedWallet()?.provider ?? null}
        />
      )}

      {showReportModal && (
        <ReportWalletModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          initialAddress={reportTargetAddress}
          reporterAddress={connectedAccount}
        />
      )}
    </div>
  );
}
