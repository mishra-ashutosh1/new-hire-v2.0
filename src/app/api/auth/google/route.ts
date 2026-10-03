import { NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";

import { isGoogleAuthConfigured, oauthRedirectUri } from "@/lib/auth/identity";

/**
 * Start Google sign-in (T083).
 *
 * GET /api/auth/google -> redirect to Google's consent screen.
 *
 * Three deliberate choices:
 *
 * 1. **PKCE is used even though this is a confidential server-side client.** The
 *    verifier never leaves the server, so it buys nothing against a code
 *    interception here. It is included because it costs one hash and one cookie,
 *    and it means a stolen `code` is useless without also stealing the verifier.
 * 2. **`state` is a random 256-bit value stored in an HttpOnly cookie** and
 *    compared on the callback. Without that comparison this endpoint is an open
 *    redirect that an attacker can use to attach their own Google account to a
 *    victim's browser session (login CSRF).
 * 3. **`prompt=select_account`**, not `consent`. Nobody should be consenting to
 *    scopes on every sign-in; this is a first-party internal tool and the account
 *    chooser is what the user actually needs.
 */

const OAUTH_STATE_COOKIE = "portal_oauth_state";
const PKCE_COOKIE = "portal_oauth_pkce";
/** Short: this window is seconds, not a session. */
const FLOW_TTL_SECONDS = 600;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export async function GET(request: Request) {
  if (!isGoogleAuthConfigured()) {
    // Fail with a page a human can act on rather than a bare 500. A login button
    // that 500s tells an operator nothing about which env var is missing.
    return NextResponse.redirect(
      new URL("/login?error=not_configured", request.url),
      { status: 303 },
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID as string;
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", oauthRedirectUri(request.url));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  // Only ask for a refresh token if one is configured; the default is a
  // single-use code exchange and the session cookie carries its own 8h life.
  url.searchParams.set("access_type", "online");

  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";
  const common = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: FLOW_TTL_SECONDS,
  };
  store.set(OAUTH_STATE_COOKIE, state, common);
  store.set(PKCE_COOKIE, codeVerifier, common);

  return NextResponse.redirect(url.toString(), { status: 303 });
}