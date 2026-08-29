import { describe, it, expect } from "vitest";
import fs from "node:fs";

/**
 * Regression: user-facing copy must not use em dashes (—) or en dashes (–).
 * Comments and the standalone "—" unavailable-value placeholder are allowed.
 */
describe("user-facing dash cleanup (regression)", () => {
  const verifyPage = fs.readFileSync("src/app/verify/page.tsx", "utf8");
  const verdictsPage = fs.readFileSync("src/app/verdicts/page.tsx", "utf8");

  it("/verify uses periods instead of dashes", () => {
    expect(verifyPage).toContain(". Paste that receipt JSON");
    expect(verifyPage).toContain("Demo receipt. Not a live verdict.");
    expect(verifyPage).not.toContain("— paste that receipt JSON");
    expect(verifyPage).not.toContain("Demo receipt — not a live verdict.");
  });

  it("/verdicts title uses a pipe, not a dash", () => {
    expect(verdictsPage).toContain('title: "Shield | Live verdict log"');
    expect(verdictsPage).not.toContain("Shield — Live verdict log");
  });

  it("page copy files contain no user-facing em/en dashes in prose", () => {
    // The only em dash allowed in these files is the standalone "—" placeholder;
    // prose sentences must not contain dashes.
    const proseDash = /[A-Za-z]\s+[—–]\s+[a-z]/;
    expect(proseDash.test(verifyPage)).toBe(false);
    expect(proseDash.test(verdictsPage)).toBe(false);
  });
});
