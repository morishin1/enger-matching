// 旧 /mail-log は /mail?tab=sent（送信履歴）に統合済み。リダイレクトのみ。
import { redirect } from "next/navigation";
export default async function MailLogRedirect({ searchParams }: { searchParams: Promise<{ q?: string; sender?: string }> }) {
  const { q, sender } = await searchParams;
  const qs = new URLSearchParams({ tab: "sent" });
  if (q) qs.set("q", q);
  if (sender) qs.set("sender", sender);
  redirect(`/mail?${qs.toString()}`);
}
