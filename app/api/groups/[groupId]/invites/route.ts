import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { createInvite } from "@/lib/groups/service";
import { optionalNote } from "@/lib/notes";

type Ctx = { params: Promise<{ groupId: string }> };
export const POST = withAuthenticatedApi<Ctx>(async (request, { params }, user) => {
  const { groupId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(groupId)) {
    return NextResponse.json({ error: "Nhóm không hợp lệ." }, { status: 400 });
  }
  let note: string | null;
  try {
    const body:unknown = await request.json();
    note = optionalNote(typeof body==="object"&&body!==null&&"note" in body ? (body as {note:unknown}).note : undefined);
  } catch {return NextResponse.json({error:"Dữ liệu hoặc ghi chú không hợp lệ."},{status:400});}
  try {
    const token = await createInvite(groupId, user.id,note??"");
    // The client builds the URL using its current origin, so Preview and
    // Production links always point to the environment being used.
    return NextResponse.json({ token }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không tạo được link mời.";
    return NextResponse.json(
      { error: message },
      { status: /quyền/i.test(message) ? 403 : /không tìm thấy/i.test(message) ? 404 : 500 },
    );
  }
});
