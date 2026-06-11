// 日報の閲覧範囲（スコープ）。シンプル化した固定運用：
//   ・全員（管理者・経営・マネージャー・リーダー・メンバー）が「全体」を閲覧。
//     部署をまたいでメンバー同士も互いの日報を見られる。
//   ・経営の日報だけは「本来の管理者」のみ閲覧可（reports/page.tsx の rawRole 判定で除外）。
//   ・自分の日報は氏名が設定されていれば誰でも提出可。
//   （旧：役職別スコープ all/dept/self を設定 UI で切替できたが、運用混乱の元のため廃止。
//    定数や API は後方互換で残すが、効果上はすべて all 相当に統一する。）

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

/** 役職別の既定スコープ。シンプル運用に統一し、全役職を「全体（all）」に。
 *  経営の日報は reports/page.tsx 側で別途フィルタするため、ここでは all で十分。 */
export function defaultReportScopes(): ReportScopes {
  return { manager: "all", leader: "all", member: "all", none: "all" };
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

/** 現在ユーザーの実効スコープを判定。
 *  シンプル運用：全員「全体（all）」固定。経営の日報は reports/page.tsx で除外する。
 *  外部ロール（client/candidate/partner/freelance）は誤って呼ばれた場合に self を返す。 */
export function effectiveReportScope(role: string | null | undefined, _teamRole: string | null | undefined, _scopes: ReportScopes): ReportScope {
  if (role === "client" || role === "candidate" || role === "partner" || role === "freelance") return "self";
  return "all";
}
