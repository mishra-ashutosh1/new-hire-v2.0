"use client";

import { useState } from "react";

import { Card, Field } from "@/components/ui";

/**
 * Passcode sign-in form.
 *
 * A client component because submitting must not navigate — the error has to
 * render in place, and a form POST would leave the user on a dead page.
 *
 * Deliberately has NO client-side length validation or hint about passcode length.
 * Anything the browser knows, an attacker replaying the request also knows.
 */
export function PasscodeForm({ configured }: { configured: boolean }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/passcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (response.ok) {
        window.location.assign("/");
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      setError(
        body?.error?.code === "rate_limited"
          ? "Too many attempts. Wait a few minutes and try again."
          : "That passcode was not accepted.",
      );
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!configured) return null;

  return (
    <form onSubmit={submit} data-testid="passcode-form">
      <Card>
        <div className="flex flex-col gap-4">
          <Field label="Passcode" htmlFor="passcode">
            <input
              id="passcode"
              name="passcode"
              type="password"
              autoComplete="current-password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              className="min-h-11 w-full rounded-md border border-border-strong bg-surface-input px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:ring-2 focus:ring-accent-glow"
            />
          </Field>

          {error ? (
            <p role="alert" data-testid="passcode-error" className="text-sm text-status-danger">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy || passcode.length === 0}
            className="min-h-11 w-full rounded-md border border-border-strong px-4 text-sm font-medium text-text-primary transition-colors hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Checking…" : "Sign in with a passcode"}
          </button>

          <p className="text-caption text-text-tertiary">
            A passcode grants a role, not a person — so it cannot open an individual
            employee&apos;s own record. Use Google sign-in for that.
          </p>
        </div>
      </Card>
    </form>
  );
}