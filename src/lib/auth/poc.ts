/**
 * POC mode for new-hire provisioning (T066).
 *
 * WHAT THIS IS
 * ------------
 * A demo switch. With `NEW_HIRE_POC_MODE=true` the Provision New Hire page and
 * `POST /api/admin/new-hire` skip the session and role checks, so the flow can be
 * demonstrated without signing in first.
 *
 * WHY IT IS A FLAG AND NOT A DELETION
 * -----------------------------------
 * Removing the checks outright would leave this as the ONLY unauthenticated write
 * endpoint in the app — every other route still calls `getSession()`, so the
 * boundary would look intact while having exactly one hole in it, and that hole
 * writes to the live roster. A flag keeps the real enforcement in the code, makes
 * the bypass greppable, and means turning it off restores the previous behaviour
 * with no diff to reason about.
 *
 * It defaults OFF: only the literal string `true` enables it, so a deploy that
 * never sets it keeps enforcing authentication.
 *
 * WHAT IT DOES NOT CHANGE
 * -----------------------
 * Schema validation, the `X-Request-Id` duplicate guard, `ADMIN_CONTRACT_VERIFIED`,
 * and `NEW_HIRE_DRY_RUN` all still apply. Skipping authentication does not imply
 * skipping validation, and in a POC the dry run is usually what makes the demo
 * safe — turning auth off is not a licence to write to the sheet.
 */
export const POC_MODE_ENABLED = process.env.NEW_HIRE_POC_MODE === "true";

/**
 * Audit actor for an unauthenticated request.
 *
 * The audit trail records `actor_email` from the session and must never take it
 * from the client. In POC mode there is no session, so this fixed value is used —
 * an audit row that says who did it is still required; one that says "unknown" for
 * every row is not evidence of anything.
 */
export const POC_ACTOR_EMAIL = "poc@local";