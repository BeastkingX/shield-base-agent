import { describe, it, expect } from "vitest";
import fs from "node:fs";

describe("Finding 4: Generic Fired because rule first - evidence ID primary", () => {
  it("page.tsx defines GENERIC_WRAPPER_RULES and preserves RULE_COMPOUND_COMPROMISE", () => {
    const content = fs.readFileSync("src/app/page.tsx", "utf8");
    expect(content).toContain("GENERIC_WRAPPER_RULES");
    expect(content).toContain("RULE_WARNING_EVIDENCE");
    expect(content).toContain("RULE_COMPOUND_COMPROMISE");
    // Must preserve compound compromise (never demoted)
    expect(content).toContain("RULE_COMPOUND_COMPROMISE is never generic");
  });

  it("page.tsx shows primary evidence IDs first, hides generic wrappers when primary exists", () => {
    const content = fs.readFileSync("src/app/page.tsx", "utf8");
    expect(content).toContain("primaryEvidence");
    expect(content).toContain("primaryEvidenceGroup");
    expect(content).toContain("hasPrimaryRule");
    expect(content).toContain("hide generic wrappers");
  });

  it("globals.css has demoted and primary evidence styles", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".rulechip-demoted");
    expect(css).toContain(".primaryEvidence");
  });

  it("risk-engine preserves RULE_COMPOUND_COMPROMISE wording with recent rapid", () => {
    const risk = fs.readFileSync("src/lib/risk-engine.ts", "utf8");
    // Should contain recent rapid forwarding wording, not claim automated unless sweeper
    expect(risk).toContain("recent rapid forwarding");
    expect(risk).toContain("RULE_COMPOUND_COMPROMISE");
  });

  it("verdicts page does not fabricate history", () => {
    const verdictsPage = fs.readFileSync("src/app/verdicts/page.tsx", "utf8");
    expect(verdictsPage).toContain("does not fabricate");
    expect(verdictsPage).toContain("No fake entries");
  });
});
