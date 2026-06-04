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
  meetingDone: boolean;  // エージェント面談済み（詳細閲覧の許可）
};

export async function getViewerScope(): Promise<ViewerScope> {
  let role: Role = "admin";
  let company: string | null = null;
  let email = "";
  let meetingDone = true;
  try {
    const a = await currentAccess();
    role = (a?.role ?? "admin") as Role;
    company = a?.companyName ?? null;
    email = a?.email ?? "";
    meetingDone = a?.meetingDone ?? false;
  } catch { /* 認証未設定(ローカル)等は admin 扱い */ }
  const isPartner = role === "partner";
  const isFreelance = role === "freelance";
  const isTenant = isPartner || isFreelance;
  // パートナーは会社名、副業エージェントは個人なので本人メールを所有キーにする（同名衝突回避）。
  const ownerKey = isPartner ? (company || null) : isFreelance ? (email ? email.toLowerCase() : null) : null;
  return { role, isInternal: role === "admin" || role === "agent", isPartner, isFreelance, isTenant, ownerKey, company: isPartner ? company : null, meetingDone };
}

const norm = (s?: string | null) => String(s ?? "").trim().toLowerCase();
/** その案件/人材が、このパートナーの「自社所有」か。 */
export const isOwnedByPartner = (row: any, company: string | null) =>
  !!company && norm(row?.owner_company) === norm(company);

/** 案件をパートナー/副業エージェント向けに匿名化。
 *   - 他社所有 ：クライアント名・連絡先・本文・商流・勤務地等の固有情報を全て除去
 *   - 自社所有 ：そのまま。ただし自由記述本文には PII マスクを保険適用
 *   - meetingDone=false（エージェント面談前）：詳細本文を見せない（連絡を促す）
 */
export function maskJobForPartner(job: any, company: string | null, meetingDone: boolean = true): any {
  const own = isOwnedByPartner(job, company);
  if (own && meetingDone) {
    return { ...job, detail: redactPii(job?.detail ?? null) };
  }
  if (own && !meetingDone) {
    // 自社所有でも面談前は詳細本文を伏せ、UIで「エージェント面談後に解放」と案内
    return { ...job, detail: null, description: null, _gated: true };
  }
  return {
    ...job,
    client_name: null,            // クライアント名は漏洩源
    contact_email: null,
    contact_name: null,
    source_mail_url: null,
    outside_owner: null,
    detail: null,
    description: null,
    flow_note: null,
    work_location: null,
    role_label: null,
    _anon: true,                  // 他社匿名
    _gated: !meetingDone,         // さらに面談前なら完全ゲート
  };
}

/** 人材をパートナー/副業エージェント向けに匿名化。 */
export function maskCandidateForPartner(c: any, company: string | null, meetingDone: boolean = true): any {
  const own = isOwnedByPartner(c, company);
  if (own && meetingDone) {
    return {
      ...c,
      exp: redactPii(c?.exp ?? null),
      note: redactPii(c?.note ?? null),
      headline: redactPii(c?.headline ?? null),
      bio: redactPii(c?.bio ?? null),
    };
  }
  if (own && !meetingDone) {
    return {
      ...c,
      exp: null, note: null, headline: null, bio: null, skill_sheet_url: null,
      _gated: true,
    };
  }
  const initials = c?.initials || (c?.name ? String(c.name).slice(0, 1) : "—");
  return {
    ...c,
    name: initials,
    company: null,
    source_company: null,
    affiliation: null,
    email: null,
    contact_email: null,
    source_mail_url: null,
    operator: null,
    exp: null,
    note: null,
    headline: null,
    bio: null,
    skill_sheet_url: null,
    _anon: true,
    _gated: !meetingDone,
  };
}

export const maskJobs = (rows: any[], company: string | null, meetingDone: boolean = true) => rows.map((r) => maskJobForPartner(r, company, meetingDone));
export const maskCandidates = (rows: any[], company: string | null, meetingDone: boolean = true) => rows.map((r) => maskCandidateForPartner(r, company, meetingDone));

/** 登録系で使う：テナント隔離ロール(partner/freelance)なら所有キー、社内なら null。 */
export async function tenantOwnerKey(): Promise<string | null> {
  const s = await getViewerScope();
  return s.isTenant ? s.ownerKey : null;
}
/** 後方互換エイリアス。 */
export const partnerOwnerCompany = tenantOwnerKey;
