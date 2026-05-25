import { engerClient, dbConfigured } from "./supabase";

export type BillingTask = {
  engagement_id: string;
  period: string;
  candidate_name: string | null;
  company: string | null;
  job_title: string | null;
  monthly_rate: number | null;
  settle_min: number | null;
  settle_max: number | null;
  attendance_status: string;
  attendance_hours: number | null;
  attendance_file: string | null;
  invoice_status: string;
  invoice_amount: number | null;
  invoice_file: string | null;
  note: string | null;
  done: boolean;
  exists: boolean; // billing_tasks 行が既にあるか
};

export const currentPeriod = () => new Date().toISOString().slice(0, 7); // YYYY-MM

/**
 * 指定月の請求・勤怠タスク（稼働中/予定の稼働 × 月）。既存の billing_tasks をマージ。
 * agentName を渡すと、その人が担当（提案者/パートナー/クローザー）の稼働のみに絞り込む。
 */
export async function getBillingTasks(period: string, opts?: { agentName?: string | null }): Promise<{ tasks: BillingTask[]; available: boolean }> {
  if (!dbConfigured) return { tasks: [], available: false };
  try {
    const sb = engerClient();
    // 稼働（対象：稼働中・予定）
    let engRes: any = await sb.from("engagements")
      .select("id, proposal_id, candidate_name, company, job_title, monthly_rate, status, settle_min, settle_max")
      .in("status", ["稼働中", "予定"]).limit(500);
    if (engRes.error) engRes = await sb.from("engagements")
      .select("id, candidate_name, company, job_title, monthly_rate, status, settle_min, settle_max")
      .in("status", ["稼働中", "予定"]).limit(500);
    if (engRes.error) return { tasks: [], available: false };
    let engs = engRes.data ?? [];

    // エージェント絞り込み：自分が担当する提案に紐づく稼働のみ
    const me = (opts?.agentName ?? "").trim();
    if (me) {
      const pr = await sb.from("proposals").select("id, candidate_name").or(`proposer.eq.${me},partner.eq.${me},closer.eq.${me}`).limit(2000);
      const ids = new Set((pr.data ?? []).map((p: any) => p.id));
      const names = new Set((pr.data ?? []).map((p: any) => p.candidate_name).filter(Boolean));
      engs = engs.filter((e: any) => ids.has(e.proposal_id) || (e.candidate_name && names.has(e.candidate_name)));
    }

    // 当月の billing_tasks
    const btRes = await sb.from("billing_tasks").select("*").eq("period", period);
    if (btRes.error) return { tasks: [], available: false }; // テーブル未作成
    const byEng = new Map((btRes.data ?? []).map((b: any) => [b.engagement_id, b]));

    const tasks: BillingTask[] = engs.map((e: any) => {
      const b = byEng.get(e.id);
      const attendance_status = b?.attendance_status ?? "未";
      const invoice_status = b?.invoice_status ?? "未";
      return {
        engagement_id: e.id, period,
        candidate_name: e.candidate_name, company: e.company, job_title: e.job_title,
        monthly_rate: e.monthly_rate, settle_min: e.settle_min ?? null, settle_max: e.settle_max ?? null,
        attendance_status, attendance_hours: b?.attendance_hours ?? null, attendance_file: b?.attendance_file ?? null,
        invoice_status, invoice_amount: b?.invoice_amount ?? null, invoice_file: b?.invoice_file ?? null,
        note: b?.note ?? null,
        done: attendance_status === "確認済" && invoice_status === "発行済",
        exists: !!b,
      };
    });
    return { tasks, available: true };
  } catch { return { tasks: [], available: false }; }
}
