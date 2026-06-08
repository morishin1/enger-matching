"use server";

// チームKPI目標（部署 × 月）の保存。app_settings(key='team_kpi_goals') に upsert。
//   - admin: 全部署を編集可能
//   - manager/leader: 自部署のみ編集可能
//   - それ以外: 不可

import { revalidatePath } from "next/cache";
import { engerAdmin } from "./supabase";
import { currentAccess } from "./accounts";
import { canManageDept } from "./roles";
import { resolveMetric } from "./kpi-metrics";
import { TEAM_KPI_GOALS_KEY, loadTeamGoalsBlob, type TeamGoalItem } from "./team-kgi-goals";

type Result = { ok: boolean; error?: string };

export type SaveTeamGoalInput = {
  department: string;
  month: string;
  items: { key: string; label?: string | null; unit?: string | null; team: number | null }[];
  note?: string | null;
};

/** チーム目標を保存。 */
export async function saveTeamGoal(input: SaveTeamGoalInput): Promise<Result> {
  const access = await currentAccess();
  if (!access) return { ok: false, error: "ログインが必要です" };

  const department = (input.department || "").trim();
  if (!department) return { ok: false, error: "部署が未指定です" };
  if (!/^\d{4}-\d{2}-01$/.test(input.month)) return { ok: false, error: "月の指定が不正です（YYYY-MM-01）" };

  const isAdmin = access.role === "admin";
  const canMgr = canManageDept(access.teamRole) && access.department === department;
  if (!isAdmin && !canMgr) {
    return { ok: false, error: "権限がありません（管理者または該当部署のマネージャー/リーダーのみ編集可）" };
  }

  // アイテムを正規化（キー重複除去・0以上の数値・上限20件）
  const seen = new Set<string>();
  const items: TeamGoalItem[] = [];
  for (const it of input.items ?? []) {
    const key = String(it?.key ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const m = resolveMetric(key, it.label, it.unit);
    let team: number | null = null;
    if (it.team != null) {
      const n = Number(it.team);
      if (Number.isNaN(n) || n < 0) return { ok: false, error: `「${m.label}」は0以上の数値で入力してください` };
      team = n;
    }
    items.push({ key, label: m.label, unit: m.unit, team });
    if (items.length >= 20) break;
  }

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  // 既存 blob を読み、該当 部署×月 だけ差し替えて全体を upsert
  const { month } = input;
  const blob = await loadTeamGoalsBlob();
  const next = { ...blob, [department]: { ...(blob[department] ?? {}) } };
  if (items.length === 0) {
    delete next[department][month];
  } else {
    next[department][month] = {
      items,
      note: input.note ?? null,
      updated_by_name: access.name || null,
      updated_at: new Date().toISOString(),
    };
  }

  const { error } = await admin.from("app_settings").upsert({ key: TEAM_KPI_GOALS_KEY, value: next }, { onConflict: "key" });
  if (error) {
    if (/app_settings|relation|column/i.test(error.message)) {
      return { ok: false, error: "app_settings テーブルが未整備です（supabase/app-settings.sql を実行してください）" };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/settings/person-kgi");
  revalidatePath("/");
  return { ok: true };
}
