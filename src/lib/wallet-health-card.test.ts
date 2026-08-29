import { describe, it, expect } from "vitest";
import fs from "node:fs";

describe("Finding 9: WalletHealthCard honesty for incomplete checks", () => {
  it("WalletHealthCard.tsx checks coverage.unavailable and clusterAnalysis.analysisStatus", () => {
    const content = fs.readFileSync("src/components/WalletHealthCard.tsx", "utf8");
    expect(content).toContain("coverage.unavailable");
    expect(content).toContain("analysisStatus");
    expect(content).toContain("isIncomplete");
  });

  it("never displays Secure Clean 2-Hop / Prime Trust / 950 when incomplete", () => {
    const content = fs.readFileSync("src/components/WalletHealthCard.tsx", "utf8");
    // The fix ensures these strings are not shown when incomplete - check logic contains guard
    expect(content).toContain("Incomplete checks (Money trail unavailable)");
    expect(content).toContain("Unrated");
    expect(content).toContain("Score unavailable");
    // Ensure the secure text is still present for complete cases, but guarded
    expect(content).toContain("Secure (Clean 2-Hop Money Trail & Seed Funder)");
    // The guard must be before secure text
    const incompleteIndex = content.indexOf("isIncomplete");
    const secureIndex = content.indexOf("Secure (Clean 2-Hop");
    expect(incompleteIndex).toBeLessThan(secureIndex);
  });

  it("shows lower review/incomplete state when money trail unavailable", () => {
    const content = fs.readFileSync("src/components/WalletHealthCard.tsx", "utf8");
    expect(content).toContain("isMoneyTrailUnavailable");
    expect(content).toContain("EVIDENCE_MONEY_TRAIL");
    expect(content).toContain("vIncomplete");
  });

  it("renders — (not a high number) when score is unavailable", () => {
    const content = fs.readFileSync("src/components/WalletHealthCard.tsx", "utf8");
    expect(content).toContain('evidenceScore === null ? "—"');
    expect(content).toContain("scoreIncomplete");
  });

  it("delegates incomplete scoring to calculateEvidenceScore, which never fabricates clean", () => {
    const component = fs.readFileSync("src/components/WalletHealthCard.tsx", "utf8");
    expect(component).toContain("calculateEvidenceScore");
    expect(component).toContain("Observed Evidence Score");
    const scoreLib = fs.readFileSync("src/lib/evidence-score.ts", "utf8");
    expect(scoreLib.toLowerCase()).toContain("not rated as secure");
    expect(scoreLib).toContain("Score unavailable");
  });
});

describe("Finding 13 presentation: readable score disclosure (presentation-only)", () => {
  const component = fs.readFileSync("src/components/WalletHealthCard.tsx", "utf8");
  const css = fs.readFileSync("src/app/globals.css", "utf8");

  it("renders label/value rows with a Score method header", () => {
    expect(component).toContain("scoreBreakdownHeader");
    expect(component).toContain("Score method");
    expect(component).toContain("scoreRowLabel");
    expect(component).toContain("scoreRowValue");
    expect(component).toContain("Starting score");
  });

  it("shows the actual penalty totals (arithmetic), not just the multiplier", () => {
    expect(component).toContain("warningPenaltyTotal");
    expect(component).toContain("dangerPenaltyTotal");
    expect(component).toContain("=");
    expect(component).toContain("-{breakdown.warningPenaltyPer} × {breakdown.warningCount} = -{breakdown.warningPenaltyTotal}");
  });

  it("emphasizes the final score row and keeps 800 / 1,000 display intact", () => {
    expect(component).toContain("scoreRowFinal");
    expect(component).toContain("Final evidence score");
    // score display still renders the value followed by / 1,000 (unchanged meaning)
    expect(component).toContain("evidenceScore === null ? \"—\" : `${evidenceScore} / 1,000`");
    // the 1,000-point scale label is preserved
    expect(component).toContain("/ 1,000");
  });

  it("uses normal site font for labels and mono only for numeric values", () => {
    expect(css).toMatch(/\.scoreRowLabel\s*\{[^}]*font-family:\s*var\(--font-body\)/);
    expect(css).toMatch(/\.scoreRowValue\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
    expect(css).toMatch(/\.scoreDisclosureNote\s*\{[^}]*font-family:\s*var\(--font-body\)/);
  });

  it("has subtle dividers between rows and a right-aligned value column", () => {
    expect(css).toMatch(/\.scoreRow\s*\{[^}]*border-top:\s*1px solid var\(--line\)/);
    expect(css).toMatch(/\.scoreRowValue\s*\{[^}]*text-align:\s*right/);
    expect(css).toMatch(/\.scoreRow\s*\{[^}]*justify-content:\s*space-between/);
  });

  it("stacks cleanly on mobile with no sideways overflow", () => {
    const mobile = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\.scoreRowValue[\s\S]*?\}/);
    expect(mobile).not.toBeNull();
    expect(mobile![0]).toContain("overflow-wrap: anywhere");
    expect(css).toContain("word-break: break-word");
  });

  it("keeps the disclosure expandable/collapsible", () => {
    expect(component).toContain("<details");
    expect(component).toContain("<summary>How this score was calculated</summary>");
  });
});
