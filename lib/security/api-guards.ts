import "server-only";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";

export type VerifiedUser =
  NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>["user"];

type VerifiedHandler<Context> = (
  request: Request,
  context: Context,
  user: VerifiedUser,
) => Promise<Response> | Response;

/**
 * A reusable, DB-verified auth boundary for financial API handlers.
 * Unlike the optimistic Proxy, this verifies the Better Auth session.
 * Authorization of group IDs, roles and individual rows belongs in
 * the data access/service layer and must never rely on request headers.
 */
export function withAuthenticatedApi<Context = unknown>(
  handler: VerifiedHandler<Context>,
) {
  return async (request: Request, context: Context): Promise<Response> => {
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Chưa đăng nhập.", code: "UNAUTHENTICATED" },
        { status: 401, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
      );
    }
    const response = await handler(request, context, session.user);
    response.headers.set("Cache-Control", "private, no-store");
    const vary = response.headers.get("Vary") ?? "";
    if (!vary.split(",").some(value => value.trim().toLowerCase() === "cookie")) {
      response.headers.set("Vary", vary ? vary + ", Cookie" : "Cookie");
    }
    return response;
  };
}
