import { unstable_cache } from "next/cache";
import { engerClient, dbConfigured } from "./supabase";
import { isCompanyVariantOf } from "./company-approval";

/**
 * 受託開発・エンド企業（`enger.companies.is_end_client = true`）— 管理NO #491
 *
 * 案件一覧は `jobs.client_name`（自由文字列）で企業マスタと突き合わせるため、
 * 承認バッジ（company-approval.ts）と**同じ突合方針**を使う:
 *   ① 企業名の完全一致（前後空白は無視）
 *   ② 親企業名の担当者・部署バリアント（「株式会社◯◯ 営業部」「株式会社◯◯の佐藤」）
 *
 * ①だけにすると、案件側に部署名付きで入っている企業のマークが出ない。
 * 逆にゆるく部分一致にすると「トヨタ」で「トヨタ商事」まで拾ってしまうため、
 * 区切り文字の判定を持つ `isCompanyVariantOf` を再利用する。
 */

const norm = (s?: string | null) => (s ?? "").trim();

async function fetchEndClientCompanyNames(): Promise<string[]> {
  if (!dbConfigured) return [];
  try {
    const sb = engerClient();
    const { data, error } = await sb
      .from("companies")
      .select("name")
      .eq("is_end_client", true)
      .limit(10000);
    // 列が未整備（companies-end-client.sql 未実行）ならマーク無しで続行
    if (error) return [];
    return [...new Set((data ?? []).map((r: { name: string | null }) => norm(r.name)).filter(Boolean))];
  } catch {
    return [];
  }
}

/**
 * 60秒キャッシュ。企業マスタの保存時に revalidatePath("/companies") が走るが、
 * 案件一覧側は別ページなのでキャッシュが切れるまで最大60秒のずれが出る
 * （承認バッジ＝getApprovedCompanyNames と同じ挙動）。
 */
export const getEndClientCompanyNames = unstable_cache(
  fetchEndClientCompanyNames,
  ["end-client-companies"],
  { revalidate: 60, tags: ["end-client-companies"] },
);

/** 受託開発・エンド企業名の一覧を取得（呼び出し側は isEndClient に渡す）。 */
export async function getEndClientCompanySet(): Promise<string[]> {
  return getEndClientCompanyNames();
}

/** name が受託開発・エンド企業か。完全一致＋担当者/部署バリアントのカスケード。 */
export function isEndClient(endClients: Iterable<string>, name?: string | null): boolean {
  const n = norm(name);
  if (!n) return false;
  for (const p of endClients) {
    if (p === n) return true;
    if (isCompanyVariantOf(p, n)) return true;
  }
  return false;
}
