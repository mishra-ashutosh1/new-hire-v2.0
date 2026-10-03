import { STAGES, type Stage } from "@/types/domain";

/**
 * Display-only stage reconciliation.
 *
 * The tracker UI renders a human label; it does NOT need a canonical `Stage`.
 * These helpers therefore exist purely to make the sheet's coarse labels
 * readable, and they deliberately have no effect on the stage-update guard in
 * POST /api/tracker/[id]/stage, which keeps using `STAGES` ordering directly.
 *
 * WHY THIS IS NEEDED (observed live 2026-10-02)
 * ---------------------------------------------
 * Sheet1 column I `onboarding_stage` holds COARSE labels:
 *   "Not Started" | "In Progress" | "Completed"
 * ...including multi-value chips output such as "Not Started, In Progress".
 *
 * `STAGES` is the FINE-grained ordered vocabulary:
 *   not_started, it_setup, orientation, meet_and_greet, task_complete,
 *   status_confirmed, complete
 *
 * The two vocabularies share no literal value, so a strict `STAGES.includes()`
 * check rejects everything and every stage renders blank. Note that "In Progress"
 * has NO unambiguous canonical equivalent — it spans four of the fine-grained
 * stages — so it is deliberately left unresolved rather than being guessed.
 * Guessing it would silently fabricate workflow detail the sheet does not have.
 */

/** Human label for each canonical stage. */
export const STAGE_LABELS: Record<Stage, string> = {
  not_started: "Not Started",
  it_setup: "IT Setup",
  orientation: "Orientation",
  meet_and_greet: "Meet & Greet",
  task_complete: "Task Complete",
  status_confirmed: "Status Confirmed",
  complete: "Complete",
};

/**
 * Sheet label -> canonical stage, for UNAMBIGUOUS pairs only.
 *
 * Keys are normalized: trimmed, lowercased, internal whitespace collapsed.
 * Deliberately absent: "in progress" / "in_progress", which spans
 * it_setup/orientation/meet_and_greet/task_complete and has no single answer.
 */
const SHEET_STAGE_ALIASES: Record<string, Stage> = {
  "not started": "not_started",
  notstarted: "not_started",
  not_started: "not_started",
  // The live Admin workflow's `Validate New Hire1` node defaults
  // `onboarding_stage` to 'Day 0' when the caller omits it (observed in the
  // node source, 2026-10-02). A third coarse vocabulary, outside both the sheet
  // labels and STAGES.
  "day 0": "not_started",
  "day0": "not_started",
  complete: "complete",
  completed: "complete",
  done: "complete",
  finished: "complete",
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Resolve one single (non-multi-value) sheet label to a canonical stage. */
export function resolveStage(raw: string | null | undefined): Stage | null {
  if (typeof raw !== "string") return null;
  const key = normalizeKey(raw);
  if (!key) return null;
  return SHEET_STAGE_ALIASES[key] ?? null;
}

/**
 * Resolve a raw `onboarding_stage` cell to a human-readable label.
 *
 * Column I is a MULTI-VALUE chips column, so a cell can hold several values
 * ("Not Started, In Progress"). Every distinct token is rendered, resolved where
 * possible and passed through verbatim where not — a chips cell is a SET of
 * selected values, not an ordered log, so there is no defensible "most advanced"
 * token to pick, and silently dropping the rest would fabricate a single stage
 * the sheet does not assert. `"Not Started, In Progress"` renders as
 * `"Not Started, In Progress"`, not `"In Progress"`.
 *
 * Returns null only when there is nothing to show.
 */
export function toDisplayStage(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  const tokens = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) return null;

  const seen = new Set<string>();
  const labels: string[] = [];
  for (const token of tokens) {
    const stage = resolveStage(token);
    const label = stage ? STAGE_LABELS[stage] : token;
    // A cell like "Not Started, not started" should not render twice.
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }

  return labels.length > 0 ? labels.join(", ") : null;
}

/** Canonical ordering index, for callers that must compare stages. */
export function stageRank(stage: Stage | null): number {
  if (!stage) return -1;
  return (STAGES as readonly string[]).indexOf(stage);
}