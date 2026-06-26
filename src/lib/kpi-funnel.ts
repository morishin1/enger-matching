// チームファネル目標（稼働数・面談率・合格率）の取得（サーバ専用）。
//   enger.kpi_funnel_target（1行・id=1）から読む。未マイグレ/未設定時は既定値。
import { engerAdmin, engerClient, dbConfigured } from "./supabase";
import { DEFAULT_FUNNEL_TARGET, type FunnelTarget } from "./kpi-roles";

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
