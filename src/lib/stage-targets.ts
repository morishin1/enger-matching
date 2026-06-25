import { engerClient, dbConfigured } from "@/lib/supabase";

// 提案ボードのステージ（承認待ち・終了系を除く運用ステージ）。
export const STAGE_TARGET_STAGES = ["所属確認", "提案中", "確認中", "面談", "合格"] as const;
export type StageTargetStage = typeof STAGE_TARGET_STAGES[number];

/** 担当者×ステージの目標件数。{ ownerName: { stage: target } }。 */
export async function getStageTargets(): Promise<Record<string, Record<string, number>>> {
  if (!dbConfigured) return {};
  try {
    const sb = engerClient();
    const r: any = await sb.from("stage_targets").select("owner_name, stage, target").limit(5000);
    if (r.error) return {};
    const out: Record<string, Record<string, number>> = {};
    for (const row of (r.data ?? []) as any[]) {
      const o = String(row.owner_name ?? "").trim();
      if (!o) continue;
      (out[o] ??= {})[String(row.stage)] = Number(row.target) || 0;
    }
    return out;
  } catch {
    return {};
  }
}
