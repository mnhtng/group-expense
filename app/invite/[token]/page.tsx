import { acceptInviteAction } from "@/app/actions/groups";
import { getCurrentSession } from "@/lib/auth/session";
import Link from "next/link";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getCurrentSession();
  return <main className="mx-auto max-w-md space-y-5 px-5 py-12">
    <h1 className="font-heading text-2xl font-semibold">Tham gia nhóm chi tiêu</h1>
    {session?.user ? <form action={acceptInviteAction}>
      <input type="hidden" name="token" value={token}/>
      <button className="rounded-xl bg-primary px-4 py-3 text-primary-foreground">Tham gia nhóm</button>
    </form> : <div className="space-y-2">
      <p>Đăng nhập để chấp nhận lời mời.</p>
      <Link className="underline" href={`/sign-in?returnTo=${encodeURIComponent(`/invite/${token}`)}`}>Đăng nhập</Link>
    </div>}
  </main>;
}
