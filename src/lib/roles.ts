// クライアント/サーバ両方から import 可能な、純粋なロール定義とアクセス判定。
// （サーバ専用処理は accounts.ts 側に置く）

export type Role = "admin" | "agent" | "client" | "candidate";
export type AccountStatus = "pending" | "active" | "disabled";

// 職能（兼務可・複数選択）
export const FUNCTIONS = ["営業", "インサイド", "アウトサイド", "バックオフィス", "EC", "サポート", "開発"] as const;
export const SALES_FUNCTIONS = ["営業", "インサイド", "アウトサイド"];
/** 営業系の職能を持つか（未設定は後方互換で営業扱い）。 */
export const hasSalesFunction = (functions?: string[] | null) => !functions || functions.length === 0 || functions.some((f) => SALES_FUNCTIONS.includes(f));

/** ロール別の初期表示パス。client も自社ポータル(=ダッシュボード"/")へ。 */
export function roleHome(_role: Role): string {
  return "/";
}

/** admin 専用ルート（営業も不可）。 */
const ADMIN_PREFIXES = ["/settings"];
/** client(ユーザー企業) が開けるルート。ここ以外は自社ポータル"/"へ戻す。 */
const CLIENT_ALLOWED = ["/", "/portal"];
/** candidate(人材) が開けるルート。自分のダッシュボード"/"のみ（企業ポータルは見せない）。 */
const CANDIDATE_ALLOWED = ["/"];
/**
 * 営業系の職能を持つ人だけがアクセスできる業務ルート。
 * バックオフィス専任（営業系職能なし）には案件・人材・打合せ記録・パイプライン等を非表示にする。
 */
export const SALES_ONLY_PREFIXES = ["/matching", "/engineers", "/jobs", "/people", "/proposals", "/companies", "/meetings", "/pipeline"];

/** 指定ロール（＋職能）が pathname にアクセスできるか。 */
export function canAccess(role: Role, pathname: string, functions?: string[] | null): boolean {
  if (role === "admin") return true;
  const hit = (list: string[]) => list.some((p) => (p === "/" ? pathname === "/" : (pathname === p || pathname.startsWith(p + "/"))));
  if (role === "agent") {
    if (hit(ADMIN_PREFIXES)) return false;               // settings は admin のみ
    if (!hasSalesFunction(functions) && hit(SALES_ONLY_PREFIXES)) return false; // バックオフィス専任は営業業務を非表示
    return true;
  }
  // candidate(人材): 自分のダッシュボードのみ。
  if (role === "candidate") return hit(CANDIDATE_ALLOWED);
  // client: 自社ポータルのみ。他の内部画面はデータ分離前のため非表示。
  return hit(CLIENT_ALLOWED);
}
