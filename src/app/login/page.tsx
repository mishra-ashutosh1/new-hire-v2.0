import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { isGoogleAuthConfigured, describeAuthConfig } from "@/lib/auth/identity";
import { isPasscodeAuthConfigured, describePasscodeConfig } from "@/lib/auth/passcode";
import { PasscodeForm } from "@/components/auth/PasscodeForm";
import { Card } from "@/components/ui";

/**
 * Sign-in page (T083).
 *
 * This is the ONLY way to obtain a session outside local development, and it
 * exists because the app previously had no authentication entry point at all —
 * every API returned 401 for every real user, so the portal was unusable in a
 * deployed environment no matter how well the rest of it worked.
 *
 * Three states, and the difference is not cosmetic:
 *   - Google configured   -> one button, which either works or fails loudly
 *   - passcode configured -> the fallback that needs no Cloud project
 *   - neither             -> says WHICH env vars are missing
 *
 * Passcode exists because registering a Google OAuth client requires Cloud project
 * permissions that a Workspace admin holds and an individual operator does not, so
 * "Sign in with Google" was a hard block rather than a setup step.
 *
 * A login page that renders a dead button in an unconfigured state is how
 * "sign-in is broken" gets mistaken for "the database is down".
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  // Demo mode has no sign-in to perform: `getSession()` is already an admin, so
  // the first branch below redirects. Rendering "No sign-in method is configured"
  // here would be the one screen the demo cannot get past.
  const session = await getSession();
  if (session) redirect("/");

  const params = await searchParams;
  const googleReady = isGoogleAuthConfigured();
  const passcodeReady = isPasscodeAuthConfigured();
  const anyMethod = googleReady || passcodeReady;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <span className="eyebrow text-text-tertiary">People Ops</span>
        <h1 className="text-h1">Sign in</h1>
        <p className="text-sm text-text-secondary">
          New-hire onboarding tracker for the HR team. Access is granted from the HR
          allowlist, not from the account you sign in with.
        </p>
      </header>

      {params.error ? <ErrorNotice error={params.error} detail={params.detail} /> : null}

      {googleReady ? (
        <Card>
          <a
            href="/api/auth/google"
            data-testid="google-sign-in"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-accent-500 px-4 text-sm font-medium text-surface-canvas transition-colors hover:bg-accent-400"
          >
            Sign in with Google
          </a>
        </Card>
      ) : null}

      {googleReady && passcodeReady ? (
        <p className="text-center text-caption text-text-tertiary">or</p>
      ) : null}

      <PasscodeForm configured={passcodeReady} />

      {!anyMethod ? (
        <div
          role="status"
          data-testid="auth-not-configured"
          className="rounded-md border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm"
        >
          <p className="font-medium text-text-primary">No sign-in method is configured</p>
          <p className="mt-1 text-text-secondary">
            Fastest: run <code className="mono">npm run auth:passcode</code> and put the
            printed hash in <code className="mono">HR_ADMIN_PASSCODE_HASH</code>. To use Google
            instead, set <code className="mono">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="mono">GOOGLE_CLIENT_SECRET</code> — that needs a Cloud project, which
            a Workspace admin must create.
          </p>
        </div>
      ) : null}

      <p className="text-caption text-text-tertiary">
        {describeAuthConfig()}. {describePasscodeConfig()}. Local development can still mint a
        session with <code className="mono">npm run dev:session</code>.
      </p>
    </main>
  );
}

/**
 * Error notices name the CAUSE, not just "login failed".
 *
 * Each reason below has a different remedy, so collapsing them into one message
 * would make the user's next step guesswork.
 */
const ERRORS: Record<string, { title: string; body: string }> = {
  not_configured: {
    title: "Sign-in is not configured",
    body: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing from this environment.",
  },
  access_denied: {
    title: "Sign-in was cancelled",
    body: "You declined the Google consent screen. Nothing was changed.",
  },
  oauth_error: {
    title: "Google rejected the sign-in",
    body: "The provider returned an error. Check the OAuth client is published and its redirect URI matches exactly.",
  },
  missing_code: {
    title: "Incomplete sign-in",
    body: "The callback arrived without an authorization code. Start again from the sign-in page.",
  },
  state_mismatch: {
    title: "Sign-in could not be verified",
    body: "The request did not match the sign-in this browser started. This is usually a stale tab or a second browser tab finishing an old flow — start again.",
  },
  missing_verifier: {
    title: "Sign-in could not be verified",
    body: "The PKCE verifier was missing, so the exchange was refused. Start again.",
  },
  no_id_token: {
    title: "Identity could not be read",
    body: "Google returned no ID token, so there is no verified identity to sign in with.",
  },
  email_not_verified: {
    title: "That Google account has no verified email",
    body: "Google reports this address as unverified (an unclaimed alias). Use an account with a verified primary address.",
  },
  verification_failed: {
    title: "Identity could not be verified",
    body: "The ID token failed verification — expired, wrong audience, or a replayed code. Start again.",
  },
  not_recognized: {
    title: "This account has no access",
    body: "Your address is not on the HR allowlist and has no roster row. Ask an HR admin to add you.",
  },
  roster_unavailable: {
    title: "The roster could not be read",
    body: "Sign-in was refused rather than granting access without the roster. Try again shortly.",
  },
};

function ErrorNotice({ error, detail }: { error: string; detail?: string }) {
  const known = ERRORS[error];
  return (
    <div
      role="alert"
      data-testid="login-error"
      className="rounded-md border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm"
    >
      <p className="font-medium text-text-primary">{known?.title ?? "Sign-in failed"}</p>
      <p className="mt-1 text-text-secondary">{known?.body ?? "The sign-in flow did not complete."}</p>
      {detail ? <p className="mt-1 mono text-caption text-text-tertiary">{detail}</p> : null}
    </div>
  );
}