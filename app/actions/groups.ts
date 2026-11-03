"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { acceptInvite, archiveGroup, createGroup, createInvite, renameGroup, removeMember } from "@/lib/groups/service";

export async function createGroupAction(form: FormData) {
  const user = await requireUser();
  const id = await createGroup(user.id, String(form.get("name") ?? ""), String(form.get("note") ?? ""));
  revalidatePath("/groups");
  redirect(`/groups/${id}`);
}

export async function renameGroupAction(form: FormData) {
  const user = await requireUser();
  await renameGroup(String(form.get("groupId") ?? ""), user.id, String(form.get("name") ?? ""), String(form.get("note") ?? ""));
  revalidatePath("/groups");
}

export async function archiveGroupAction(form: FormData) {
  const user = await requireUser();
  await archiveGroup(
    String(form.get("groupId") ?? ""),
    user.id,
    String(form.get("confirmation") ?? ""),
    String(form.get("note") ?? ""),
  );
  revalidatePath("/groups");
  redirect("/groups");
}

export async function createInviteAction(form: FormData) {
  const user = await requireUser();
  const groupId = String(form.get("groupId") ?? "");
  const token = await createInvite(groupId, user.id, String(form.get("note") ?? ""));
  redirect(`/groups/${groupId}/manage?invite=${encodeURIComponent(token)}`);
}

export async function acceptInviteAction(form: FormData) {
  const user = await requireUser();
  const groupId = await acceptInvite(user.id, String(form.get("token") ?? ""), String(form.get("note") ?? ""));
  revalidatePath("/groups");
  redirect(`/groups/${groupId}`);
}

export async function removeMemberAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("groupId") ?? "");
  await removeMember(id, user.id, String(form.get("memberId") ?? ""));
  revalidatePath(`/groups/${id}`);
}
