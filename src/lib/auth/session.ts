import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "@/types/domain";
import { DEMO_MODE, DEMO_SESSION } from "@/lib/demo";

/**
 * Session and role gate (T017).
 *
 * Authorization runs BEFORE any employee data is fetched upstream. This is not
 * an optimisation — it is the constitution's access-boundary obligation. Hiding
 * a nav item is presentation; it is not access control (FR-023).
 *
 * Deliberately minimal: a signed session cookie carrying a role claim, with
 * RBAC as a switch rather than a policy engine. An auth vendor is unjustified
 * for a single-team internal tool.
 */

const COOKIE_NAME = "portal_session";
const MAX_AGE_SECONDS = 60 * 60 * 8;

export interface Session {
  email: string;
  role: Role;
  /** Manager scope: the employee ids this manager may view. */
  scopedEmployeeIds: string[] | null;
  /**
   * The signed-in user's own employee id, when they are a new hire.
   *
   * Without this a new_hire can be authorized onto a module but has no way to
   * identify WHICH record is theirs, and `canViewEmployee` can only refuse. This
   * is populated at sign-in from the identity provider, never from the client.
   */
  selfId?: string;
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  const minimum = Number(process.env.SESSION_SECRET_MIN_LENGTH ?? "32");
  if (!value || value.length < minimum) {
    // Fail closed. A weak secret silently degrades every authorization check.
    throw new Error(`SESSION_SECRET must be configured with at least ${minimum} characters`);
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!parsed.email || !parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* --- Server-side session access ---------------------------------------- */

export async function getSession(): Promise<Session | null> {
  // Demo mode: every request is the synthetic admin. Placed before the cookie is
  // read so the demo needs no SESSION_SECRET and no sign-in — and so a stale
  // cookie from a real session cannot reach `secret()` and throw.
  if (DEMO_MODE) return { ...DEMO_SESSION };

  const store = await cookies();
  return verifySessionToken(store.get(COOKIE_NAME)?.value);
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new AuthorizationError("authentication required", 401);
  return session;
}

/* --- Module-level authorization ---------------------------------------- */

export type Module = "dashboard" | "tracker" | "welcome" | "policies" | "new-hire";

const MODULE_ACCESS: Record<Module, readonly Role[]> = {
  dashboard: ["hr_admin", "manager", "new_hire"],
  tracker: ["hr_admin", "manager", "new_hire"],
  welcome: ["hr_admin"],
  policies: ["hr_admin", "manager", "new_hire"],
  "new-hire": ["hr_admin"],
};

export function canAccessModule(role: Role, module: Module): boolean {
  return MODULE_ACCESS[module].includes(role);
}

/**
 * Employee scope check. `new_hire` sees only itself; `manager` sees direct
 * reports; `hr_admin` sees everything.
 */
export function canViewEmployee(session: Session, employeeId: string, selfId?: string): boolean {
  if (session.role === "hr_admin") return true;
  if (session.role === "new_hire") return selfId !== undefined && employeeId === selfId;
  return session.scopedEmployeeIds?.includes(employeeId) ?? false;
}

export function assertModuleAccess(session: Session, module: Module): void {
  if (!canAccessModule(session.role, module)) {
    throw new AuthorizationError(`role "${session.role}" cannot access ${module}`, 403);
  }
}

export function assertEmployeeAccess(session: Session, employeeId: string, selfId?: string): void {
  if (!canViewEmployee(session, employeeId, selfId)) {
    throw new AuthorizationError("employee record is outside your scope", 403);
  }
}

export class AuthorizationError extends Error {
  readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

export { COOKIE_NAME, MAX_AGE_SECONDS };