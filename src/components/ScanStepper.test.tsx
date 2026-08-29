import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ScanStepper, { type StageState } from "./ScanStepper";

const STAGES = [
  { id: "validate", label: "Validate target" },
  { id: "block", label: "Read Base block" },
  { id: "evidence", label: "Collect indexed evidence" },
  { id: "rules", label: "Apply deterministic rules" },
] as const;

function render(states: StageState[], summary: string | null = null): string {
  return renderToStaticMarkup(
    <ScanStepper stages={STAGES} states={states} summary={summary} />,
  );
}

describe("ScanStepper", () => {
  it("renders all four stage labels", () => {
    const html = render(["pending", "pending", "pending", "pending"]);

    for (const stage of STAGES) {
      expect(html).toContain(stage.label);
    }
  });

  it("marks a completed stage as done with a check icon", () => {
    const html = render(["done", "pending", "pending", "pending"]);

    expect(html).toContain('class="stepperChip is-done"');
    expect(html).toContain("icon-check");
  });

  it("marks the running stage active with aria-current and visible activity", () => {
    const html = render(["done", "active", "pending", "pending"]);

    expect(html).toContain('class="stepperChip is-active"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("chipSpinner");
  });

  it("keeps untouched stages pending", () => {
    const html = render(["done", "done", "active", "pending"]);

    expect(html).toContain('class="stepperChip is-pending"');
  });

  it("shows an unavailable stage as unavailable, never as a pass", () => {
    const html = render(["done", "unavailable", "active", "pending"]);

    expect(html).toContain('class="stepperChip is-unavailable"');

    // Exactly one chip is done (stage 1) and exactly one is unavailable.
    expect((html.match(/stepperChip is-done/g) ?? [])).toHaveLength(1);
    expect((html.match(/stepperChip is-unavailable/g) ?? [])).toHaveLength(1);

    // The unavailable chip itself carries the alert icon, the "unavailable"
    // flag, and no check mark.
    const unavailableChip = html.split('stepperChip is-unavailable')[1] ?? "";
    expect(unavailableChip).toContain("icon-alert");
    expect(unavailableChip).toContain(">unavailable</span>");
    expect(unavailableChip).not.toContain("icon-check");
  });

  it("exposes progressbar semantics with an accurate value", () => {
    const html = render(["done", "done", "active", "pending"]);

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="4"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain("2 of 4 stages complete, current stage: Collect indexed evidence");
  });

  it("reports every stage complete once all four are done", () => {
    const html = render(["done", "done", "done", "done"]);

    expect(html).toContain('aria-valuenow="4"');
    expect(html).toContain("4 of 4 stages complete");
  });

  it("renders the completion summary when the scan settles", () => {
    const html = render(
      ["done", "done", "done", "done"],
      "Completed in 2.4s · 4/4 stages",
    );

    expect(html).toContain('class="stepperDone"');
    expect(html).toContain("Completed in 2.4s · 4/4 stages");
  });

  it("counts only completed stages when one was unavailable", () => {
    const html = render(
      ["done", "unavailable", "done", "done"],
      "Completed in 3.1s · 3/4 stages",
    );

    expect(html).toContain('aria-valuenow="3"');
    expect(html).toContain("Completed in 3.1s · 3/4 stages");
  });

  it("renders no summary while the scan is still running", () => {
    const html = render(["done", "active", "pending", "pending"], null);

    expect(html).not.toContain("stepperDone");
  });
});
