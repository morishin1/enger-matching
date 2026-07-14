// 企業（法人）による自社案件の掲載コア（サーバー専用）。
//   DX ポータルのサーバーアクション（portal/actions.ts createClientJob）と、
//   enger-lp 向け公開API（POST /api/public/jobs）の両方から呼び、掲載フローを1本化する。
//   下書き（審査中）で作成 → /jobs の「企業掲載の承認待ち」で承認後に公開（既存フロー）。
import { engerAdmin } from "@/lib/supabase";
import { notifySlack, appUrl } from "@/lib/slack";
import { sanitizeJobDraft, type JobDraft } from "@/lib/business-ai";

export type ClientJobInput = JobDraft & { description?: string };
export type InsertJobResult = { ok: true; job_no: number } | { ok: false; error: string };

// #401：DBエラーを英語のまま企業画面へ出さない。列名はフォームの表示名（form-defs のラベル）に置き換える。
const JOB_COL_LABELS: Record<string, string> = {
  job_no: "案件番号", title: "案件名", client_name: "クライアント名", role_label: "募集職種",
  skills: "必要スキル", salary_min: "単価（下限）", salary_max: "単価（上限）", remote_type: "リモート区分",
  contract_types: "契約種別", work_location: "勤務地", start_date: "開始希望", detail: "案件詳細",
};
function jpJobDbError(msg: string): string {
  const label = (col?: string | null) => (col && JOB_COL_LABELS[col]) || col || "項目";
  let m = msg.match(/non-DEFAULT value into column "?([a-z_0-9]+)"?/i);
  if (m) return `「${label(m[1])}」は自動採番のため指定できません。時間をおいて再度お試しいただき、解決しない場合は運営までご連絡ください。`;
  m = msg.match(/null value in column "?([a-z_0-9]+)"?/i);
  if (m) return `「${label(m[1])}」が未入力です。入力のうえ、もう一度登録してください。`;
  m = msg.match(/Could not find the '([a-z_0-9]+)' column|column "?([a-z_0-9]+)"? of relation/i);
  if (m) return `登録に失敗しました：データベースに「${label(m[1] || m[2])}」の保存先が未整備です。運営までご連絡ください。`;
  if (/duplicate|unique/i.test(msg)) return "同じ内容の案件が既に登録されています。内容をご確認ください。";
  return `登録に失敗しました（${msg.slice(0, 120)}）。時間をおいて再度お試しください。`;
}

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
    // 挿入は「採番された job_no を受け取る」形にし、環境差で落ちないよう2段階でリカバリする。
    //   ① #401/#402 根本原因：live 環境の job_no は自動採番（GENERATED ALWAYS）列のため、手動採番で
    //      insert すると「cannot insert a non-DEFAULT value into column "job_no"」で必ず失敗していた。
    //      このエラーを検知したら job_no を外して再試行し、DB が採番した番号を受け取る。
    //   ② 列未整備の環境では、エラーが指す任意列だけを動的に外して再試行する（固定リスト方式だと
    //      リストにない列で復旧できず登録不能になるため）。
    const PROTECTED = new Set(["title", "client_name"]); // これらが欠ける環境は本当の異常
    let ins: any = await sb.from("jobs").insert(row).select("job_no").maybeSingle();
    for (let i = 0; i < 14 && ins.error; i++) {
      const msg = String(ins.error.message ?? "");
      if (/non-DEFAULT value into column "?job_no"?|generated always/i.test(msg) && "job_no" in row) {
        delete row.job_no; // ① 自動採番列：手動指定をやめて DB に任せる
      } else if (/column|schema cache|could not find/i.test(msg)) {
        const m = msg.match(/'([a-z_0-9]+)' column|column "?([a-z_0-9]+)"?/i);
        const col = m?.[1] || m?.[2];
        if (!col || PROTECTED.has(col) || !(col in row)) break;
        delete row[col]; // ② 未整備の任意列
      } else break;
      ins = await sb.from("jobs").insert(row).select("job_no").maybeSingle();
    }
    // #401：DBエラーは英語のまま出さず、フォームの項目名で日本語化して返す。
    if (ins.error) return { ok: false, error: jpJobDbError(String(ins.error.message ?? "")) };
    const assignedNo = ins.data?.job_no != null ? Number(ins.data.job_no) : nextNo;

    // Slack 通知：承認待ちが入ったことを社内に知らせる。/jobs の「企業掲載の承認待ち」へ直リンク。
    try {
      const title = input.title.trim();
      const role = input.role_label;
      const budget = (input.salary_min || input.salary_max) ? `${input.salary_min ?? ""}〜${input.salary_max ?? ""}万円` : "—";
      await notifySlack({
        text: `📝 案件掲載の申請：${companyName} / ${title}（No.${assignedNo}）`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*📝 案件掲載の申請がありました*\n• 申請企業: *${companyName}*\n• 案件: *${title}* (No.${assignedNo})${role ? `\n• 職種: ${role}` : ""}\n• 予算: ${budget}` } },
          { type: "context", elements: [{ type: "mrkdwn", text: `<${appUrl("/jobs")}|承認 (/jobs 企業掲載の承認待ち)> ／ <${appUrl("/portal/jobs")}|企業ポータル>` }] },
        ],
      });
    } catch { /* Slack 失敗は無視 */ }
    return { ok: true, job_no: assignedNo };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
