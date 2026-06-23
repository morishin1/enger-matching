// 職能（営業 / バックオフィス）別のサイドバーメニュー表示権限。
//   管理者が /settings の「メニュー権限」タブで、職能グループ（営業/バックオフィス）ごとに
//   メニューの表示ON/OFFを設定し、app_settings(key='menu_permissions') に保存する。
//   サイドバーは現在ユーザーの職能(functions)に応じてメニューを絞り込む。
//   ・管理者(role=admin)は常に全メニュー表示（ロックアウト防止）。
//   ・兼務（営業かつバックオフィス）は両グループの和集合（どちらかで許可なら表示）。
//   ・未設定(値なし)は「全部表示」をデフォルトにする（後方互換・事故防止）。
//
//   ※ 以前は役職(team_role: manager/leader/member/none)軸で持っていたが、
//     「営業とバックオフィスで見えるメニューを分けたい」という要件に合わせ職能軸へ置き換えた。
//     旧形式(role キー)の保存値は新キー(sales/backoffice)に一致しないため、移行後は
//     デフォルト(全表示)から再設定する（loadMenuPermissions が安全にフォールバック）。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";
import { hasSalesFunction } from "./roles";

export const MENU_PERM_KEY = "menu_permissions";

// 職能グループキー。
export const MENU_GROUP_KEYS = ["sales", "backoffice"] as const;
export type MenuGroupKey = (typeof MENU_GROUP_KEYS)[number];
export const MENU_GROUP_LABEL: Record<MenuGroupKey, string> = {
  sales: "営業", backoffice: "バックオフィス",
};

// 設定対象のメニュー（href が安定キー）。サイドバーの主要項目に対応。
//   ※ ダッシュボード・設定は土台のため対象外（常時表示）。承認(ユーザー管理)も管理操作なので対象外。
//   ※ 稼働管理は「業務」と「書類送付」をまとめた1つの単位、分析は KPI推移/ファネル/パイプライン/詳細分析を
//     まとめた1つの単位として管理する（シンプル化）。サブタブは無条件表示。
//   ※ 企業(/companies) は「打合せ後の企業登録・承認済み記録」を全メンバーが行う必須業務のため
//     設定対象外（常時表示）。MENU_ITEMS から外すと isMenuAllowed のフォールスルーで常に許可になる。
export const MENU_ITEMS: { href: string; label: string }[] = [
  { href: "/mail",       label: "メール取込" },
  { href: "/matching",   label: "マッチング（案件/人材/LP登録）" },
  { href: "/proposals",  label: "提案管理" },
  { href: "/progress",   label: "稼働管理（業務/書類送付）" },
  { href: "/kpi",        label: "分析（KPI推移/ファネル/パイプライン/詳細）" },
  { href: "/meetings",   label: "打合せ記録" },
  { href: "/reports",    label: "日報" },
  { href: "/pr",         label: "PR・X集客" },
  { href: "/ai",         label: "AIアシスタント" },
];

/** ユーザーの職能から、所属するメニューグループを返す（兼務は複数）。 */
export function menuGroupsOf(functions: string[] | null | undefined): MenuGroupKey[] {
  const fns = functions ?? [];
  const groups: MenuGroupKey[] = [];
  if (hasSalesFunction(fns)) groups.push("sales");        // 空/未設定/「営業」は営業扱い
  if (fns.includes("バックオフィス")) groups.push("backoffice");
  return groups;
}

// 保存形式：{ sales: { "/mail": true, ... }, backoffice: {...} }
export type MenuPermissions = Record<MenuGroupKey, Record<string, boolean>>;

/** 全許可（デフォルト）。 */
export function defaultMenuPermissions(): MenuPermissions {
  const allOn: Record<string, boolean> = {};
  for (const m of MENU_ITEMS) allOn[m.href] = true;
  return { sales: { ...allOn }, backoffice: { ...allOn } };
}

/** app_settings から読み込み（未設定は全許可）。サーバ専用。 */
export async function loadMenuPermissions(): Promise<MenuPermissions> {
  const def = defaultMenuPermissions();
  if (!dbConfigured) return def;
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const { data, error } = await sb.from("app_settings").select("value").eq("key", MENU_PERM_KEY).maybeSingle();
    if (error || !data?.value) return def;
    const v = data.value as Partial<MenuPermissions>;
    // 既定にマージ（新メニュー追加時や旧形式の保存値では未定義キーは true 扱い）
    const merged = def;
    for (const gk of MENU_GROUP_KEYS) {
      const saved = v[gk] ?? {};
      for (const m of MENU_ITEMS) {
        if (typeof saved[m.href] === "boolean") merged[gk][m.href] = saved[m.href]!;
      }
    }
    return merged;
  } catch { return def; }
}

/** 指定 functions（職能）で href が表示可能か（管理者判定は呼び出し側）。
 *   兼務（営業かつバックオフィス）は和集合＝どちらかのグループで許可されていれば表示する。 */
export function isMenuAllowed(perms: MenuPermissions, functions: string[] | null | undefined, href: string): boolean {
  if (!perms) return true;
  const groups = menuGroupsOf(functions);
  if (groups.length === 0) return true; // どの職能にも属さない場合は事故防止で許可
  return groups.some((g) => {
    const m = perms[g];
    if (!m) return true;            // グループ設定なし＝許可
    if (!(href in m)) return true;  // 設定対象外メニュー（MENU_ITEMS に無い href）は常に許可
    return m[href] !== false;       // 明示的 false 以外は許可
  });
}
