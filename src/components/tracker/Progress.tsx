"use client";

import { ProgressBar, ProgressRing, StatusBadge } from "@/components/ui";
import type { OnboardingProgress } from "@/types/domain";

/**
 * Progress presentation (T035).
 *
 * Every figure is paired with a numeric value so progress is never conveyed by
 * bar length alone — a 0% bar and a 50% bar are indistinguishable to a screen
 * reader without the accompanying number.
 */

export function ProgressBarWithCount({ progress }: { progress: OnboardingProgress }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[140px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text-primary">{progress.percentComplete}%</span>
        <span className="text-caption text-text-tertiary">
          {`${progress.completedCount}/${progress.totalItems}`}
        </span>
      </div>
      <ProgressBar percent={progress.percentComplete} label="Onboarding completion" />
    </div>
  );
}

export function ProgressHero({ progress }: { progress: OnboardingProgress }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <ProgressRing percent={progress.percentComplete} label="Onboarding completion" />
      <p className="text-caption text-text-secondary">
        {`${progress.completedCount} of ${progress.totalItems} items complete`}
      </p>
    </div>
  );
}

/**
 * True when the upstream had no per-item checklist to report, as opposed to a
 * checklist on which everything happens to be done.
 *
 * The two are indistinguishable from `completed`/`outstanding` alone — both are
 * empty in either case — so this is the only thing that stops "Nothing
 * outstanding. All items complete." from being shown to a new hire whose
 * progress is simply not being tracked. See `OnboardingProgress.checklistSource`.
 */
function hasNoChecklist(progress: OnboardingProgress): boolean {
  return progress.checklistSource === "none";
}

/**
 * Completed and outstanding as SEPARATE lists (US1 acceptance scenario 2).
 *
 * A merged list would make "what still needs doing" ambiguous, which is the
 * entire question a new hire or HR lead is trying to answer.
 */
export function OutstandingList({ progress }: { progress: OnboardingProgress }) {
  // Say "not tracked", never "all done". An empty checklist is missing data, and
  // rendering it as completion is the one failure this portal must not ship.
  if (hasNoChecklist(progress)) {
    return (
      <div
        role="status"
        data-testid="no-checklist"
        className="rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-text-secondary"
      >
        {progress.totalItems > 0
          ? `No checklist is recorded for this employee. The sheet lists ${progress.totalItems} essentials, but nothing is being tracked against them, so completion cannot be shown. This is missing data, not zero progress.`
          : "No checklist is recorded for this employee, so completion cannot be shown. This is missing data, not zero progress."}
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section aria-labelledby="outstanding-heading">
        <h3 id="outstanding-heading" className="eyebrow text-text-tertiary mb-3">
          Outstanding ({progress.outstanding.length})
        </h3>
        {progress.outstanding.length === 0 ? (
          <p className="text-sm text-text-secondary">Nothing outstanding. All items complete.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {progress.outstanding.map((item) => (
              <li
                key={item}
                className="rounded-md border border-status-warning/30 bg-status-warning/8 px-3 py-2 text-sm text-text-primary"
              >
                <StatusBadge tone="warning" label="To do" />
                <span className="ml-2">{item}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="completed-heading">
        <h3 id="completed-heading" className="eyebrow text-text-tertiary mb-3">
          Completed ({progress.completed.length})
        </h3>
        {progress.completed.length === 0 ? (
          <p className="text-sm text-text-secondary">No items completed yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {progress.completed.map((item) => (
              <li
                key={item}
                className="rounded-md border border-status-success/30 bg-status-success/8 px-3 py-2 text-sm text-text-secondary line-through"
              >
                <StatusBadge tone="success" label="Done" />
                <span className="ml-2">{item}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Count discrepancy flag (T040).
 *
 * Observed live: the webhook reports total_items: 4 while the sheet's
 * total_essentials is 3 for the same employee. Displaying the webhook figure
 * and flagging the mismatch is correct; silently picking one would hide a real
 * data inconsistency.
 */
export function ItemCountDiscrepancy({
  webhookTotal,
  sheetTotal,
}: {
  webhookTotal: number;
  sheetTotal: number | null;
}) {
  if (sheetTotal === null || sheetTotal === webhookTotal) return null;
  return (
    <div
      role="status"
      data-testid="count-discrepancy"
      className="rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-status-warning"
    >
      {`Item count mismatch: the workflow reports ${webhookTotal} items but the roster sheet records ${sheetTotal}. The workflow figure is shown. This needs reconciliation.`}
    </div>
  );
}