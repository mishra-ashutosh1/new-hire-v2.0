import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { COOKIE_NAME, MAX_AGE_SECONDS, createSessionToken } from "@/lib/auth/session";
import { isPasscodeAuthConfigured, roleForPasscode } from "@/lib/auth/passcode";
import { PASSCODE_POLICY, consume, peek } from "@/lib/auth/rate-limit";

/**
 * Passcode sign-in (T083).
 *
 * POST /api/auth/passcode  { "passcode": "XXXXX-XXXXX-XXXXX-XXXXX" }
 *
 * Issues the SAME signed session cookie as the Google flow, so nothing downstream
 * knows or cares which door the user came through.
 *
 * Two properties worth stating:
 *
 * - A wrong passcode and a right passcode that matches nothing produce the SAME
 *   response and the same wording. Distinguishing them would help an attacker
 *   enumerate valid passcodes.
 * - The rate limiter is checked BEFORE hashing. scrypt is deliberately slow, and
 *   without the limit that slowness is free compute handed to an attacker; with it,
 *   the cost is paid at most 5 times per 15 minutes.
 */

/**
 * Best-effort client IP.
 *
 * `x-forwarded-for` is client-controlled and is trusted here ONLY to slow guessing
 * down, never to grant anything — a spoofed value cannot bypass the passcode, and
 * spoofing it away from a locked-out bucket merely moves the attacker to their next
 * address. On a platform that strips it, every caller shares one bucket, which is
 * stricter, not weaker.
 */
function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `passcode:${ip}`;
}

function deny(request: Request, error: string, retryAfterSeconds: number) {
  const response = NextResponse.json(
    { error: { code: error, message: "That passcode was not accepted." } },
    { status: error === "rate_limited" ? 429 : 401 },
  );
  if (retryAfterSeconds > 0) response.headers.set("Retry-After", String(retryAfterSeconds));
  void request;
  return response;
}

export async function POST(request: Request) {
  if (!isPasscodeAuthConfigured()) {
    return NextResponse.json(
      {
        error: {
          code: "not_configured",
          message: "Passcode sign-in is not configured. Set HR_ADMIN_PASSCODE_HASH.",
        },
      },
      { status: 503 },
    );
  }

  const key = clientKey(request);
  const now = Date.now();

  // Check first so a locked-out caller never reaches the scrypt cost.
  const current = peek(key, PASSCODE_POLICY, now);
  if (!current.allowed) return deny(request, "rate_limited", current.retryAfterSeconds);

  const limit = consume(key, PASSCODE_POLICY, now);
  if (!limit.allowed) return deny(request, "rate_limited", limit.retryAfterSeconds);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return deny(request, "invalid_request", 0);
  }

  const passcode =
    typeof body === "object" && body !== null && "passcode" in body
      ? String((body as { passcode: unknown }).passcode ?? "")
      : "";

  // A generous ceiling: a human cannot type 10k characters, and refusing absurd
  // input before hashing keeps the limiter from being bypassed with huge bodies.
  if (passcode.length > 256) return deny(request, "invalid_request", 0);

  const role = roleForPasscode(passcode);
  if (!role) return deny(request, "invalid_passcode", limit.retryAfterSeconds);

  // The session has no `email`. Passcode auth identifies a ROLE, not a person, and
  // inventing an identity here would put a fabricated address into the audit trail
  // and into anything downstream that reads `session.email`.
  const response = NextResponse.json({ ok: true, role }, { status: 200 });
  response.cookies.set(
    COOKIE_NAME,
    createSessionToken({ email: `passcode:${role}`, role, scopedEmployeeIds: null }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    },
  );
  return response;
}