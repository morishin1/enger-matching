"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "./supabase";

export type CandidateInput = {
  code?: string | null;
  name: string;
  title?: string | null;
  company?: string | null;
  skills?: string[];
  rate?: string | null;
  rate_num?: number | null;
  avail?: string | null;
  location?: string | null;
  exp?: string | null;
  status?: string | null;
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

/** 人材CSVの取り込み (service role)。バッチで insert。 */
export async function importCandidates(records: CandidateInput[], sourceLabel: string) {
  const admin = engerAdmin();
  const now = new Date().toISOString();

  const rows = records
    .filter((r) => r.name?.trim())
    .map((r) => ({
      code: r.code?.trim() || null,
      name: r.name.trim(),
      initials: initialsOf(r.name),
      title: r.title?.trim() || null,
      company: r.company?.trim() || null,
      skills: r.skills ?? [],
      rate: r.rate?.trim() || null,
      rate_num: r.rate_num ?? null,
      avail: r.avail?.trim() || null,
      location: r.location?.trim() || null,
      exp: r.exp?.trim() || null,
      status: r.status?.trim() || "提案可",
      score: 0,
      source_csv: sourceLabel,
      imported_at: now,
    }));

  if (rows.length === 0) return { ok: false, inserted: 0, error: "有効な行がありません（氏名必須）" };

  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error, count } = await admin.from("candidates").insert(batch, { count: "exact" });
    if (error) return { ok: false, inserted, error: error.message };
    inserted += count ?? batch.length;
  }

  revalidatePath("/people");
  return { ok: true, inserted };
}

/** 注力フラグのトグル (service role)。案件=jobs/job_no、人材=candidates/candidate_no */
export async function toggleFocus(table: "jobs" | "candidates", idField: string, idValue: number, value: boolean, revalidate?: string) {
  const admin = engerAdmin();
  const { error } = await admin.from(table).update({ is_focus: value }).eq(idField, idValue);
  if (error) return { ok: false, error: error.message };
  if (revalidate) revalidatePath(revalidate);
  return { ok: true };
}

/** 注力フラグの一括設定 (service role)。チェックした複数行をまとめて注力ON/OFF。 */
export async function bulkSetFocus(
  table: "jobs" | "candidates",
  idField: string,
  idValues: number[],
  value: boolean,
  revalidate?: string,
) {
  if (!idValues || idValues.length === 0) return { ok: true, updated: 0 };
  const admin = engerAdmin();
  const { error } = await admin.from(table).update({ is_focus: value }).in(idField, idValues);
  if (error) return { ok: false, updated: 0, error: error.message };
  if (revalidate) revalidatePath(revalidate);
  return { ok: true, updated: idValues.length };
}

// ===================== 提案 / 稼働 =====================

// インサイド提案DBの運用に準拠
export const PROPOSAL_STAGES = ["未対応", "提案中", "面談調整", "クロージング中", "稼働決定"] as const;

export const CALLER_STATUSES = ["未架電", "電話(不在)", "電話済み", "LINE確認中", "メール確認中", "返信あり"];
export const PROPOSERS = ["工藤", "結城", "藤本"];
export const CLOSERS = ["未割当", "寺本", "野澤", "工藤"];
export const LOST_PHASES = ["1. 接触前失注", "2. 接触後失注", "3. 提案後失注", "4. 面談後失注", "5. 最終提示後失注"];
export const LOST_REASONS = [
  "A1: スキル不足/アンマッチ", "A2: 単価が高すぎ", "A3: 稼働開始時期が合わない", "A4: 人材側辞退",
  "A5: 経歴/人柄が刺さらず", "A6: ブランク/キャリアアンマッチ", "A7: 人材側 勤務地NG", "A8: 人材側 他社単価が高い",
  "B1: 他社で決定済み", "B2: ポジションクローズ", "B3: 予算が低すぎ", "B4: リモート/出社条件不一致", "B5: 契約形態が合わない",
  "C1: 別商流で同人材重複", "C2: 他社が単価安", "C3: 他社が提案速い",
  "D1: 自社の提案が遅れた", "D2: ヒアリング不足", "D3: フォロー漏れ/連絡途絶",
  "E1: 担当者と連絡つかず", "E2: タイミング逃した", "E3: その他", "架電できていない",
];

/** 提案の任意フィールドを更新 (架電進捗/担当/失注理由 等)。 */
export async function updateProposalFields(id: string, fields: Record<string, any>) {
  const admin = engerAdmin();
  const allowed = ["caller_status", "proposer", "closer", "client_contact", "lost_reason", "lost_phase", "next_action", "stage"];
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in fields) patch[k] = fields[k];
  const { error } = await admin.from("proposals").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals");
  return { ok: true };
}

const parseRateNum = (rate?: string | null): number | null => {
  if (!rate) return null;
  const nums = (rate.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0 && n < 1000);
  return nums.length ? Math.max(...nums) : null;
};

/** マッチングのペアを提案ボードに記録 (service role)。重複は既存を返す。 */
export async function createProposal(jobNo: number, candNo: number, score?: number) {
  const admin = engerAdmin();
  const [{ data: job }, { data: cand }] = await Promise.all([
    admin.from("jobs").select("id, title, client_name").eq("job_no", jobNo).maybeSingle(),
    admin.from("candidates").select("id, name, initials, rate").eq("candidate_no", candNo).maybeSingle(),
  ]);
  if (!job?.id || !cand?.id) return { ok: false, error: "案件または人材が見つかりません" };

  // 重複チェック (同一 job × candidate)
  const { data: dup } = await admin.from("proposals").select("id").eq("job_id", job.id).eq("candidate_id", cand.id).maybeSingle();
  if (dup?.id) {
    revalidatePath("/proposals");
    return { ok: true, id: dup.id, existed: true };
  }

  const { data, error } = await admin.from("proposals").insert({
    job_id: job.id, candidate_id: cand.id, stage: "未対応",
    job_title: job.title, company: job.client_name, candidate_name: cand.name,
    c_init: cand.initials, rate: cand.rate, score: score ?? null, ai: false,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals");
  return { ok: true, id: data.id, existed: false };
}

/** 提案ステージの変更 (カンバン移動)。 */
export async function updateProposalStage(id: string, stage: string) {
  const admin = engerAdmin();
  const { error } = await admin.from("proposals").update({ stage, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals");
  return { ok: true };
}

/** 成約した提案を稼働(engagements)へ変換。提案は「成約」に更新。 */
export async function convertToEngagement(proposalId: string) {
  const admin = engerAdmin();
  const { data: p } = await admin.from("proposals").select("id, job_title, company, candidate_name, rate").eq("id", proposalId).maybeSingle();
  if (!p?.id) return { ok: false, error: "提案が見つかりません" };

  const { data: existing } = await admin.from("engagements").select("id").eq("proposal_id", proposalId).maybeSingle();
  if (!existing?.id) {
    const { error } = await admin.from("engagements").insert({
      proposal_id: proposalId, job_title: p.job_title, company: p.company,
      candidate_name: p.candidate_name, monthly_rate: parseRateNum(p.rate), status: "予定",
    });
    if (error) return { ok: false, error: error.message };
  }
  await admin.from("proposals").update({ stage: "稼働決定", updated_at: new Date().toISOString() }).eq("id", proposalId);
  revalidatePath("/proposals");
  revalidatePath("/progress");
  return { ok: true };
}

/** 稼働ステータスの更新 (予定 / 稼働中 / 終了)。 */
export async function updateEngagementStatus(id: string, status: string) {
  const admin = engerAdmin();
  const { error } = await admin.from("engagements").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/progress");
  return { ok: true };
}

export type JobInput = {
  title: string;
  client_name?: string | null;
  role_label?: string | null;
  skills?: string[];
  salary_min?: number | null;
  salary_max?: number | null;
  remote_type?: string | null;
  flow_note?: string | null;
  work_location?: string | null;
  start_date?: string | null;
  detail?: string | null;
  status?: string | null;
};

/** 案件CSVの取り込み (service role)。title+client_name の重複は無視。 */
export async function importJobs(records: JobInput[], sourceLabel: string) {
  const admin = engerAdmin();
  const now = new Date().toISOString();
  const salaryLabel = (lo: number | null | undefined, hi: number | null | undefined) =>
    lo && hi ? (lo === hi ? `${lo}万円` : `${lo}〜${hi}万円`) : hi ? `〜${hi}万円` : lo ? `${lo}万円〜` : "スキル見合い";

  const rows = records
    .filter((r) => r.title?.trim())
    .map((r) => ({
      title: r.title.trim(),
      client_name: r.client_name?.trim() || null,
      role_label: r.role_label?.trim() || null,
      skills: r.skills ?? [],
      salary_min: r.salary_min ?? null,
      salary_max: r.salary_max ?? null,
      salary_label: salaryLabel(r.salary_min, r.salary_max),
      remote_type: r.remote_type || "partial_remote",
      flow_note: r.flow_note?.trim() || null,
      work_location: r.work_location?.trim() || null,
      start_date: r.start_date || null,
      detail: r.detail?.trim() || null,
      status: r.status?.trim() || "募集中",
      rank: "-",
      is_published: true,
      source_csv: sourceLabel,
      imported_at: now,
      created_at: now,
    }));

  if (rows.length === 0) return { ok: false, inserted: 0, error: "有効な行がありません（案件名必須）" };

  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error, count } = await admin
      .from("jobs")
      .upsert(batch, { onConflict: "title,client_name", ignoreDuplicates: true, count: "exact" });
    if (error) return { ok: false, inserted, error: error.message };
    inserted += count ?? batch.length;
  }

  revalidatePath("/jobs");
  return { ok: true, inserted };
}
