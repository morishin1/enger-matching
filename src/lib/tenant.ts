// パートナー企業(partner)向けのテナント分離・匿名化ヘルパ。
//   - partner は「自社(owner_company)＝自分の会社」＋「共有(shared=true)」の案件/人材だけ見える。
//   - 他社の共有データは匿名化して返す（氏名・連絡先・クライアント名・送信元メール等を除去）。
// すべてサーバ側で適用すること（クライアントに生データを渡さない）。
import { currentAccess } from "./accounts";
import type { Role } from "./roles";
import { redactPii } from "./pii";

export type ViewerScope = {
  role: Role;
  isInternal: boolean;   // admin / agent は全データ可視（社内）
  isPartner: boolean;    // パートナー企業（owner_company=会社名）
  isFreelance: boolean;  // 副業エージェント（owner_company=本人メール）
  isTenant: boolean;     // partner || freelance → テナント隔離が必要
  ownerKey: string | null; // 所有テナントの突合キー（owner_company に入る値）
  company: string | null;  // 互換用（partner の会社名）
};

export async function getViewerScope(): Promise<ViewerScope> {
  let role: Role = "admin";
  let company: string | null = null;
  let email = "";
  try {
    const a = await currentAccess();
    role = (a?.role ?? "admin") as Role;
    company = a?.companyName ?? null;
    email = a?.email ?? "";
  } catch { /* 認証未設定(ローカル)等は admin 扱い */ }
  const isPartner = role === "partner";
  const isFreelance = role === "freelance";
  const isTenant = isPartner || isFreelance;
  // パートナーは会社名、副業エージェントは個人なので本人メールを所有キーにする（同名衝突回避）。
  const ownerKey = isPartner ? (company || null) : isFreelance ? (email ? email.toLowerCase() : null) : null;
  return { role, isInternal: role === "admin" || role === "agent", isPartner, isFreelance, isTenant, ownerKey, company: isPartner ? company : null };
}

const norm = (s?: string | null) => String(s ?? "").trim().toLowerCase();
/** その案件/人材が、このパートナーの「自社所有」か。 */
export const isOwnedByPartner = (row: any, company: string | null) =>
  !!company && norm(row?.owner_company) === norm(company);

/** 案件をパートナー向けに匿名化。
 *   - 他社所有 ：クライアント名・連絡先・本文・商流・勤務地等の固有情報を全て除去
 *   - 自社所有 ：そのまま（自分で登録した内容）。ただし自由記述本文には PII マスクを保険適用
 */
export function maskJobForPartner(job: any, company: string | null): any {
  if (isOwnedByPartner(job, company)) {
    // 自社所有でも、本文に電話/メール/社名等が紛れていることがあるので保険でマスク
    return {
      ...job,
      detail: redactPii(job?.detail ?? null),
    };
  }
  return {
    ...job,
    client_name: null,            // クライアント名は漏洩源
    contact_email: null,
    contact_name: null,
    source_mail_url: null,
    outside_owner: null,
    // 自由記述系（本文・商流・勤務地・職種テキスト）も他社固有情報を含み得るため伏せる
    detail: null,
    description: null,
    flow_note: null,
    work_location: null,
    role_label: null,
    _anon: true,                  // UI 表示用の匿名フラグ
  };
}

/** 人材をパートナー向けに匿名化。
 *   - 他社所有 ：氏名・連絡先・所属会社・自由記述（経歴/備考/headline）を全て除去
 *   - 自社所有 ：そのまま。本文には PII マスクを保険適用
 */
export function maskCandidateForPartner(c: any, company: string | null): any {
  if (isOwnedByPartner(c, company)) {
    return {
      ...c,
      exp: redactPii(c?.exp ?? null),
      note: redactPii(c?.note ?? null),
      headline: redactPii(c?.headline ?? null),
      bio: redactPii(c?.bio ?? null),
    };
  }
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
    // 自由記述系（経歴・備考・自己紹介）は固有情報を含み得るため伏せる
    exp: null,
    note: null,
    headline: null,
    bio: null,
    skill_sheet_url: null,        // 他社人材のスキルシートURLも伏せる（連絡先や氏名が記載される）
    _anon: true,
  };
}

export const maskJobs = (rows: any[], company: string | null) => rows.map((r) => maskJobForPartner(r, company));
export const maskCandidates = (rows: any[], company: string | null) => rows.map((r) => maskCandidateForPartner(r, company));

/** 登録系で使う：テナント隔離ロール(partner/freelance)なら所有キー、社内なら null。 */
export async function tenantOwnerKey(): Promise<string | null> {
  const s = await getViewerScope();
  return s.isTenant ? s.ownerKey : null;
}
/** 後方互換エイリアス。 */
export const partnerOwnerCompany = tenantOwnerKey;
