// チームファネル目標（稼働数・面談率・合格率）の取得（サーバ専用）。
//   enger.kpi_funnel_target（1行・id=1）から読む。未マイグレ/未設定時は既定値。
import { engerAdmin, engerClient, dbConfigured } from "./supabase";
import { DEFAULT_FUNNEL_TARGET, type FunnelTarget, type KpiRoleKey } from "./kpi-roles";

/** メンバー名 → 役割（outside/inside/telapo）。app_users.kpi_role 優先・無ければ position(inside/outside)。
 *  ステージ目標ボードの役割別KPI/KGI表示に使う（サーバ専用）。未設定メンバーは含めない。 */
export async function getMemberKpiRoles(): Promise<Record<string, KpiRoleKey>> {
  if (!dbConfigured) return {};
  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { try { sb = engerClient(); } catch { return {}; } }
  const out: Record<string, KpiRoleKey> = {};
  try {
    let r: any = await sb.from("app_users").select("name, kpi_role, position");
    if (r.error && /kpi_role|position|column/i.test(r.error.message ?? "")) r = await sb.from("app_users").select("name, position");
    if (r.error) r = await sb.from("app_users").select("name");
    for (const u of (r.data ?? [])) {
      const nm = String(u?.name ?? "").trim(); if (!nm) continue;
      const kr = String(u?.kpi_role ?? "").trim().toLowerCase();
      const pos = String(u?.position ?? "").trim().toLowerCase();
      const role: KpiRoleKey | "" =
        (kr === "outside" || kr === "inside" || kr === "telapo") ? (kr as KpiRoleKey)
        : (pos === "outside" || pos === "inside") ? (pos as KpiRoleKey) : "";
      if (role) out[nm] = role;
    }
  } catch { /* テーブル/列が無い環境でも空で続行 */ }
  return out;
}

export async function getKpiFunnelTarget(): Promise<FunnelTarget> {
  if (!dbConfigured) return { ...DEFAULT_FUNNEL_TARGET };
  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }
  try {
    const { data, error } = await sb.from("kpi_funnel_target").select("won_target, meeting_rate, pass_rate").eq("id", 1).maybeSingle();
    if (error || !data) return { ...DEFAULT_FUNNEL_TARGET };
    return {
      won: Number(data.won_target) || DEFAULT_FUNNEL_TARGET.won,
      meetingRate: Number(data.meeting_rate) || DEFAULT_FUNNEL_TARGET.meetingRate,
      passRate: Number(data.pass_rate) || DEFAULT_FUNNEL_TARGET.passRate,
    };
  } catch {
    return { ...DEFAULT_FUNNEL_TARGET };
  }
}
