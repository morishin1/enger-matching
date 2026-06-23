// クライアント/サーバ両方から import 可能な、純粋なロール定義とアクセス判定。
// （サーバ専用処理は accounts.ts 側に置く）

// admin=管理者(全機能) / agent=自社営業・契約社員(全業務) / partner=パートナー企業(限定・自社＋共有)
// freelance=副業エージェント(ag.enger.jp・個人・限定・自分＋共有) / client=エンド企業 / candidate=人材(enger.jp)
export type Role = "admin" | "agent" | "client" | "candidate" | "partner" | "freelance";
export type AccountStatus = "pending" | "active" | "disabled";

// 職能（兼務可・複数選択）。「インサイド」「アウトサイド」「EC」「開発」は廃止。
//   旧表記が DB に残っている場合の後方互換は hasSalesFunction 側で吸収する。
export const FUNCTIONS = ["営業", "バックオフィス", "サポート"] as const;
export const SALES_FUNCTIONS = ["営業"];
/** 営業系の職能を持つか（未設定は後方互換で営業扱い／旧「インサイド」「アウトサイド」も営業扱い）。 */
export const hasSalesFunction = (functions?: string[] | null) =>
  !functions || functions.length === 0 || functions.some((f) => SALES_FUNCTIONS.includes(f) || f === "インサイド" || f === "アウトサイド");

// 組織：部署とチーム役職（日報の閲覧/返信権限に使用）
export const DEPARTMENTS = ["ITS", "バックオフィス", "サポート", "開発", "経営", "フリーランス"] as const;
export type Department = (typeof DEPARTMENTS)[number];

// 経営部署は「全機能アクセス（管理者相当）」。役職別の細かな権限を気にせず、
// 経営/管理側は全メニュー・全操作ができるようにするための単純化ルール。
export const EXEC_DEPARTMENT = "経営";
export const isExecDepartment = (dept?: string | null) => (dept ?? "").trim() === EXEC_DEPARTMENT;
export const TEAM_ROLES = ["manager", "leader", "member"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { manager: "マネージャー", leader: "リーダー", member: "メンバー" };
/** マネージャー/リーダーは「自部署の日報を閲覧・返信」できる。 */
export const canManageDept = (teamRole?: string | null) => teamRole === "manager" || teamRole === "leader";


/** ロール別の初期表示パス。client も自社ポータル(=ダッシュボード"/")へ。 */
export function roleHome(_role: Role): string {
  return "/";
}

// 法人向け ENGER business（dx.enger.jp）にログイン・入室できないロール。
//   フリーランス（人材）は enger.jp の LP / マイページを利用する区分であり、
//   法人ログインからは「ログイン」も「自動リダイレクト（共有セッション経由の入室）」も不可とする。
//   ※ Supabase Auth を LP と共有しているため、ロールでの締め出しを唯一の境界線にする。
const DX_BLOCKED_ROLES: Role[] = ["candidate"];
/** dx（法人ログイン）への入室を許可しないロールか。true なら締め出す。 */
export function isDxBlockedRole(role: Role | null | undefined): boolean {
  return !!role && DX_BLOCKED_ROLES.includes(role);
}
/** dx 入室不可ロールに表示する共通メッセージ。 */
export const DX_BLOCKED_MESSAGE =
  "このアカウントは法人向け ENGER business にはログインできません。人材（フリーランス）の方は enger.jp のマイページをご利用ください。";

/** admin 専用ルート（営業も不可）。 */
const ADMIN_PREFIXES = ["/settings"];
/** client(ユーザー企業) が開けるルート。ここ以外は自社ポータル"/"へ戻す。 */
const CLIENT_ALLOWED = ["/", "/portal"];
/** candidate(人材) が開けるルート。自分のダッシュボード"/"のみ（企業ポータルは見せない）。 */
const CANDIDATE_ALLOWED = ["/"];
/**
 * partner(パートナー企業) が開けるルート。漏洩防止のため限定。
 * データは「自社登録＋共有」のみ表示し、他社分は匿名化する（各ページのサーバ側で隔離）。
 * 非表示：企業管理・受信箱・請求・日報・書類・パイプライン・PR・AI・設定・LP登録・打合せ。
 */
// テナント隔離ロール(partner/freelance)が開けるルート。自分＋共有のみ・他社匿名。
const TENANT_ALLOWED = ["/", "/jobs", "/people", "/matching"];
/**
 * 営業系の職能を持つ人だけがアクセスできる業務ルート。
 * バックオフィス専任（営業系職能なし）には案件・人材・打合せ記録・パイプライン等を非表示にする。
 */
export const SALES_ONLY_PREFIXES = ["/matching", "/engineers", "/jobs", "/people", "/proposals", "/companies", "/meetings", "/pipeline"];

/** マネージャー/リーダーにも開放する settings 配下の例外ルート。 */
const MANAGER_SETTINGS_ALLOWED = ["/settings/team-kgi", "/settings/person-kgi"];

/** 指定ロール（＋職能・チーム役職）が pathname にアクセスできるか。 */
export function canAccess(role: Role, pathname: string, functions?: string[] | null, teamRole?: string | null): boolean {
  if (role === "admin") return true;
  const hit = (list: string[]) => list.some((p) => (p === "/" ? pathname === "/" : (pathname === p || pathname.startsWith(p + "/"))));
  if (role === "agent") {
    if (hit(ADMIN_PREFIXES)) {
      // settings 配下でも manager/leader は KGI 設定だけ許可
      if (canManageDept(teamRole) && hit(MANAGER_SETTINGS_ALLOWED)) return true;
      return false;
    }
    if (!hasSalesFunction(functions) && hit(SALES_ONLY_PREFIXES)) return false; // バックオフィス専任は営業業務を非表示
    return true;
  }
  // candidate(人材): 自分のダッシュボードのみ。
  if (role === "candidate") return hit(CANDIDATE_ALLOWED);
  // partner(パートナー企業) / freelance(副業エージェント): 限定ルートのみ（settings等は不可）。
  if (role === "partner" || role === "freelance") {
    if (hit(ADMIN_PREFIXES)) return false;
    return hit(TENANT_ALLOWED);
  }
  // client: 自社ポータルのみ。他の内部画面はデータ分離前のため非表示。
  return hit(CLIENT_ALLOWED);
}
