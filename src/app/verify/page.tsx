"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ShieldLogo from "@/components/ShieldLogo";
import Icon from "@/components/Icon";
import { verifyReceiptBrowser, type VerificationResult } from "@/lib/verify-receipt";

const SAMPLE_EOA_RECEIPT = {
  receiptId: "shield_9f8e7d6c5b4a3f2e1d0c",
  receiptHash: "0x42f0cada4fb3022ef2bc306d5b24ada1ece5e3f18c18f6c91e3d82ff083d5c18",
  receiptVersion: "0.1",
  riskEngineVersion: "0.3.0",
  network: "Base Mainnet",
  chainId: 8453,
  address: "0xa37bA80bA292F3EFA1387468A676660C6e6a5f96",
  targetType: "wallet",
  blockNumber: "28450123",
  blockTimestamp: "2026-08-28T02:00:00.000Z",
  scannedAt: "2026-08-28T02:00:01.000Z",
  verdict: "LOW OBSERVED RISK",
  summary: "Standard EOA wallet with clean 1-hop upstream gas funding and zero open allowances.",
  coverage: { completed: 6, unavailable: 0, total: 6 },
  evidence: [],
  firedRules: [
    {
      id: "RULE_NO_BYTECODE_EOA",
      description: "Standard EOA wallet with no deployed smart contract bytecode.",
      level: "info",
    },
  ],
  limitations: [
    "Shield is a decision-support tool, not a guarantee of safety.",
    "Never share a private key or recovery phrase.",
  ],
  clusterAnalysis: { isSweeperActive: false },
  approvalsSummary: { totalCount: 0 },
};

const SAMPLE_INSPECT_RECEIPT = {
  receiptId: "inspect_22d473030f116d",
  // Recomputed over the canonical payload after the verdict wording change;
  // the digest must match the content or the demo would verify as tampered.
  receiptHash:
    "0xd3e4ac1f7c8fb932f37df419e1b725336332c383bebf3d4d8f170af568d5cd1c",
  title: "Permit2 Single Signature Inspection",
  verdict: "NO RED FLAGS FOUND",
  summary:
    "Demo payload: a standard Uniswap Permit2 signature on Base Mainnet. Domain verifying contract matches the official canonical deployment. No red flags found in the checks that ran; this is not a guarantee of safety.",
  details: "Single token approval for USDC router execution.",
  signatureType: "Permit2 Single",
  parsedData: {
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "500.00 USDC",
    spender: "0x2626664c2603336E57B271c5C0b26F421741e481",
  },
  evidence: [],
  threatScore: 0,
  inspectedAt: "2026-08-28T02:15:00.000Z",
};

const SAMPLE_TAMPERED_RECEIPT = {
  receiptId: "shield_attack_example",
  receiptHash: "0x3b89ef7b5a1b559792138ad26cf8d4bb92b5e28328bf3d0fb0c3dbe7cf7cf4f8",
  receiptVersion: "0.1",
  riskEngineVersion: "0.3.0",
  network: "Base Mainnet",
  chainId: 8453,
  address: "0x69620a2e27af4849bce5f70126ba1fc474c0e4a0",
  targetType: "wallet",
  blockNumber: "28450123",
  blockTimestamp: "2026-08-28T02:00:00.000Z",
  scannedAt: "2026-08-28T02:00:01.000Z",
  verdict: "LOW OBSERVED RISK",
  summary: "Attacker manipulated receipt content to fake a clean verdict.",
  coverage: { completed: 6, unavailable: 0, total: 6 },
  evidence: [],
  firedRules: [],
  limitations: [],
  clusterAnalysis: { isSweeperActive: true },
  approvalsSummary: { totalCount: 1 },
};

function VerifyContent() {
  const searchParams = useSearchParams();
  const [jsonInput, setJsonInput] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  /**
   * Digest carried in from the live verdict log, so a published hash can be
   * compared against a receipt the visitor holds. Shield never claims a match
   * until the browser recomputes it.
   */
  const publishedHash = searchParams.get("hash")?.trim() || "";

  useEffect(() => {
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    setTheme(isDark ? "dark" : "light");
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    localStorage.setItem("shield-theme", nextTheme);
  };

  const runVerification = useCallback(async (content: string) => {
    if (!content.trim()) {
      setResult(null);
      return;
    }
    setVerifying(true);
    try {
      const res = await verifyReceiptBrowser(content);
      setResult(res);
    } catch (err: any) {
      setResult({
        valid: false,
        type: "unknown",
        expectedHash: "",
        computedHash: "",
        error: err?.message || "Verification failed.",
      });
    } finally {
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    const queryReceipt = searchParams.get("receipt");
    if (queryReceipt) {
      try {
        const decoded = decodeURIComponent(queryReceipt);
        setJsonInput(decoded);
        void runVerification(decoded);
      } catch {}
    }
  }, [searchParams, runVerification]);

  const handleCopyHash = async (hash: string) => {
    await navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="verifyPageMain">
      <nav aria-label="Verification navigation" className="navlinks" style={{ justifyContent: "space-between", padding: "18px 20px" }}>
        <Link className="brand" href="/" aria-label="Shield home">
          <ShieldLogo size={32} />
          <span>SHIELD <span className="subBrand" style={{ fontSize: "11px", color: "var(--blue-hi)" }}>/ VERIFY</span></span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Link href="/" className="navbtn">
            ← Back to Scanner
          </Link>
          <button
            type="button"
            className="navbtn"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            <Icon name="theme" size={14} /> {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </nav>

      <div className="canvas">
        <div className="wrap verifyShell">
          <header className="verifyHeader">
            <span className="eyebrow">
              <Icon name="hash" size={12} /> Cryptographic Evidence Auditor
            </span>
            <h1>Independent Receipt Verification</h1>
            <p className="verifySubtitle">
              Every Shield receipt carries a SHA-256 content digest; recompute it in
              your browser and compare. A digest proves the content is unchanged, it
              is not a cryptographic signature.
              Paste any receipt JSON below to re-hash and prove zero data tampering in your browser.
            </p>
          </header>

          {publishedHash && (
            <p className="verdictLogMeta" role="status">
              Comparing against the digest published in the live verdict log:{" "}
              <span className="mono">{publishedHash}</span>. Paste that receipt JSON
              below; the digest your browser recomputes must match it exactly.
            </p>
          )}

          <section className="verifyConsoleSection">
            <div className="verifyInputCard">
              <div className="verifyCardTop">
                <label htmlFor="receiptJson">Paste Shield Receipt JSON</label>
                <div className="sampleButtonsGroup">
                  <span>Load demo receipt:</span>
                  <button
                    type="button"
                    className="samplePill"
                    onClick={() => {
                      const text = JSON.stringify(SAMPLE_EOA_RECEIPT, null, 2);
                      setJsonInput(text);
                      void runVerification(text);
                    }}
                  >
                    <Icon name="check" size={11} /> EOA scan (demo)
                  </button>
                  <button
                    type="button"
                    className="samplePill"
                    onClick={() => {
                      const text = JSON.stringify(SAMPLE_INSPECT_RECEIPT, null, 2);
                      setJsonInput(text);
                      void runVerification(text);
                    }}
                  >
                    <Icon name="key" size={11} /> Permit2 inspection (demo)
                  </button>
                  <button
                    type="button"
                    className="samplePill samplePillDanger"
                    onClick={() => {
                      const text = JSON.stringify(SAMPLE_TAMPERED_RECEIPT, null, 2);
                      setJsonInput(text);
                      void runVerification(text);
                    }}
                  >
                    <Icon name="danger" size={11} /> Tampered receipt (demo)
                  </button>
                </div>
              </div>

              <p className="verdictLogMeta">
                Demo receipt. Not a live verdict. These fixed samples exist only to
                show how hash verification behaves; they are not scans of any live
                address. Paste a receipt from a real scan to verify actual results.
              </p>

              <textarea
                id="receiptJson"
                rows={9}
                value={jsonInput}
                onChange={(e) => {
                  setJsonInput(e.target.value);
                  void runVerification(e.target.value);
                }}
                placeholder='Paste JSON receipt here (e.g. { "receiptId": "shield_...", "receiptHash": "0x...", ... })'
                spellCheck={false}
              />

              <div className="verifyActionRow">
                <button
                  type="button"
                  className="ghostbtn"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) {
                        setJsonInput(text);
                        void runVerification(text);
                      }
                    } catch {}
                  }}
                >
                  <Icon name="receipt" size={13} /> Paste from Clipboard
                </button>
                <button
                  type="button"
                  className="cta"
                  disabled={verifying || !jsonInput.trim()}
                  onClick={() => runVerification(jsonInput)}
                >
                  {verifying ? "Computing SHA-256..." : "Recompute & Verify Hash →"}
                </button>
              </div>
            </div>

            {result && (
              <div
                className={`verificationResultBanner ${
                  result.valid ? "resultMatch" : "resultMismatch"
                }`}
                role="status"
                aria-live="polite"
              >
                <div className="resultTopline">
                  <div className="resultIconBadge">
                    <Icon name={result.valid ? "check" : "danger"} size={22} />
                  </div>
                  <div className="resultHeadText">
                    <h3>
                      {result.valid
                        ? "SHA-256 DIGEST MATCHED · CONTENT UNALTERED"
                        : "HASH MISMATCH: TAMPERED RECEIPT DETECTED"}
                    </h3>
                    <p>
                      {result.valid
                        ? "The client-side SHA-256 digest computed across all facts matches the exact receipt hash."
                        : result.error ||
                          "The computed SHA-256 digest does not match the receipt hash. One or more facts in this receipt have been modified."}
                    </p>
                  </div>
                </div>

                <div className="hashComparisonGrid">
                  <div className="hashBox">
                    <span className="hashLabel">Claimed Receipt Hash:</span>
                    <code className="hashValue">
                      {result.expectedHash || "None provided"}
                    </code>
                  </div>
                  <div className="hashBox">
                    <span className="hashLabel">Computed SHA-256 (WebCrypto):</span>
                    <code className="hashValue">
                      {result.computedHash || "Calculation failed"}
                    </code>
                  </div>
                </div>

                {result.valid && (
                  <div className="receiptMetadataRow">
                    {result.target && (
                      <div>
                        <span>Target:</span>
                        <strong>{result.target}</strong>
                      </div>
                    )}
                    {result.verdict && (
                      <div>
                        <span>Verdict:</span>
                        <strong className="verdictTag">{result.verdict}</strong>
                      </div>
                    )}
                    {result.blockNumber && (
                      <div>
                        <span>Base Block:</span>
                        <strong>#{Number(result.blockNumber).toLocaleString()}</strong>
                      </div>
                    )}
                    {result.timestamp && (
                      <div>
                        <span>Scanned At:</span>
                        <strong>{new Date(result.timestamp).toLocaleString()}</strong>
                      </div>
                    )}
                    <button
                      type="button"
                      className="ghostbtn"
                      style={{ minHeight: "30px", padding: "2px 8px", fontSize: "11px", marginLeft: "auto" }}
                      onClick={() => handleCopyHash(result.computedHash)}
                    >
                      {copied ? "Copied" : "Copy Hash"}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="verifyMethodCard">
              <h4>How Shield Verifiability Works</h4>
              <div className="verifyMethodSteps">
                <div className="methodStep">
                  <span className="stepNum">1</span>
                  <div>
                    <strong>Canonical JSON Stripping</strong>
                    <p>Shield removes the dynamic receipt ID and previous hash wrapper from the payload.</p>
                  </div>
                </div>
                <div className="methodStep">
                  <span className="stepNum">2</span>
                  <div>
                    <strong>Hardware SHA-256 Execution</strong>
                    <p>Your browser executes standard W3C WebCrypto `crypto.subtle.digest(&quot;SHA-256&quot;)`, independent of any server.</p>
                  </div>
                </div>
                <div className="methodStep">
                  <span className="stepNum">3</span>
                  <div>
                    <strong>Deterministic Integrity Check</strong>
                    <p>If even a single byte, block number, or balance digit is altered, the entire SHA-256 changes.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="shell" style={{ padding: "80px 0", textAlign: "center" }}>Loading verification portal...</div>}>
      <VerifyContent />
    </Suspense>
  );
}
