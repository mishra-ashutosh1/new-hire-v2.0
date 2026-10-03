import { NextResponse } from "next/server";
import { askPolicy } from "@/lib/n8n/client";
import { classifyPolicy } from "@/lib/policy/classify";
import { policySearchSchema } from "@/lib/contracts/schemas";
import { AuthorizationError, assertModuleAccess, getSession } from "@/lib/auth/session";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/policies/search?q=<question>
 *
 * SEARCH-ONLY by design. Probes confirmed that `category`, `topic`, `query`,
 * `search`, and `action` all return HTTP 400 upstream — only `question` is
 * accepted — so no category browsing or filtering may be offered in the UI
 * until an n8n list mode exists.
 *
 * This route is the enforcement point for the coercion invariant asserted in
 * tests/unit/policy-route.test.ts: it MUST NOT emit the upstream's
 * `{status:"success", answer:""}` shape to the browser.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "authentication required" } },
      { status: 401 },
    );
  }

  try {
    assertModuleAccess(session, "policies");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }

  const question = new URL(request.url).searchParams.get("q") ?? "";
  const parsed = policySearchSchema.safeParse({ q: question });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_QUERY",
          message: "Enter a question to search for a policy.",
          details: parsed.error.issues.map((i) => i.message),
        },
      },
      { status: 400 },
    );
  }

  const upstream = await askPolicy(parsed.data.q);

  if (!upstream.ok && upstream.httpStatus >= 400) {
    return NextResponse.json(
      {
        error: {
          code: "POLICY_UPSTREAM_FAILED",
          message: `The policy service is unavailable (HTTP ${upstream.httpStatus}).`,
          requestId: randomUUID(),
        },
      },
      { status: 502 },
    );
  }

  // classifyPolicy performs the coercion. Its output vocabulary is
  // answered|unanswered|error — the upstream "success" never escapes.
  const result = classifyPolicy(upstream.body);

  return NextResponse.json({
    ...result,
    question: parsed.data.q,
    requestedAt: new Date().toISOString(),
  });
}