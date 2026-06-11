import { unstable_cache } from "next/cache";
import { engerClient, dbConfigured } from "./supabase";

// 「承認済み企業」＝打ち合わせ完了（承認）済みの企業。
//   判定は CompaniesView の isMeetingDone と同じ：
//     companies.meeting_done = true  OR  meetings に company_name の記録がある。
//   案件/人材の詳細・ドロワーで「承認済み / 未承認」バッジを出すために、
//   承認済み企業名の集合を取得する（軽量・キャッシュ）。

const norm = (s?: string | null) => (s ?? "").trim();

async function fetchApprovedCompanyNames(): Promise<string[]> {
  if (!dbConfigured) return [];
  const sb = engerClient();
  const set = new Set<string>();
  // ① 手動の打合せ完了フラグ
  try {
    const { data } = await sb.from("companies").select("name").eq("meeting_done", true).limit(10000);
    for (const r of data ?? []) { const n = norm((r as any).name); if (n) set.add(n); }
  } catch { /* meeting_done 列未整備は無視 */ }
  // ② 打合せ記録がある企業（自動で「済」）
  try {
    const { data } = await sb.from("meetings").select("company_name").not("company_name", "is", null).limit(20000);
    for (const r of data ?? []) { const n = norm((r as any).company_name); if (n) set.add(n); }
  } catch { /* meetings 未整備は無視 */ }
  return [...set];
}

// 60秒キャッシュ。打合せ完了トグル時に revalidateTag("approved-companies") で即時更新。
export const getApprovedCompanyNames = unstable_cache(fetchApprovedCompanyNames, ["approved-companies"], {
  revalidate: 60,
  tags: ["approved-companies"],
});

/** 承認済み企業名の Set を取得（呼び出し側はこれで has() 判定）。 */
export async function getApprovedCompanySet(): Promise<Set<string>> {
  return new Set(await getApprovedCompanyNames());
}

/** name が承認済み（打合せ済）か。前後空白は無視。 */
export function isCompanyApproved(approved: Set<string>, name?: string | null): boolean {
  const n = norm(name);
  return !!n && approved.has(n);
}
