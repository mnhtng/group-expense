import { Suspense } from "react";
import { AcceptInviteForm } from "@/components/groups/accept-invite-form";
import { getCurrentSession } from "@/lib/auth/session";
import { getInvitePreview } from "@/lib/groups/service";
import Link from "next/link";

async function InviteContent({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [session, invite] = await Promise.all([getCurrentSession(), getInvitePreview(token)]);
  return <main className="mx-auto max-w-md space-y-5 px-5 py-12">
    <h1 className="font-heading text-2xl font-semibold">Tham gia nhóm chi tiêu</h1>
    {invite?<div className="rounded-xl border bg-card p-4 text-sm"><p className="font-semibold">{invite.groupName}</p>{invite.inviteNote&&<p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">Ghi chú lời mời: {invite.inviteNote}</p>}</div>:<p className="text-sm text-muted-foreground">Liên kết mời không còn hiệu lực.</p>}
    {invite && (session?.user ? <AcceptInviteForm token={token}/> : <div className="space-y-2">
      <p>Đăng nhập để chấp nhận lời mời.</p>
      <Link className="underline" href={`/sign-in?returnTo=${encodeURIComponent(`/invite/${token}`)}`}>Đăng nhập</Link>
    </div>)}
  </main>;
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-6" role="status">Đang mở lời mời...</main>}>
      <InviteContent params={params} />
    </Suspense>
  );
}
