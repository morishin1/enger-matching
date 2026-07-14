// 企業（法人）による自社案件の掲載コア（サーバー専用）。
//   DX ポータルのサーバーアクション（portal/actions.ts createClientJob）と、
//   enger-lp 向け公開API（POST /api/public/jobs）の両方から呼び、掲載フローを1本化する。
//   下書き（審査中）で作成 → /jobs の「企業掲載の承認待ち」で承認後に公開（既存フロー）。
import { engerAdmin } from "@/lib/supabase";
import { notifySlack, appUrl } from "@/lib/slack";
import { sanitizeJobDraft, type JobDraft } from "@/lib/business-ai";

export type ClientJobInput = JobDraft & { description?: string };
export type InsertJobResult = { ok: true; job_no: number } | { ok: false; error: string };

/** 企業案件を「審査中」で登録し、Slack で社内へ承認依頼を通知する。 */
export async function insertClientJob(companyName: string, email: string | null, raw: ClientJobInput): Promise<InsertJobResult> {
  const input = sanitizeJobDraft(raw);
  const detail = (input.detail ?? raw.description ?? "").toString().trim() || null;
  if (!input.title?.trim()) return { ok: false, error: "案件名を入力してください" };

  try {
    const sb = engerAdmin();
    // job_no は連番。最大値+1。
    const { data: maxRow } = await sb.from("jobs").select("job_no").order("job_no", { ascending: false }).limit(1).maybeSingle();
    const nextNo = (Number((maxRow as any)?.job_no) || 0) + 1;

    const row: Record<string, any> = {
      job_no: nextNo,
      title: input.title.trim(),
      client_name: companyName,
      role_label: input.role_label ?? null,
      skills: input.skills ?? [],
      salary_min: input.salary_min ?? null,
      salary_max: input.salary_max ?? null,
      remote_type: input.remote_type ?? null,
      contract_types: input.contract_types ?? [],
      work_location: input.work_location ?? null,
      start_date: input.start_date ?? null,
      // detail はDXマッチング（スキル/国籍/年代判定）が読む本文。description は旧ポータル互換。
      detail,
      description: detail,
      posted_by_client: true,
      posted_by_email: email,
      review_status: "pending",
      status: "審査中",
      is_published: false,
    };
    // 列未整備の環境でも登録できるよう、エラーが指す列を「動的に」外して再試行する。
    //   #402：従来は固定リスト（work_location 等）だけを外していたため、live 環境に存在しない
    //   別の任意列（posted_by_client / detail / review_status 等）でエラーになると復旧できず
    //   「AIで下書きした案件が登録できない」原因になっていた。エラーの指す列を順に除去する。
    const PROTECTED = new Set(["job_no", "title", "client_name"]); // これらが欠ける環境は本当の異常
    let { error } = await sb.from("jobs").insert(row);
    for (let i = 0; i < 12 && error; i++) {
      const msg = String(error.message ?? "");
      if (!/column|schema cache|could not find/i.test(msg)) break;
      const m = msg.match(/'([a-z_0-9]+)' column|column "?([a-z_0-9]+)"?/i);
      const col = m?.[1] || m?.[2];
      if (!col || PROTECTED.has(col) || !(col in row)) break;
      delete row[col];
      ({ error } = await sb.from("jobs").insert(row));
    }
    if (error) return { ok: false, error: error.message };

    // Slack 通知：承認待ちが入ったことを社内に知らせる。/jobs の「企業掲載の承認待ち」へ直リンク。
    try {
      const title = input.title.trim();
      const role = input.role_label;
      const budget = (input.salary_min || input.salary_max) ? `${input.salary_min ?? ""}〜${input.salary_max ?? ""}万円` : "—";
      await notifySlack({
        text: `📝 案件掲載の申請：${companyName} / ${title}（No.${nextNo}）`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*📝 案件掲載の申請がありました*\n• 申請企業: *${companyName}*\n• 案件: *${title}* (No.${nextNo})${role ? `\n• 職種: ${role}` : ""}\n• 予算: ${budget}` } },
          { type: "context", elements: [{ type: "mrkdwn", text: `<${appUrl("/jobs")}|承認 (/jobs 企業掲載の承認待ち)> ／ <${appUrl("/portal/jobs")}|企業ポータル>` }] },
        ],
      });
    } catch { /* Slack 失敗は無視 */ }
    return { ok: true, job_no: nextNo };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
