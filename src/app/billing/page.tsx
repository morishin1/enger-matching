import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** 請求・勤怠は「稼働・請求/勤怠」(/progress) に統合。旧URLはリダイレクト。 */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period } = await searchParams;
  redirect(period && /^\d{4}-\d{2}$/.test(period) ? `/progress?period=${period}` : "/progress");
}
