import { getRoster } from "@/lib/sheets/cache";
import { ingestRoster } from "@/lib/sheets/ingest";

/**
 * Suggest the next `temp_emp_id` (T064).
 *
 * WHY A SUGGESTION AND NOT A GENERATED ID
 * --------------------------------------
 * `temp_emp_id` is caller-assigned — the workflow's `Validate New Hire1` node
 * REQUIRES it and errors when it is absent — so someone has to supply it. But
 * making HR invent one by hand is how you get `EMP-001` typed next to `1204` in the
 * same column, and the ids key every downstream webhook lookup.
 *
 * So: suggest the next free numeric id, and let HR override it. Overriding is
 * essential, because ids may also be issued by another system and this suggestion
 * cannot see it.
 *
 * Only purely numeric ids are considered. `EMP001`-style ids are ignored rather
 * than parsed, so a mixed column cannot produce a nonsense suggestion.
 */
export interface IdSuggestion {
  /** The proposed id, or null when it cannot be determined. */
  suggested: string | null;
  /** Ids already in use, so the form can warn about a collision before submitting. */
  taken: string[];
  /** Why there is no suggestion, when there is none. */
  reason?: string;
}

export async function suggestNextTempEmpId(): Promise<IdSuggestion> {
  let ids: string[];
  try {
    const { result } = await getRoster();
    ids = ingestRoster(result.rows).employees.map((e) => e.id);
  } catch {
    return {
      suggested: null,
      taken: [],
      reason:
        "The roster could not be read, so no identifier is suggested. Enter one manually.",
    };
  }

  const taken = [...ids];
  const numeric = ids
    .map((id) => (/^\d+$/.test(id.trim()) ? Number(id.trim()) : null))
    .filter((n): n is number => n !== null && Number.isSafeInteger(n));

  if (numeric.length === 0) {
    return {
      suggested: null,
      taken,
      reason:
        "No purely numeric identifiers exist in the sheet, so none can be suggested. Enter one manually.",
    };
  }

  return { suggested: String(Math.max(...numeric) + 1), taken, reason: undefined };
}