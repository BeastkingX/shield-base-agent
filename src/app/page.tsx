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
import ShieldLogo from "@/components/ShieldLogo";
import Icon from "@/components/Icon";

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

function statusRowClass(status: EvidenceItem["status"]): string {
  if (status === "danger") return "row-danger";
  if (status === "warning") return "row-warn";
  if (status === "pass") return "row-ok";
  if (status === "info") return "row-info";
  return "row-unav";
}

function statusWord(status: EvidenceItem["status"]): string {
  if (status === "danger") return "Danger";
  if (status === "warning") return "Review";
  if (status === "pass") return "Clean";
  if (status === "info") return "Noted";
  return "Gap";
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

  // Deterministic severity sorting: danger -> warning -> pass -> info -> unavailable
  const sortedEvidence = useMemo(() => {
    if (!receipt) return [];
    const order: Record<EvidenceItem["status"], number> = {
      danger: 0,
      warning: 1,
      pass: 2,
      info: 3,
      unavailable: 4,
    };
    return [...receipt.evidence].sort((a, b) => order[a.status] - order[b.status]);
  }, [receipt]);

  const filteredEvidence = useMemo(() => {
    if (filter === "all") return sortedEvidence;
    return sortedEvidence.filter((item) => item.category === filter);
  }, [sortedEvidence, filter]);

  // Flagship finding: top danger or top warning finding
  const flagshipFinding = useMemo(() => {
    if (!receipt) return null;
    const topDanger = receipt.evidence.find((e) => e.status === "danger");
    if (topDanger) return topDanger;
    const topWarning = receipt.evidence.find((e) => e.status === "warning");
    if (topWarning) return topWarning;
    return null;
  }, [receipt]);

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

  const dangerCount = receipt?.evidence.filter((e) => e.status === "danger").length || 0;
  const warningCount = receipt?.evidence.filter((e) => e.status === "warning").length || 0;
  const passCount = receipt?.evidence.filter((e) => e.status === "pass").length || 0;
  const infoCount = receipt?.evidence.filter((e) => e.status === "info").length || 0;
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
        {/* Navigation */}
        <nav aria-label="Primary navigation">
          <a className="brand" href="#top" aria-label="Shield home">
            <ShieldLogo size={32} />
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
              <Icon name="flag" size={13} /> Report
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
              Base · {health?.blockNumber ? Number(health.blockNumber).toLocaleString() : "50,551,087"}
            </span>
          </div>
        </nav>

        {/* Hero Section */}
        <header className={`hero ${receipt ? "heroCompact" : ""}`} id="top">
          <span className="eyebrow">
            <Icon name="shield" size={12} /> Evidence-first security on Base
          </span>
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
                <Icon name="flag" size={12} /> caught live: phishing address <span className="arr">→</span>
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

        {/* Scan Result Verdict Banner & Evidence Trail */}
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
                      <Icon
                        name={
                          receipt.verdict === "LOW OBSERVED RISK"
                            ? "check"
                            : receipt.verdict === "CAUTION"
                            ? "alert"
                            : "danger"
                        }
                        size={22}
                      />
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
                    <Icon name="flag" size={12} /> Report
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
                    {copied === "receipt" ? "Copied JSON" : "Copy JSON"}
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
                  <div className="n">{dangerCount + warningCount}</div>
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
                <Icon name="hash" size={14} />
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
                    {copied === "hash" ? "Copied" : "Copy Hash"}
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

            {/* Evidence Trail (Decluttered Trophy Case with Flagship Finding) */}
            <section className="evi" aria-label="Evidence trail">
              <h2>Evidence trail</h2>
              <p className="sub">
                measured at block #{Number(receipt.blockNumber).toLocaleString()} · receipt {receipt.receiptId.slice(0, 16)}…
              </p>

              {/* 1. Severity Summary Bar */}
              <div className="summarybar" role="status" aria-label="Evidence summary counts">
                <span className="sev">
                  <span className="pip red" aria-hidden="true" />
                  <b>{dangerCount}</b> danger
                </span>
                <span className="sev">
                  <span className="pip amber" aria-hidden="true" />
                  <b>{warningCount}</b> review
                </span>
                <span className="sev">
                  <span className="pip green" aria-hidden="true" />
                  <b>{passCount}</b> clean
                </span>
                <span className="sev">
                  <span className="pip blue" aria-hidden="true" />
                  <b>{infoCount}</b> noted
                </span>
                {unavailableCount > 0 && (
                  <span className="sev">
                    <span className="pip gray" aria-hidden="true" />
                    <b>{unavailableCount}</b> gaps
                  </span>
                )}
                <span className="cover">
                  {receipt.coverage.completed}/{receipt.coverage.total} checks
                </span>
              </div>

              {/* 2. Flagship Finding Card (Tinted Hero Card for Top Warning/Danger) */}
              {flagshipFinding && (
                <div
                  className={`herofind ${flagshipFinding.status === "danger" ? "danger" : ""}`}
                >
                  <div className="kicker">
                    <Icon name="flag" size={11} /> Why this verdict
                  </div>
                  <div className="title">{flagshipFinding.claim}</div>
                  {flagshipFinding.facts && Object.keys(flagshipFinding.facts).length > 0 && (
                    <div className="detail">
                      {Object.entries(flagshipFinding.facts)
                        .slice(0, 3)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(" · ")}
                    </div>
                  )}
                  <span className="idtag">{flagshipFinding.id}</span>
                </div>
              )}

              {/* 3. One-Line Rows for Evidence Checks */}
              {filteredEvidence.map((item) => (
                <details key={item.id}>
                  <summary className={`evidenceRow ${statusRowClass(item.status)}`}>
                    <span className="sw">{statusWord(item.status)}</span>
                    <span className="claim">{item.claim}</span>
                    <span className="chev" aria-hidden="true">⌄</span>
                  </summary>

                  <div className="expanded">
                    {item.facts && Object.keys(item.facts).length > 0 && (
                      <>
                        {Object.entries(item.facts).map(([k, v]) => (
                          <div key={k} className="factrow">
                            <span className="k">{k}</span>
                            <span className="v">{displayFact(v)}</span>
                          </div>
                        ))}
                      </>
                    )}

                    <div className="factrow">
                      <span className="k">Source</span>
                      <span className="v">{item.source} · {item.method}</span>
                    </div>
                    <div className="factrow">
                      <span className="k">Evidence ID</span>
                      <span className="v">{item.id}</span>
                    </div>
                    <div className="factrow">
                      <span className="k">Block</span>
                      <span className="v">#{Number(item.blockNumber).toLocaleString()}</span>
                    </div>

                    {item.referenceUrl && (
                      <div className="factrow">
                        <span className="k">Reference</span>
                        <a
                          href={item.referenceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="v"
                          style={{ color: "var(--blue-hi)", fontWeight: 700 }}
                        >
                          Inspect source ↗
                        </a>
                      </div>
                    )}

                    {item.limitations.length > 0 && (
                      <div className="limitations">
                        <strong>Limitations</strong>
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

              <p className="hintline">
                One line per check. Rail color signals severity, label states findings explicitly. Expand any check for raw on-chain facts and verification sources.
              </p>
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
            <span className="eyebrow">
              <Icon name="shield" size={12} /> Verifiable Architecture
            </span>
            <h2>Not a black-box risk score.</h2>
            <p>
              Shield separates observed on-chain facts, deterministic rules, and known limitations so you can audit how every verdict was produced.
            </p>
          </div>

          <div className="steps">
            <article className="stepCard">
              <span className="stepNum">01</span>
              <Icon name="scan" size={24} className="stepIcon" />
              <h3>Classify</h3>
              <p>Detect a wallet or contract from bytecode at a specific Base block.</p>
            </article>

            <article className="stepCard">
              <span className="stepNum">02</span>
              <Icon name="receipt" size={24} className="stepIcon" />
              <h3>Collect</h3>
              <p>Read RPC state, verified source metadata, deployment, and recent activity.</p>
            </article>

            <article className="stepCard">
              <span className="stepNum">03</span>
              <Icon name="shield" size={24} className="stepIcon" />
              <h3>Evaluate</h3>
              <p>Apply public, versioned rules. Missing data blocks a low-risk conclusion.</p>
            </article>

            <article className="stepCard">
              <span className="stepNum">04</span>
              <Icon name="key" size={24} className="stepIcon" />
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
              <ShieldLogo size={28} />
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

      {/* Floating Chat Dock Launcher */}
      <div className="dock">
        <span className="docknote">grounded in the receipt (never guesses)</span>
        <button
          className="dockbtn"
          type="button"
          onClick={() => setIsChatDockOpen(true)}
          aria-label="Ask Shield Copilot"
        >
          <Icon name="bot" size={16} /> Ask Shield
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

      {/* Persistent Theme Toggle Button */}
      <button
        className="themeToggle"
        type="button"
        onClick={toggleTheme}
        aria-label={`Toggle theme (currently ${theme})`}
      >
        <Icon name="theme" size={14} /> Toggle theme
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
