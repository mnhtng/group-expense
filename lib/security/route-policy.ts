/**
 * Central ingress policy for Next.js 16 Proxy.
 *
 * This is intentionally an *optimistic* routing guard. A session cookie is
 * NOT proof of authentication. Pages, route handlers and database services
 * still verify the Better Auth session and entity permissions.
 */
export type RouteKind =
  | "public-page" | "auth-api" | "internal-cron"
  | "private-page" | "private-api";

function routeIs(path: string, root: string): boolean {
  return path === root || path.startsWith(root + "/");
}

export function classifyRoute(pathname: string): RouteKind {
  if (routeIs(pathname, "/api/auth")) return "auth-api";
  if (pathname === "/api/internal/push-drain") return "internal-cron";
  if (routeIs(pathname, "/api")) return "private-api";

  if (
    pathname === "/" ||
    routeIs(pathname, "/sign-in") ||
    routeIs(pathname, "/sign-up") ||
    routeIs(pathname, "/invite")
  ) return "public-page";

  // Default-deny future application pages until their server-side auth is wired.
  return "private-page";
}

export function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

/**
 * API cookie-authenticated writes must have an exact same-origin Origin.
 * Also reject cross-site Fetch Metadata. Do not accept sibling subdomains.
 * Better Auth owns its own CSRF checks; internal cron uses Bearer auth.
 * Next.js Server Actions are handled by Next.js' built-in origin protections.
 */
export function isAllowedApiMutation(
  method: string,
  requestOrigin: string,
  originHeader: string | null,
  fetchSite: string | null,
): boolean {
  if (!isUnsafeMethod(method)) return true;
  if (fetchSite === "cross-site") return false;
  if (!originHeader || originHeader === "null") return false;
  try {
    const supplied = new URL(originHeader);
    const expected = new URL(requestOrigin);
    return (
      supplied.origin === expected.origin &&
      supplied.href === supplied.origin + "/" &&
      !supplied.username &&
      !supplied.password
    );
  } catch {
    return false;
  }
}

/**
 * Only a relative path inside this app is allowed for post-login navigation.
 * Prevent protocol-relative redirects and backslash/encoded-slash confusion.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  const fallback = "/groups";
  if (
    !raw ||
    raw.length > 2048 ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    /%(?:2f|5c|0d|0a|00)/i.test(raw)
  ) return fallback;
  try {
    const base = "https://local.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base || !url.pathname.startsWith("/")) return fallback;
    if (
      routeIs(url.pathname, "/api") ||
      routeIs(url.pathname, "/sign-in") ||
      routeIs(url.pathname, "/sign-up")
    ) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
