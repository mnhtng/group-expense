import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { listPersonalDebts } from "@/lib/debts/service";

export const GET = withAuthenticatedApi(async (_request, _context, user) =>
  NextResponse.json({ debts: await listPersonalDebts(user.id) }),
);
