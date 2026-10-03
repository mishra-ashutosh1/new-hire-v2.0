/**
 * Upstream kill switch for per-employee progress reads.
 *
 * HISTORY — WHY THIS FLAG EXISTED
 * --------------------------------
 * The live `Check Onboarding Progress` n8n workflow contained an active
 * googleSheets node, "Update Onboarding Stage", mapped as
 *   onboarding_stage: = {{ $('...').first().json.body.onboarding_stage }}
 * It wrote an **empty string** to the sheet's `onboarding_stage` column on any
 * request that omitted the field, instead of skipping the row.
 *
 * Confirmed live 2026-10-02: column I held `Not Started` / `In Progress` /
 * `Not Started, In Progress` / `Completed` early in the session and was blank
 * for every row by the end of it. Column H followed, being the formula
 * `=IF(I{r}="","",COUNTA(SPLIT(I{r},",",FALSE,TRUE)))`.
 *
 * This was never only a hazard of *probing* the webhook. `GET /api/tracker`
 * fans out one such read per employee and `EmployeeTable` polls every 30s, so
 * the application wiped the SSOT continuously on its own, and
 * `GET /api/tracker/[id]` did it once per page view. That is why the fan-out
 * shipped disabled.
 *
 * STATUS — FIXED AND VERIFIED 2026-10-03
 * --------------------------------------
 * The workflow's update node is now gated behind `requested_stage_update`, so a
 * read that omits `onboarding_stage` writes nothing. Proven, not assumed:
 *
 *   - Seeded row 1302 through the workflow's own write path
 *     (`{temp_emp_id, onboarding_stage:"Not Started"}`) — the cell now holds a
 *     value, so a `""`-over-`""` write can no longer hide.
 *   - Issued a plain read with no `onboarding_stage`. The cell still read
 *     `Not Started`; it was not blanked.
 *   - Enabled the fan-out and issued a real `GET /api/tracker` covering all four
 *     roster rows. Column I was byte-identical before and after.
 *
 * `npm run verify:progress` re-runs that proof against a TEST row and refuses
 * any id that looks like a real employee.
 *
 * WHY THE FLAG STILL EXISTS
 * -------------------------
 * It is now a **kill switch, not a mitigation**: a workflow edit can regress
 * the gate silently, exactly as the contract drift this project already guards
 * against elsewhere. Setting `TRACKER_PROGRESS_FANOUT=false` restores the old
 * behaviour (progress reported as unavailable, employee block still served from
 * the sheet) without a code change or deploy. Default stays off so that an
 * environment which never opted in cannot start issuing per-employee reads.
 */
export const PROGRESS_FANOUT_ENABLED = process.env.TRACKER_PROGRESS_FANOUT === "true";

/**
 * Operator-facing explanation, reused so both routes say the same thing.
 *
 * This is only ever surfaced while the kill switch is OFF. It deliberately does
 * NOT claim the upstream workflow is destructive any more, because that is no
 * longer true and a stale warning would train operators to ignore it.
 */
export const PROGRESS_READ_DISABLED =
  "Per-employee progress reads are disabled by TRACKER_PROGRESS_FANOUT. The upstream " +
  "onboarding-progress workflow no longer writes on read (its update node is gated behind " +
  "requested_stage_update, verified 2026-10-03), so this flag is now a kill switch rather " +
  "than a workaround. Set TRACKER_PROGRESS_FANOUT=true to enable progress; the employee " +
  "block below is served from the sheet either way.";