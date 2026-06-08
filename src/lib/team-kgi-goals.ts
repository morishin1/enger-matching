// チームKPI目標（部署 × 月）の読み込み。
//   app_settings(key='team_kpi_goals') に保存：{ [department]: { [month]: TeamGoal } }
//   個人KGI（person_kgi）へ均等配分する元データとして使う。
//   保存処理は team-kgi-goals-actions.ts（"use server"）に分離。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";
import { resolveMetric } from "./kpi-metrics";

export const TEAM_KPI_GOALS_KEY = "team_kpi_goals";

export type TeamGoalItem = { key: string; label: string; unit: string; team: number | null };
export type TeamGoal = {
  items: TeamGoalItem[];
  note: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
};

type GoalsBlob = Record<string, Record<string, any>>;

function normalizeGoal(raw: any): TeamGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const seen = new Set<string>();
  const items: TeamGoalItem[] = [];
  for (const it of rawItems) {
    const key = String(it?.key ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const m = resolveMetric(key, it?.label, it?.unit);
    const team = it?.team == null || it.team === "" ? null : Number(it.team);
    items.push({ key, label: m.label, unit: m.unit, team: team != null && !Number.isNaN(team) ? team : null });
  }
  if (items.length === 0) return null;
  return {
    items,
    note: raw.note ?? null,
    updated_by_name: raw.updated_by_name ?? null,
    updated_at: raw.updated_at ?? null,
  };
}

/** app_settings の team_kpi_goals 全体（部署×月のネスト）を取得。 */
export async function loadTeamGoalsBlob(): Promise<GoalsBlob> {
  if (!dbConfigured) return {};
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const { data, error } = await sb.from("app_settings").select("value").eq("key", TEAM_KPI_GOALS_KEY).maybeSingle();
    if (error || !data?.value || typeof data.value !== "object") return {};
    return data.value as GoalsBlob;
  } catch { return {}; }
}

/** 指定部署×月のチーム目標を取得（未設定は null）。 */
export async function loadTeamGoal(department: string, month: string): Promise<TeamGoal | null> {
  const blob = await loadTeamGoalsBlob();
  return normalizeGoal(blob?.[department]?.[month] ?? null);
}
