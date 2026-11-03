import { Suspense } from "react";
import { AcceptInviteForm } from "@/components/groups/accept-invite-form";
import { getCurrentSession } from "@/lib/auth/session";
import Link from "next/link";

async function InviteContent({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getCurrentSession();
  return <main className="mx-auto max-w-md space-y-5 px-5 py-12">
    <h1 className="font-heading text-2xl font-semibold">Tham gia nhóm chi tiêu</h1>
    {session?.user ? <AcceptInviteForm token={token}/> : <div className="space-y-2">
      <p>Đăng nhập để chấp nhận lời mời.</p>
      <Link className="underline" href={`/sign-in?returnTo=${encodeURIComponent(`/invite/${token}`)}`}>Đăng nhập</Link>
    </div>}
  </main>;
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-6" role="status">Đang mở lời mời...</main>}>
      <InviteContent params={params} />
    </Suspense>
  );
}
