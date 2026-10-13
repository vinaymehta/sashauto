import { NextResponse, type NextRequest } from "next/server";

// Signed-out visitors go straight to /login before any page renders (no flash of the app first). The backend sets
// the `sash_signed_in` marker cookie at sign-in and clears it at sign-out or when the session has ended. This is
// only an optimistic check: the API still verifies the real session on every request.
export function proxy(request: NextRequest) {
  if (request.cookies.has("sash_signed_in")) return NextResponse.next();
  const login = new URL("/login", request.url);
  return NextResponse.redirect(login);
}

export const config = {
  // Every page except /login, the API (forwarded to Rails), Next.js assets and files with an extension.
  matcher: ["/((?!login|api|_next|.*\\..*).*)"],
};
