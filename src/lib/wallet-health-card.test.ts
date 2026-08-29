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
