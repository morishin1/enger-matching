"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { engerAdmin } from "./supabase";
import { currentAccess } from "./accounts";
import { canSeeMargin } from "./engagement-access";
import { normalizeSkills } from "./skills";

/** サイドバーのカウントキャッシュを即時更新する。(Next16: 第2引数 cacheLife が必須) */
const bustCounts = () => revalidateTag("sidebar-counts", "max");

export type CandidateInput = {
  code?: string | null;
  name: string;
  title?: string | null;
  company?: string | null;
  affiliation?: string | null;
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
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const now = new Date().toISOString();

  const rows = records
    .filter((r) => r.name?.trim())
    .map((r) => ({
      code: r.code?.trim() || null,
      name: r.name.trim(),
      initials: initialsOf(r.name),
      title: r.title?.trim() || null,
      company: r.company?.trim() || null,
      affiliation: r.affiliation?.trim() || null,
      skills: normalizeSkills(r.skills ?? []),
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
  bustCounts();
  return { ok: true, inserted };
}

/** 注力フラグのトグル (service role)。案件=jobs/job_no、人材=candidates/candidate_no */
export async function toggleFocus(table: "jobs" | "candidates", idField: string, idValue: number, value: boolean, revalidate?: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const { error } = await admin.from(table).update({ is_focus: value }).eq(idField, idValue);
  if (error) return { ok: false, error: error.message };
  if (revalidate) revalidatePath(revalidate);
  bustCounts();
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
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const { error } = await admin.from(table).update({ is_focus: value }).in(idField, idValues);
  if (error) return { ok: false, updated: 0, error: error.message };
  if (revalidate) revalidatePath(revalidate);
  bustCounts();
  return { ok: true, updated: idValues.length };
}

// ===================== 提案 / 稼働 =====================

/** 提案の任意フィールドを更新 (架電進捗/担当/失注理由 等)。 */
export async function updateProposalFields(id: string, fields: Record<string, any>) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const allowed = ["caller_status", "proposer", "partner", "closer", "client_contact", "lost_reason", "lost_phase", "next_action", "stage", "meeting_date", "meeting_status"];
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in fields) patch[k] = fields[k];
  const { error } = await admin.from("proposals").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals");
  bustCounts();
  return { ok: true };
}

const parseRateNum = (rate?: string | null): number | null => {
  if (!rate) return null;
  const nums = (rate.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0 && n < 1000);
  return nums.length ? Math.max(...nums) : null;
};

/** マッチングのペアを提案ボードに記録 (service role)。重複は既存を返す。 */
export async function createProposal(jobNo: number, candNo: number, score?: number) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  let job: any = null, cand: any = null;
  {
    // outside_owner（企業担当）列が無い環境でも落ちないようフォールバック
    let jr = await admin.from("jobs").select("id, title, client_name, outside_owner").eq("job_no", jobNo).maybeSingle();
    if (jr.error) jr = await admin.from("jobs").select("id, title, client_name").eq("job_no", jobNo).maybeSingle();
    job = jr.data;
    const cr = await admin.from("candidates").select("id, name, initials, rate").eq("candidate_no", candNo).maybeSingle();
    cand = cr.data;
  }
  if (!job?.id || !cand?.id) return { ok: false, error: "案件または人材が見つかりません" };

  // 重複チェック (同一 job × candidate)
  const { data: dup } = await admin.from("proposals").select("id").eq("job_id", job.id).eq("candidate_id", cand.id).maybeSingle();
  if (dup?.id) {
    revalidatePath("/proposals");
  bustCounts();
    return { ok: true, id: dup.id, existed: true };
  }

  // デフォルトのクロージング担当 = 案件企業の担当者（案件の outside_owner、無ければ企業マスタの owner）。後で変更可。
  let defaultCloser: string | null = (job.outside_owner ?? "").trim() || null;
  if (!defaultCloser && job.client_name) {
    try {
      const { data: co } = await admin.from("companies").select("owner").ilike("name", job.client_name).maybeSingle();
      defaultCloser = ((co as any)?.owner ?? "").trim() || null;
    } catch { /* companies 未整備 */ }
  }

  const { data, error } = await admin.from("proposals").insert({
    job_id: job.id, candidate_id: cand.id, stage: "未対応",
    job_title: job.title, company: job.client_name, candidate_name: cand.name,
    c_init: cand.initials, rate: cand.rate, score: score ?? null, ai: false,
    closer: defaultCloser, // 企業担当をデフォルトのクロージング担当に
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals");
  bustCounts();
  return { ok: true, id: data.id, existed: false };
}

/** 提案ステージの変更 (カンバン移動)。 */
export async function updateProposalStage(id: string, stage: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const { error } = await admin.from("proposals").update({ stage, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals");
  bustCounts();
  return { ok: true };
}

/** 成約した提案を稼働(engagements)へ変換。提案は「成約」に更新。 */
export async function convertToEngagement(proposalId: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const { data: p } = await admin.from("proposals").select("id, job_title, company, candidate_name, rate").eq("id", proposalId).maybeSingle();
  if (!p?.id) return { ok: false, error: "提案が見つかりません" };

  // 人材マスタから所属区分を引き継ぐ（原価マスク判定キー）
  let affiliation: string | null = null;
  if (p.candidate_name) { try { const { data: c } = await admin.from("candidates").select("affiliation").eq("name", p.candidate_name).maybeSingle(); affiliation = (c as any)?.affiliation ?? null; } catch { /* 列なし無視 */ } }

  const { data: existing } = await admin.from("engagements").select("id").eq("proposal_id", proposalId).maybeSingle();
  if (!existing?.id) {
    const row: Record<string, any> = {
      proposal_id: proposalId, job_title: p.job_title, company: p.company,
      candidate_name: p.candidate_name, monthly_rate: parseRateNum(p.rate), status: "予定",
    };
    if (affiliation) row.affiliation = affiliation;
    let { error } = await admin.from("engagements").insert(row);
    if (error && /affiliation/.test(error.message)) { delete row.affiliation; ({ error } = await admin.from("engagements").insert(row)); }
    if (error) return { ok: false, error: error.message };
  }
  await admin.from("proposals").update({ stage: "稼働", updated_at: new Date().toISOString() }).eq("id", proposalId);
  revalidatePath("/proposals");
  bustCounts();
  revalidatePath("/progress");
  return { ok: true };
}

/** 稼働ステータスの更新 (予定 / 稼働中 / 終了)。 */
export async function updateEngagementStatus(id: string, status: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const { error } = await admin.from("engagements").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/progress");
  return { ok: true };
}

/** 稼働(契約)の項目を更新。原価/所属区分は権限ガードあり（F-4）。 */
export async function updateEngagementFields(id: string, fields: Record<string, any>) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  // 閲覧/編集権限の判定（プロパー原価の保護）
  const access = await currentAccess();
  const role = access?.role ?? "admin";
  let affiliation: string | null = null;
  try { const { data } = await admin.from("engagements").select("affiliation").eq("id", id).maybeSingle(); affiliation = (data as any)?.affiliation ?? null; } catch { /* 列なし等は無視 */ }

  const allowed = ["monthly_rate", "cost", "affiliation", "settle_min", "settle_max", "work_hours", "contract_status", "po_status", "start_date", "end_date", "renewal_due", "renewal_status", "status"];
  const patch: Record<string, any> = {};
  for (const k of allowed) if (k in fields) patch[k] = fields[k] === "" ? null : fields[k];

  // 所属区分の変更は管理者のみ（区分を書き換えて原価を露出させる経路を遮断）
  if ("affiliation" in patch && role !== "admin") delete patch.affiliation;
  // 原価は閲覧権限のある行のみ更新可
  if ("cost" in patch && !canSeeMargin(role, affiliation)) return { ok: false, error: "この稼働の原価を編集する権限がありません" };
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await admin.from("engagements").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/progress"); revalidatePath("/");
  return { ok: true };
}

// ----- 稼働の新規追加 / 一括インポート・エクスポート（管理者・バックオフィスのみ）-----

export type EngagementInput = {
  job_title?: string | null; company?: string | null; candidate_name?: string | null;
  monthly_rate?: number | string | null; cost?: number | string | null; affiliation?: string | null;
  status?: string | null; start_date?: string | null; end_date?: string | null;
  settle_min?: number | string | null; settle_max?: number | string | null; work_hours?: number | string | null;
  contract_status?: string | null; po_status?: string | null;
  renewal_due?: string | null; renewal_status?: string | null;
};

/** 稼働の新規追加・一括取込は 管理者 / バックオフィス（職能）のみ許可。 */
async function canManageEngagements(): Promise<boolean> {
  const access = await currentAccess();
  if (!access) return true; // 認証未設定のローカルは通す
  if (access.role === "admin") return true;
  return access.role === "agent" && (access.functions ?? []).includes("バックオフィス");
}

const _str = (v: any) => (v == null ? null : (String(v).trim() || null));
const _num = (v: any) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[^\d.\-]/g, "")); return isNaN(n) ? null : n; };
const _date = (v: any) => { const s = _str(v); if (!s) return null; const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); return m ? `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}` : null; };

function cleanEngagementRow(r: EngagementInput): Record<string, any> {
  const row: Record<string, any> = {};
  if (r.job_title !== undefined) row.job_title = _str(r.job_title);
  if (r.company !== undefined) row.company = _str(r.company);
  if (r.candidate_name !== undefined) row.candidate_name = _str(r.candidate_name);
  if (r.monthly_rate !== undefined) row.monthly_rate = _num(r.monthly_rate);
  if (r.cost !== undefined) row.cost = _num(r.cost);
  if (r.affiliation !== undefined) row.affiliation = _str(r.affiliation);
  if (r.start_date !== undefined) row.start_date = _date(r.start_date);
  if (r.end_date !== undefined) row.end_date = _date(r.end_date);
  if (r.settle_min !== undefined) row.settle_min = _num(r.settle_min);
  if (r.settle_max !== undefined) row.settle_max = _num(r.settle_max);
  if (r.work_hours !== undefined) row.work_hours = _num(r.work_hours);
  if (r.contract_status !== undefined) row.contract_status = _str(r.contract_status);
  if (r.po_status !== undefined) row.po_status = _str(r.po_status);
  if (r.renewal_due !== undefined) row.renewal_due = _date(r.renewal_due);
  if (r.renewal_status !== undefined) row.renewal_status = _str(r.renewal_status);
  row.status = _str(r.status) ?? "予定";
  return row;
}

/** 列が無い環境でも落ちないよう、エラーが指す列を外して再試行する insert。 */
async function insertEngagements(admin: ReturnType<typeof engerAdmin>, rows: Record<string, any>[]) {
  let attempt = rows;
  for (let i = 0; i < 10; i++) {
    const { error, count } = await admin.from("engagements").insert(attempt, { count: "exact" });
    if (!error) return { ok: true as const, inserted: count ?? attempt.length };
    const m = error.message.match(/'([^']+)' column/) || error.message.match(/column "([^"]+)"/);
    const col = m?.[1];
    if (col && attempt[0] && col in attempt[0]) { attempt = attempt.map((r) => { const c = { ...r }; delete c[col]; return c; }); continue; }
    return { ok: false as const, error: error.message };
  }
  return { ok: false as const, error: "取込に失敗しました（列不一致）" };
}

/** 稼働を1件新規追加。 */
export async function createEngagement(input: EngagementInput) {
  if (!(await canManageEngagements())) return { ok: false, error: "権限がありません（管理者・バックオフィスのみ）" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const row = cleanEngagementRow(input);
  if (!row.job_title && !row.candidate_name && !row.company) return { ok: false, error: "案件名・企業・氏名のいずれかは必須です" };
  const res = await insertEngagements(admin, [row]);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/progress"); revalidatePath("/"); bustCounts();
  return { ok: true };
}

/** 稼働をCSVから一括取込。 */
export async function importEngagements(records: EngagementInput[]) {
  if (!(await canManageEngagements())) return { ok: false, inserted: 0, error: "権限がありません（管理者・バックオフィスのみ）" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, inserted: 0, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const rows = records.map(cleanEngagementRow).filter((r) => r.job_title || r.candidate_name || r.company);
  if (rows.length === 0) return { ok: false, inserted: 0, error: "有効な行がありません（案件名・企業・氏名のいずれか必須）" };
  const res = await insertEngagements(admin, rows);
  if (!res.ok) return { ok: false, inserted: 0, error: res.error };
  revalidatePath("/progress"); revalidatePath("/"); bustCounts();
  return { ok: true, inserted: res.inserted };
}

// ===================== 企業マスタ =====================

export type CompanyInput = {
  name: string; industry?: string; tier?: string; status?: string;
  owner_staff?: string; contact_name?: string; contact_email?: string;
  phone?: string; website?: string; address?: string; note?: string;
};

/** 企業を新規登録/更新 (name で upsert)。 */
export async function saveCompany(input: CompanyInput) {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "企業名を入力してください" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const row: Record<string, any> = { name };
  for (const k of ["industry", "tier", "status", "owner_staff", "contact_name", "contact_email", "phone", "website", "address", "note"] as const) {
    const v = (input as any)[k];
    if (v !== undefined) row[k] = typeof v === "string" ? (v.trim() || null) : v;
  }
  const { error } = await admin.from("companies").upsert(row, { onConflict: "name" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/companies");
  return { ok: true };
}

/** 企業マスタ登録を削除（案件由来の集計表示は残る）。 */
export async function deleteCompany(name: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("companies").delete().eq("name", name);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/companies");
  return { ok: true };
}

// ===================== 担当者マスタ (提案者/クロージング) =====================

/** 担当者を追加（提案者/クロージングの役割フラグ + ログイン用メール）。 */
export async function addStaff(name: string, isProposer: boolean, isCloser: boolean, email?: string) {
  const n = name.trim();
  if (!n) return { ok: false, error: "名前を入力してください" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const row: Record<string, any> = { name: n, is_proposer: isProposer, is_closer: isCloser, active: true };
  if (email && email.trim()) row.email = email.trim();
  const { error } = await admin.from("staff").upsert(row, { onConflict: "name" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings"); revalidatePath("/proposals"); revalidateTag("staff", "max");
  return { ok: true };
}

/** 担当者の役割/名前を更新。 */
export async function updateStaff(id: string, fields: { name?: string; email?: string; is_proposer?: boolean; is_closer?: boolean; active?: boolean; position?: string | null }) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const patch: Record<string, any> = {};
  for (const k of ["name", "email", "is_proposer", "is_closer", "active", "position"] as const) if (k in fields) patch[k] = (fields as any)[k];
  const { error } = await admin.from("staff").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings"); revalidatePath("/proposals"); revalidateTag("staff", "max");
  return { ok: true };
}

/** 担当者を削除。 */
export async function deleteStaff(id: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("staff").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings"); revalidatePath("/proposals"); revalidateTag("staff", "max");
  return { ok: true };
}

/** 人材の所属区分（プロパー/BP/フリーランス）を設定。 */
export async function setCandidateAffiliation(candidateNo: number, affiliation: string | null) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("candidates").update({ affiliation: affiliation || null }).eq("candidate_no", candidateNo);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/people");
  return { ok: true };
}

/** 案件のエンド担当（アウトサイド）を設定。 */
export async function setJobOutsideOwner(jobNo: number, owner: string | null) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("jobs").update({ outside_owner: owner || null }).eq("job_no", jobNo);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/jobs"); revalidatePath("/");
  return { ok: true };
}

// ===================== 打ち合わせ記録 =====================

export type MeetingInput = {
  title?: string; company_name?: string; meeting_date?: string | null;
  their_contact?: string; our_owner?: string; new_or_existing?: string;
  relation_status?: string; fb_sentiment?: string; ai_summary?: string;
  enger_fb?: string; hit_points?: string; miss_points?: string; needs?: string;
  strategy?: string; next_action_us?: string; next_action_them?: string;
  competitors?: string[]; competitor_detail?: string; tags?: string[];
  transcript_url?: string; publishable?: string; follow_up_date?: string | null;
};

/** 打ち合わせ記録を作成 (service role)。 */
export async function createMeeting(input: MeetingInput) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const row = {
    title: input.title?.trim() || `${input.company_name ?? "打合せ"}（${input.meeting_date ?? ""}）`,
    company_name: input.company_name?.trim() || null,
    meeting_date: input.meeting_date || null,
    their_contact: input.their_contact?.trim() || null,
    our_owner: input.our_owner || null,
    new_or_existing: input.new_or_existing || null,
    relation_status: input.relation_status || null,
    fb_sentiment: input.fb_sentiment || null,
    ai_summary: input.ai_summary?.trim() || null,
    enger_fb: input.enger_fb?.trim() || null,
    hit_points: input.hit_points?.trim() || null,
    miss_points: input.miss_points?.trim() || null,
    needs: input.needs?.trim() || null,
    strategy: input.strategy?.trim() || null,
    next_action_us: input.next_action_us?.trim() || null,
    next_action_them: input.next_action_them?.trim() || null,
    competitors: input.competitors ?? [],
    competitor_detail: input.competitor_detail?.trim() || null,
    tags: input.tags ?? [],
    transcript_url: input.transcript_url?.trim() || null,
    publishable: input.publishable || null,
    follow_up_date: input.follow_up_date || null,
  };
  let { error } = await admin.from("meetings").insert(row);
  if (error && /follow_up_date/.test(error.message)) {
    // 列未追加(meetings-followup.sql 未実行)時はフォロー列を除いて再試行
    const { follow_up_date, ...rest } = row;
    ({ error } = await admin.from("meetings").insert(rest));
  }
  if (error) return { ok: false, error: error.message };
  revalidatePath("/meetings");
  revalidatePath("/companies");
  return { ok: true };
}

/** 打合せのフォロー完了/未完了を切替。 */
export async function setMeetingFollowDone(id: string, done: boolean) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("meetings").update({ follow_done: done }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/meetings");
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
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const now = new Date().toISOString();
  const salaryLabel = (lo: number | null | undefined, hi: number | null | undefined) =>
    lo && hi ? (lo === hi ? `${lo}万円` : `${lo}〜${hi}万円`) : hi ? `〜${hi}万円` : lo ? `${lo}万円〜` : "スキル見合い";

  const rows = records
    .filter((r) => r.title?.trim())
    .map((r) => ({
      title: r.title.trim(),
      client_name: r.client_name?.trim() || null,
      role_label: r.role_label?.trim() || null,
      skills: normalizeSkills(r.skills ?? []),
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
  bustCounts();
  return { ok: true, inserted };
}
