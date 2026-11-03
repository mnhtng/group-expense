import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { listPersonalSettlements } from "@/lib/settlements/service";
import { settlementErrorResponse } from "@/lib/settlements/http";

export const GET = withAuthenticatedApi(async (_request, _context, user) => {
  try {
    return NextResponse.json({ settlements: await listPersonalSettlements(user.id) });
  } catch (error) {
    return settlementErrorResponse(error);
  }
});
