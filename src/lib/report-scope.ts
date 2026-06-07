// 日報の閲覧範囲（スコープ）。役職(team_role)別に管理者が設定する。
//   全体 (all)     ＝ 経営：全員の日報を閲覧
//   部署 (dept)    ＝ マネージャー/リーダー：自部署メンバーの日報を閲覧
//   個人 (self)    ＝ メンバー：自分の日報のみ
//   未設定はロール既定（admin=all / manager,leader=dept / その他=self）に従う。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export const REPORT_SCOPE_KEY = "report_scopes";

// 役職キー。サイドバー権限と同じ4分類。
export const REPORT_ROLE_KEYS = ["manager", "leader", "member", "none"] as const;
export type ReportRoleKey = (typeof REPORT_ROLE_KEYS)[number];
export const REPORT_ROLE_LABEL: Record<ReportRoleKey, string> = {
  manager: "マネージャー", leader: "リーダー", member: "メンバー", none: "役職なし",
};

export type ReportScope = "all" | "dept" | "self";
export const REPORT_SCOPE_LABEL: Record<ReportScope, string> = {
  all: "全体（経営）", dept: "部署全体", self: "個人のみ",
};
export const REPORT_SCOPE_HINT: Record<ReportScope, string> = {
  all: "全員の日報を閲覧・返信できます",
  dept: "自部署メンバーの日報を閲覧・返信できます",
  self: "自分の日報のみ閲覧できます",
};

export type ReportScopes = Record<ReportRoleKey, ReportScope>;

/** 役職別の既定スコープ。admin はこの設定対象外（常に all）。 */
export function defaultReportScopes(): ReportScopes {
  return { manager: "dept", leader: "dept", member: "self", none: "self" };
}

export function toReportRoleKey(teamRole: string | null | undefined): ReportRoleKey {
  if (teamRole === "manager" || teamRole === "leader" || teamRole === "member") return teamRole;
  return "none";
}

/** app_settings から読み込み（未設定は既定）。サーバ専用。 */
export async function loadReportScopes(): Promise<ReportScopes> {
  const def = defaultReportScopes();
  if (!dbConfigured) return def;
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const { data, error } = await sb.from("app_settings").select("value").eq("key", REPORT_SCOPE_KEY).maybeSingle();
    if (error || !data?.value) return def;
    const v = data.value as Partial<ReportScopes>;
    const out: ReportScopes = { ...def };
    for (const rk of REPORT_ROLE_KEYS) {
      const s = v[rk];
      if (s === "all" || s === "dept" || s === "self") out[rk] = s;
    }
    return out;
  } catch { return def; }
}

/** 現在ユーザーの実効スコープを判定（admin は常に all）。 */
export function effectiveReportScope(role: string | null | undefined, teamRole: string | null | undefined, scopes: ReportScopes): ReportScope {
  if (role === "admin") return "all";
  return scopes[toReportRoleKey(teamRole)] ?? "self";
}
