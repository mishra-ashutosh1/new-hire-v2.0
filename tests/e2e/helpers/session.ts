import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";
import type { Role } from "@/types/domain";

/**
 * Test-only session minting for the E2E suite.
 *
 * Authorization must be tested against real signed tokens, not a stub header —
 * a suite that fakes the session proves nothing about the signature check, the
 * cookie parsing, or the scope lookup. So this signs exactly the token the app
 * would issue.
 *
 * The secret must match the dev server's SESSION_SECRET (see .env.example).
 */

const SECRET = process.env.SESSION_SECRET ?? "e2e-local-only-secret-at-least-32-characters";
const COOKIE_NAME = "portal_session";

interface MintOptions {
  role: Role;
  email?: string;
  scopedEmployeeIds?: string[] | null;
  selfId?: string;
}

/** A Playwright cookie object, for authenticating a PAGE. */
export function testCookie(options: MintOptions): {
  name: string;
  value: string;
} {
  const session = {
    email: options.email ?? `${options.role}@company.com`,
    role: options.role,
    scopedEmployeeIds: options.scopedEmployeeIds ?? null,
    ...(options.selfId ? { selfId: options.selfId } : {}),
  };

  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const signature = createHmac("sha256", SECRET).update(payload).digest("base64url");

  return { name: COOKIE_NAME, value: `${payload}.${signature}` };
}

/** A `cookie:` header value, for authenticating a `request` context. */
export function issueTestSession(options: MintOptions): string {
  const { value } = testCookie(options);
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

/**
 * Authenticate a page as hr_admin.
 *
 * Without this every page renders its 401 error panel, so layout, contrast and
 * responsive assertions would be measuring an error page rather than the real
 * UI — a suite that passes by measuring the wrong thing.
 */
export async function authenticate(page: Page, options: MintOptions = { role: "hr_admin" }): Promise<void> {
  await page.context().addCookies([
    {
      ...testCookie(options),
      url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/** An hr_admin session header, the common case for most specs. */
export function hrAdminSession(): string {
  return issueTestSession({ role: "hr_admin", email: "hr.admin@company.com" });
}
