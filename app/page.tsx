import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";

export default async function Home() {
  const session = await getCurrentSession();
  redirect(session?.user ? "/groups" : "/sign-in");
}
