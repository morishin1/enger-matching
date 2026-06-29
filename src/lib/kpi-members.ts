// KPI推移の「担当者（メンバー）マスタ」。
//   app_settings(key='kpi_members') に JSON 配列で保存：[{ name, team }]
//   ・team は アウトサイド/インサイド/テレアポ（outside/inside/telapo）。未設定は null。
//   ・このマスタが KPI推移のメンバー行（ステージ目標ボード）の対象と役割、
//     および「打ち合わせ記録」の自社担当プルダウンの選択肢を兼ねる（1か所で管理）。
import { engerAdmin, engerClient, dbConfigured } from "./supabase";
import type { KpiRoleKey } from "./kpi-roles";

export const KPI_MEMBERS_KEY = "kpi_members";

export type KpiMember = { name: string; team: KpiRoleKey | null };

const TEAMS: KpiRoleKey[] = ["outside", "inside", "telapo"];
export const cleanKpiTeam = (t: any): KpiRoleKey | null => {
  const v = String(t ?? "").trim().toLowerCase();
  return (TEAMS as string[]).includes(v) ? (v as KpiRoleKey) : null;
};

/** 受け取った任意配列を {name, team} の正規化済みリストにする（重複名・空名は除去、最大100件）。 */
export function normalizeKpiMembers(arr: any): KpiMember[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: KpiMember[] = [];
  for (const m of arr) {
    const name = String(m?.name ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, team: cleanKpiTeam(m?.team) });
    if (out.length >= 100) break;
  }
  return out;
}

/** メンバーマスタを読み込み（未設定・未整備時は空配列）。サーバ専用。 */
export async function loadKpiMembers(): Promise<KpiMember[]> {
  if (!dbConfigured) return [];
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const { data, error } = await sb.from("app_settings").select("value").eq("key", KPI_MEMBERS_KEY).maybeSingle();
    if (error || !data?.value) return [];
    // 配列でも { members: [...] } でも受ける（後方互換）。
    const arr = Array.isArray(data.value) ? data.value : (data.value as any)?.members;
    return normalizeKpiMembers(arr);
  } catch { return []; }
}
