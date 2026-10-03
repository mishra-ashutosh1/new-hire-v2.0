import type { ReactNode } from "react";

/**
 * DataState wrapper (T020).
 *
 * Every async surface in this app renders through this component, so the five
 * states are implemented once rather than five times. FR-019 requires a distinct,
 * designed treatment for each; a surface that ships with fewer is a defect.
 *
 * The dev-only invariant at the bottom converts "no blank panel" from a UI
 * convention into an enforced rule. A `success` state that renders zero children
 * is the exact bug SC-008 exists to catch — the employee sees an empty card and
 * concludes the data is unavailable. It throws in development so it can never
 * reach a review as a finished surface.
 */

export type DataState = "idle" | "loading" | "empty" | "error" | "success";

export interface DataStateProps {
  state: DataState;
  children?: ReactNode;
  /** Label for screen readers and empty/error copy. */
  label: string;
  /** Shown when state is `empty`. */
  emptyMessage?: string;
  /** Shown when state is `error`. */
  errorMessage?: string;
  /** Retry affordance rendered on error. */
  onRetry?: () => void;
  /** True when `children` genuinely contains nothing to show. */
  hasContent?: boolean;
  skeleton?: ReactNode;
}

function countChildren(children: ReactNode): number {
  if (children === null || children === undefined || children === false) return 0;
  if (Array.isArray(children)) return children.filter((c) => c !== null && c !== false).length;
  return 1;
}

export function DataState({
  state,
  children,
  label,
  emptyMessage,
  errorMessage,
  onRetry,
  hasContent,
  skeleton,
}: DataStateProps) {
  const childCount = countChildren(children);
  const contentPresent = hasContent ?? childCount > 0;

  if (process.env.NODE_ENV !== "production" && state === "success" && !contentPresent) {
    throw new Error(
      `DataState "${label}" resolved with no renderable content — blank panel invariant. ` +
        `A success state with zero children renders an empty card and reads as missing data.`,
    );
  }

  return (
    <div data-state={state} data-label={label} aria-busy={state === "loading"}>
      {state === "idle" && (
        <p className="text-text-secondary text-sm py-4">{`No ${label} requested yet.`}</p>
      )}

      {state === "loading" && (
        <div aria-live="polite" aria-label={`Loading ${label}`}>
          <span className="sr-only">{`Loading ${label}`}</span>
          {skeleton ?? <div className="h-24 rounded-md bg-surface-raised animate-pulse" />}
        </div>
      )}

      {state === "empty" && (
        <div className="flex flex-col items-start gap-2 py-6">
          <p className="text-text-secondary text-sm">{emptyMessage ?? `No ${label} found.`}</p>
        </div>
      )}

      {state === "error" && (
        <div role="alert" className="flex flex-col items-start gap-3 py-4">
          <p className="text-status-danger text-sm">
            {errorMessage ?? `Could not load ${label}.`}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-border-strong px-3 py-2 text-sm hover:bg-surface-overlay min-h-11"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {state === "success" && children}
    </div>
  );
}