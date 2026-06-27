import { engerClient, dbConfigured } from "@/lib/supabase";

// メンバー別ステージ目標ボードの列キー（表示順）。
//   打ち合わせ・案件の仕入れは proposals 以外（打合せ記録／企業×案件取込）から集計する特殊列。
//   ※ 現在値の算出ロジックは StageTargetBoard 側の STAGE_COLUMNS を参照。
export const STAGE_TARGET_STAGES = ["打ち合わせ", "提案中", "案件の仕入れ", "面談", "合格"] as const;
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
