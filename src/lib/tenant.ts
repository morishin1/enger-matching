// パートナー企業(partner)向けのテナント分離・匿名化ヘルパ。
//   - partner は「自社(owner_company)＝自分の会社」＋「共有(shared=true)」の案件/人材だけ見える。
//   - 他社の共有データは匿名化して返す（氏名・連絡先・クライアント名・送信元メール等を除去）。
// すべてサーバ側で適用すること（クライアントに生データを渡さない）。
import { currentAccess } from "./accounts";
import type { Role } from "./roles";

export type ViewerScope = {
  role: Role;
  isInternal: boolean;   // admin / agent は全データ可視（社内）
  isPartner: boolean;
  company: string | null; // partner の所有キー（app_users.company_name）
};

export async function getViewerScope(): Promise<ViewerScope> {
  let role: Role = "admin";
  let company: string | null = null;
  try {
    const a = await currentAccess();
    role = (a?.role ?? "admin") as Role;
    company = a?.companyName ?? null;
  } catch { /* 認証未設定(ローカル)等は admin 扱い */ }
  const isPartner = role === "partner";
  return { role, isInternal: role === "admin" || role === "agent", isPartner, company: isPartner ? company : null };
}

const norm = (s?: string | null) => String(s ?? "").trim().toLowerCase();
/** その案件/人材が、このパートナーの「自社所有」か。 */
export const isOwnedByPartner = (row: any, company: string | null) =>
  !!company && norm(row?.owner_company) === norm(company);

/** 案件をパートナー向けに匿名化（自社所有はそのまま、他社共有はクライアント名・連絡先を伏せる）。 */
export function maskJobForPartner(job: any, company: string | null): any {
  if (isOwnedByPartner(job, company)) return job;
  return {
    ...job,
    client_name: null,            // クライアント名は漏洩源
    contact_email: null,
    contact_name: null,
    source_mail_url: null,
    outside_owner: null,
    _anon: true,                  // UI 表示用の匿名フラグ
  };
}

/** 人材をパートナー向けに匿名化（イニシャル＋スキル＋単価のみ。氏名・連絡先・所属会社を伏せる）。 */
export function maskCandidateForPartner(c: any, company: string | null): any {
  if (isOwnedByPartner(c, company)) return c;
  const initials = c?.initials || (c?.name ? String(c.name).slice(0, 1) : "—");
  return {
    ...c,
    name: initials,               // 氏名はイニシャルのみ
    company: null,
    source_company: null,
    affiliation: null,
    email: null,
    contact_email: null,
    source_mail_url: null,
    operator: null,
    _anon: true,
  };
}

export const maskJobs = (rows: any[], company: string | null) => rows.map((r) => maskJobForPartner(r, company));
export const maskCandidates = (rows: any[], company: string | null) => rows.map((r) => maskCandidateForPartner(r, company));

/** 登録系で使う：現在のユーザーがパートナーなら自社名(=所有テナント)、社内なら null。 */
export async function partnerOwnerCompany(): Promise<string | null> {
  const s = await getViewerScope();
  return s.isPartner ? s.company : null;
}
