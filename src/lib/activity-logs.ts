// 操作ログ（誰が・いつ・何をしたか）。提案削除の承認制を廃止する代わりに追跡性を担保する。
//   ・logActivity / logProposalActivity：サーバアクションから記録（fail-soft）。
//   ・listActivityLogs：設定「ログ」タブの一覧取得。
import { engerAdmin, dbConfigured } from "./supabase";
import { currentAccess } from "./accounts";

export type ActivityLog = {
  id: string;
  operator: string | null;
  operator_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  detail: string | null;
  created_at: string;
};

/** 操作ログを1件記録（担当者は現在のログインユーザーから取得）。記録失敗は本処理を止めない。 */
export async function logActivity(input: {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  detail?: string | null;
}): Promise<void> {
  try {
    const me = await currentAccess();
    const admin = engerAdmin();
    await admin.from("activity_logs").insert({
      operator: me?.name?.trim() || me?.email || null,
      operator_email: me?.email || null,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      detail: input.detail ?? null,
    });
  } catch { /* activity_logs 未作成/権限不足でも本処理は止めない */ }
}

/** 提案に対する操作ログ。対象の表示名（候補者 × 案件）を補完して記録（提案が存在する間に呼ぶこと）。 */
export async function logProposalActivity(proposalId: string, action: string, detail?: string | null): Promise<void> {
  let label: string | null = null;
  try {
    const admin = engerAdmin();
    const r: any = await admin.from("proposals").select("candidate_name, job_title").eq("id", proposalId).maybeSingle();
    if (r.data) label = `${r.data.candidate_name ?? "—"} × ${r.data.job_title ?? "—"}`;
  } catch { /* ラベル取得失敗は無視 */ }
  await logActivity({ action, targetType: "proposal", targetId: proposalId, targetLabel: label, detail: detail ?? null });
}

/** 操作ログ一覧（新しい順）。設定の「ログ」タブで表示。 */
export async function listActivityLogs(opts?: { limit?: number }): Promise<{ rows: ActivityLog[]; available: boolean }> {
  if (!dbConfigured) return { rows: [], available: false };
  try {
    const sb = engerAdmin();
    const r: any = await sb.from("activity_logs")
      .select("id, operator, operator_email, action, target_type, target_id, target_label, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(opts?.limit ?? 500);
    if (r.error) return { rows: [], available: false };
    return { rows: (r.data ?? []) as ActivityLog[], available: true };
  } catch { return { rows: [], available: false }; }
}
