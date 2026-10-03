import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { OAuth2Client } from "google-auth-library";

import { resolveIdentity, oauthRedirectUri, UnrecognizedIdentityError } from "@/lib/auth/identity";
import { COOKIE_NAME, MAX_AGE_SECONDS, createSessionToken } from "@/lib/auth/session";
import { readRoster } from "@/lib/sheets/client";
import { ingestRoster } from "@/lib/sheets/ingest";

/**
 * Google sign-in callback (T083).
 *
 * GET /api/auth/google/callback?code=...&state=...
 *
 * Order of operations is the whole security property of this file:
 *
 *   1. Google's own error passthrough      — don't mask a denial as a bug
 *   2. state matches the cookie            — login CSRF
 *   3. code exchanges for tokens           — the code is single-use
 *   4. id_token VERIFIED by Google         — the email is not self-asserted
 *   5. email_verified is true              — an unverified alias is not an identity
 *   6. role resolved from the ALLOWLIST    — never from the token
 *   7. HttpOnly session cookie set         — cleared if anything above failed
 *
 * Steps 2 and 4 are the ones that are easy to skip and impossible to notice
 * afterwards. Step 6 is the one that decides what this person can see.
 */

const OAUTH_STATE_COOKIE = "portal_oauth_state";
const PKCE_COOKIE = "portal_oauth_pkce";

function fail(request: Request, reason: string, detail?: string): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", reason);
  if (detail) url.searchParams.set("detail", detail);
  const response = NextResponse.redirect(url, { status: 303 });
  // Never leave a half-finished flow's cookies behind on the failure path.
  response.cookies.delete(OAUTH_STATE_COOKIE);
  response.cookies.delete(PKCE_COOKIE);
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // 1. Google said no. Pass the reason through rather than logging a user out
  //    with a generic error they cannot act on.
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const denied = oauthError === "access_denied";
    return fail(request, denied ? "access_denied" : "oauth_error", oauthError);
  }

  if (!code || !state) return fail(request, "missing_code");

  const store = await cookies();
  const expectedState = store.get(OAUTH_STATE_COOKIE)?.value;
  const codeVerifier = store.get(PKCE_COOKIE)?.value;

  // 2. Login CSRF: a callback whose `state` does not match the cookie this
  //    browser was issued is not the continuation of a flow we started.
  if (!expectedState || state !== expectedState) {
    return fail(request, "state_mismatch");
  }
  if (!codeVerifier) return fail(request, "missing_verifier");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail(request, "not_configured");

  // 3 + 4. Exchange the code, then VERIFY the id_token against Google's keys.
  //     `verifyIdToken` checks signature, issuer, audience and expiry. Decoding
  //     the token without verifying it would let anyone mint an admin session.
  let email: string;
  try {
    const client = new OAuth2Client(clientId, clientSecret, oauthRedirectUri(request.url));
    const { tokens } = await client.getToken({
      code,
      codeVerifier,
      redirect_uri: oauthRedirectUri(request.url),
    });
    if (!tokens.id_token) return fail(request, "no_id_token");

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: clientId,
    });
    const payload = ticket.getPayload();

    // 5. Google marks unverified aliases (unclaimed @gmail.com addresses) as
    //    email_verified:false. Treating those as an identity would let anyone
    //    claim an unclaimed address and inherit that employee's access.
    if (!payload?.email || payload.email_verified !== true) {
      return fail(request, "email_not_verified");
    }
    email = payload.email;
  } catch {
    // Deliberately opaque: a token failure can mean a bad clock, a key rotation,
    // or a replayed code, and none of those are the user's problem to solve.
    return fail(request, "verification_failed");
  }

  // 6. Authority is ours, not Google's.
  let identity;
  try {
    const roster = await loadRoster();
    identity = resolveIdentity(email, roster);
  } catch (cause) {
    if (cause instanceof UnrecognizedIdentityError) {
      return fail(request, "not_recognized", email);
    }
    // A roster read failure must NOT fall back to a permissive role. Refusing
    // to sign in is recoverable; silently granting hr_admin is not.
    return fail(request, "roster_unavailable");
  }

  // 7. Issue the session.
  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(COOKIE_NAME, createSessionToken({ email, ...identity }), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  response.cookies.delete(OAUTH_STATE_COOKIE);
  response.cookies.delete(PKCE_COOKIE);
  return response;
}

/**
 * The roster as validated employees, for the email -> row lookup.
 *
 * Deliberately the SAME ingest path every other reader uses, so a quarantined or
 * malformed row can never hand an unvalidated email to the role resolver.
 *
 * Returns [] on failure. The caller treats an empty roster as "nobody matched",
 * which refuses sign-in — never grants it. Refusing because the roster was
 * unreadable is the correct trade against granting hr_admin to a Google account
 * whose email we could not attribute to a row.
 */
async function loadRoster() {
  try {
    const { rows } = await readRoster();
    return ingestRoster(rows).employees;
  } catch {
    return [];
  }
}