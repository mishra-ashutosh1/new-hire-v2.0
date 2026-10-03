import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";

/**
 * Who am I? (T083)
 *
 * Returns the session's identity and which modules it can reach, so the UI can
 * hide what is not permitted instead of rendering a 403 on click. This is
 * PRESENTATION ONLY — `canAccessModule` in the API routes remains the actual
 * gate. Hiding a nav item is not access control.
 *
 * Reports configuration without leaking it: enough for an operator to tell
 * "not set up" from "set up but you are not on the list", never the addresses.
 */
export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json(
      {
        authenticated: false,
        authConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      },
      { status: 401 },
    );
  }

  const { canAccessModule } = await import("@/lib/auth/session");
  const modules = ["dashboard", "tracker", "welcome", "policies", "new-hire"] as const;

  return NextResponse.json({
    authenticated: true,
    email: session.email,
    role: session.role,
    selfId: session.selfId ?? null,
    modules: Object.fromEntries(
      modules.map((m) => [m, canAccessModule(session.role, m)]),
    ),
  });
}