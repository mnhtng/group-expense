import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import {
  classifyRoute,
  isAllowedApiMutation,
  safeReturnTo,
} from "./lib/security/route-policy";

function addSecurityHeaders(response: NextResponse, kind: ReturnType<typeof classifyRoute>) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (kind === "private-api" || kind === "private-page") {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.append("Vary", "Cookie");
  }
  return response;
}

export function proxy(request: NextRequest) {
  const kind = classifyRoute(request.nextUrl.pathname);
  if (kind === "auth-api" || kind === "internal-cron" || kind === "public-page") {
    return addSecurityHeaders(NextResponse.next(), kind);
  }

  // Cookie presence optimizes anonymous routing, it never authenticates users.
  // A forged/expired cookie is rejected downstream by requireUser/getSession.
  if (!getSessionCookie(request)) {
    if (kind === "private-api") {
      return addSecurityHeaders(
        NextResponse.json({ error: "Chưa đăng nhập.", code: "UNAUTHENTICATED" },
          { status: 401 }),
        kind,
      );
    }
    const target = request.nextUrl.clone();
    target.pathname = "/sign-in";
    target.search = "";
    target.searchParams.set(
      "returnTo",
      safeReturnTo(request.nextUrl.pathname + request.nextUrl.search),
    );
    return addSecurityHeaders(NextResponse.redirect(target), kind);
  }

  if (kind === "private-api" && !isAllowedApiMutation(
    request.method,
    // Next.js can normalize nextUrl.host to localhost in local server mode.
    // Host reflects the authority the browser actually requested.
    `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`,
    request.headers.get("origin"),
    request.headers.get("sec-fetch-site"),
  )) {
    return addSecurityHeaders(
      NextResponse.json({ error: "Yêu cầu không cùng nguồn.", code: "INVALID_ORIGIN" },
        { status: 403 }),
      kind,
    );
  }

  return addSecurityHeaders(NextResponse.next(), kind);
}

// Matches application pages and APIs; leaves static assets and the public SW
// untouched. Keep this literal: Next.js requires a compile-time matcher.
export const config = {
  matcher: [
    // All APIs are matched explicitly, including paths containing a dot.
    "/api/:path*",
    "/((?!api(?:/|$)|_next/|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|sw.js|offline.html|robots.txt|sitemap.xml|.*\\.[a-zA-Z0-9]{2,8}$).*)",
  ],
};
