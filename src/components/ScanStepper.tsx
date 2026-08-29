import Icon from "./Icon";

/**
 * Four-stage scan stepper.
 *
 * Purely presentational: the parent advances `states` only when it has really
 * observed the corresponding milestone (local validation, a live Base block
 * read, the scan response, and the rules inside that response). Nothing here
 * animates on a timer, so the chips can never claim progress that did not
 * happen, and a failed stage is shown as unavailable rather than as a pass.
 */

export type StageState = "pending" | "active" | "done" | "unavailable";

export interface ScanStage {
  id: string;
  label: string;
}

interface ScanStepperProps {
  stages: readonly ScanStage[];
  states: readonly StageState[];
  /** Rendered once the scan settles, e.g. "Completed in 2.4s · 4/4 stages". */
  summary?: string | null;
}

export default function ScanStepper({ stages, states, summary }: ScanStepperProps) {
  const doneCount = states.filter((state) => state === "done").length;
  const total = stages.length;
  const activeStage = stages.find((_, index) => states[index] === "active");

  return (
    <div className="stepper">
      <div
        className="stepperTrack"
        role="progressbar"
        aria-label="Scan progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={doneCount}
        aria-valuetext={`${doneCount} of ${total} stages complete${
          activeStage ? `, current stage: ${activeStage.label}` : ""
        }`}
      >
        <span style={{ width: `${(doneCount / total) * 100}%` }} />
      </div>

      <ol className="stepperChips">
        {stages.map((stage, index) => {
          const state = states[index] ?? "pending";
          return (
            <li
              key={stage.id}
              className={`stepperChip is-${state}`}
              aria-current={state === "active" ? "step" : undefined}
            >
              <span className="chipMark" aria-hidden="true">
                {state === "done" ? (
                  <Icon name="check" size={13} />
                ) : state === "unavailable" ? (
                  <Icon name="alert" size={13} />
                ) : (
                  index + 1
                )}
              </span>
              <span className="chipLabel">{stage.label}</span>
              {state === "active" && <span className="chipSpinner" aria-hidden="true" />}
              {state === "unavailable" && <span className="chipFlag">unavailable</span>}
            </li>
          );
        })}
      </ol>

      {summary && <p className="stepperDone">{summary}</p>}
    </div>
  );
}
