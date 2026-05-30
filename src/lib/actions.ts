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
  remote_pref?: string | null;     // リモート希望（マッチングのリモート評価に使用）
  age_band?: string | null;        // 年齢層
  nationality?: string | null;     // 国籍
  skill_level?: string | null;     // スキルレベル
  japanese_level?: string | null;  // 日本語レベル
  comm?: string | null;            // コミュニケーション力
  note?: string | null;            // 備考
  skill_sheet_url?: string | null;
  email?: string | null;          // 人材本人の連絡先（あれば）
  contact_email?: string | null;  // 所属(SES)窓口＝元メールの送信元
  source_mail_url?: string | null; // 元メール(Gmail)へのURL
  operator?: string | null;        // 登録担当（KPI集計用・新規登録時のみ記録）
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

/** 重複判定用の正規化（空白・全角・記号を除去）。 */
const normKey = (s?: string | null): string => String(s ?? "").toLowerCase().replace(/[\s　]/g, "").replace(/[（）()・,，、。．.\-－_/／]/g, "");

/** 人材CSVの取り込み (service role)。バッチで insert。 */
export async function importCandidates(records: CandidateInput[], sourceLabel: string, operator?: string | null) {
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
      // source_company も同時保存（読み出し側は source_company を主、company をフォールバック）
      source_company: r.company?.trim() || null,
      affiliation: r.affiliation?.trim() || null,
      skills: normalizeSkills(r.skills ?? []),
      rate: r.rate?.trim() || null,
      rate_num: r.rate_num ?? null,
      avail: r.avail?.trim() || null,
      location: r.location?.trim() || null,
      exp: r.exp?.trim() || null,
      status: r.status?.trim() || "提案可",
      remote_pref: r.remote_pref?.trim() || null,
      age_band: r.age_band?.trim() || null,
      nationality: r.nationality?.trim() || null,
      skill_level: r.skill_level?.trim() || null,
      japanese_level: r.japanese_level?.trim() || null,
      comm: r.comm?.trim() || null,
      note: r.note?.trim() || null,
      skill_sheet_url: r.skill_sheet_url?.trim() || null,
      email: r.email?.trim() || null,
      contact_email: r.contact_email?.trim() || null,
      source_mail_url: r.source_mail_url?.trim() || null,
      operator: operator?.trim() || null,
      score: 0,
      source_csv: sourceLabel,
      imported_at: now,
    }));

  if (rows.length === 0) return { ok: false, inserted: 0, error: "有効な行がありません（氏名必須）" };

  // 重複排除（氏名×会社×メールID）。会社が空でも元メールが違えば別人として取り込む
  // （同姓同名で会社空欄の別人を取りこぼさない）。バッチ内＋既存DBと突合し、新規のみ取り込む。
  const dkey = (name?: string | null, company?: string | null, mail?: string | null) =>
    normKey(name) + "|" + normKey(company) + "|" + String(mail ?? "").trim();
  const existing = new Set<string>();
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("candidates").select("name, company, source_company, source_mail_url").range(from, from + 999);
      if (error || !data) break;
      for (const r of data as any[]) existing.add(dkey(r.name, r.company || r.source_company, r.source_mail_url));
      if (data.length < 1000) break;
    }
  } catch { /* 取得失敗時は突合スキップ（最悪でも従来どおり） */ }

  const seen = new Set<string>();
  const fresh = rows.filter((r) => {
    const k = dkey(r.name, r.company, r.source_mail_url);
    if (existing.has(k) || seen.has(k)) return false;
    seen.add(k); return true;
  });
  const skipped = rows.length - fresh.length;
  if (fresh.length === 0) { revalidatePath("/people"); bustCounts(); return { ok: true, inserted: 0, skipped }; }

  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < fresh.length; i += BATCH) {
    const batch = fresh.slice(i, i + BATCH);
    let { error, count } = await admin.from("candidates").insert(batch, { count: "exact" });
    // 追加列（skill_sheet_url/email/remote_pref/age_band/operator 等）が未整備でも落ちないよう、その列を外して再試行
    if (error && /skill_sheet_url|email|source_mail_url|source_company|remote_pref|age_band|nationality|skill_level|japanese_level|comm|note|operator|column/i.test(error.message)) {
      const stripped = batch.map((b) => { const o: any = { ...b }; for (const k of ["skill_sheet_url", "email", "contact_email", "source_mail_url", "source_company", "remote_pref", "age_band", "nationality", "skill_level", "japanese_level", "comm", "note", "operator"]) delete o[k]; return o; });
      ({ error, count } = await admin.from("candidates").insert(stripped, { count: "exact" }));
    }
    if (error) return { ok: false, inserted, error: error.message };
    inserted += count ?? batch.length;
  }

  revalidatePath("/people");
  bustCounts();
  return { ok: true, inserted, skipped };
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

/** 案件を一括削除（job_no の配列で指定）。 */
export async function bulkDeleteJobs(jobNos: number[]) {
  if (!jobNos.length) return { ok: true, deleted: 0 };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("jobs").delete().in("job_no", jobNos);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/jobs");
  bustCounts();
  return { ok: true, deleted: jobNos.length };
}

/** 人材を一括削除（candidate_no の配列で指定）。 */
export async function bulkDeleteCandidates(candidateNos: number[]) {
  if (!candidateNos.length) return { ok: true, deleted: 0 };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("candidates").delete().in("candidate_no", candidateNos);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/people");
  bustCounts();
  return { ok: true, deleted: candidateNos.length };
}

// ===================== 提案 / 稼働 =====================

/** 提案の任意フィールドを更新 (架電進捗/担当/失注理由 等)。 */
export async function updateProposalFields(id: string, fields: Record<string, any>) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const allowed = ["caller_status", "proposer", "partner", "closer", "client_contact", "lost_reason", "lost_phase", "next_action", "stage", "meeting_date", "meeting_status", "company", "source"];
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in fields) patch[k] = fields[k];
  let { error } = await admin.from("proposals").update(patch).eq("id", id);
  // source 列が未追加の環境でも落ちないようフォールバック（proposals-source.sql 未実行時）
  if (error && /source|column/i.test(error.message) && "source" in patch) {
    const { source: _drop, ...rest } = patch;
    ({ error } = await admin.from("proposals").update(rest).eq("id", id));
  }
  if (error) return { ok: false, error: error.message };

  // 会社名が入力されていれば企業マスタへ紐づけ（窓口担当=client_contact / 自社担当=closer）。
  // 企業管理(/companies) でも「その会社の誰が担当か」を一元で確認できるようにする。
  const company = typeof fields.company === "string" ? fields.company.trim() : "";
  if (company) {
    const crow: Record<string, any> = { name: company };
    if (typeof fields.client_contact === "string" && fields.client_contact.trim()) crow.contact_name = fields.client_contact.trim();
    if (typeof fields.closer === "string" && fields.closer.trim()) crow.owner_staff = fields.closer.trim();
    try {
      let r = await admin.from("companies").upsert(crow, { onConflict: "name" });
      if (r.error && /column|owner_staff|contact_name/i.test(r.error.message)) {
        await admin.from("companies").upsert({ name: company }, { onConflict: "name" });
      }
      revalidatePath("/companies");
    } catch { /* companies 未整備でも提案更新は成功させる */ }
  }

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

  // 重複チェック (同一 job × candidate)。
  //   maybeSingle() は2件以上ヒット時にエラーで null を返し「未登録」と誤判定→二重登録が雪だるま式に増える。
  //   limit(1) で先頭を取り、既存があれば必ず existed として返す（冪等）。
  const { data: dups } = await admin.from("proposals").select("id").eq("job_id", job.id).eq("candidate_id", cand.id).limit(1);
  if (dups && dups.length > 0) {
    revalidatePath("/proposals");
    bustCounts();
    return { ok: true, id: dups[0].id, existed: true };
  }

  // デフォルトのクロージング担当 = 案件企業の担当者（案件の outside_owner、無ければ企業マスタの owner）。後で変更可。
  let defaultCloser: string | null = (job.outside_owner ?? "").trim() || null;
  if (!defaultCloser && job.client_name) {
    try {
      const { data: co } = await admin.from("companies").select("owner").ilike("name", job.client_name).maybeSingle();
      defaultCloser = ((co as any)?.owner ?? "").trim() || null;
    } catch { /* companies 未整備 */ }
  }

  const insertBase = {
    job_id: job.id, candidate_id: cand.id, stage: "返信待ち",
    job_title: job.title, company: job.client_name, candidate_name: cand.name,
    c_init: cand.initials, rate: cand.rate, score: score ?? null, ai: false,
    closer: defaultCloser, // 企業担当をデフォルトのクロージング担当に
  } as Record<string, any>;
  let ins: any = await admin.from("proposals").insert({ ...insertBase, stage_updated_at: new Date().toISOString() }).select("id").single();
  if (ins.error && /stage_updated_at|column/i.test(ins.error.message)) {
    ins = await admin.from("proposals").insert(insertBase).select("id").single();
  }
  const data = ins.data; const error = ins.error;
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals");
  bustCounts();
  return { ok: true, id: data.id, existed: false };
}

/** 提案ステージの変更 (カンバン移動)。 */
/** 提案ステージを更新。stage_updated_at も同時に更新して滞留日数を正確に。
 *  stage_updated_at 列が未追加の環境では自動で外して再試行。 */
export async function updateProposalStage(id: string, stage: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const now = new Date().toISOString();
  let r: any = await admin.from("proposals").update({ stage, updated_at: now, stage_updated_at: now }).eq("id", id);
  if (r.error && /stage_updated_at|column/i.test(r.error.message)) {
    r = await admin.from("proposals").update({ stage, updated_at: now }).eq("id", id);
  }
  const error = r.error;
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals");
  bustCounts();
  return { ok: true };
}

/** 提案を削除（記録ミスの取り消し）。紐づく稼働があれば一緒に削除。 */
export async function deleteProposal(id: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!id) return { ok: false, error: "id がありません" };
  try { await admin.from("engagements").delete().eq("proposal_id", id); } catch { /* engagements未整備でも続行 */ }
  const { error } = await admin.from("proposals").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals"); bustCounts(); revalidatePath("/progress");
  return { ok: true };
}

/**
 * 提案の取り消し（記録直後のみ）。
 * 以下の条件を全て満たす場合のみ削除を許可：
 *   - stage が初期値（返信待ち）のまま
 *   - next_action が未入力
 *   - 作成から60秒以内（updated_at ≈ created_at）
 *   - 紐づく稼働(engagements)が無い
 */
export async function undoProposal(id: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!id) return { ok: false, error: "id がありません" };

  const { data: p, error: fe } = await admin
    .from("proposals")
    .select("id, stage, next_action, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (fe || !p) return { ok: false, error: "提案が見つかりません" };

  if (p.stage !== "返信待ち") return { ok: false, error: `ステージが「${p.stage}」に進んでいるため取り消せません` };
  if (p.next_action) return { ok: false, error: "次のアクションが記入済みのため取り消せません" };

  const diffSec = (new Date(p.updated_at).getTime() - new Date(p.created_at).getTime()) / 1000;
  if (diffSec > 60) return { ok: false, error: "作成から時間が経過しているため取り消せません（提案管理から削除してください）" };

  const { data: eng } = await admin.from("engagements").select("id").eq("proposal_id", id).limit(1);
  if (eng && eng.length > 0) return { ok: false, error: "稼働が紐づいているため取り消せません" };

  const { error } = await admin.from("proposals").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals"); bustCounts(); revalidatePath("/matching");
  return { ok: true };
}

/** 見送り/失注/稼働化した提案をボードに戻す（ステージを「返信待ち」へ）。 */
export async function restoreProposal(id: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!id) return { ok: false, error: "id がありません" };
  // 稼働化済みなら稼働も取り消し
  try { await admin.from("engagements").delete().eq("proposal_id", id); } catch { /* 続行 */ }
  const now = new Date().toISOString();
  let rr: any = await admin.from("proposals").update({ stage: "返信待ち", lost_reason: null, lost_phase: null, updated_at: now, stage_updated_at: now }).eq("id", id);
  if (rr.error && /stage_updated_at|column/i.test(rr.error.message)) {
    rr = await admin.from("proposals").update({ stage: "返信待ち", lost_reason: null, lost_phase: null, updated_at: now }).eq("id", id);
  }
  const error = rr.error;
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals"); bustCounts(); revalidatePath("/progress");
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
  {
    const now = new Date().toISOString();
    let r2: any = await admin.from("proposals").update({ stage: "稼働", updated_at: now, stage_updated_at: now }).eq("id", proposalId);
    if (r2.error && /stage_updated_at|column/i.test(r2.error.message)) {
      await admin.from("proposals").update({ stage: "稼働", updated_at: now }).eq("id", proposalId);
    }
  }
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

// ----- 単価アップ履歴（稼働契約の月額単価の変更ログ）-----

export type RateChange = { id: string; effective_date: string; old_rate: number | null; new_rate: number; note: string | null; created_at: string };

/** ある稼働の単価変更履歴を取得（適用日の新しい順）。 */
export async function getRateChanges(engagementId: string): Promise<{ ok: boolean; rows?: RateChange[]; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { data, error } = await admin.from("engagement_rate_changes")
    .select("id, effective_date, old_rate, new_rate, note, created_at")
    .eq("engagement_id", engagementId)
    .order("effective_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as RateChange[] };
}

/** 単価アップ(変更)を記録：履歴に1件追加し、engagements.monthly_rate を新単価へ更新。 */
export async function recordRateChange(engagementId: string, input: { new_rate: number | string; effective_date?: string | null; note?: string | null }) {
  if (!(await canManageEngagements())) return { ok: false, error: "権限がありません（管理者・バックオフィスのみ）" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  const newRate = _num(input.new_rate);
  if (newRate == null) return { ok: false, error: "新しい月額(万)を入力してください" };
  const eff = _date(input.effective_date) ?? new Date().toISOString().slice(0, 10);

  const { data: e } = await admin.from("engagements").select("monthly_rate").eq("id", engagementId).maybeSingle();
  if (!e) return { ok: false, error: "稼働が見つかりません" };
  const oldRate = (e as any).monthly_rate != null ? Number((e as any).monthly_rate) : null;

  const { error: insErr } = await admin.from("engagement_rate_changes")
    .insert({ engagement_id: engagementId, effective_date: eff, old_rate: oldRate, new_rate: newRate, note: _str(input.note) });
  if (insErr) return { ok: false, error: insErr.message };

  const { error: updErr } = await admin.from("engagements").update({ monthly_rate: newRate }).eq("id", engagementId);
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath("/progress"); revalidatePath("/");
  return { ok: true };
}

// ----- 書類送付の期限管理（document_tasks）-----

export type DocumentTaskInput = {
  party?: string | null; counterparty?: string | null; subject?: string | null;
  doc_type?: string | null; due_date?: string | null; status?: string | null; note?: string | null;
};

function cleanDocumentTask(input: DocumentTaskInput): Record<string, any> {
  return {
    party: _str(input.party) ?? "上位",
    counterparty: _str(input.counterparty),
    subject: _str(input.subject),
    doc_type: _str(input.doc_type) ?? "契約書",
    due_date: _date(input.due_date),
    status: _str(input.status) ?? "未送付",
    note: _str(input.note),
  };
}

/** 書類送付タスクを1件追加（管理者・バックオフィスのみ）。 */
export async function createDocumentTask(input: DocumentTaskInput) {
  if (!(await canManageEngagements())) return { ok: false, error: "権限がありません（管理者・バックオフィスのみ）" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("document_tasks").insert(cleanDocumentTask(input));
  if (error) return { ok: false, error: error.message };
  revalidatePath("/documents");
  return { ok: true };
}

/** 書類送付タスクの項目を更新（管理者・バックオフィスのみ）。 */
export async function updateDocumentTask(id: string, fields: DocumentTaskInput) {
  if (!(await canManageEngagements())) return { ok: false, error: "権限がありません（管理者・バックオフィスのみ）" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const allowed = ["party", "counterparty", "subject", "doc_type", "due_date", "status", "note"] as const;
  const patch: Record<string, any> = {};
  for (const k of allowed) if (k in fields) patch[k] = k === "due_date" ? _date((fields as any)[k]) : _str((fields as any)[k]);
  if (Object.keys(patch).length === 0) return { ok: true };
  patch.updated_at = new Date().toISOString();
  const { error } = await admin.from("document_tasks").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/documents");
  return { ok: true };
}

/** 書類送付タスクを削除（管理者・バックオフィスのみ）。 */
export async function deleteDocumentTask(id: string) {
  if (!(await canManageEngagements())) return { ok: false, error: "権限がありません（管理者・バックオフィスのみ）" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("document_tasks").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/documents");
  return { ok: true };
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

/** 企業マスタをCSVから一括登録/更新（name で upsert）。案件/人材が無くても企業として残る。 */
export async function importCompanies(records: CompanyInput[]) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, inserted: 0, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const rows = records.filter((r) => r.name?.trim()).map((r) => {
    const row: Record<string, any> = { name: r.name.trim() };
    for (const k of ["industry", "tier", "status", "owner_staff", "contact_name", "contact_email", "phone", "website", "address", "note"] as const) {
      const v = (r as any)[k]; if (v != null && String(v).trim()) row[k] = String(v).trim();
    }
    return row;
  });
  if (rows.length === 0) return { ok: false, inserted: 0, error: "有効な行がありません（企業名必須）" };
  let inserted = 0; const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error, count } = await admin.from("companies").upsert(batch, { onConflict: "name", count: "exact" });
    if (error) return { ok: false, inserted, error: error.message };
    inserted += count ?? batch.length;
  }
  revalidatePath("/companies"); bustCounts();
  return { ok: true, inserted };
}

/** 企業へ連絡したことを記録（last_contacted_at を現在時刻に）。3ヶ月ごとのフォロー管理用。 */
export async function markCompanyContacted(name: string) {
  const n = (name || "").trim();
  if (!n) return { ok: false, error: "企業名がありません" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("companies").upsert({ name: n, last_contacted_at: new Date().toISOString() }, { onConflict: "name" });
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
  contact_name?: string | null;   // 案件窓口の担当者名
  contact_email?: string | null;  // 案件窓口＝元メールの送信元（返信先）
  source_mail_url?: string | null; // 元メール(Gmail)へのURL
  operator?: string | null;        // 登録担当（KPI集計用）
};

/** 案件CSVの取り込み (service role)。title+client_name の重複は無視。 */
export async function importJobs(records: JobInput[], sourceLabel: string, operator?: string | null) {
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
      contact_name: r.contact_name?.trim() || null,
      contact_email: r.contact_email?.trim() || null,
      source_mail_url: r.source_mail_url?.trim() || null,
      rank: "-",
      is_published: true,
      source_csv: sourceLabel,
      operator: operator?.trim() || null,
      imported_at: now,
      created_at: now,
    }));

  if (rows.length === 0) return { ok: false, inserted: 0, error: "有効な行がありません（案件名必須）" };

  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    let { error, count } = await admin
      .from("jobs")
      .upsert(batch, { onConflict: "title,client_name", ignoreDuplicates: true, count: "exact" });
    // contact_email / source_mail_url / operator 列が未追加（SQL未実行）でも落ちないよう、その列を外して再試行
    if (error && /contact_email|contact_name|source_mail_url|operator|column/i.test(error.message)) {
      const stripped = batch.map((b) => { const o: any = { ...b }; delete o.contact_name; delete o.contact_email; delete o.source_mail_url; delete o.operator; return o; });
      ({ error, count } = await admin.from("jobs").upsert(stripped, { onConflict: "title,client_name", ignoreDuplicates: true, count: "exact" }));
    }
    if (error) return { ok: false, inserted, error: error.message };
    inserted += count ?? batch.length;
  }

  revalidatePath("/jobs");
  bustCounts();
  return { ok: true, inserted };
}

// ----- 手動登録前の類似候補プレビュー --------------------------------------
// 完全一致マージの前に「似た既存」を提示し、二重登録/取り違えを防ぐ。
// 非公開（過去インポートで一覧に出ない）案件・人材も対象に含める。

/** ilike のワイルドカード文字をエスケープ。 */
const escLike = (s: string) => s.replace(/[%_\\]/g, (m) => "\\" + m);

export type SimilarJob = { job_no: number; title: string; client_name: string | null; is_published: boolean; role_label: string | null; salary_min: number | null; salary_max: number | null; exact: boolean };

/** 案件名/クライアント名から似た既存案件を探す（非公開も含む）。 */
export async function findSimilarJobs(input: { title?: string | null; client_name?: string | null }): Promise<{ ok: boolean; items: SimilarJob[]; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, items: [], error: "サーバ設定エラー" }; }
  const title = (input.title ?? "").trim();
  const client = (input.client_name ?? "").trim();
  if (title.length < 2 && client.length < 2) return { ok: true, items: [] };
  const cols = "job_no, title, client_name, is_published, role_label, salary_min, salary_max";
  const map = new Map<number, any>();
  const run = async (qb: any) => { const r: any = await qb; if (!r.error) for (const x of (r.data ?? [])) if (x.job_no != null) map.set(x.job_no, x); };
  // タイトル部分一致／クライアント部分一致を別々に引いて統合（ilike特殊文字はエスケープ）
  if (title.length >= 2) await run(admin.from("jobs").select(cols).ilike("title", `%${escLike(title)}%`).order("job_no", { ascending: false }).limit(20));
  if (client.length >= 2) await run(admin.from("jobs").select(cols).ilike("client_name", `%${escLike(client)}%`).order("job_no", { ascending: false }).limit(20));
  const nt = normKey(title), nc = normKey(client);
  const items: SimilarJob[] = Array.from(map.values()).map((x) => {
    const exact = !!title && normKey(x.title) === nt && (client ? normKey(x.client_name) === nc : !x.client_name);
    return { job_no: x.job_no, title: x.title, client_name: x.client_name ?? null, is_published: x.is_published !== false, role_label: x.role_label ?? null, salary_min: x.salary_min ?? null, salary_max: x.salary_max ?? null, exact };
  });
  // 完全一致を上、次に正規化部分一致の近いもの。最大8件。
  items.sort((a, b) => (Number(b.exact) - Number(a.exact)) || (a.job_no < b.job_no ? 1 : -1));
  return { ok: true, items: items.slice(0, 8) };
}

export type SimilarCandidate = { candidate_no: number; name: string; company: string | null; affiliation: string | null; title: string | null; rate: string | null; exact: boolean };

/** 氏名/会社から似た既存人材を探す。 */
export async function findSimilarCandidates(input: { name?: string | null; company?: string | null }): Promise<{ ok: boolean; items: SimilarCandidate[]; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, items: [], error: "サーバ設定エラー" }; }
  const name = (input.name ?? "").trim();
  const company = (input.company ?? "").trim();
  if (name.length < 1) return { ok: true, items: [] };
  const cols = "candidate_no, name, company, source_company, affiliation, title, rate";
  const map = new Map<number, any>();
  const run = async (qb: any) => { const r: any = await qb; if (!r.error) for (const x of (r.data ?? [])) if (x.candidate_no != null) map.set(x.candidate_no, x); };
  await run(admin.from("candidates").select(cols).ilike("name", `%${escLike(name)}%`).order("candidate_no", { ascending: false }).limit(20));
  const nn = normKey(name), nco = normKey(company);
  const items: SimilarCandidate[] = Array.from(map.values()).map((x) => {
    const co = x.company || x.source_company || null;
    const exact = normKey(x.name) === nn && (company ? normKey(co) === nco : true);
    return { candidate_no: x.candidate_no, name: x.name, company: co, affiliation: x.affiliation ?? null, title: x.title ?? null, rate: x.rate ?? null, exact };
  });
  items.sort((a, b) => (Number(b.exact) - Number(a.exact)) || (a.candidate_no < b.candidate_no ? 1 : -1));
  return { ok: true, items: items.slice(0, 8) };
}

// ----- 手動1件 upsert（新規登録モーダル用） ----------------------------------
// 重複時はスキップせず「再公開＋更新」する。空欄項目は既存値を保持。

/** 案件の手動1件 upsert。title×client_name で既存があれば更新、無ければ挿入。 */
export async function upsertJobManual(rec: JobInput) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!rec.title?.trim()) return { ok: false as const, error: "案件名は必須です" };
  const now = new Date().toISOString();
  const salaryLabel = (lo?: number | null, hi?: number | null) =>
    lo && hi ? (lo === hi ? `${lo}万円` : `${lo}〜${hi}万円`) : hi ? `〜${hi}万円` : lo ? `${lo}万円〜` : "スキル見合い";
  const row: Record<string, any> = {
    title: rec.title.trim(),
    client_name: rec.client_name?.trim() || null,
    role_label: rec.role_label?.trim() || null,
    skills: normalizeSkills(rec.skills ?? []),
    salary_min: rec.salary_min ?? null,
    salary_max: rec.salary_max ?? null,
    salary_label: salaryLabel(rec.salary_min, rec.salary_max),
    remote_type: rec.remote_type || "partial_remote",
    flow_note: rec.flow_note?.trim() || null,
    work_location: rec.work_location?.trim() || null,
    start_date: rec.start_date || null,
    detail: rec.detail?.trim() || null,
    status: rec.status?.trim() || "募集中",
    contact_name: rec.contact_name?.trim() || null,
    contact_email: rec.contact_email?.trim() || null,
    source_mail_url: rec.source_mail_url?.trim() || null,
    rank: "-",
    is_published: true,
    source_csv: "manual",
    operator: rec.operator?.trim() || null,
    imported_at: now,
  };

  const stripCols = (o: Record<string, any>) => { const c = { ...o }; delete c.contact_name; delete c.contact_email; delete c.source_mail_url; delete c.operator; return c; };
  // 既存案件を更新・再公開する（複数ヒット時は最若番を採用）
  const updateExisting = async (id: string, jobNo: number, wasPublished: boolean) => {
    const update: Record<string, any> = { is_published: true, imported_at: now };
    for (const [k, v] of Object.entries(row)) {
      if (k === "is_published" || k === "imported_at" || k === "created_at" || k === "operator") continue; // operatorは登録時のみ
      if (v == null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      update[k] = v;
    }
    let r: any = await admin.from("jobs").update(update).eq("id", id);
    if (r.error && /contact_email|contact_name|source_mail_url|column/i.test(r.error.message)) {
      r = await admin.from("jobs").update(stripCols(update)).eq("id", id);
    }
    if (r.error) return { ok: false as const, error: r.error.message };
    revalidatePath("/jobs"); bustCounts();
    return { ok: true as const, action: "updated" as const, job_no: jobNo, republished: !wasPublished };
  };

  // 既存検索（title 完全一致＋client_name 一致 or 両方 null）
  // 注意: 過去のインポートで同一 title×client_name が「非公開」や「複数行」で残っている
  // ことがある。.maybeSingle() は複数行でエラーになり、フォールバックの INSERT が一意制約
  // (jobs_title_client_uq) に当たって「重複で登録不可」になる事故が起きるため、
  // 並べて先頭(最若番)の既存案件を採用して更新・再公開する。
  let q = admin.from("jobs").select("id, job_no, is_published").eq("title", row.title);
  q = row.client_name ? q.eq("client_name", row.client_name) : q.is("client_name", null);
  const exList: any = await q.order("job_no", { ascending: true }).limit(1);
  const exRow = exList.data?.[0] ?? null;
  if (exRow?.id) return updateExisting(exRow.id, exRow.job_no, !!exRow.is_published);

  // 新規 INSERT
  row.created_at = now;
  let r: any = await admin.from("jobs").insert(row).select("job_no").maybeSingle();
  if (r.error && /contact_email|contact_name|source_mail_url|column/i.test(r.error.message)) {
    r = await admin.from("jobs").insert(stripCols(row)).select("job_no").maybeSingle();
  }
  // 一意制約に当たった場合（直前の検索では拾えなかった既存行がある）は、
  // 「重複」エラーにせず既存案件を更新・再公開へフォールバックする。
  if (r.error && /duplicate key|unique|jobs_title_client/i.test(r.error.message)) {
    let q2 = admin.from("jobs").select("id, job_no, is_published").eq("title", row.title);
    q2 = row.client_name ? q2.eq("client_name", row.client_name) : q2.is("client_name", null);
    const again: any = await q2.order("job_no", { ascending: true }).limit(1);
    const hit = again.data?.[0];
    if (hit?.id) return updateExisting(hit.id, hit.job_no, !!hit.is_published);
  }
  if (r.error) return { ok: false as const, error: r.error.message };
  revalidatePath("/jobs"); bustCounts();
  return { ok: true as const, action: "inserted", job_no: r.data?.job_no };
}

/** 人材の手動1件 upsert。name×company で既存があれば更新、無ければ挿入。 */
export async function upsertCandidateManual(rec: CandidateInput) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!rec.name?.trim()) return { ok: false as const, error: "氏名は必須です" };
  const now = new Date().toISOString();
  const row: Record<string, any> = {
    code: rec.code?.trim() || null,
    name: rec.name.trim(),
    initials: ((rec.name.trim().split(/\s+/)[0]?.[0] ?? "") + (rec.name.trim().split(/\s+/)[1]?.[0] ?? "")),
    title: rec.title?.trim() || null,
    company: rec.company?.trim() || null,
    affiliation: rec.affiliation?.trim() || null,
    skills: normalizeSkills(rec.skills ?? []),
    rate: rec.rate?.trim() || null,
    rate_num: rec.rate_num ?? null,
    avail: rec.avail?.trim() || null,
    location: rec.location?.trim() || null,
    exp: rec.exp?.trim() || null,
    status: rec.status?.trim() || "提案可",
    skill_sheet_url: rec.skill_sheet_url?.trim() || null,
    email: rec.email?.trim() || null,
    contact_email: rec.contact_email?.trim() || null,
    source_mail_url: rec.source_mail_url?.trim() || null,
    operator: rec.operator?.trim() || null,
    score: 0,
    source_csv: "manual",
    imported_at: now,
  };

  const stripCols = (o: Record<string, any>) => { const c = { ...o }; delete c.email; delete c.contact_email; delete c.source_mail_url; delete c.skill_sheet_url; delete c.operator; return c; };
  const updateExisting = async (id: string, candidateNo: number) => {
    const update: Record<string, any> = { imported_at: now };
    for (const [k, v] of Object.entries(row)) {
      if (k === "imported_at" || k === "operator") continue; // operatorは登録時のみ
      if (v == null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      update[k] = v;
    }
    let r: any = await admin.from("candidates").update(update).eq("id", id);
    if (r.error && /skill_sheet_url|email|source_mail_url|column/i.test(r.error.message)) {
      r = await admin.from("candidates").update(stripCols(update)).eq("id", id);
    }
    if (r.error) return { ok: false as const, error: r.error.message };
    revalidatePath("/people"); bustCounts();
    return { ok: true as const, action: "updated" as const, candidate_no: candidateNo };
  };

  // 既存検索（name×company）。複数行・重複でも落ちないよう最若番を採用。
  let q = admin.from("candidates").select("id, candidate_no").eq("name", row.name);
  q = row.company ? q.eq("company", row.company) : q.is("company", null);
  const exList: any = await q.order("candidate_no", { ascending: true }).limit(1);
  const exRow = exList.data?.[0] ?? null;
  if (exRow?.id) return updateExisting(exRow.id, exRow.candidate_no);

  let r: any = await admin.from("candidates").insert(row).select("candidate_no").maybeSingle();
  if (r.error && /skill_sheet_url|email|source_mail_url|column/i.test(r.error.message)) {
    r = await admin.from("candidates").insert(stripCols(row)).select("candidate_no").maybeSingle();
  }
  // 一意制約に当たった場合は既存人材の更新へフォールバック（重複エラーにしない）
  if (r.error && /duplicate key|unique|candidates_/i.test(r.error.message)) {
    let q2 = admin.from("candidates").select("id, candidate_no").eq("name", row.name);
    q2 = row.company ? q2.eq("company", row.company) : q2.is("company", null);
    const again: any = await q2.order("candidate_no", { ascending: true }).limit(1);
    const hit = again.data?.[0];
    if (hit?.id) return updateExisting(hit.id, hit.candidate_no);
  }
  if (r.error) return { ok: false as const, error: r.error.message };
  revalidatePath("/people"); bustCounts();
  return { ok: true as const, action: "inserted", candidate_no: r.data?.candidate_no };
}

/** 提案の手動1件追加。LINE/書面で来た案件など、既存に無くてもインライン作成して提案を登録できる。 */
export async function createProposalManual(input: {
  job: { job_no?: number | null; title?: string | null; client_name?: string | null };
  candidate: { candidate_no?: number | null; name?: string | null; company?: string | null; rate?: string | null };
  stage?: string;
  proposer?: string;
  partner?: string;
  closer?: string;
  client_contact?: string;
  meeting_date?: string;
  note?: string;
}) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  // 案件解決：NO 指定があれば既存参照、無ければ手動 upsert
  let jobRow: any = null;
  if (input.job.job_no) {
    let jr = await admin.from("jobs").select("id, job_no, title, client_name, outside_owner").eq("job_no", input.job.job_no).maybeSingle();
    if (jr.error) jr = await admin.from("jobs").select("id, job_no, title, client_name").eq("job_no", input.job.job_no).maybeSingle();
    if (!jr.data) return { ok: false as const, error: `案件NO ${input.job.job_no} が見つかりません` };
    jobRow = jr.data;
  } else if (input.job.title?.trim()) {
    const up = await upsertJobManual({ title: input.job.title.trim(), client_name: input.job.client_name?.trim() || null });
    if (!up.ok) return { ok: false as const, error: up.error };
    let jr = await admin.from("jobs").select("id, job_no, title, client_name, outside_owner").eq("job_no", up.job_no!).maybeSingle();
    if (jr.error) jr = await admin.from("jobs").select("id, job_no, title, client_name").eq("job_no", up.job_no!).maybeSingle();
    jobRow = jr.data;
  } else {
    return { ok: false as const, error: "案件NO または 案件名 を入力してください" };
  }

  // 人材解決：NO 指定があれば既存参照、無ければ手動 upsert
  let candRow: any = null;
  if (input.candidate.candidate_no) {
    const cr = await admin.from("candidates").select("id, candidate_no, name, initials, rate").eq("candidate_no", input.candidate.candidate_no).maybeSingle();
    if (!cr.data) return { ok: false as const, error: `人材NO ${input.candidate.candidate_no} が見つかりません` };
    candRow = cr.data;
  } else if (input.candidate.name?.trim()) {
    const up = await upsertCandidateManual({
      name: input.candidate.name.trim(),
      company: input.candidate.company?.trim() || null,
      rate: input.candidate.rate?.trim() || null,
    });
    if (!up.ok) return { ok: false as const, error: up.error };
    const cr = await admin.from("candidates").select("id, candidate_no, name, initials, rate").eq("candidate_no", up.candidate_no!).maybeSingle();
    candRow = cr.data;
  } else {
    return { ok: false as const, error: "人材NO または 氏名 を入力してください" };
  }

  // 重複チェック
  const dup = await admin.from("proposals").select("id").eq("job_id", jobRow.id).eq("candidate_id", candRow.id).limit(1);
  if (dup.data && dup.data.length > 0) {
    revalidatePath("/proposals"); bustCounts();
    return { ok: true as const, action: "existed" as const, id: dup.data[0].id, job_no: jobRow.job_no, candidate_no: candRow.candidate_no };
  }

  const insertRow: Record<string, any> = {
    job_id: jobRow.id, candidate_id: candRow.id,
    stage: input.stage?.trim() || "返信待ち",
    job_title: jobRow.title, company: jobRow.client_name, candidate_name: candRow.name,
    c_init: candRow.initials, rate: candRow.rate, ai: false,
  };
  if (input.proposer?.trim()) insertRow.proposer = input.proposer.trim();
  if (input.partner?.trim()) insertRow.partner = input.partner.trim();
  const defaultCloser = (jobRow.outside_owner ?? "").trim() || null;
  if (input.closer?.trim()) insertRow.closer = input.closer.trim();
  else if (defaultCloser) insertRow.closer = defaultCloser;
  if (input.client_contact?.trim()) insertRow.client_contact = input.client_contact.trim();
  if (input.meeting_date?.trim()) insertRow.meeting_date = input.meeting_date.trim();
  if (input.note?.trim()) insertRow.next_action = input.note.trim();
  insertRow.stage_updated_at = new Date().toISOString();

  let r: any = await admin.from("proposals").insert(insertRow).select("id").single();
  if (r.error && /stage_updated_at|column/i.test(r.error.message)) {
    const { stage_updated_at: _drop, ...rest } = insertRow;
    r = await admin.from("proposals").insert(rest).select("id").single();
  }
  if (r.error && /proposer|partner|closer|client_contact|meeting_date|next_action|column/i.test(r.error.message)) {
    const stripped: Record<string, any> = { ...insertRow };
    delete stripped.proposer; delete stripped.partner; delete stripped.closer;
    delete stripped.client_contact; delete stripped.meeting_date; delete stripped.next_action;
    r = await admin.from("proposals").insert(stripped).select("id").single();
  }
  if (r.error) return { ok: false as const, error: r.error.message };

  revalidatePath("/proposals"); bustCounts();
  return { ok: true as const, action: "inserted" as const, id: r.data?.id, job_no: jobRow.job_no, candidate_no: candRow.candidate_no };
}

// ----- 個別ページからの編集 (candidate_no / job_no で特定して更新) -------------

/** 人材を candidate_no で指定して更新。空欄/未指定の項目は既存値を保持。 */
export async function updateCandidateById(candidateNo: number, fields: Partial<CandidateInput>) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!candidateNo) return { ok: false as const, error: "candidate_no が未指定です" };
  const now = new Date().toISOString();
  const trim = (v?: string | null) => v == null ? undefined : (String(v).trim() || null);
  const row: Record<string, any> = { updated_at: now };
  if (fields.name !== undefined) row.name = trim(fields.name) ?? null;
  if (fields.title !== undefined) row.title = trim(fields.title);
  if (fields.company !== undefined) row.company = trim(fields.company);
  if (fields.affiliation !== undefined) row.affiliation = trim(fields.affiliation);
  if (fields.skills !== undefined) row.skills = normalizeSkills(fields.skills ?? []);
  if (fields.rate !== undefined) { const r = trim(fields.rate); row.rate = r; if (r) { const n = Number((r.match(/\d+/g) ?? []).map(Number).filter((x) => x > 0)[0]); if (Number.isFinite(n)) row.rate_num = n; } }
  if (fields.avail !== undefined) row.avail = trim(fields.avail);
  if (fields.location !== undefined) row.location = trim(fields.location);
  if (fields.exp !== undefined) row.exp = trim(fields.exp);
  if (fields.status !== undefined) row.status = trim(fields.status);
  if (fields.skill_sheet_url !== undefined) row.skill_sheet_url = trim(fields.skill_sheet_url);
  if ((fields as any).email !== undefined) row.email = trim((fields as any).email);
  if ((fields as any).contact_email !== undefined) row.contact_email = trim((fields as any).contact_email);
  if ((fields as any).source_mail_url !== undefined) row.source_mail_url = trim((fields as any).source_mail_url);
  if ((fields as any).source_company !== undefined) row.source_company = trim((fields as any).source_company);
  // source_company の同期：会社名(=company)を変更する場合は source_company も同期しておく
  if (row.company !== undefined && (fields as any).source_company === undefined) row.source_company = row.company;
  const stripped = (o: Record<string, any>) => { const c = { ...o }; delete c.email; delete c.contact_email; delete c.source_mail_url; delete c.skill_sheet_url; delete c.source_company; return c; };
  let r: any = await admin.from("candidates").update(row).eq("candidate_no", candidateNo);
  if (r.error && /skill_sheet_url|email|source_mail_url|source_company|column/i.test(r.error.message)) {
    r = await admin.from("candidates").update(stripped(row)).eq("candidate_no", candidateNo);
  }
  if (r.error) return { ok: false as const, error: r.error.message };
  revalidatePath(`/people/${candidateNo}`); revalidatePath("/people"); bustCounts();
  return { ok: true as const };
}

/** 案件を job_no で指定して更新。空欄/未指定の項目は既存値を保持。 */
export async function updateJobById(jobNo: number, fields: Partial<JobInput>) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!jobNo) return { ok: false as const, error: "job_no が未指定です" };
  const now = new Date().toISOString();
  const trim = (v?: string | null) => v == null ? undefined : (String(v).trim() || null);
  const row: Record<string, any> = { updated_at: now };
  if (fields.title !== undefined) row.title = trim(fields.title) ?? null;
  if (fields.client_name !== undefined) row.client_name = trim(fields.client_name);
  if (fields.role_label !== undefined) row.role_label = trim(fields.role_label);
  if (fields.skills !== undefined) row.skills = normalizeSkills(fields.skills ?? []);
  if (fields.salary_min !== undefined) row.salary_min = fields.salary_min;
  if (fields.salary_max !== undefined) row.salary_max = fields.salary_max;
  if (fields.remote_type !== undefined) row.remote_type = fields.remote_type;
  if (fields.flow_note !== undefined) row.flow_note = trim(fields.flow_note);
  if (fields.work_location !== undefined) row.work_location = trim(fields.work_location);
  if (fields.start_date !== undefined) row.start_date = fields.start_date || null;
  if (fields.detail !== undefined) row.detail = trim(fields.detail);
  if (fields.status !== undefined) row.status = trim(fields.status);
  if ((fields as any).contact_name !== undefined) row.contact_name = trim((fields as any).contact_name);
  if ((fields as any).contact_email !== undefined) row.contact_email = trim((fields as any).contact_email);
  if ((fields as any).source_mail_url !== undefined) row.source_mail_url = trim((fields as any).source_mail_url);
  if ((fields as any).is_published !== undefined) row.is_published = (fields as any).is_published;
  const stripped = (o: Record<string, any>) => { const c = { ...o }; delete c.contact_name; delete c.contact_email; delete c.source_mail_url; return c; };
  let r: any = await admin.from("jobs").update(row).eq("job_no", jobNo);
  if (r.error && /contact_email|contact_name|source_mail_url|column/i.test(r.error.message)) {
    r = await admin.from("jobs").update(stripped(row)).eq("job_no", jobNo);
  }
  if (r.error) return { ok: false as const, error: r.error.message };
  revalidatePath(`/jobs/${jobNo}`); revalidatePath("/jobs"); bustCounts();
  return { ok: true as const };
}
