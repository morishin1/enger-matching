// 旧 /mailbox は /mail?tab=import（Gmail取込）に統合済み。リダイレクトのみ。
import { redirect } from "next/navigation";
export default async function MailboxRedirect({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  redirect(`/mail?tab=import${filter ? `&filter=${filter}` : ""}`);
}
