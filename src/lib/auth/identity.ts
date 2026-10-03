import type { Role } from "@/types/domain";

/**
 * Who gets which role after signing in (T083).
 *
 * WHY ROLES ARE NOT SELF-DECLARED
 * -------------------------------
 * The role is NEVER taken from the identity provider, a form field, or a query
 * parameter. A verified Google account proves only that someone controls that
 * email — it says nothing about what they may see in this tool. If the IdP could
 * grant a role, anyone able to create a Google account with a matching-looking
 * address would inherit HR admin over live employee data.
 *
 * So identity and authorization are kept strictly separate:
 *
 *   identity   -> "who is this person"      = the verified Google email
 *   authority  -> "what may they see"       = this module's env allowlists
 *
 * `HR_ADMIN_EMAILS` is the authority for the widest role. Anyone else whose email
 * appears in the roster is a `new_hire` scoped to their OWN row, found by email
 * lookup. Anyone else is REFUSED.
 *
 * A roster lookup is the fallback, not the grant: being in the sheet means "this
 * person is an employee", not "this person is an administrator".
 *
 * WHY THIS LIVES IN ENV AND NOT THE SHEET
 * ---------------------------------------
 * The sheet's `role` column holds JOB TITLES ("Developer - Lead", "QA Engineer"),
 * not access roles — the two vocabularies share nothing. Writing `hr_admin` into a
 * job-title column would mean an Apps Script webhook that can write `role` could
 * silently promote itself. See scripts/apps-script/onboarding-webhook.gs, where
 * `role` is in WRITABLE_COLUMNS.
 */

/**
 * The only roster fields this module needs.
 *
 * Structural on purpose: the resolver takes whatever `ingestRoster` produces
 * (`EmployeeRow`) without importing that type, so this file cannot break when the
 * ingest shape changes and does not pretend to need fields it never reads.
 */
export interface RosterIdentity {
  id: string;
  email: string | null;
}

export interface ResolvedIdentity {
  role: Role;
  /** The employee's own row, when they are in the roster. */
  selfId?: string;
  /** Employee ids a manager may see. Null for anyone without a reporting line. */
  scopedEmployeeIds: string[] | null;
}

export class UnrecognizedIdentityError extends Error {
  constructor(readonly email: string) {
    super(
      `${email} is not recognized. Add the address to HR_ADMIN_EMAILS or MANAGER_EMAILS, ` +
        `or add a roster row for them, then sign in again.`,
    );
    this.name = "UnrecognizedIdentityError";
  }
}

/**
 * Parse an allowlist env var. Comma or whitespace separated, case-insensitive.
 *
 * Tolerates a trailing comma and stray whitespace because these are hand-edited
 * lists, and a list that silently loses its last entry because of a trailing
 * comma is a genuinely nasty auth failure to debug.
 */
function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

/** Emails allowed to administer. Highest authority; matched first. */
export function adminEmails(): string[] {
  return parseList(process.env.HR_ADMIN_EMAILS);
}

/** Emails allowed the scoped manager view. */
export function managerEmails(): string[] {
  return parseList(process.env.MANAGER_EMAILS);
}

/**
 * Resolve a verified email to a role.
 *
 * `selfId` / `scopedEmployeeIds` come from the roster so a `new_hire` can
 * actually identify their own record and a `manager` has a reporting line. Both
 * are looked up by email because the IdP gives us an email and nothing else.
 *
 * Throws `UnrecognizedIdentityError` rather than defaulting to a role. An
 * unrecognized signer-in is a question for a human, not something to paper over
 * with a permissive default.
 */
export function resolveIdentity(
  email: string,
  roster: readonly RosterIdentity[] = [],
): ResolvedIdentity {
  const normalized = email.trim().toLowerCase();

  if (normalized.length === 0) {
    throw new UnrecognizedIdentityError(email);
  }

  const self = roster.find((e) => e.email?.trim().toLowerCase() === normalized);

  if (adminEmails().includes(normalized)) {
    // hr_admin sees everything, so there is no meaningful scope to record.
    return { role: "hr_admin", selfId: self?.id, scopedEmployeeIds: null };
  }

  if (managerEmails().includes(normalized)) {
    // A manager's scope is their reporting line. `MANAGER_SCOPE_<local-part>` is
    // deliberately NOT supported: scope belongs to the roster, not to config, or
    // two sources of truth drift.
    return {
      role: "manager",
      selfId: self?.id,
      scopedEmployeeIds: self ? [self.id] : [],
    };
  }

  // Everyone else must be an actual employee, scoped to their own row only.
  if (self) {
    return { role: "new_hire", selfId: self.id, scopedEmployeeIds: [self.id] };
  }

  throw new UnrecognizedIdentityError(email);
}

/** Whether sign-in is possible at all. The login page renders a setup notice if not. */
export function isGoogleAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * The exact redirect URI registered with the OAuth client.
 *
 * Derived from the request when unset, but an explicit value should be set in any
 * deployed environment: proxies rewrite Host, and a redirect_uri mismatch is the
 * single most common cause of a silent OAuth failure.
 */
export function oauthRedirectUri(requestUrl?: string): string {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI) return process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!requestUrl) throw new Error("GOOGLE_OAUTH_REDIRECT_URI is not configured");
  return new URL("/api/auth/google/callback", requestUrl).toString();
}

/** Never log the full allowlist — it is a list of employee addresses. */
export function describeAuthConfig(): string {
  const admins = adminEmails().length;
  const managers = managerEmails().length;
  if (!isGoogleAuthConfigured()) return "Google sign-in is NOT configured";
  return `Google sign-in configured — ${admins} admin, ${managers} manager allowlist entr${
    admins === 1 && managers === 1 ? "y" : "ies"
  }`;
}