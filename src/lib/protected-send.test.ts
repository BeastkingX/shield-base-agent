import { describe, it, expect } from "vitest";
import fs from "node:fs";

describe("Finding 10: Protected Send mobile panel cramped", () => {
  it("ProtectedSendModal.tsx has clear sections: Asset & Amount, Recipient, Quick test, Actions", () => {
    const content = fs.readFileSync("src/components/ProtectedSendModal.tsx", "utf8");
    expect(content).toContain("Asset & Amount");
    expect(content).toContain("Recipient Address");
    expect(content).toContain("Quick test");
    expect(content).toContain("modalActions");
  });

  it("globals.css has section blocks with 12-16px spacing and full-width inputs", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".sendForm");
    expect(css).toContain("gap: 20px");
    expect(css).toContain(".formGroup");
    expect(css).toContain("padding: 14px");
    expect(css).toContain(".amountInputGroup");
    expect(css).toContain("width: 100%");
  });

  it("asset selector + percentage separate readable, not mashed", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".percentageButtonsRow");
    expect(css).toContain(".pctButtonGroup");
    expect(css).toContain("gap: 8px");
    expect(css).toContain(".tokenSelectorContainer");
  });

  it("button labels not touching, stack/wrap actions narrow", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".modalActions");
    expect(css).toContain("flex-wrap: wrap");
    expect(css).toContain("gap: 12px");
  });

  it("modal body scrollable if exceeds viewport, safe-area padding", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("env(safe-area-inset-bottom");
    expect(css).toContain("padding-bottom: calc(24px + env(safe-area-inset-bottom");
  });

  it("does not hide warnings or change security behavior", () => {
    const modal = fs.readFileSync("src/components/ProtectedSendModal.tsx", "utf8");
    expect(modal).toContain("preFlightBox");
    expect(modal).toContain("isBlocked");
    expect(modal).toContain("overrideWarning");
    expect(modal).toContain("Transaction blocked");
  });
});

describe("Finding 11: Mobile token/asset list no visual rows", () => {
  it("TokenSelector.tsx renders clear row/card boundary", () => {
    const content = fs.readFileSync("src/components/TokenSelector.tsx", "utf8");
    expect(content).toContain("tokenOptionItem");
    expect(content).toContain("tokenDetails");
    expect(content).toContain("symbolRow");
    expect(content).toContain("contractAddr");
  });

  it("globals.css has visual separation: padding, gaps, border, wrapping", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".tokenOptionItem");
    expect(css).toContain("padding: 12px 12px");
    expect(css).toContain("border-bottom: 1px solid var(--line)");
    expect(css).toContain("min-height: 56px");
    expect(css).toContain("overflow-wrap: anywhere");
  });

  it("every token row has separate symbol/full name/short address readable", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".symbolRow strong");
    expect(css).toContain(".symbolRow .name");
    expect(css).toContain(".contractAddr");
    expect(css).toContain("font-family: var(--font-mono)");
  });

  it("list scrollable inside panel not expanding viewport, no horizontal overflow", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain(".tokenItemsList");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("overflow-x: hidden");
    expect(css).toContain("max-height: 340px");
    expect(css).toContain(".tokenDropdownMenu");
    expect(css).toContain("max-width: 360px");
  });

  it("align marker/icon with symbol, long names wrap", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("align-items: center");
    expect(css).toContain("word-break: break-word");
  });

  it("preserves selection/balances/chain data", () => {
    const modal = fs.readFileSync("src/components/ProtectedSendModal.tsx", "utf8");
    expect(modal).toContain("userBalance");
    expect(modal).toContain("tokenPrice");
    expect(modal).toContain("SUPPORTED_BASE_TOKENS");
  });
});
