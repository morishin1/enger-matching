import { unstable_cache } from "next/cache";
import { engerClient, dbConfigured } from "./supabase";

// 「承認済み企業」＝打ち合わせ完了（承認）済みの企業。
//   判定は CompaniesView の isMeetingDone と同じ：
//     companies.meeting_done = true  OR  meetings に company_name の記録がある。
//   案件/人材の詳細・ドロワーで「承認済み / 未承認」バッジを出すために、
//   承認済み企業名の集合を取得する（軽量・キャッシュ）。
//
// バリアント承認（カスケード）:
//   承認済み「株式会社トヨタ」と全く同じ名前だけでなく、その担当者・部署を表す
//   変種（例: 「株式会社トヨタ 営業部」「株式会社トヨタの佐藤」）も承認済み扱いにする。
//   親会社名が変種名の先頭に出現し、かつ直後が「人名・部署名の前に来る区切り（空白・
//   助詞「の」・敬称・スラッシュ等）」である場合に限り承認をカスケードする。
//     - 「株式会社トヨタ 営業部」    → 親「株式会社トヨタ」 + " "（区切り）→ 承認 ✓
//     - 「株式会社トヨタの佐藤」     → 親「株式会社トヨタ」 + "の"        → 承認 ✓
//     - 「トヨタ商事」               → 親「トヨタ」 + "商"（区切りでない） → 承認しない ✓
//     - 「トヨタ自動車」             → 同上                                → 承認しない ✓

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

// 担当者名・部署名・敬称の前に来る区切り文字。完全一致しない名前を変種とみなすかの境界判定。
const VARIANT_BOUNDARY_RE = /^[\s　・/／|｜()（）の様さま殿\-ー－、,。]/;

/** parent が candidate の親（候補）か判定。
 *   - 完全一致は false（呼び出し側で別判定するため）
 *   - candidate が parent で始まり、直後が区切り文字なら true
 */
export function isCompanyVariantOf(parent: string, candidate: string): boolean {
  const p = norm(parent);
  const c = norm(candidate);
  if (!p || !c || p === c) return false;
  if (!c.startsWith(p)) return false;
  return VARIANT_BOUNDARY_RE.test(c.slice(p.length));
}

/** name が承認済みか。前後空白は無視。
 *   ① 完全一致
 *   ② 承認済みの親企業の「担当者/部署バリアント」とみなせるなら承認扱い（カスケード）
 *  approved に Set を渡せば②はスキップ（後方互換）。Iterable<string> を渡せばカスケードを評価。
 */
export function isCompanyApproved(approved: Set<string> | Iterable<string>, name?: string | null): boolean {
  const n = norm(name);
  if (!n) return false;
  // Set 渡し（旧 API）: 完全一致のみ
  if (approved instanceof Set) {
    if (approved.has(n)) return true;
    for (const p of approved) if (isCompanyVariantOf(p, n)) return true;
    return false;
  }
  // Iterable（配列など）: 完全一致 + カスケード
  for (const p of approved) {
    if (p === n) return true;
    if (isCompanyVariantOf(p, n)) return true;
  }
  return false;
}
