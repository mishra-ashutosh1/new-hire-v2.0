import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { COOKIE_NAME } from "@/lib/auth/session";

/**
 * Sign out (T083).
 *
 * POST only. A GET logout can be triggered by any `<img src>` on any page the
 * user visits, so "log me out" must never be reachable by a link prefetch or a
 * cross-site request.
 */
export async function POST(request: Request) {
  const store = await cookies();
  store.delete(COOKIE_NAME);

  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  // Clear with the same attributes the cookie was set with, or some browsers
  // keep the original alongside the deletion.
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}