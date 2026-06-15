// 役職（team_role）別のサイドバーメニュー表示権限。
//   管理者が /settings/permissions で各役職（マネージャー/リーダー/メンバー/役職なし）ごとに
//   メニューの表示ON/OFFを設定し、app_settings(key='menu_permissions') に保存する。
//   サイドバーは現在ユーザーの team_role に応じてメニューを絞り込む。
//   ・管理者(role=admin)は常に全メニュー表示（ロックアウト防止）。
//   ・未設定(値なし)は「全部表示」をデフォルトにする（後方互換・事故防止）。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export const MENU_PERM_KEY = "menu_permissions";

// 役職キー（team_role が無い内部メンバーは "none"）。
export const MENU_ROLE_KEYS = ["manager", "leader", "member", "none"] as const;
export type MenuRoleKey = (typeof MENU_ROLE_KEYS)[number];
export const MENU_ROLE_LABEL: Record<MenuRoleKey, string> = {
  manager: "マネージャー", leader: "リーダー", member: "メンバー", none: "役職なし",
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

// teamRole → MenuRoleKey
export function toMenuRoleKey(teamRole: string | null | undefined): MenuRoleKey {
  if (teamRole === "manager" || teamRole === "leader" || teamRole === "member") return teamRole;
  return "none";
}

// 保存形式：{ manager: { "/mail": true, ... }, leader: {...}, member: {...}, none: {...} }
export type MenuPermissions = Record<MenuRoleKey, Record<string, boolean>>;

/** 全許可（デフォルト）。 */
export function defaultMenuPermissions(): MenuPermissions {
  const allOn: Record<string, boolean> = {};
  for (const m of MENU_ITEMS) allOn[m.href] = true;
  return { manager: { ...allOn }, leader: { ...allOn }, member: { ...allOn }, none: { ...allOn } };
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
    // 既定にマージ（新メニュー追加時に未定義キーは true 扱い）
    const merged = def;
    for (const rk of MENU_ROLE_KEYS) {
      const saved = v[rk] ?? {};
      for (const m of MENU_ITEMS) {
        if (typeof saved[m.href] === "boolean") merged[rk][m.href] = saved[m.href]!;
      }
    }
    return merged;
  } catch { return def; }
}

/** 指定 teamRole で href が表示可能か（管理者判定は呼び出し側）。 */
export function isMenuAllowed(perms: MenuPermissions, teamRole: string | null | undefined, href: string): boolean {
  const key = toMenuRoleKey(teamRole);
  const m = perms[key];
  if (!m) return true;
  // 設定対象外のメニュー（MENU_ITEMS に無い href）は常に許可
  if (!(href in m)) return true;
  return m[href] !== false;
}
