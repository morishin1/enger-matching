"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { randomBytes } from "crypto";
import { engerAdmin } from "./supabase";
import { currentAccess } from "./accounts";
import { canSeeMargin } from "./engagement-access";
import { partnerOwnerCompany } from "./tenant";
import { normalizeSkills } from "./skills";
import { analyzeSkillSheet, driveConfigured } from "./skill-sheet";
import { gmailMessageUrl } from "./gmail";

/** サイドバーのカウントキャッシュを即時更新する。(Next16: 第2引数 cacheLife が必須) */
const bustCounts = () => revalidateTag("sidebar-counts", "max");

/** お知らせ(notifications)を1件登録（fail-soft）。recipient は氏名。失敗しても本処理は止めない。 */
async function notify(recipient: string | null | undefined, title: string, body: string, kind = "info") {
  const r = (recipient ?? "").trim();
  if (!r) return;
  try {
    const admin = engerAdmin();
    await admin.from("notifications").insert({ recipient: r, title, body, kind });
    revalidatePath("/notifications");
  } catch { /* 通知失敗は本処理を止めない */ }
}

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
export async function importCandidates(records: CandidateInput[], sourceLabel: string, operator?: string | null, opts?: { mergeByName?: boolean }) {
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
  // mergeByName 用：氏名(正規化) → 既存レコード(複数あれば最古を採用)
  const byName = new Map<string, any>();
  try {
    // ① 既存重複の判定はキー列のみで全件ロード（軽量）
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("candidates").select("name, company, source_company, source_mail_url").range(from, from + 999);
      if (error || !data) break;
      for (const r of data as any[]) existing.add(dkey(r.name, r.company || r.source_company, r.source_mail_url));
      if (data.length < 1000) break;
    }
    // ② mergeByName のときだけ、このバッチの名前に絞って既存レコードを取得（チャンク毎の全件再取得を回避）
    if (opts?.mergeByName) {
      const batchNames = Array.from(new Set(rows.map((r) => r.name).filter(Boolean) as string[]));
      const CHUNK = 500;
      for (let i = 0; i < batchNames.length; i += CHUNK) {
        const slice = batchNames.slice(i, i + CHUNK);
        // 行全体(*)を取得して未指定列の上書きを防ぐ（後段の upsert で id 衝突時に欠落列が null 化されないように）
        const { data, error } = await admin.from("candidates").select("*").in("name", slice);
        if (error || !data) continue;
        for (const r of data as any[]) {
          const k = normKey(r.name);
          if (k && !byName.has(k)) byName.set(k, r); // 同姓同名は最初に拾った1件を統合先に
        }
      }
    }
  } catch { /* 取得失敗時は突合スキップ（最悪でも従来どおり） */ }

  // 同姓同名統合：既存に氏名一致がある行は、空欄補完で既存を更新（一括 upsert）
  let mergedCount = 0;
  if (opts?.mergeByName) {
    const stillFresh: typeof rows = [];
    // 既存行ベースに「空欄のみ補完」したマージ済みレコードを構築
    const mergedRows: any[] = [];
    const FILL = ["title", "company", "source_company", "affiliation", "rate", "rate_num", "avail", "location", "exp", "remote_pref", "age_band", "nationality", "skill_level", "japanese_level", "comm", "note", "skill_sheet_url", "email", "contact_email", "source_mail_url", "operator"];
    for (const r of rows) {
      const nk = normKey(r.name);
      const ex = nk ? byName.get(nk) : null;
      if (!ex || !ex.id) { stillFresh.push(r); continue; }
      const merged: Record<string, any> = { ...ex, imported_at: now };
      for (const f of FILL) {
        const cur = (ex as any)[f];
        const nv = (r as any)[f];
        if ((cur == null || cur === "") && nv != null && nv !== "") merged[f] = nv;
      }
      const curSkills: string[] = Array.isArray(ex.skills) ? ex.skills : [];
      const newSkills: string[] = Array.isArray(r.skills) ? r.skills : [];
      const union = Array.from(new Set([...curSkills, ...newSkills]));
      if (union.length !== curSkills.length) merged.skills = union;
      mergedRows.push(merged);
    }
    // ★ 一括 upsert（id 衝突＝既存ID指定の UPDATE）に変更し、N回の往復を1〜数回に圧縮
    if (mergedRows.length > 0) {
      const UB = 500;
      for (let i = 0; i < mergedRows.length; i += UB) {
        const slice = mergedRows.slice(i, i + UB);
        let { error, count } = await admin.from("candidates").upsert(slice, { onConflict: "id", count: "exact" });
        if (error && /column/i.test(error.message)) {
          // 未整備列がある環境はその列を外して再試行
          const stripped = slice.map((b) => { const o: any = { ...b }; for (const k of ["remote_pref", "age_band", "nationality", "skill_level", "japanese_level", "comm", "note", "skill_sheet_url", "email", "contact_email", "source_mail_url", "operator", "source_company"]) delete o[k]; return o; });
          ({ error, count } = await admin.from("candidates").upsert(stripped, { onConflict: "id", count: "exact" }));
        }
        if (!error) mergedCount += count ?? slice.length;
      }
    }
    // 統合対象だった行は新規INSERTのループから除外
    if (stillFresh.length !== rows.length) (rows as any).length = 0;
    for (const r of stillFresh) (rows as any).push(r);
  }

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

  // スキルシートのAI解析（バックグラウンド・fail-soft）。GOOGLE_SERVICE_ACCOUNT_JSON 設定時のみ。
  //   取込で挿入された人材のうち skill_sheet_url があり未解析のものを最大50件ずつ並行5本で解析。
  //   失敗してもユーザー応答は止めない。完了は revalidate で反映される。
  if (driveConfigured() && inserted > 0) {
    queueMicrotask(async () => {
      try {
        const pending = await admin
          .from("candidates")
          .select("id, skill_sheet_url, skills")
          .not("skill_sheet_url", "is", null)
          .is("skill_sheet_extracted_at", null)
          .limit(50);
        const rows = (pending.data ?? []) as any[];
        const work = async (c: any) => {
          const now = new Date().toISOString();
          const res = await analyzeSkillSheet(c.skill_sheet_url);
          if (!res.ok) {
            await admin.from("candidates").update({ skill_sheet_error: res.error, skill_sheet_extracted_at: now }).eq("id", c.id);
            return;
          }
          const cur: string[] = Array.isArray(c.skills) ? c.skills : [];
          const merged = Array.from(new Set([...cur, ...res.skills]));
          await admin.from("candidates").update({
            skill_sheet_summary: res.summary,
            skill_sheet_skills: res.skills,
            skill_sheet_extracted_at: now,
            skill_sheet_error: null,
            skills: merged,
          }).eq("id", c.id);
        };
        // 同時5本で消化（LLM側のレート制限を考慮）
        const POOL = 5; let idx = 0;
        const workers = Array.from({ length: Math.min(POOL, rows.length) }, async () => {
          while (idx < rows.length) { const i = idx++; try { await work(rows[i]); } catch { /* fail-soft */ } }
        });
        await Promise.all(workers);
      } catch { /* fail-soft */ }
    });
  }

  return { ok: true, inserted, skipped, merged: mergedCount };
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

/** 案件の在否確認（鮮度リセット）。「まだ募集中？」を確認したら last_confirmed_at を now に更新し、
 *  マッチングの鮮度ガードから外れて再び候補に出るようにする。 */
export async function confirmJobOpen(jobNo: number) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("jobs").update({ last_confirmed_at: new Date().toISOString() }).eq("job_no", jobNo);
  if (error) {
    // 列未整備（migration未適用）の場合は分かりやすく返す
    if (/last_confirmed_at/.test(error.message)) return { ok: false, error: "鮮度カラム未整備です。supabase/jobs-freshness.sql を実行してください。" };
    return { ok: false, error: error.message };
  }
  revalidatePath("/matching");
  revalidatePath("/jobs");
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

/** クローズ済フラグの一括設定 (service role)。
 *   value=true でクローズ（一覧の初期表示から外し、マッチング対象外にする）、false で再開。
 *   is_closed 列が未整備の環境では分かりやすいエラーを返す（supabase/closed-flag.sql を案内）。 */
export async function bulkSetClosed(
  table: "jobs" | "candidates",
  idField: string,
  idValues: number[],
  value: boolean,
  revalidate?: string,
) {
  if (!idValues || idValues.length === 0) return { ok: true, updated: 0 };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, updated: 0, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const { error } = await admin.from(table).update({ is_closed: value }).in(idField, idValues);
  if (error) {
    if (/is_closed|column/i.test(error.message)) return { ok: false, updated: 0, error: "クローズ用カラム未整備です。supabase/closed-flag.sql を実行してください。" };
    return { ok: false, updated: 0, error: error.message };
  }
  if (revalidate) revalidatePath(revalidate);
  bustCounts();
  return { ok: true, updated: idValues.length };
}

/** 案件を一括削除（job_no の配列で指定）。 */
export async function bulkDeleteJobs(jobNos: number[]) {
  // 既存の「削除」呼び出しは互換のためそのまま動かしつつ、実体はゴミ箱（ソフトデリート）に変更。
  // 完全削除は purgeJobs（ゴミ箱画面から admin が実行）から。
  return moveJobsToTrash(jobNos);
}

/** 人材を一括削除（candidate_no の配列で指定）。実体はゴミ箱（ソフトデリート）へ。 */
export async function bulkDeleteCandidates(candidateNos: number[]) {
  return moveCandidatesToTrash(candidateNos);
}

// ===================== ゴミ箱（ソフトデリート） =====================
//   ・deleted_at をセット = ゴミ箱
//   ・deleted_at を null に戻す = 復元
//   ・purge* = ゴミ箱から完全削除
//   ・bulkTrashBefore = 指定日より前の取込分をまとめてゴミ箱へ（提案紐付けは除外）
//   未マイグレ時（deleted_at 列が無い）はフォールバックで従来通り delete する。

async function trashItems(table: "jobs" | "candidates", noField: "job_no" | "candidate_no", nos: number[]) {
  if (!nos.length) return { ok: true as const, moved: 0 };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const now = new Date().toISOString();
  let r: any = await admin.from(table).update({ deleted_at: now, updated_at: now }).in(noField, nos).is("deleted_at", null);
  if (r.error && /deleted_at|column/i.test(r.error.message)) {
    // 未マイグレ：フォールバックでハード削除（従来動作）
    r = await admin.from(table).delete().in(noField, nos);
  }
  if (r.error) return { ok: false as const, error: r.error.message };
  revalidatePath(table === "jobs" ? "/jobs" : "/people"); revalidatePath("/trash"); bustCounts();
  return { ok: true as const, moved: nos.length };
}

async function restoreItems(table: "jobs" | "candidates", noField: "job_no" | "candidate_no", nos: number[]) {
  if (!nos.length) return { ok: true as const, restored: 0 };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const r: any = await admin.from(table).update({ deleted_at: null, updated_at: new Date().toISOString() }).in(noField, nos);
  if (r.error) return { ok: false as const, error: r.error.message };
  revalidatePath(table === "jobs" ? "/jobs" : "/people"); revalidatePath("/trash"); bustCounts();
  return { ok: true as const, restored: nos.length };
}

async function purgeItems(table: "jobs" | "candidates", noField: "job_no" | "candidate_no", nos: number[]) {
  if (!nos.length) return { ok: true as const, purged: 0 };
  const me = await currentAccess();
  if (!me || me.role !== "admin") return { ok: false as const, error: "完全削除は管理者のみ可能です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  // 念のため、ゴミ箱(deleted_at not null)のものだけを完全削除
  let r: any = await admin.from(table).delete().in(noField, nos).not("deleted_at", "is", null);
  if (r.error && /deleted_at|column/i.test(r.error.message)) {
    r = await admin.from(table).delete().in(noField, nos);
  }
  if (r.error) return { ok: false as const, error: r.error.message };
  revalidatePath(table === "jobs" ? "/jobs" : "/people"); bustCounts();
  return { ok: true as const, purged: nos.length };
}

export async function moveJobsToTrash(nos: number[])       { return trashItems("jobs", "job_no", nos); }
export async function moveCandidatesToTrash(nos: number[]) { return trashItems("candidates", "candidate_no", nos); }
export async function restoreJobs(nos: number[])           { return restoreItems("jobs", "job_no", nos); }
export async function restoreCandidates(nos: number[])     { return restoreItems("candidates", "candidate_no", nos); }
export async function purgeJobs(nos: number[])             { return purgeItems("jobs", "job_no", nos); }
export async function purgeCandidates(nos: number[])       { return purgeItems("candidates", "candidate_no", nos); }

/** 指定日より前の「取込済みデータ」をプレビュー or 実行でゴミ箱へ。
 *    cutoffIso 未満の created_at が対象。
 *    提案レコードに紐づく id（job_id / candidate_id）は対象から除外（提案履歴があれば残す）。
 *    dryRun=true で件数だけ返す（破壊的操作の前にユーザーに見せる）。 */
export async function bulkTrashBefore(opts: {
  kind: "jobs" | "candidates";
  cutoffIso: string;
  dryRun?: boolean;
}): Promise<{ ok: true; targets: number; protectedCount: number; sampleTitles: string[] } | { ok: false; error: string }> {
  const me = await currentAccess();
  if (!me || me.role !== "admin") return { ok: false, error: "管理者のみ実行できます" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!/^\d{4}-\d{2}-\d{2}/.test(opts.cutoffIso)) return { ok: false, error: "cutoff の形式が不正です" };

  const table = opts.kind === "jobs" ? "jobs" : "candidates";
  const idCol = opts.kind === "jobs" ? "job_id" : "candidate_id";
  const noCol = opts.kind === "jobs" ? "job_no" : "candidate_no";
  const titleCol = opts.kind === "jobs" ? "title" : "name";

  // 1) 提案で参照中の id 集合を取得（ステージは問わない＝失注/見送り含めて全て保護）
  const protectedIds = new Set<string>();
  try {
    const p: any = await admin.from("proposals").select(idCol).not(idCol, "is", null).limit(20000);
    for (const r of (p.data ?? []) as any[]) { const v = r[idCol]; if (v) protectedIds.add(String(v)); }
  } catch { /* ignore: proposals 未整備でも処理続行（保護対象0扱い） */ }

  // 2) 対象候補：cutoff 未満 ＆ ゴミ箱でない
  let q: any = admin.from(table)
    .select(`id, ${noCol}, ${titleCol}, created_at`)
    .lt("created_at", opts.cutoffIso)
    .order("created_at", { ascending: true })
    .limit(50000);
  try { q = q.is("deleted_at", null); } catch { /* 未マイグレ環境では deleted_at が無いので無視 */ }
  let r: any = await q;
  if (r.error && /deleted_at|column/i.test(r.error.message)) {
    r = await admin.from(table).select(`id, ${noCol}, ${titleCol}, created_at`).lt("created_at", opts.cutoffIso).order("created_at", { ascending: true }).limit(50000);
  }
  if (r.error) return { ok: false, error: r.error.message };
  const rows = (r.data ?? []) as any[];

  const targets = rows.filter((row) => !protectedIds.has(String(row.id)));
  const protectedCount = rows.length - targets.length;
  const sampleTitles = targets.slice(0, 5).map((row) => String(row[titleCol] ?? "(無題)"));

  if (opts.dryRun || targets.length === 0) {
    return { ok: true, targets: targets.length, protectedCount, sampleTitles };
  }

  // 3) 実行：1000件ずつチャンクして deleted_at をセット
  const now = new Date().toISOString();
  const nos: number[] = targets.map((row) => row[noCol]).filter((n) => typeof n === "number");
  const CHUNK = 500;
  for (let i = 0; i < nos.length; i += CHUNK) {
    const slice = nos.slice(i, i + CHUNK);
    let u: any = await admin.from(table).update({ deleted_at: now, updated_at: now }).in(noCol, slice);
    if (u.error && /deleted_at|column/i.test(u.error.message)) {
      // 未マイグレ：ハード削除にフォールバック（説明済み）
      u = await admin.from(table).delete().in(noCol, slice);
    }
    if (u.error) return { ok: false, error: `${i}件目以降で失敗：${u.error.message}` };
  }

  revalidatePath(opts.kind === "jobs" ? "/jobs" : "/people");
  revalidatePath("/trash");
  bustCounts();
  return { ok: true, targets: targets.length, protectedCount, sampleTitles };
}

// ===================== 提案 / 稼働 =====================

/** 提案の任意フィールドを更新 (架電進捗/担当/失注理由 等)。 */
export async function updateProposalFields(id: string, fields: Record<string, any>) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const allowed = ["caller_status", "proposer", "partner", "closer", "client_contact", "lost_reason", "lost_phase", "lost_reason_note", "next_action", "stage", "meeting_date", "meeting_status", "meeting_time", "meeting_format", "meeting_url", "meeting_attendees", "meeting_note", "company", "source", "job_notify_status", "cand_notify_status"];
  const now = new Date().toISOString();
  const patch: Record<string, any> = { updated_at: now };
  for (const k of allowed) if (k in fields) patch[k] = fields[k];
  // ステージが変わるときは滞留日数・失注日の起点となる stage_updated_at も更新する。
  if ("stage" in fields) patch.stage_updated_at = now;
  let { error } = await admin.from("proposals").update(patch).eq("id", id);
  // stage_updated_at 列が未追加の環境では外して再試行（proposals-stage-updated-at.sql 未実行時）
  if (error && /stage_updated_at|column/i.test(error.message) && "stage_updated_at" in patch) {
    const { stage_updated_at: _d, ...rest } = patch;
    ({ error } = await admin.from("proposals").update(rest).eq("id", id));
    if (error && /source|column/i.test(error.message) && "source" in rest) {
      const { source: _s, ...rest2 } = rest;
      ({ error } = await admin.from("proposals").update(rest2).eq("id", id));
    }
  } else if (error && /source|column/i.test(error.message) && "source" in patch) {
    // source 列が未追加の環境でも落ちないようフォールバック（proposals-source.sql 未実行時）
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

/** マッチングのペアを提案ボードに記録 (service role)。重複は既存を返す。
 *   ※ 承認チェック：approver（承認者の氏名）必須。stage="承認待ち" で作成され、
 *      承認者（admin or 本人）が approveProposal を呼ぶと "所属確認" へ遷移する。 */
export type PendingMailSide = { to?: string; cc?: string; subject?: string; body?: string };
export type PendingMail = { job?: PendingMailSide; cand?: PendingMailSide };

/** ログイン中ユーザーが「承認スキップで直接提案できる権限者」か。
 *  admin / マネージャー / リーダーが true。クライアントで UI 分岐に使う。 */
export async function isProposerPrivileged(): Promise<{ ok: boolean; privileged: boolean; role?: string | null; name?: string | null }> {
  try {
    const me = await currentAccess();
    if (!me) return { ok: true, privileged: false };
    const { canManageDept } = await import("./roles");
    const privileged = me.role === "admin" || canManageDept(me.teamRole ?? null);
    return { ok: true, privileged, role: me.role, name: me.name ?? null };
  } catch { return { ok: true, privileged: false }; }
}

export async function createProposal(jobNo: number, candNo: number, score?: number, proposer?: string, preTokens?: { jobToken?: string | null; candToken?: string | null }, approver?: string, pendingMail?: PendingMail | null) {
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

  // 応答リンクのトークン。メールに埋め込んだものを優先（HEX48）。無ければ新規生成。
  //   ※ 重複チェックより前に計算するのは、既存提案に再送する場合でも「最新メールの
  //     トークンが必ず有効になる」ようDB側を更新するため（旧トークンのままだとリンク切れ）。
  const HEX48 = /^[0-9a-f]{48}$/;
  const hasMailTokens = !!(preTokens?.jobToken && HEX48.test(preTokens.jobToken)) || !!(preTokens?.candToken && HEX48.test(preTokens.candToken));
  const job_action_token  = (preTokens?.jobToken  && HEX48.test(preTokens.jobToken))  ? preTokens.jobToken  : randomBytes(24).toString("hex");
  const cand_action_token = (preTokens?.candToken && HEX48.test(preTokens.candToken)) ? preTokens.candToken : randomBytes(24).toString("hex");

  // 重複チェック (同一 job × candidate)。
  //   maybeSingle() は2件以上ヒット時にエラーで null を返し「未登録」と誤判定→二重登録が雪だるま式に増える。
  //   limit(1) で先頭を取り、既存があれば必ず existed として返す（冪等）。
  const { data: dups } = await admin.from("proposals").select("id").eq("job_id", job.id).eq("candidate_id", cand.id).limit(1);
  if (dups && dups.length > 0) {
    // 既存提案に「新しいメールを送り直す」ケース：メールのトークンをDBへ反映し、
    //   回答も「未回答」にリセットする。これをしないと、
    //   ① 新メールのリンクが旧トークンと一致せず「URL無効」になる
    //   ② 過去の回答（見送り等）が残り、相手が「話を進める」を押しても旧回答が表示される
    //   という不具合になる（再提案・失注からの再送で発生）。
    if (hasMailTokens) {
      const upd: Record<string, any> = {
        job_action_token, cand_action_token,
        job_action_type: "未回答", cand_action_type: "未回答",
        updated_at: new Date().toISOString(),
      };
      if (pendingMail) upd.pending_mail = pendingMail; // 承認者送信用に最新メール下書きを保存
      try {
        let r: any = await admin.from("proposals").update(upd).eq("id", dups[0].id);
        if (r.error && /pending_mail|column/i.test(r.error.message)) {
          const { pending_mail: _drop, ...rest } = upd;
          await admin.from("proposals").update(rest).eq("id", dups[0].id);
        }
      } catch { /* token列が未整備でも既存返却は続行 */ }
    }
    revalidatePath("/proposals");
    bustCounts();
    return { ok: true, id: dups[0].id, existed: true };
  }

  // 打ち合わせ/顔合わせ未実施の企業への提案ゲート。
  //   先方と一度も打合せていない企業へは、管理者/マネージャー以外は提案できない
  //   （無闇な提案で信用を損なわないため）。打合せ記録（meetings）が無い & 提案者が
  //   admin/manager でない場合はブロックして、先に打合せ記録か上長対応を促す。
  {
    const me = await currentAccess();
    const { canManageDept } = await import("./roles");
    const privileged = !me || me.role === "admin" || canManageDept(me.teamRole ?? null);
    if (!privileged && (job.client_name ?? "").trim()) {
      let hasMeeting = false;
      try {
        const { data: mtg } = await admin.from("meetings").select("id").ilike("company_name", job.client_name).limit(1);
        hasMeeting = (mtg?.length ?? 0) > 0;
      } catch { hasMeeting = true; /* meetings 未整備の環境ではゲートを無効化（誤ブロック防止） */ }
      if (!hasMeeting) {
        return { ok: false, error: "この企業はまだ打ち合わせ・顔合わせの記録がありません。提案には管理者またはマネージャーの操作（許可）が必要です。先に「打合せ記録」を登録するか、上長に依頼してください。" };
      }
    }
  }

  // デフォルトのクロージング担当 = 案件企業の担当者（案件の outside_owner、無ければ企業マスタの owner）。後で変更可。
  let defaultCloser: string | null = (job.outside_owner ?? "").trim() || null;
  if (!defaultCloser && job.client_name) {
    try {
      const { data: co } = await admin.from("companies").select("owner").ilike("name", job.client_name).maybeSingle();
      defaultCloser = ((co as any)?.owner ?? "").trim() || null;
    } catch { /* companies 未整備 */ }
  }

  // job_action_token / cand_action_token は重複チェック前に計算済み（再送時のトークン整合のため）。

  // 提案者の既定＝作成者（ログイン中の本人）。明示指定が無いと proposer が null になり、
  // 日報スコアカード/KPIに「自分の提案」が出なくなるため、ここで本人名を補完する。
  let proposerName = (proposer ?? "").trim() || null;
  let proposerIsPrivileged = false;   // admin / マネージャー / リーダーは承認スキップで直接送信可
  try {
    const me = await currentAccess();
    if (me) {
      if (!proposerName) proposerName = (me.name ?? "").trim() || null;
      const { canManageDept } = await import("./roles");
      proposerIsPrivileged = me.role === "admin" || canManageDept(me.teamRole ?? null);
    }
  } catch { /* 未ログインでも続行 */ }

  // 承認者：通常エージェントは必須。管理者/マネージャー/リーダーは自分で承認＝直接送信のため省略可。
  const approverName = (approver ?? "").trim();
  if (!proposerIsPrivileged && !approverName) return { ok: false, error: "承認者を選択してください（提案者と承認者の両方が必要です）" };

  const insertBase = {
    job_id: job.id, candidate_id: cand.id,
    // 権限者は「承認待ち」をスキップして所属確認から開始（自己承認扱い）。
    stage: proposerIsPrivileged ? "所属確認" : "承認待ち",
    job_title: job.title, company: job.client_name, candidate_name: cand.name,
    c_init: cand.initials, rate: cand.rate, score: score ?? null, ai: false,
    closer: defaultCloser,
    proposer: proposerName,
    approver: approverName || (proposerIsPrivileged ? proposerName : null),
    approval_status: proposerIsPrivileged ? "approved" : "pending",
    approved_at: proposerIsPrivileged ? new Date().toISOString() : null,
    job_action_type: "未回答", job_action_token,
    cand_action_type: "未回答", cand_action_token,
    ...(pendingMail ? { pending_mail: pendingMail } : {}),
  } as Record<string, any>;
  // pending_mail 列が無い旧環境ではドロップして再試行（フォールバック）。
  let ins: any = await admin.from("proposals").insert({ ...insertBase, stage_updated_at: new Date().toISOString() }).select("id").single();
  if (ins.error && /pending_mail|column/i.test(ins.error.message)) {
    const { pending_mail: _drop, ...withoutPending } = insertBase;
    ins = await admin.from("proposals").insert({ ...withoutPending, stage_updated_at: new Date().toISOString() }).select("id").single();
  }
  // approver/approval_status 列が無い旧環境では落とし、既存通り 所属確認 で作成
  if (ins.error && /approver|approval_status|column/i.test(ins.error.message)) {
    const fallback = { ...insertBase, stage: "所属確認" } as Record<string, any>;
    delete fallback.approver; delete fallback.approval_status; delete fallback.pending_mail;
    ins = await admin.from("proposals").insert({ ...fallback, stage_updated_at: new Date().toISOString() }).select("id").single();
  }
  if (ins.error && /stage_updated_at|column/i.test(ins.error.message)) {
    ins = await admin.from("proposals").insert(insertBase).select("id").single();
  }
  const data = ins.data; const error = ins.error;
  if (error) return { ok: false, error: error.message };
  // 承認者へ「承認待ち」を通知（権限者は承認不要なのでスキップ）。
  if (!proposerIsPrivileged) {
    const who = [job.title, cand.name].filter(Boolean).join(" × ");
    await notify(
      approverName,
      "提案の承認依頼",
      `${proposerName ?? "担当者"} さんから承認待ちの提案があります${who ? `：${who}` : ""}。\n提案管理で内容を確認し、承認のうえメールを送信してください。`,
      "approval",
    );
  }
  revalidatePath("/proposals");
  revalidatePath("/matching");
  bustCounts();
  return { ok: true, id: data.id, existed: false, job_action_token, cand_action_token };
}

/** 提案を承認（承認待ち → 所属確認 へ遷移）。承認できるのは admin か、approver と現在ユーザー名が一致する人。 */
export async function approveProposal(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await currentAccess();
  if (!me) return { ok: false, error: "未ログインです" };
  const cur: any = await admin.from("proposals").select("id, approver, approval_status, stage, proposer, job_title, candidate_name").eq("id", id).maybeSingle();
  if (cur.error) return { ok: false, error: cur.error.message };
  if (!cur.data) return { ok: false, error: "提案が見つかりません" };
  if (cur.data.approval_status === "approved") return { ok: true }; // 冪等
  // 権限：admin or 自分が approver
  const { ownerMatches } = await import("./owner-match");
  const isApprover = me.name && ownerMatches(me.name, cur.data.approver ?? "");
  if (me.role !== "admin" && !isApprover) return { ok: false, error: "承認権限がありません（指定された承認者のみ承認できます）" };
  const now = new Date().toISOString();
  const r: any = await admin.from("proposals").update({
    approval_status: "approved",
    approved_at: now,
    approver_email: me.email,
    reject_reason: null,
    stage: "所属確認",
    stage_updated_at: now,
    updated_at: now,
  }).eq("id", id);
  if (r.error) return { ok: false, error: r.error.message };
  // 提案者へ「承認された」ことを通知（自分が提案者を兼ねる場合は不要）。
  if (!(me.name && ownerMatches(me.name, cur.data.proposer ?? ""))) {
    const who = [cur.data.job_title, cur.data.candidate_name].filter(Boolean).join(" × ");
    await notify(
      cur.data.proposer,
      "提案が承認されました",
      `${me.name ?? "承認者"} さんが提案を承認しました${who ? `：${who}` : ""}。承認者がメールを送信します。`,
      "approval_result",
    );
  }
  revalidatePath("/proposals"); bustCounts();
  return { ok: true };
}

/** 承認者用：保存されたメール下書きを取得（承認画面でプレビュー用）。 */
export async function getProposalPendingMail(id: string): Promise<{ ok: true; mail: PendingMail | null; jobToken: string | null; candToken: string | null; jobTitle: string | null; company: string | null; candName: string | null } | { ok: false; error: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  const me = await currentAccess();
  if (!me) return { ok: false, error: "未ログインです" };
  let r: any = await admin.from("proposals").select("id, approver, approval_status, pending_mail, job_action_token, cand_action_token, job_title, company, candidate_name").eq("id", id).maybeSingle();
  if (r.error && /pending_mail|column/i.test(r.error.message)) {
    r = await admin.from("proposals").select("id, approver, approval_status, job_action_token, cand_action_token, job_title, company, candidate_name").eq("id", id).maybeSingle();
  }
  if (r.error) return { ok: false, error: r.error.message };
  if (!r.data) return { ok: false, error: "提案が見つかりません" };
  const { ownerMatches } = await import("./owner-match");
  const isApprover = me.name && ownerMatches(me.name, r.data.approver ?? "");
  if (me.role !== "admin" && !isApprover) return { ok: false, error: "閲覧権限がありません（承認者のみ）" };
  return {
    ok: true,
    mail: (r.data.pending_mail ?? null) as PendingMail | null,
    jobToken: r.data.job_action_token ?? null,
    candToken: r.data.cand_action_token ?? null,
    jobTitle: r.data.job_title ?? null,
    company: r.data.company ?? null,
    candName: r.data.candidate_name ?? null,
  };
}

/** 承認者がメール送信した直後に呼ぶ：送信時刻を記録し、承認＋ステージ進行。 */
export async function markProposalMailSentAndApprove(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  const me = await currentAccess();
  if (!me) return { ok: false, error: "未ログインです" };
  const cur: any = await admin.from("proposals").select("id, approver, proposer, job_title, candidate_name").eq("id", id).maybeSingle();
  if (cur.error) return { ok: false, error: cur.error.message };
  if (!cur.data) return { ok: false, error: "提案が見つかりません" };
  const { ownerMatches } = await import("./owner-match");
  const isApprover = me.name && ownerMatches(me.name, cur.data.approver ?? "");
  if (me.role !== "admin" && !isApprover) return { ok: false, error: "送信権限がありません（承認者のみ）" };
  const now = new Date().toISOString();
  const upd: Record<string, any> = {
    approval_status: "approved",
    approved_at: now,
    approver_email: me.email,
    reject_reason: null,
    stage: "所属確認",
    stage_updated_at: now,
    updated_at: now,
    mail_sent_at: now,
    mail_sent_by: me.email,
    pending_mail: null,
  };
  let r: any = await admin.from("proposals").update(upd).eq("id", id);
  if (r.error && /pending_mail|mail_sent|column/i.test(r.error.message)) {
    const { pending_mail: _a, mail_sent_at: _b, mail_sent_by: _c, ...rest } = upd;
    r = await admin.from("proposals").update(rest).eq("id", id);
  }
  if (r.error) return { ok: false, error: r.error.message };
  // 提案者へ「承認・送信済み」を通知（自分が提案者を兼ねる場合は不要）。
  if (!(me.name && ownerMatches(me.name, cur.data.proposer ?? ""))) {
    const who = [cur.data.job_title, cur.data.candidate_name].filter(Boolean).join(" × ");
    await notify(
      cur.data.proposer,
      "提案が承認・送信されました",
      `${me.name ?? "承認者"} さんが提案を承認し、メールを送信しました${who ? `：${who}` : ""}。`,
      "approval_result",
    );
  }
  revalidatePath("/proposals"); bustCounts();
  return { ok: true };
}

/** 提案を差戻し（承認者→提案者へ）。stage は「承認待ち」のままで approval_status のみ rejected。 */
export async function rejectProposal(id: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await currentAccess();
  if (!me) return { ok: false, error: "未ログインです" };
  const r0 = (reason ?? "").trim();
  if (!r0) return { ok: false, error: "差戻し理由を入力してください" };
  const cur: any = await admin.from("proposals").select("id, approver, approval_status, proposer, job_title, candidate_name").eq("id", id).maybeSingle();
  if (cur.error) return { ok: false, error: cur.error.message };
  if (!cur.data) return { ok: false, error: "提案が見つかりません" };
  const { ownerMatches } = await import("./owner-match");
  const isApprover = me.name && ownerMatches(me.name, cur.data.approver ?? "");
  if (me.role !== "admin" && !isApprover) return { ok: false, error: "差戻し権限がありません（指定された承認者のみ操作できます）" };
  const now = new Date().toISOString();
  const r: any = await admin.from("proposals").update({
    approval_status: "rejected",
    reject_reason: r0,
    approver_email: me.email,
    stage: "承認待ち",
    updated_at: now,
  }).eq("id", id);
  if (r.error) return { ok: false, error: r.error.message };
  // 提案者へ「差戻し」を理由つきで通知（自分が提案者を兼ねる場合は不要）。
  if (!(me.name && ownerMatches(me.name, cur.data.proposer ?? ""))) {
    const who = [cur.data.job_title, cur.data.candidate_name].filter(Boolean).join(" × ");
    await notify(
      cur.data.proposer,
      "提案が差し戻されました",
      `${me.name ?? "承認者"} さんが提案を差し戻しました${who ? `：${who}` : ""}。\n差戻し理由：${r0}\n内容を修正して再度承認を依頼してください。`,
      "approval_result",
    );
  }
  revalidatePath("/proposals");
  bustCounts();
  return { ok: true };
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

  // 初期ステージ（新:所属確認、旧:提案済/返信待ち）のうちは取り消し可
  if (!["所属確認", "提案済", "返信待ち"].includes(p.stage)) return { ok: false, error: `ステージが「${p.stage}」に進んでいるため取り消せません` };
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
  let rr: any = await admin.from("proposals").update({ stage: "所属確認", lost_reason: null, lost_phase: null, lost_reason_note: null, updated_at: now, stage_updated_at: now }).eq("id", id);
  if (rr.error && /stage_updated_at|lost_reason_note|column/i.test(rr.error.message)) {
    rr = await admin.from("proposals").update({ stage: "所属確認", lost_reason: null, lost_phase: null, updated_at: now }).eq("id", id);
  }
  const error = rr.error;
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals"); bustCounts(); revalidatePath("/progress");
  return { ok: true };
}

/** 成約した提案を稼働(engagements)へ変換。提案は「成約」に更新。 */
export async function convertToEngagement(proposalId: string): Promise<{ ok: true; engagementId: string | null } | { ok: false; error: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const { data: p } = await admin.from("proposals").select("id, job_title, company, candidate_name, rate").eq("id", proposalId).maybeSingle();
  if (!p?.id) return { ok: false, error: "提案が見つかりません" };

  // 人材マスタから所属区分を引き継ぐ（原価マスク判定キー）
  let affiliation: string | null = null;
  if (p.candidate_name) { try { const { data: c } = await admin.from("candidates").select("affiliation").eq("name", p.candidate_name).maybeSingle(); affiliation = (c as any)?.affiliation ?? null; } catch { /* 列なし無視 */ } }

  let engagementId: string | null = null;
  const { data: existing } = await admin.from("engagements").select("id").eq("proposal_id", proposalId).maybeSingle();
  if (existing?.id) {
    engagementId = existing.id;
  } else {
    const row: Record<string, any> = {
      proposal_id: proposalId, job_title: p.job_title, company: p.company,
      candidate_name: p.candidate_name, monthly_rate: parseRateNum(p.rate), status: "予定",
    };
    if (affiliation) row.affiliation = affiliation;
    let ins: any = await admin.from("engagements").insert(row).select("id").maybeSingle();
    if (ins.error && /affiliation/.test(ins.error.message)) {
      delete row.affiliation;
      ins = await admin.from("engagements").insert(row).select("id").maybeSingle();
    }
    if (ins.error) return { ok: false, error: ins.error.message };
    engagementId = ins.data?.id ?? null;
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
  return { ok: true, engagementId };
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

/** 稼働(契約)を削除（管理者・バックオフィスのみ）。関連の請求タスクも合わせて削除。 */
export async function deleteEngagement(id: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!id) return { ok: false as const, error: "id がありません" };
  // 権限：管理者またはバックオフィス職能のみ
  const access = await currentAccess();
  const role = access?.role ?? "admin";
  const isBackoffice = (access?.functions ?? []).includes("バックオフィス");
  if (role !== "admin" && !isBackoffice) return { ok: false as const, error: "削除は管理者・バックオフィスのみ可能です" };
  // 関連する請求タスクを先に削除（FK が無くても掃除する）
  try { await admin.from("billing_tasks").delete().eq("engagement_id", id); } catch { /* 続行 */ }
  const { error } = await admin.from("engagements").delete().eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/progress"); revalidatePath("/billing"); bustCounts();
  return { ok: true as const };
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

  const allowed = ["candidate_name", "company", "job_title", "monthly_rate", "cost", "affiliation", "settle_min", "settle_max", "work_hours", "contract_status", "po_status", "start_date", "end_date", "renewal_due", "renewal_status", "status"];
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
  board_project_id?: string | null; // board の案件ID または 案件No（最初から紐付けて自動同期を効かせる）
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
  if (r.board_project_id !== undefined) row.board_project_id = _str(r.board_project_id);
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

/** 企業の「打ち合わせ完了」手動フラグを切替（詳細画面のチェック用）。
 *  companies 行が無ければ name で作成（upsert）。meeting_done 列が未追加なら案内を返す。 */
export async function setCompanyMeetingDone(name: string, done: boolean): Promise<{ ok: boolean; error?: string }> {
  const n = (name ?? "").trim();
  if (!n) return { ok: false, error: "企業名が空です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await currentAccess();
  const full: Record<string, any> = {
    name: n,
    meeting_done: !!done,
    meeting_done_at: done ? new Date().toISOString() : null,
    meeting_done_by: done ? ((me?.name ?? "").trim() || null) : null,
  };
  // 監査列(meeting_done_at / meeting_done_by)が未整備の環境でも、フラグ本体(meeting_done)は
  // 必ず保存されるよう、列エラー時は行を段階的に削って再試行する。
  //   ※ これをしないと「meeting_done_by 列が無い」だけで upsert 全体が失敗し、
  //     画面の楽観更新が戻って「承認しても外れる」状態になっていた。
  let { error } = await admin.from("companies").upsert(full, { onConflict: "name" });
  if (error && /meeting_done_by|column/i.test(error.message)) {
    const { meeting_done_by: _b, ...noBy } = full;
    ({ error } = await admin.from("companies").upsert(noBy, { onConflict: "name" }));
  }
  if (error && /meeting_done_at|column/i.test(error.message)) {
    ({ error } = await admin.from("companies").upsert({ name: n, meeting_done: !!done }, { onConflict: "name" }));
  }
  if (error) {
    if (/meeting_done|column/i.test(error.message)) return { ok: false, error: "打合せ完了列が未整備です（supabase/companies-meeting-done.sql を実行してください）" };
    return { ok: false, error: error.message };
  }
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

/** 企業マスタをCSVから一括登録/更新（name で upsert）。案件/人材が無くても企業として残る。
 *  情報持ち出し・改ざん防止のため admin のみ実行可（ローカル＝未認証は admin 相当）。 */
export async function importCompanies(records: CompanyInput[]) {
  const access = await currentAccess();
  if (access && access.role !== "admin") {
    return { ok: false, inserted: 0, error: "権限がありません（CSV取込は管理者のみ）" };
  }
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

/** 取引NG（取引停止）フラグの設定/解除。撤退検討の根拠をもとに NG 指定する。 */
export async function setCompanyNg(name: string, isNg: boolean, reason?: string | null, by?: string | null) {
  const n = (name || "").trim();
  if (!n) return { ok: false, error: "企業名がありません" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const row: Record<string, any> = isNg
    ? { name: n, is_ng: true, ng_reason: (reason ?? "").trim() || null, ng_at: new Date().toISOString(), ng_by: (by ?? "").trim() || null }
    : { name: n, is_ng: false, ng_reason: null, ng_at: null, ng_by: null };
  const { error } = await admin.from("companies").upsert(row, { onConflict: "name" });
  if (error) {
    if (/is_ng|column/i.test(error.message)) return { ok: false, error: "NG列が未整備です（supabase/companies-ng.sql を実行してください）" };
    return { ok: false, error: error.message };
  }
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
  title?: string; company_name?: string; meeting_date?: string | null; meeting_time?: string | null;
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
    title: input.title?.trim() || `${input.company_name ?? "打合せ"}（${input.meeting_date ?? ""}${input.meeting_time ? ` ${input.meeting_time}` : ""}）`,
    company_name: input.company_name?.trim() || null,
    meeting_date: input.meeting_date || null,
    meeting_time: input.meeting_time || null,
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
  // meeting_time / follow_up_date 列未追加でも落ちないようフォールバック
  if (error && /meeting_time|follow_up_date|column/i.test(error.message)) {
    const r2: any = { ...row }; delete r2.meeting_time; delete r2.follow_up_date;
    ({ error } = await admin.from("meetings").insert(r2));
  }
  if (error) return { ok: false, error: error.message };
  revalidatePath("/meetings");
  revalidatePath("/companies");
  return { ok: true };
}

/** 打ち合わせ記録を更新（admin/agent 想定）。 */
export async function updateMeeting(id: string, input: MeetingInput) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  if (!id) return { ok: false, error: "id がありません" };
  const patch: Record<string, any> = {};
  const setStr = (k: keyof MeetingInput) => { const v = (input as any)[k]; if (v !== undefined) patch[k as string] = (typeof v === "string" ? (v.trim() || null) : v); };
  setStr("title"); setStr("company_name"); setStr("meeting_date"); setStr("meeting_time");
  setStr("their_contact"); setStr("our_owner"); setStr("new_or_existing");
  setStr("relation_status"); setStr("fb_sentiment"); setStr("ai_summary");
  setStr("enger_fb"); setStr("hit_points"); setStr("miss_points"); setStr("needs");
  setStr("strategy"); setStr("next_action_us"); setStr("next_action_them");
  if (input.competitors !== undefined) patch.competitors = input.competitors;
  setStr("competitor_detail");
  if (input.tags !== undefined) patch.tags = input.tags;
  setStr("transcript_url"); setStr("publishable"); setStr("follow_up_date");
  let { error } = await admin.from("meetings").update(patch).eq("id", id);
  if (error && /meeting_time|follow_up_date|column/i.test(error.message)) {
    const p2: any = { ...patch }; delete p2.meeting_time; delete p2.follow_up_date;
    ({ error } = await admin.from("meetings").update(p2).eq("id", id));
  }
  if (error) return { ok: false, error: error.message };
  revalidatePath("/meetings"); revalidatePath("/companies");
  return { ok: true };
}

/** 打ち合わせ記録を削除。 */
export async function deleteMeeting(id: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  if (!id) return { ok: false, error: "id がありません" };
  const { error } = await admin.from("meetings").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/meetings"); revalidatePath("/companies");
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
export async function importJobs(records: JobInput[], sourceLabel: string, operator?: string | null, opts?: { mergeExisting?: boolean }) {
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
  let merged = 0;
  // mergeExisting: 既存(title × client_name 一致)を空欄補完で更新し、INSERT はスキップ。
  //   - 既存値は上書きしない（運用上の手動編集を保護）
  //   - スキル/タグ等の配列は重複排除でマージ
  //   - 非公開だった案件は最新CSV取込で再公開する
  if (opts?.mergeExisting) {
    const stillNew: typeof rows = [];
    const tk = (t?: string | null, c?: string | null) => normKey(t) + "|" + normKey(c);
    // 既存をこのバッチの (title × client_name) に絞って取得（チャンク毎の全件再取得を回避）。
    const byKey = new Map<string, any>();
    try {
      const titles = Array.from(new Set(rows.map((r) => r.title).filter(Boolean) as string[]));
      const CH = 500;
      for (let i = 0; i < titles.length; i += CH) {
        const slice = titles.slice(i, i + CH);
        // 行全体(*)を取得し、後段の upsert で欠落列が null 化されないようにする
        const { data, error } = await admin.from("jobs").select("*").in("title", slice);
        if (error || !data) continue;
        for (const r of data as any[]) { const k = tk(r.title, r.client_name); if (k && !byKey.has(k)) byKey.set(k, r); }
      }
    } catch { /* 取得失敗時は通常のINSERTパスへ */ }

    // 既存行ベースに「空欄のみ補完」したマージ済みレコードを構築
    const FILL = ["role_label", "salary_min", "salary_max", "remote_type", "flow_note", "work_location", "start_date", "detail", "status", "contact_name", "contact_email", "source_mail_url", "operator"];
    const mergedRows: any[] = [];
    for (const r of rows) {
      const k = tk(r.title, r.client_name);
      const ex = byKey.get(k);
      if (!ex?.id) { stillNew.push(r); continue; }
      const m: Record<string, any> = { ...ex, is_published: true, imported_at: now };
      for (const f of FILL) {
        const cur = (ex as any)[f];
        const nv = (r as any)[f];
        if ((cur == null || cur === "") && nv != null && nv !== "") m[f] = nv;
      }
      const curSkills: string[] = Array.isArray(ex.skills) ? ex.skills : [];
      const newSkills: string[] = Array.isArray((r as any).skills) ? (r as any).skills : [];
      const union = Array.from(new Set([...curSkills, ...newSkills]));
      if (union.length !== curSkills.length) m.skills = union;
      mergedRows.push(m);
    }
    // ★ 一括 upsert（id 衝突＝既存IDの UPDATE）に変更
    if (mergedRows.length > 0) {
      const UB = 300; // detail を含むため小さめ
      for (let i = 0; i < mergedRows.length; i += UB) {
        const slice = mergedRows.slice(i, i + UB);
        let { error, count } = await admin.from("jobs").upsert(slice, { onConflict: "id", count: "exact" });
        if (error && /column/i.test(error.message)) {
          const stripped = slice.map((b) => { const o: any = { ...b }; for (const k2 of ["contact_email", "contact_name", "source_mail_url", "operator"]) delete o[k2]; return o; });
          ({ error, count } = await admin.from("jobs").upsert(stripped, { onConflict: "id", count: "exact" }));
        }
        if (!error) merged += count ?? slice.length;
      }
    }
    rows.length = 0; for (const r of stillNew) (rows as any).push(r);
  }

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
  return { ok: true, inserted, merged };
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
  // パートナー企業の登録は自社所有(owner_company)で隔離。社内は null（社内所有）。
  const ownerCompany = await partnerOwnerCompany();
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
    owner_company: ownerCompany,
    imported_at: now,
  };

  const stripCols = (o: Record<string, any>) => { const c = { ...o }; delete c.contact_name; delete c.contact_email; delete c.source_mail_url; delete c.operator; delete c.owner_company; return c; };
  // 既存案件を更新・再公開する（複数ヒット時は最若番を採用）
  const updateExisting = async (id: string, jobNo: number, wasPublished: boolean) => {
    const update: Record<string, any> = { is_published: true, imported_at: now };
    for (const [k, v] of Object.entries(row)) {
      if (k === "is_published" || k === "imported_at" || k === "created_at" || k === "operator" || k === "owner_company") continue; // operator/所有は登録時のみ
      if (v == null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      update[k] = v;
    }
    let r: any = await admin.from("jobs").update(update).eq("id", id);
    if (r.error && /contact_email|contact_name|source_mail_url|owner_company|column/i.test(r.error.message)) {
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
  // テナント隔離：パートナーは自社所有のみ、社内は社内所有(null)のみと突合（他テナントの行を書き換えない）
  if (ownerCompany != null) q = q.eq("owner_company", ownerCompany); else { try { q = q.is("owner_company", null); } catch { /* 列未整備 */ } }
  const exList: any = await q.order("job_no", { ascending: true }).limit(1);
  const exRow = !exList.error ? (exList.data?.[0] ?? null) : null;
  if (exRow?.id) return updateExisting(exRow.id, exRow.job_no, !!exRow.is_published);

  // 新規 INSERT
  row.created_at = now;
  let r: any = await admin.from("jobs").insert(row).select("job_no").maybeSingle();
  if (r.error && /contact_email|contact_name|source_mail_url|owner_company|column/i.test(r.error.message)) {
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
  // パートナー企業の登録は自社所有(owner_company)で隔離。社内は null（社内所有）。
  const ownerCompany = await partnerOwnerCompany();
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
    owner_company: ownerCompany,
    score: 0,
    source_csv: "manual",
    imported_at: now,
  };

  const stripCols = (o: Record<string, any>) => { const c = { ...o }; delete c.email; delete c.contact_email; delete c.source_mail_url; delete c.skill_sheet_url; delete c.operator; delete c.owner_company; return c; };
  const updateExisting = async (id: string, candidateNo: number) => {
    const update: Record<string, any> = { imported_at: now };
    for (const [k, v] of Object.entries(row)) {
      if (k === "imported_at" || k === "operator" || k === "owner_company") continue; // operator/所有は登録時のみ
      if (v == null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      update[k] = v;
    }
    let r: any = await admin.from("candidates").update(update).eq("id", id);
    if (r.error && /skill_sheet_url|email|source_mail_url|owner_company|column/i.test(r.error.message)) {
      r = await admin.from("candidates").update(stripCols(update)).eq("id", id);
    }
    if (r.error) return { ok: false as const, error: r.error.message };
    revalidatePath("/people"); bustCounts();
    return { ok: true as const, action: "updated" as const, candidate_no: candidateNo };
  };

  // 既存検索（name×company）。複数行・重複でも落ちないよう最若番を採用。
  // テナント隔離：パートナーは自社所有のみ、社内は社内所有(null)のみと突合。
  let q = admin.from("candidates").select("id, candidate_no").eq("name", row.name);
  q = row.company ? q.eq("company", row.company) : q.is("company", null);
  if (ownerCompany != null) q = q.eq("owner_company", ownerCompany); else { try { q = q.is("owner_company", null); } catch { /* 列未整備 */ } }
  const exList: any = await q.order("candidate_no", { ascending: true }).limit(1);
  const exRow = !exList.error ? (exList.data?.[0] ?? null) : null;
  if (exRow?.id) return updateExisting(exRow.id, exRow.candidate_no);

  let r: any = await admin.from("candidates").insert(row).select("candidate_no").maybeSingle();
  if (r.error && /skill_sheet_url|email|source_mail_url|owner_company|column/i.test(r.error.message)) {
    r = await admin.from("candidates").insert(stripCols(row)).select("candidate_no").maybeSingle();
  }
  // 一意制約に当たった場合は既存人材の更新へフォールバック（重複エラーにしない）
  if (r.error && /duplicate key|unique|candidates_/i.test(r.error.message)) {
    let q2 = admin.from("candidates").select("id, candidate_no").eq("name", row.name);
    q2 = row.company ? q2.eq("company", row.company) : q2.is("company", null);
    if (ownerCompany != null) q2 = q2.eq("owner_company", ownerCompany); else { try { q2 = q2.is("owner_company", null); } catch { /* 列未整備 */ } }
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
    stage: input.stage?.trim() || "所属確認",
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
  if ((fields as any).flow_depth !== undefined) {
    const v = (fields as any).flow_depth;
    row.flow_depth = (v === null || v === "" || v === undefined) ? null : Number(v);
  }
  // source_company の同期：会社名(=company)を変更する場合は source_company も同期しておく
  if (row.company !== undefined && (fields as any).source_company === undefined) row.source_company = row.company;
  // updated_at 列が無い環境（旧スキーマ）でも保存できるよう、stripped で落とせるように。
  const stripped = (o: Record<string, any>) => { const c = { ...o }; delete c.email; delete c.contact_email; delete c.source_mail_url; delete c.skill_sheet_url; delete c.source_company; delete c.flow_depth; return c; };
  const withoutUpdatedAt = (o: Record<string, any>) => { const c = { ...o }; delete c.updated_at; return c; };
  let r: any = await admin.from("candidates").update(row).eq("candidate_no", candidateNo);
  if (r.error && /updated_at|column|schema cache/i.test(r.error.message)) {
    // updated_at 列がないテーブル定義 → タイムスタンプは省いて再試行
    r = await admin.from("candidates").update(withoutUpdatedAt(row)).eq("candidate_no", candidateNo);
  }
  if (r.error && /skill_sheet_url|email|source_mail_url|source_company|flow_depth|column/i.test(r.error.message)) {
    r = await admin.from("candidates").update(stripped(withoutUpdatedAt(row))).eq("candidate_no", candidateNo);
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
  if ((fields as any).accept_flow_depth !== undefined) {
    const v = (fields as any).accept_flow_depth;
    row.accept_flow_depth = (v === null || v === "" || v === undefined) ? null : Number(v);
  }
  const stripped = (o: Record<string, any>) => { const c = { ...o }; delete c.contact_name; delete c.contact_email; delete c.source_mail_url; delete c.accept_flow_depth; return c; };
  const withoutUpdatedAt = (o: Record<string, any>) => { const c = { ...o }; delete c.updated_at; return c; };
  let r: any = await admin.from("jobs").update(row).eq("job_no", jobNo);
  if (r.error && /updated_at|column|schema cache/i.test(r.error.message)) {
    // updated_at 列がない旧スキーマ → タイムスタンプは省いて再試行
    r = await admin.from("jobs").update(withoutUpdatedAt(row)).eq("job_no", jobNo);
  }
  if (r.error && /contact_email|contact_name|source_mail_url|accept_flow_depth|column/i.test(r.error.message)) {
    r = await admin.from("jobs").update(stripped(withoutUpdatedAt(row))).eq("job_no", jobNo);
  }
  if (r.error) return { ok: false as const, error: r.error.message };
  revalidatePath(`/jobs/${jobNo}`); revalidatePath("/jobs"); bustCounts();
  return { ok: true as const };
}

// ────────────────────────────────────────────────────────
// 提案メモ（連絡記録/重要事項/内部メモ/クライアント対応/人材対応）
// ────────────────────────────────────────────────────────
// 注意: PROPOSAL_MEMO_CATEGORIES は値の定数のため proposal-constants.ts に置く。
//        "use server" の本ファイルは async 関数しか export できない。

export async function addProposalMemo(proposalId: string, category: string, body: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const cat = (category || "").trim();
  const text = (body || "").trim();
  if (!proposalId) return { ok: false as const, error: "提案IDが必要です" };
  const { PROPOSAL_MEMO_CATEGORIES } = await import("./proposal-constants");
  if (!cat || !(PROPOSAL_MEMO_CATEGORIES as readonly string[]).includes(cat)) return { ok: false as const, error: "カテゴリが不正です" };
  if (!text) return { ok: false as const, error: "本文を入力してください" };
  let by_email: string | null = null, by_name: string | null = null;
  try { const a = await currentAccess(); by_email = a?.email ?? null; by_name = a?.name ?? null; } catch { /* noop */ }
  const r: any = await admin.from("proposal_memos").insert({ proposal_id: proposalId, category: cat, body: text, created_by_email: by_email, created_by_name: by_name }).select("*").single();
  if (r.error) return { ok: false as const, error: r.error.message };
  revalidatePath("/proposals");
  return { ok: true as const, memo: r.data };
}

export async function deleteProposalMemo(memoId: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー" }; }
  if (!memoId) return { ok: false as const, error: "メモIDが必要です" };
  const r: any = await admin.from("proposal_memos").delete().eq("id", memoId);
  if (r.error) return { ok: false as const, error: r.error.message };
  revalidatePath("/proposals");
  return { ok: true as const };
}

// ────────────────────────────────────────────────────────
// 受信メール（Gmail 同期・AI抽出・登録）
//   - 同期: Gmail API で最新メールを取得して inbox_emails に保存（AIは使わない・無料）
//   - 抽出: 1通ずつ Claude Haiku に投げて { kind, summary, data } を取得（営業が手動で発火）
//   - 登録: extracted_data から jobs/candidates テーブルに insert（既存 upsert*Manual を流用）
// ────────────────────────────────────────────────────────

export async function syncInboxFromGmail(opts?: { query?: string; max?: number }): Promise<{ ok: boolean; synced?: number; skipped?: number; found?: number; account?: string | null; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { gmailConfigured, listMessageIds, fetchMessage, getGmailProfile } = await import("./gmail-api");
  if (!gmailConfigured()) return { ok: false, error: "Gmail OAuth 未設定です（GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN を Vercel に設定してください）" };

  // 接続先メールボックスを把握（refresh token が想定アカウントに紐づいているか診断）
  const prof = await getGmailProfile();
  if (!prof.ok) return { ok: false, error: `Gmail 接続エラー ${prof.error}` };
  const account = prof.emailAddress;

  const list = await listMessageIds({ q: opts?.query ?? `${INBOX_EXCLUDE_QUERY} newer_than:7d`, maxResults: opts?.max ?? 100 });
  if (!list.ok) return { ok: false, error: list.error, account };
  if (list.ids.length === 0) return { ok: true, synced: 0, skipped: 0, found: 0, account };

  // 既存の message_id を一括取得（重複保存をスキップ）
  const existing = await admin.from("inbox_emails").select("gmail_message_id").in("gmail_message_id", list.ids);
  const seen = new Set<string>((existing.data ?? []).map((r: any) => r.gmail_message_id));
  const newIds = list.ids.filter((id) => !seen.has(id));

  let synced = 0;
  let skippedBounce = 0;
  // 同時5本で取得（Gmail API は概ね 250 quota/秒なので問題ない）
  const POOL = 5; let idx = 0;
  const work = async (gid: string) => {
    const r = await fetchMessage(gid);
    if (!r.ok) return;
    const m = r.msg;
    // 最終防衛線：バウンス/システム通知はクエリをすり抜けても保存しない。
    // ただし本文から不達となった宛先を抽出し bounce_records に蓄積（マッチング/提案で警告に使う）。
    if (isSystemBounceEmail(m.fromEmail, m.fromName, m.subject)) {
      skippedBounce++;
      const recipient = extractBouncedRecipient(m.body || m.bodyHtml || "");
      if (recipient) {
        await recordBounce(admin, {
          recipient, subject: m.subject, reason: extractBounceReason(m.body || m.bodyHtml || ""),
          messageId: m.id, receivedAt: m.receivedAt,
        });
      }
      return;
    }
    await admin.from("inbox_emails").insert({
      gmail_message_id: m.id, gmail_thread_id: m.threadId || null,
      subject: m.subject, from_email: m.fromEmail, from_name: m.fromName, to_email: m.toEmail,
      body: m.body, body_html: m.bodyHtml || null,
      has_attachment: m.hasAttachment, attachment_names: m.attachmentNames.length ? m.attachmentNames : null,
      received_at: m.receivedAt,
    });
    synced++;
  };
  const workers = Array.from({ length: Math.min(POOL, newIds.length) }, async () => {
    while (idx < newIds.length) { const i = idx++; try { await work(newIds[i]); } catch { /* 1通失敗しても続行 */ } }
  });
  await Promise.all(workers);

  // 過去に取り込んでしまったバウンス/システム通知：本文から宛先を抽出して bounce_records に蓄積し、
  // そのうえで一覧から見えないようアーカイブする。
  try {
    const past: any = await admin.from("inbox_emails")
      .select("id, gmail_message_id, subject, body, body_html, received_at, is_archived")
      .or("from_email.ilike.%mailer-daemon%,from_email.ilike.%postmaster@%,from_name.ilike.%Mail Delivery%,subject.ilike.%Delivery Status Notification%,subject.ilike.%Undelivered Mail%")
      .limit(500);
    const rows: any[] = past.data ?? [];
    for (const row of rows) {
      const recipient = extractBouncedRecipient(row.body || row.body_html || row.subject || "");
      if (recipient) {
        await recordBounce(admin, {
          recipient, subject: row.subject ?? null,
          reason: extractBounceReason(row.body || row.body_html || ""),
          messageId: row.gmail_message_id ?? null, receivedAt: row.received_at ?? null,
        });
      }
    }
    const toArchive = rows.filter((r) => !r.is_archived).map((r) => r.id);
    if (toArchive.length > 0) await admin.from("inbox_emails").update({ is_archived: true }).in("id", toArchive);
  } catch { /* is_archived / bounce_records 未整備でも続行 */ }

  revalidatePath("/inbox"); revalidatePath("/mail");
  return { ok: true, synced, skipped: seen.size + skippedBounce, found: list.ids.length, account };
}

const INBOX_EXTRACT_SYSTEM = "あなたはエンジニア人材紹介エージェントのメール仕分けアシスタントです。受信メール本文から、それが『案件情報』か『人材情報』か『その他/スパム』かを判定し、構造化データを返してください。出力は必ず指定された JSON 形式のみ（説明文不要）。";
const INBOX_EXTRACT_PROMPT_TEMPLATE = (subject: string, from: string, body: string) => `次のメールを判定し、JSON のみを出力してください。

形式:
{
  "kind": "job" | "candidate" | "skip" | "spam",
  "summary": "一行要約(80文字以内)",
  "confidence": 0.0〜1.0,
  "data": {
    // kind=="job" の場合（分かるものだけ・無いものは null）:
    "title": "案件名",
    "client_name": "クライアント企業名",
    "role_label": "職種(SE/PMなど)",
    "skills": ["スキル名(配列・最大10)"],
    "salary_min": 数値(万) | null,
    "salary_max": 数値(万) | null,
    "remote_type": "full_remote" | "partial_remote" | "onsite" | null,
    "flow_note": "商流の制限(あれば)",
    "work_location": "勤務地",
    "start_date": "YYYY-MM-DD" | null,
    "detail": "求められる経験/スキル要件",
    // kind=="candidate" の場合:
    "name": "氏名",
    "company": "現所属企業",
    "title": "職種",
    "skills": ["スキル名"],
    "rate": "想定単価(例: ¥70万)",
    "exp": "経験年数や経歴サマリ",
    "remote_pref": "希望リモート区分",
    "skill_sheet_url": "添付/Driveリンク(あれば)"
  }
}

判定の指針:
- "案件" = クライアントから「こんな人材を探している」「人材いますか」等の案件依頼
- "人材" = エンジニア本人/エージェントから「この人材を紹介します」「スキルシート」等の人材提案
- "skip" = 返信・確認メール・社内連絡・無関係（自動配信/ニュースレター含む）
- "spam" = スパム/フィッシング

--- メール ---
件名: ${subject}
差出人: ${from}

${body}`;

export async function extractInboxEmail(inboxId: string): Promise<{ ok: boolean; kind?: string; summary?: string; data?: any; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  if (!inboxId) return { ok: false, error: "メールID が必要です" };

  const row: any = (await admin.from("inbox_emails").select("*").eq("id", inboxId).maybeSingle()).data;
  if (!row) return { ok: false, error: "メールが見つかりません" };

  const { callLLM, parseJsonLoose } = await import("./llm");
  const { logUsage } = await import("./ai-usage");

  // Haiku を強制（安価モデル）。LLM_MODEL が指定されていてもこの処理だけは Haiku を選好。
  const previousModel = process.env.LLM_MODEL;
  if (!previousModel || !/haiku/i.test(previousModel)) process.env.LLM_MODEL = "claude-haiku-4-5";

  const subject = row.subject ?? "(件名なし)";
  const from = [row.from_name, row.from_email].filter(Boolean).join(" ") || "(差出人不明)";
  const body = (row.body ?? "").slice(0, 12000);
  const prompt = INBOX_EXTRACT_PROMPT_TEMPLATE(subject, from, body);

  const r = await callLLM({ system: INBOX_EXTRACT_SYSTEM, prompt, maxTokens: 1200, temperature: 0.1 });
  // モデル設定を元に戻す
  if (previousModel) process.env.LLM_MODEL = previousModel; else delete process.env.LLM_MODEL;

  if (!r.ok) return { ok: false, error: r.error };
  try { await logUsage("inbox-extract", r.model, r.usage); } catch { /* noop */ }

  const parsed = parseJsonLoose<{ kind: string; summary: string; data: any; confidence?: number }>(r.text);
  if (!parsed || !parsed.kind) return { ok: false, error: "AI 応答の JSON 解析に失敗しました" };

  const confidence = typeof parsed.confidence === "number"
    ? Math.max(0, Math.min(1, parsed.confidence))
    : null;

  await admin.from("inbox_emails").update({
    extracted_at: new Date().toISOString(),
    extracted_kind: parsed.kind,
    extracted_data: parsed.data ?? null,
    extracted_summary: parsed.summary ?? null,
    confidence,
  }).eq("id", inboxId);

  revalidatePath("/inbox");
  return { ok: true, kind: parsed.kind, summary: parsed.summary, data: parsed.data };
}

// ── LINE / メール 貼り付け取り込み ─────────────────────────────
//   LINEやメールで送られてきた素のテキストを貼り付けて、AIで案件/人材フィールドに整形する。
//   新規登録モーダルの「LINE/メールから貼り付け」で使用。Haiku 固定で安価。
const PASTE_EXTRACT_SYSTEM = "あなたはエンジニア人材紹介エージェントの入力補助アシスタントです。LINEやメールで送られてきた自由文から、案件または人材の情報を構造化して抽出します。出力は指定の JSON のみ（説明文・コードブロック不要）。分からない項目は null。";

const PASTE_JOB_PROMPT = (text: string) => `次の文章は「案件（求人）」の情報です。JSON のみ出力してください。
形式:
{
  "title": "案件名(短く)",
  "client_name": "クライアント企業名" | null,
  "role_label": "職種(SE/PM/インフラ等)" | null,
  "skills": ["スキル名(最大10)"],
  "salary_min": 数値(万) | null,
  "salary_max": 数値(万) | null,
  "remote_type": "full_remote" | "partial_remote" | "onsite" | null,
  "flow_note": "商流の制限(例: 二社下まで)" | null,
  "work_location": "勤務地" | null,
  "start_date": "YYYY-MM-DD または 自由文(例: 即日/6月)" | null,
  "detail": "求められる経験・スキル要件など本文の要点",
  "contact_name": "窓口担当者名" | null
}
単価は「万」単位の数値に正規化（例: 70万→70, 700,000円→70）。範囲があれば min/max 両方。
--- 文章 ---
${text}`;

const PASTE_CAND_PROMPT = (text: string) => `次の文章は「人材（エンジニア）」の情報です。JSON のみ出力してください。
形式:
{
  "name": "氏名(イニシャル可)",
  "company": "現所属企業" | null,
  "affiliation": "所属区分(例: 一社下社員/フリーランス/二社下以降)" | null,
  "title": "職種" | null,
  "skills": ["スキル名(最大15)"],
  "rate": "希望単価(例: 80万 / ¥70〜90万)" | null,
  "exp": "経験年数や経歴サマリ" | null,
  "avail": "稼働開始(例: 即日/6月〜)" | null,
  "location": "希望勤務地" | null,
  "remote_pref": "希望リモート区分(自由文)" | null,
  "status": "ステータス(例: 提案可)" | null
}
--- 文章 ---
${text}`;

/** 貼り付けテキストを AI で構造化（kind=candidates|jobs）。フォーム初期値用の文字列マップを返す。 */
export async function parseEntityText(kind: "candidates" | "jobs", text: string): Promise<{ ok: true; fields: Record<string, string>; summary?: string } | { ok: false; error: string }> {
  const raw = (text ?? "").trim();
  if (raw.length < 4) return { ok: false, error: "テキストが短すぎます。LINE/メールの本文を貼り付けてください。" };
  const me = await currentAccess();
  if (!me) return { ok: false, error: "未ログインです" };

  const { callLLM, parseJsonLoose } = await import("./llm");
  const { logUsage } = await import("./ai-usage");

  // Haiku 固定（安価）。
  const previousModel = process.env.LLM_MODEL;
  if (!previousModel || !/haiku/i.test(previousModel)) process.env.LLM_MODEL = "claude-haiku-4-5";
  const body = raw.slice(0, 8000);
  const prompt = kind === "jobs" ? PASTE_JOB_PROMPT(body) : PASTE_CAND_PROMPT(body);
  const r = await callLLM({ system: PASTE_EXTRACT_SYSTEM, prompt, maxTokens: 1000, temperature: 0.1 });
  if (previousModel) process.env.LLM_MODEL = previousModel; else delete process.env.LLM_MODEL;
  if (!r.ok) return { ok: false, error: r.error };
  try { await logUsage("paste-extract", r.model, r.usage); } catch { /* noop */ }

  const d = parseJsonLoose<any>(r.text);
  if (!d || typeof d !== "object") return { ok: false, error: "AI 応答の解析に失敗しました。手入力してください。" };

  // フォームの field キーに合わせて文字列化（skills は配列→カンマ区切り、数値→文字列）
  const s = (v: any) => (v == null ? "" : String(v).trim());
  const arr = (v: any) => Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).join(", ") : s(v);
  const fields: Record<string, string> = {};
  if (kind === "jobs") {
    fields.title = s(d.title);
    fields.client_name = s(d.client_name);
    fields.role_label = s(d.role_label);
    fields.skills = arr(d.skills);
    fields.salary_min = d.salary_min != null ? String(d.salary_min) : "";
    fields.salary_max = d.salary_max != null ? String(d.salary_max) : "";
    fields.remote_type = ["full_remote", "partial_remote", "onsite"].includes(d.remote_type) ? d.remote_type : "";
    fields.flow_note = s(d.flow_note);
    fields.work_location = s(d.work_location);
    fields.start_date = s(d.start_date);
    fields.detail = s(d.detail);
    fields.contact_name = s(d.contact_name);
  } else {
    fields.name = s(d.name);
    fields.company = s(d.company);
    fields.affiliation = s(d.affiliation);
    fields.title = s(d.title);
    fields.skills = arr(d.skills);
    fields.rate = s(d.rate);
    fields.exp = s(d.exp);
    fields.avail = s(d.avail);
    fields.location = s(d.location);
    fields.status = s(d.status);
  }
  // 空キーは落とす（既存入力を上書きしないため）
  for (const k of Object.keys(fields)) if (!fields[k]) delete fields[k];
  return { ok: true, fields };
}

export async function registerInboxAsJob(inboxId: string, override?: Partial<JobInput>): Promise<{ ok: boolean; job_no?: number; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  const row: any = (await admin.from("inbox_emails").select("*").eq("id", inboxId).maybeSingle()).data;
  if (!row) return { ok: false, error: "メールが見つかりません" };
  const d = row.extracted_data ?? {};
  const input: JobInput = {
    title: override?.title ?? d.title ?? row.subject ?? "(無題)",
    client_name: override?.client_name ?? d.client_name ?? null,
    role_label: override?.role_label ?? d.role_label ?? null,
    skills: override?.skills ?? (Array.isArray(d.skills) ? d.skills : []),
    salary_min: override?.salary_min ?? d.salary_min ?? null,
    salary_max: override?.salary_max ?? d.salary_max ?? null,
    remote_type: override?.remote_type ?? d.remote_type ?? "partial_remote",
    flow_note: override?.flow_note ?? d.flow_note ?? null,
    work_location: override?.work_location ?? d.work_location ?? null,
    start_date: override?.start_date ?? d.start_date ?? null,
    detail: override?.detail ?? d.detail ?? row.body?.slice(0, 1500) ?? null,
    contact_email: row.from_email ?? null,
    contact_name: row.from_name ?? null,
    // 受信アカウント(authuser)付きの正しい原本URLを保存（u/0 固定だと別アカウントで開けない）。
    source_mail_url: gmailMessageUrl(row.gmail_message_id),
  };
  const res = await upsertJobManual(input);
  if (!res.ok) return { ok: false, error: ("error" in res ? res.error : undefined) || "案件作成に失敗しました" };

  let by_email: string | null = null;
  try { const a = await currentAccess(); by_email = a?.email ?? null; } catch { /* noop */ }
  await admin.from("inbox_emails").update({
    registered_at: new Date().toISOString(),
    registered_job_no: (res as any).job_no ?? null,
    registered_by_email: by_email,
    extracted_kind: "job",
  }).eq("id", inboxId);

  revalidatePath("/inbox"); revalidatePath("/jobs"); bustCounts();
  return { ok: true, job_no: (res as any).job_no };
}

export async function registerInboxAsCandidate(inboxId: string, override?: Partial<CandidateInput>): Promise<{ ok: boolean; candidate_no?: number; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  const row: any = (await admin.from("inbox_emails").select("*").eq("id", inboxId).maybeSingle()).data;
  if (!row) return { ok: false, error: "メールが見つかりません" };
  const d = row.extracted_data ?? {};
  const input: CandidateInput = {
    name: override?.name ?? d.name ?? row.from_name ?? "(氏名未抽出)",
    title: override?.title ?? d.title ?? null,
    company: override?.company ?? d.company ?? null,
    skills: override?.skills ?? (Array.isArray(d.skills) ? d.skills : []),
    rate: override?.rate ?? d.rate ?? null,
    exp: override?.exp ?? d.exp ?? null,
    remote_pref: override?.remote_pref ?? d.remote_pref ?? null,
    skill_sheet_url: override?.skill_sheet_url ?? d.skill_sheet_url ?? null,
    note: row.body?.slice(0, 1500) ?? null,
    contact_email: row.from_email ?? null,
    // 受信アカウント(authuser)付きの正しい原本URLを保存（u/0 固定だと別アカウントで開けない）。
    source_mail_url: gmailMessageUrl(row.gmail_message_id),
  };
  const res = await upsertCandidateManual(input);
  if (!res.ok) return { ok: false, error: ("error" in res ? res.error : undefined) || "人材作成に失敗しました" };

  let by_email: string | null = null;
  try { const a = await currentAccess(); by_email = a?.email ?? null; } catch { /* noop */ }
  await admin.from("inbox_emails").update({
    registered_at: new Date().toISOString(),
    registered_candidate_no: (res as any).candidate_no ?? null,
    registered_by_email: by_email,
    extracted_kind: "candidate",
  }).eq("id", inboxId);

  revalidatePath("/inbox"); revalidatePath("/people"); bustCounts();
  return { ok: true, candidate_no: (res as any).candidate_no };
}

// ────────────────────────────────────────────────────────
// Gmail取込: 既存登録済みレコードの「元メールURL」を補完・修正する。
//   ・URL が空のもの → inbox_emails.gmail_message_id から正しい authuser 付き URL を付与
//   ・旧フォーマット(/u/0/ 固定)のもの → authuser 付きに張り替え（別アカウントで開けない不具合を解消）
//   ・手動で http(s) URL を入れたものは尊重して触らない
// ────────────────────────────────────────────────────────
export async function backfillInboxSourceMailUrls(): Promise<{
  ok: boolean; jobsFixed?: number; candidatesFixed?: number; scanned?: number; error?: string;
}> {
  const access = await currentAccess();
  if ((access?.role ?? "admin") !== "admin") return { ok: false, error: "管理者のみ実行できます" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }

  // 登録済み（jobs/candidates に紐づく）かつ gmail_message_id を持つ取込メールを取得
  const r: any = await admin.from("inbox_emails")
    .select("gmail_message_id, registered_job_no, registered_candidate_no")
    .not("gmail_message_id", "is", null)
    .or("registered_job_no.not.is.null,registered_candidate_no.not.is.null")
    .limit(5000);
  if (r.error) return { ok: false, error: r.error.message };
  const rows: any[] = r.data ?? [];

  // 既存 URL が「空 or /u/0/ 旧形式」なら張り替える、という判定
  const needsFix = (cur: string | null | undefined) =>
    !cur || /\/mail\/u\/\d+\/#/.test(String(cur));

  let jobsFixed = 0, candidatesFixed = 0;
  for (const row of rows) {
    const url = gmailMessageUrl(row.gmail_message_id);
    if (!url) continue;
    if (row.registered_job_no != null) {
      const cur: any = await admin.from("jobs").select("job_no, source_mail_url").eq("job_no", row.registered_job_no).maybeSingle();
      if (cur.data && needsFix(cur.data.source_mail_url)) {
        const up = await admin.from("jobs").update({ source_mail_url: url }).eq("job_no", row.registered_job_no);
        if (!up.error) jobsFixed++;
      }
    }
    if (row.registered_candidate_no != null) {
      const cur: any = await admin.from("candidates").select("candidate_no, source_mail_url").eq("candidate_no", row.registered_candidate_no).maybeSingle();
      if (cur.data && needsFix(cur.data.source_mail_url)) {
        const up = await admin.from("candidates").update({ source_mail_url: url }).eq("candidate_no", row.registered_candidate_no);
        if (!up.error) candidatesFixed++;
      }
    }
  }
  revalidatePath("/jobs"); revalidatePath("/people"); revalidatePath("/matching");
  return { ok: true, jobsFixed, candidatesFixed, scanned: rows.length };
}

export async function skipInboxEmail(inboxId: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  await admin.from("inbox_emails").update({
    extracted_kind: "skip",
    skipped_reason: reason || null,
    extracted_at: new Date().toISOString(),
    is_archived: true,
  }).eq("id", inboxId);
  revalidatePath("/inbox");
  return { ok: true };
}

export async function archiveInboxEmail(inboxId: string, archived: boolean = true): Promise<{ ok: boolean; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  await admin.from("inbox_emails").update({ is_archived: archived }).eq("id", inboxId);
  revalidatePath("/inbox");
  return { ok: true };
}

// ────────────────────────────────────────────────────────
// Gmail → AI 一括取込（/jobs・/people の「✨ Gmailから取込」ボタン用）
//   1) Gmail を同期して inbox_emails に未取得分を保存
//   2) 未抽出メールに対し Claude Haiku で kind 判定＋構造化（並列）
//   3) 指定 kind（job or candidate）に該当する結果のみ返す
//   register は `bulkRegisterFromGmail` で別途行う（プレビュー→確認→登録の2段階）
// ────────────────────────────────────────────────────────
export type BulkPreviewItem = {
  inbox_id: string;
  gmail_message_id: string | null;
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  received_at: string | null;
  summary: string | null;
  data: any;
};

export async function bulkPreviewFromGmail(opts: {
  kind: "jobs" | "candidates"; max?: number; sync?: boolean;
}): Promise<{ ok: boolean; items?: BulkPreviewItem[]; synced?: number; extracted?: number; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const targetKind = opts.kind === "jobs" ? "job" : "candidate";
  const max = Math.max(1, Math.min(50, opts.max ?? 30));

  // 1) Gmail 同期（任意）。すでに同期済の場合は無料。
  let synced = 0;
  if (opts.sync !== false) {
    const s = await syncInboxFromGmail({ max });
    if (!s.ok) return { ok: false, error: s.error };
    synced = s.synced ?? 0;
  }

  // 2) 未抽出メールを取得（古い順だとAIコストがかさむ恐れがあるので新しい順）
  const r: any = await admin.from("inbox_emails")
    .select("id, gmail_message_id, subject, from_email, from_name, received_at, extracted_at, extracted_kind, extracted_data, extracted_summary, is_archived")
    .is("extracted_at", null).eq("is_archived", false)
    .order("received_at", { ascending: false }).limit(max);
  if (r.error) return { ok: false, error: `inbox_emails 取得失敗: ${r.error.message}` };
  const pending: any[] = r.data ?? [];

  // 3) 並列抽出（同時3本・Haiku 想定）
  let extracted = 0;
  const POOL = 3; let idx = 0;
  const worker = async () => {
    while (idx < pending.length) {
      const i = idx++;
      try { const ex = await extractInboxEmail(pending[i].id); if (ex.ok) extracted++; }
      catch { /* 1通失敗しても続行 */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, pending.length) }, () => worker()));

  // 4) 指定 kind に該当する抽出済みメール（未登録）を取得して返す
  const q: any = await admin.from("inbox_emails")
    .select("id, gmail_message_id, subject, from_email, from_name, received_at, extracted_kind, extracted_data, extracted_summary")
    .eq("extracted_kind", targetKind).eq("is_archived", false).is("registered_at", null)
    .order("received_at", { ascending: false }).limit(100);
  if (q.error) return { ok: false, error: `抽出結果の取得に失敗: ${q.error.message}` };

  const items: BulkPreviewItem[] = (q.data ?? []).map((row: any) => ({
    inbox_id: row.id, gmail_message_id: row.gmail_message_id,
    subject: row.subject, from_email: row.from_email, from_name: row.from_name,
    received_at: row.received_at, summary: row.extracted_summary, data: row.extracted_data ?? {},
  }));
  return { ok: true, items, synced, extracted };
}

export async function bulkRegisterFromGmail(input: {
  kind: "jobs" | "candidates"; items: { inbox_id: string; override?: any }[];
}): Promise<{ ok: boolean; registered?: number; failed?: number; error?: string }> {
  if (!Array.isArray(input.items) || input.items.length === 0) return { ok: false, error: "登録対象がありません" };
  let registered = 0, failed = 0;
  for (const it of input.items) {
    try {
      const res = input.kind === "jobs"
        ? await registerInboxAsJob(it.inbox_id, it.override as Partial<JobInput> | undefined)
        : await registerInboxAsCandidate(it.inbox_id, it.override as Partial<CandidateInput> | undefined);
      if (res.ok) registered++; else failed++;
    } catch { failed++; }
  }
  bustCounts();
  return { ok: true, registered, failed };
}

// ────────────────────────────────────────────────────────
// GAS 代替：完全自動取込（cron から定期実行）
//   1) Gmail を「案件/人材っぽい」検索クエリで絞って同期（noreply 等は除外）
//   2) 未抽出メールを AI 分類（並列・1通約 0.5円）
//   3) confidence >= 閾値（既定 0.75）なら自動登録、skip/spam は自動アーカイブ
//   4) それ以外は「未承認（要確認）」として人がレビュー
// ────────────────────────────────────────────────────────
// バウンス本文から不達となった宛先メールアドレスを抽出。
//   優先順位：
//     1) Final-Recipient: / Original-Recipient: 行（RFC3464 配信状態通知の標準）
//     2) X-Failed-Recipients: ヘッダ
//     3) 本文中の「To: <email>」「<email>」など。最初に見つかった妥当アドレスを返す。
//   抽出できなければ null。
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
function extractBouncedRecipient(text: string | null | undefined): string | null {
  if (!text) return null;
  const norm = String(text).replace(/\r\n/g, "\n");
  // 1) RFC3464 ヘッダ
  for (const line of norm.split("\n")) {
    const m = line.match(/^\s*(Final-Recipient|Original-Recipient|X-Failed-Recipients)\s*:\s*(?:rfc822\s*;)?\s*(.+)$/i);
    if (m) {
      const v = m[2].match(EMAIL_RE);
      if (v) return v[0].toLowerCase();
    }
  }
  // 2) Google 形式：「Message not delivered ... <recipient@...>」「The email account that you tried to reach (recipient@...)」
  const cues = [
    /(?:not\s+delivered|could\s+not\s+be\s+delivered|undeliverable)[\s\S]{0,200}?<([^>\s]+@[^>\s]+)>/i,
    /tried\s+to\s+reach\s*\(?\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s*\)?/i,
  ];
  for (const re of cues) { const m = norm.match(re); if (m) return m[1].toLowerCase(); }
  // 3) 本文の <email> 形式（最初のもの）
  const m = norm.match(/<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/i);
  if (m) return m[1].toLowerCase();
  // 4) ベタ書きアドレス（mailer-daemon系を除外して最初のもの）
  const all = norm.match(new RegExp(EMAIL_RE.source, "gi")) ?? [];
  for (const a of all) {
    const low = a.toLowerCase();
    if (/(mailer-daemon|postmaster|noreply|no-reply|donotreply|googlemail\.com|google\.com)/.test(low)) continue;
    return low;
  }
  return null;
}

// バウンス本文から「失敗理由」を1行抜粋（SMTP 5xx 行や reason: ... を拾う）。
function extractBounceReason(text: string | null | undefined): string | null {
  if (!text) return null;
  const norm = String(text).replace(/\r\n/g, "\n");
  // Diagnostic-Code: smtp; 550 5.1.1 ... のような RFC3464
  const dx = norm.match(/Diagnostic-Code\s*:\s*(.+)/i);
  if (dx) return dx[1].slice(0, 200).trim();
  // SMTP 5xx メッセージ行
  const smtp = norm.match(/(\b5\d{2}[\s-][^\n]{0,200})/);
  if (smtp) return smtp[1].slice(0, 200).trim();
  // 「address does not exist」「could not be delivered」等の英文の1行
  const phrase = norm.match(/([^\n]*(?:does not exist|could not be delivered|user unknown|mailbox (?:full|not found)|address rejected|recipient address rejected)[^\n]*)/i);
  if (phrase) return phrase[1].slice(0, 200).trim();
  return null;
}

// バウンス記録テーブルへ upsert（テーブル未整備でも握りつぶす）。
async function recordBounce(admin: ReturnType<typeof engerAdmin>, args: { recipient: string; subject: string | null; reason: string | null; messageId: string | null; receivedAt: string | null }) {
  const recipient = args.recipient.toLowerCase().trim();
  if (!recipient) return;
  try {
    // 既存があれば count++ と last_* を更新、無ければ新規。
    const existing: any = await admin.from("bounce_records").select("id, bounce_count").eq("recipient_email", recipient).maybeSingle();
    const now = args.receivedAt ?? new Date().toISOString();
    if (existing.data?.id) {
      await admin.from("bounce_records").update({
        bounce_count: (existing.data.bounce_count ?? 1) + 1,
        last_bounced_at: now,
        last_subject: args.subject ?? null,
        last_reason: args.reason ?? null,
        sample_message_id: args.messageId ?? null,
      }).eq("id", existing.data.id);
    } else {
      await admin.from("bounce_records").insert({
        recipient_email: recipient,
        bounce_count: 1,
        first_bounced_at: now,
        last_bounced_at: now,
        last_subject: args.subject ?? null,
        last_reason: args.reason ?? null,
        sample_message_id: args.messageId ?? null,
      });
    }
  } catch { /* bounce_records 未整備でも続行 */ }
}

// 取込ノイズ（自動送信・配信不能通知など）の除外クエリ。手動同期・自動取込の両方で使う。
//   ※ mailer-daemon の「Delivery Status Notification (Failure)」等のバウンスを弾くのが主目的。
const INBOX_EXCLUDE_QUERY = [
  "-from:noreply -from:no-reply -from:notifications -from:notification",
  "-from:postmaster -from:mailer-daemon -from:donotreply -from:mailer-daemon@googlemail.com",
  "-subject:配信停止 -subject:newsletter -subject:メルマガ",
  '-subject:"Delivery Status Notification" -subject:"Undelivered Mail" -subject:"failure notice" -subject:"Mail Delivery"',
  "-unsubscribe -配信解除",
  "-category:promotions -category:social",
].join(" ");

const AUTO_INGEST_GMAIL_QUERY = [
  // 包含: SES営業メールに頻出するキーワード（最低1つ含むものを取得）
  "(案件 OR 人材 OR スキルシート OR 経歴書 OR エンジニア OR SE OR PM OR PL OR 単価 OR 月額 OR 提案 OR 募集 OR ご紹介)",
  // 除外: 自動送信・配信系・バウンス
  INBOX_EXCLUDE_QUERY,
].join(" ");

// 取込時の最終防衛線：クエリをすり抜けたバウンス/システム通知を判定して保存をスキップする。
const BOUNCE_FROM_RE = /(mailer-daemon|postmaster|no-?reply|do-?not-?reply|noreply)@/i;
const BOUNCE_SUBJECT_RE = /(delivery status notification|undelivered mail|mail delivery (sub)?system|failure notice|returned mail|配信不能|送信できませんでした|メールが配信されませんでした)/i;
function isSystemBounceEmail(fromEmail: string | null, fromName: string | null, subject: string | null): boolean {
  const f = `${fromEmail ?? ""} ${fromName ?? ""}`;
  if (BOUNCE_FROM_RE.test(f) || /mail delivery subsystem/i.test(f)) return true;
  if (subject && BOUNCE_SUBJECT_RE.test(subject)) return true;
  return false;
}

export async function autoIngestFromGmail(opts?: {
  query?: string; max?: number; confidenceThreshold?: number; dryRun?: boolean;
}): Promise<{
  ok: boolean;
  synced?: number; extracted?: number;
  autoJobs?: number; autoCandidates?: number;
  needsReview?: number; archived?: number; errors?: number;
  error?: string;
}> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const threshold = Math.max(0, Math.min(1, opts?.confidenceThreshold
    ?? Number(process.env.AUTO_INGEST_CONFIDENCE_THRESHOLD ?? "0.75")));
  const max = Math.max(1, Math.min(200, opts?.max ?? Number(process.env.AUTO_INGEST_MAX_PER_RUN ?? "12")));
  const query = opts?.query ?? `${AUTO_INGEST_GMAIL_QUERY} newer_than:1d`;

  // 1) Gmail 同期（絞り込み済みクエリで取得）
  const s = await syncInboxFromGmail({ query, max });
  if (!s.ok) return { ok: false, error: s.error };
  const synced = s.synced ?? 0;

  // 2) 未抽出メールを取得して並列抽出
  const r: any = await admin.from("inbox_emails")
    .select("id")
    .is("extracted_at", null).eq("is_archived", false)
    .order("received_at", { ascending: false }).limit(max);
  if (r.error) return { ok: false, error: `inbox_emails 取得失敗: ${r.error.message}` };
  const pending: { id: string }[] = r.data ?? [];

  let extracted = 0, errors = 0;
  const POOL = 3; let idx = 0;
  const worker = async () => {
    while (idx < pending.length) {
      const i = idx++;
      try { const ex = await extractInboxEmail(pending[i].id); if (ex.ok) extracted++; else errors++; }
      catch { errors++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, pending.length) }, () => worker()));

  if (opts?.dryRun) return { ok: true, synced, extracted, autoJobs: 0, autoCandidates: 0, needsReview: 0, archived: 0, errors };

  // 3) 抽出済み・未登録・未アーカイブ なメールを confidence で振り分け
  // 60秒上限に収めるため 1 回の振り分けも件数を絞る（残りは次回の起動で処理）。
  const q: any = await admin.from("inbox_emails")
    .select("id, extracted_kind, confidence")
    .not("extracted_at", "is", null)
    .is("registered_at", null).eq("is_archived", false)
    .order("received_at", { ascending: false })
    .limit(Math.max(max * 2, 30));
  if (q.error) return { ok: false, error: `振分け対象の取得失敗: ${q.error.message}` };

  let autoJobs = 0, autoCandidates = 0, archived = 0, needsReview = 0;
  for (const row of (q.data ?? []) as { id: string; extracted_kind: string | null; confidence: number | null }[]) {
    const kind = row.extracted_kind;
    const conf = row.confidence ?? 0;

    if (kind === "skip" || kind === "spam") {
      // 無関係/スパム → 自動アーカイブ
      await admin.from("inbox_emails").update({ is_archived: true }).eq("id", row.id);
      archived++;
      continue;
    }
    if ((kind === "job" || kind === "candidate") && conf >= threshold) {
      try {
        const res = kind === "job" ? await registerInboxAsJob(row.id) : await registerInboxAsCandidate(row.id);
        if (res.ok) {
          await admin.from("inbox_emails").update({ auto_registered: true }).eq("id", row.id);
          if (kind === "job") autoJobs++; else autoCandidates++;
        } else { errors++; }
      } catch { errors++; }
      continue;
    }
    // 閾値未満／kind 不明 → 人がレビュー
    needsReview++;
  }

  revalidatePath("/mailbox"); revalidatePath("/inbox");
  bustCounts();
  return { ok: true, synced, extracted, autoJobs, autoCandidates, needsReview, archived, errors };
}

// ────────────────────────────────────────────────────────
// メール送信（Xserver SMTP・差出人ドメイン選択可）
// ────────────────────────────────────────────────────────
export async function sendMailAction(input: {
  sender: "enger" | "8grp"; to: string; subject: string; text: string;
  html?: string | null;
  cc?: string | null; bcc?: string | null; replyTo?: string | null;
  relatedKind?: string | null; relatedId?: string | null;
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  // 送信は社内（管理者/エージェント）のみ
  const access = await currentAccess();
  const role = access?.role ?? "admin";
  if (role !== "admin" && role !== "agent") return { ok: false, error: "メール送信の権限がありません" };

  // 差出人表示名＝ログイン者の名前、返信先＝ログイン者のメール（明示指定があれば優先）。
  //   送信元アドレス自体は配信（SPF/DKIM）のため共有箱のまま。
  //   → 相手には「{ログイン者名} <共有箱>」と表示され、返信は本人に届く。
  const senderName = access?.name?.trim() || null;
  const replyTo = input.replyTo?.trim() || access?.email || null;

  const { sendMail } = await import("./mailer");
  const res = await sendMail({
    sender: input.sender, to: input.to, subject: input.subject, text: input.text,
    html: input.html || null,
    cc: input.cc, bcc: input.bcc, replyTo, fromNameOverride: senderName,
  });
  if (!res.ok) return { ok: false, error: res.error };

  // 送信ログを残す（列未整備でも送信自体は成功扱い）
  try {
    const admin = engerAdmin();
    await admin.from("mail_sent").insert({
      sender_key: input.sender, from_address: res.from, to_address: input.to,
      cc_address: input.cc || null, bcc_address: input.bcc || null,
      subject: input.subject, body: input.text, message_id: res.messageId,
      sent_by_email: access?.email ?? null, sent_by_name: access?.name ?? null,
      related_kind: input.relatedKind || null, related_id: input.relatedId || null,
    });
  } catch { /* ログ失敗は無視 */ }
  return { ok: true, messageId: res.messageId };
}

/** SMTP 接続テスト（管理者）。設定が正しいか本文を送らず確認。 */
export async function testSmtpAction(sender: "enger" | "8grp"): Promise<{ ok: boolean; error?: string }> {
  const access = await currentAccess();
  if ((access?.role ?? "admin") !== "admin") return { ok: false, error: "管理者のみ実行できます" };
  const { verifySmtp } = await import("./mailer");
  const r = await verifySmtp(sender);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}


// ────────────────────────────────────────────────────────
// KPI ダッシュボード: 週次目標の保存
// ────────────────────────────────────────────────────────
import type { Metric } from "./kpi";

export async function saveKpiTargets(input: {
  scope: "person" | "team";
  ownerEmail?: string | null;
  ownerName?: string | null;
  teamKey?: string | null;
  weekStart: string; // 'YYYY-MM-DD' (月曜)
  targets: Partial<Record<Metric, number>>;
}): Promise<{ ok: boolean; error?: string }> {
  const access = await currentAccess();
  if (!access) return { ok: false, error: "ログインが必要です" };
  if (input.scope === "team" && access.role !== "admin")
    return { ok: false, error: "チーム目標は管理者のみ設定できます" };
  if (input.scope === "person" && access.role !== "admin" && (input.ownerEmail ?? "") !== access.email)
    return { ok: false, error: "他人の目標は変更できません" };

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "DB 接続できません" }; }

  const metrics = Object.entries(input.targets).filter(([, v]) => typeof v === "number" && v >= 0);
  if (metrics.length === 0) return { ok: true };

  // 1週間×1対象×対象指標の既存行を一旦削除してから入れ直す（partial-unique を回避）。
  let del: any = admin.from("kpi_targets").delete()
    .eq("scope", input.scope).eq("week_start", input.weekStart)
    .in("metric", metrics.map(([m]) => m));
  if (input.scope === "person") del = del.eq("owner_email", input.ownerEmail ?? "");
  else                          del = del.eq("team_key", input.teamKey ?? "its");
  const dr = await del;
  if (dr.error) return { ok: false, error: dr.error.message };

  const rows = metrics.map(([metric, target]) => ({
    scope: input.scope,
    owner_email: input.scope === "person" ? (input.ownerEmail ?? "") : null,
    owner_name:  input.scope === "person" ? (input.ownerName  ?? null) : null,
    team_key:    input.scope === "team"   ? (input.teamKey    ?? "its") : null,
    week_start:  input.weekStart,
    metric,
    target: target as number,
    updated_at: new Date().toISOString(),
  }));
  const ir = await admin.from("kpi_targets").insert(rows);
  if (ir.error) return { ok: false, error: ir.error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

/** マッチング対象期間（鮮度ウィンドウ）の保存（admin限定）。 */
export async function saveMatchWindow(input: { enabled: boolean; days: number }): Promise<{ ok: boolean; error?: string }> {
  const access = await currentAccess();
  if (!access || access.role !== "admin") return { ok: false, error: "管理者のみ変更できます" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "DB 接続できません" }; }
  const days = Math.min(365, Math.max(1, Math.floor(Number(input.days) || 7)));
  const value = { enabled: !!input.enabled, days };
  const { MATCH_WINDOW_KEY } = await import("./match-window");
  const r: any = await admin.from("app_settings").upsert({ key: MATCH_WINDOW_KEY, value }, { onConflict: "key" });
  if (r.error) {
    if (/app_settings|relation|column/i.test(r.error.message)) return { ok: false, error: "app_settings テーブルが未整備です（supabase/app-settings.sql を実行してください）" };
    return { ok: false, error: r.error.message };
  }
  revalidatePath("/matching");
  revalidatePath("/settings");
  return { ok: true };
}

// ────────────────────────────────────────────────────────
// タイムカード（社内バイト/副業向け）
// ────────────────────────────────────────────────────────
//   ・月締めで申請（status: open → submitted）
//   ・マネージャー（自部署のみ）/ admin が承認・差し戻し
//
//   セキュリティ：操作は currentAccess() で本人 or 承認権を確認。
//   本人 = 自分の email、または admin/経営。承認 = admin/経営 または team_role が manager/leader で
//   かつエントリの department と自分の department が一致する場合。

type TimecardActionResult = { ok: true } | { ok: false; error: string };

async function timecardMe() {
  const me = await currentAccess();
  if (!me?.email) return null;
  return me;
}

function canApprove(me: { role: string; teamRole: string | null; department: string | null }, entryDept: string | null): boolean {
  if (me.role === "admin") return true;
  const isLead = me.teamRole === "manager" || me.teamRole === "leader";
  if (!isLead) return false;
  if (!me.department) return false;
  // department が空のエントリは「部署未設定の人」。マネージャーは触れない（adminのみ）。
  if (!entryDept) return false;
  return me.department === entryDept;
}

/** 本人または管理者がエントリを upsert（編集モーダルから）。 */
export async function upsertTimeEntry(input: {
  userEmail: string;          // 対象ユーザー（通常は本人）
  workDate: string;            // YYYY-MM-DD
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  breakMinutes?: number | null;
  note?: string | null;
  /** シフト外で働いた理由。承認済シフトと実績が異なるときに必要。 */
  deviationReason?: string | null;
}): Promise<TimecardActionResult> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  const isSelf = me.email.toLowerCase() === input.userEmail.toLowerCase();
  const isAdmin = me.role === "admin";
  if (!isSelf && !isAdmin) return { ok: false, error: "他のメンバーのタイムカードを編集する権限がありません" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) return { ok: false, error: "日付の形式が不正です" };

  // 既存行を取得（status と user_name/department のキャッシュ更新のため）
  const existing: any = await admin.from("time_entries").select("id, status, user_name, department")
    .eq("user_email", input.userEmail).eq("work_date", input.workDate).maybeSingle();
  // submitted/approved の編集はマネージャー（自部署）/admin のみ。本人は open/rejected のみ編集可。
  if (existing.data && !isAdmin) {
    const s = existing.data.status as string;
    if (s === "submitted" || s === "approved") {
      return { ok: false, error: "申請中・承認済の打刻は編集できません（管理者に差し戻しを依頼してください）" };
    }
  }

  // department は app_users から引く（初回作成時のキャッシュ）。失敗してもエントリ作成は続行。
  let department: string | null = existing.data?.department ?? null;
  let userName: string | null = existing.data?.user_name ?? null;
  if (!department || !userName) {
    try {
      const u: any = await admin.from("app_users").select("name, department").eq("email", input.userEmail).maybeSingle();
      if (!u.error && u.data) { department = department ?? (u.data.department ?? null); userName = userName ?? (u.data.name ?? null); }
    } catch { /* ignore */ }
  }

  const row: Record<string, any> = {
    user_email: input.userEmail,
    user_name: userName,
    department,
    work_date: input.workDate,
    updated_at: new Date().toISOString(),
  };
  // シフト（予定）：申請中/承認済のときは本人は予定を変更できない（admin のみ）。
  const shiftStatus = existing.data?.shift_status as string | null | undefined;
  const shiftLocked = !isAdmin && (shiftStatus === "submitted" || shiftStatus === "approved");
  if (shiftLocked && (input.plannedStart !== undefined || input.plannedEnd !== undefined)) {
    return { ok: false, error: "申請中・承認済のシフト（予定）は本人では編集できません（管理者に差戻しを依頼してください）" };
  }

  if (input.plannedStart !== undefined) row.planned_start = input.plannedStart || null;
  if (input.plannedEnd   !== undefined) row.planned_end   = input.plannedEnd   || null;
  if (input.actualStart  !== undefined) row.actual_start  = input.actualStart  || null;
  if (input.actualEnd    !== undefined) row.actual_end    = input.actualEnd    || null;
  if (input.breakMinutes !== undefined) row.break_minutes = Math.max(0, Math.floor(Number(input.breakMinutes) || 0));
  if (input.note         !== undefined) row.note          = (input.note ?? "").trim() || null;
  // シフト外で働いた理由（任意項目）。空文字は null として保存。
  if (input.deviationReason !== undefined) row.deviation_reason = (input.deviationReason ?? "").trim() || null;

  // rejected の行を編集したら open に戻す（再申請できるように）
  if (existing.data?.status === "rejected" && !isAdmin) row.status = "open";
  // 差し戻されたシフトを編集したら open に戻す
  if (shiftStatus === "rejected" && !isAdmin && (input.plannedStart !== undefined || input.plannedEnd !== undefined)) {
    row.shift_status = "open";
    row.shift_reject_reason = null;
  }

  let r: any = await admin.from("time_entries").upsert(row, { onConflict: "user_email,work_date" });
  // 旧スキーマ（shift_status / deviation_reason 列無し）は列ドロップで再試行
  if (r.error && /shift_status|deviation_reason|column/i.test(r.error.message)) {
    const { shift_status: _s, shift_reject_reason: _r, deviation_reason: _d, ...rest } = row;
    r = await admin.from("time_entries").upsert(rest, { onConflict: "user_email,work_date" });
  }
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true };
}

/** 出勤打刻（actual_start を今に）。同日に既にあれば上書きしない（上書きしたいときは編集モーダルから）。 */
export async function clockIn(userEmail?: string): Promise<TimecardActionResult> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  const target = (userEmail || me.email).toLowerCase();
  if (target !== me.email.toLowerCase() && me.role !== "admin") return { ok: false, error: "本人のみが打刻できます" };

  const now = new Date();
  const workDate = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const iso = now.toISOString();

  const existing: any = await admin.from("time_entries").select("id, actual_start, status")
    .eq("user_email", target).eq("work_date", workDate).maybeSingle();

  if (existing.data) {
    if (existing.data.actual_start) return { ok: false, error: "本日はすでに出勤打刻済みです" };
    const r: any = await admin.from("time_entries").update({ actual_start: iso, updated_at: iso }).eq("id", existing.data.id);
    if (r.error) return { ok: false, error: r.error.message };
  } else {
    // department/user_name を引いてキャッシュ
    let department: string | null = null, userName: string | null = null;
    try {
      const u: any = await admin.from("app_users").select("name, department").eq("email", target).maybeSingle();
      if (!u.error && u.data) { department = u.data.department ?? null; userName = u.data.name ?? null; }
    } catch { /* ignore */ }
    const r: any = await admin.from("time_entries").insert({
      user_email: target, user_name: userName, department,
      work_date: workDate, actual_start: iso, created_at: iso, updated_at: iso,
    });
    if (r.error) return { ok: false, error: r.error.message };
  }
  revalidatePath("/timecard");
  return { ok: true };
}

/** 退勤打刻。 */
export async function clockOut(userEmail?: string): Promise<TimecardActionResult> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  const target = (userEmail || me.email).toLowerCase();
  if (target !== me.email.toLowerCase() && me.role !== "admin") return { ok: false, error: "本人のみが打刻できます" };

  const now = new Date();
  const workDate = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const iso = now.toISOString();
  const existing: any = await admin.from("time_entries").select("id, actual_start, actual_end")
    .eq("user_email", target).eq("work_date", workDate).maybeSingle();
  if (!existing.data || !existing.data.actual_start) return { ok: false, error: "先に出勤打刻してください" };
  if (existing.data.actual_end) return { ok: false, error: "本日はすでに退勤打刻済みです" };
  const r: any = await admin.from("time_entries").update({ actual_end: iso, updated_at: iso }).eq("id", existing.data.id);
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true };
}

/** 月締め申請：当月の open エントリをすべて submitted に。 */
export async function submitMonthForApproval(userEmail: string, ym: string): Promise<TimecardActionResult & { count?: number }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  if (me.email.toLowerCase() !== userEmail.toLowerCase() && me.role !== "admin") return { ok: false, error: "本人のみが申請できます" };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, error: "対象月の形式が不正です" };

  const [y, m] = ym.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;

  // シフト外で働いた日（承認済シフトと実績がずれている日）に deviation_reason が
  // 空のものがあれば、月締申請をブロックして本人に修正を促す。
  // shift_status / deviation_reason 列が未マイグレ環境ではチェックをスキップ。
  try {
    const monthRows: any = await admin.from("time_entries")
      .select("work_date, shift_status, planned_start, planned_end, actual_start, actual_end, deviation_reason")
      .eq("user_email", userEmail).gte("work_date", start).lt("work_date", end);
    if (!monthRows.error) {
      const { deviatesFromShift } = await import("./timecard");
      const missing: string[] = [];
      for (const e of (monthRows.data ?? []) as any[]) {
        if (deviatesFromShift(e) && !(e.deviation_reason ?? "").trim()) missing.push(e.work_date);
      }
      if (missing.length > 0) {
        return { ok: false, error: `シフト外で働いた日に理由が未入力です（${missing.length}日）。先頭：${missing[0]}。各日の編集画面で「シフト外で働いた理由」を入力してください。` };
      }
    }
  } catch { /* 列未追加環境では握りつぶす */ }

  const r: any = await admin.from("time_entries").update({ status: "submitted", updated_at: new Date().toISOString() })
    .eq("user_email", userEmail).gte("work_date", start).lt("work_date", end).in("status", ["open", "rejected"]).select("id");
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true, count: (r.data ?? []).length };
}

/** 承認（マネージャー/admin が submitted のエントリを approved に）。複数IDをまとめて。 */
export async function approveTimeEntries(ids: string[]): Promise<TimecardActionResult & { count?: number }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  if (!ids.length) return { ok: true, count: 0 };

  // 取得して権限チェック（自部署のみ）。
  const list: any = await admin.from("time_entries").select("id, department, status").in("id", ids);
  if (list.error) return { ok: false, error: list.error.message };
  const targets: string[] = [];
  for (const row of (list.data ?? []) as any[]) {
    if (row.status !== "submitted") continue;
    if (!canApprove(me as any, row.department ?? null)) continue;
    targets.push(row.id);
  }
  if (!targets.length) return { ok: false, error: "承認可能な対象がありません（権限・状態を確認）" };
  const r: any = await admin.from("time_entries").update({
    status: "approved", approver_email: me.email, approver_name: me.name ?? null,
    approved_at: new Date().toISOString(), reject_reason: null, updated_at: new Date().toISOString(),
  }).in("id", targets);
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true, count: targets.length };
}

/** 差し戻し。reason 必須。 */
export async function rejectTimeEntries(ids: string[], reason: string): Promise<TimecardActionResult & { count?: number }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  if (!ids.length) return { ok: true, count: 0 };
  const r0 = (reason ?? "").trim();
  if (!r0) return { ok: false, error: "差し戻し理由を入力してください" };

  const list: any = await admin.from("time_entries").select("id, department, status").in("id", ids);
  if (list.error) return { ok: false, error: list.error.message };
  const targets: string[] = [];
  for (const row of (list.data ?? []) as any[]) {
    if (row.status !== "submitted") continue;
    if (!canApprove(me as any, row.department ?? null)) continue;
    targets.push(row.id);
  }
  if (!targets.length) return { ok: false, error: "差し戻し可能な対象がありません" };
  const r: any = await admin.from("time_entries").update({
    status: "rejected", approver_email: me.email, approver_name: me.name ?? null,
    approved_at: null, reject_reason: r0, updated_at: new Date().toISOString(),
  }).in("id", targets);
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true, count: targets.length };
}

// ── シフト申請（予定）の承認フロー ───────────────────────────────
//   1) 本人がシフト申請タブで planned_start/end を入力
//   2) submitShiftForApproval で当月の予定だけある行を shift_status='submitted' に
//   3) approveShifts / rejectShifts でマネージャー/admin が承認・差戻し

/** 当月のシフト（予定）を一括で申請する。planned_start/end が入っている行のみ対象。 */
export async function submitShiftForApproval(userEmail: string, ym: string): Promise<TimecardActionResult & { count?: number }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  if (me.email.toLowerCase() !== userEmail.toLowerCase() && me.role !== "admin") return { ok: false, error: "本人のみが申請できます" };
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, error: "対象月の形式が不正です" };

  const [y, m] = ym.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;
  const now = new Date().toISOString();
  // open/rejected かつ planned 両方そろっている日を submitted へ。
  let r: any = await admin.from("time_entries").update({
    shift_status: "submitted", shift_submitted_at: now, shift_reject_reason: null, updated_at: now,
  })
    .eq("user_email", userEmail).gte("work_date", start).lt("work_date", end)
    .in("shift_status", ["open", "rejected"])
    .not("planned_start", "is", null).not("planned_end", "is", null)
    .select("id");
  if (r.error && /shift_status|shift_submitted_at|column/i.test(r.error.message)) {
    return { ok: false, error: "シフト申請の列が未追加です。supabase/timecard-shift.sql を実行してください。" };
  }
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true, count: (r.data ?? []).length };
}

/** シフト申請の承認（マネージャー/admin）。 */
export async function approveShifts(ids: string[]): Promise<TimecardActionResult & { count?: number }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  if (!ids.length) return { ok: true, count: 0 };
  const list: any = await admin.from("time_entries").select("id, department, shift_status").in("id", ids);
  if (list.error) return { ok: false, error: list.error.message };
  const targets: string[] = [];
  for (const row of (list.data ?? []) as any[]) {
    if (row.shift_status !== "submitted") continue;
    if (!canApprove(me as any, row.department ?? null)) continue;
    targets.push(row.id);
  }
  if (!targets.length) return { ok: false, error: "承認可能なシフトがありません（権限・状態を確認）" };
  const now = new Date().toISOString();
  const r: any = await admin.from("time_entries").update({
    shift_status: "approved", shift_approved_at: now,
    shift_approver_email: me.email, shift_approver_name: me.name ?? null,
    shift_reject_reason: null, updated_at: now,
  }).in("id", targets);
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true, count: targets.length };
}

/** シフトを差し戻し。 */
export async function rejectShifts(ids: string[], reason: string): Promise<TimecardActionResult & { count?: number }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me) return { ok: false, error: "未ログインです" };
  if (!ids.length) return { ok: true, count: 0 };
  const r0 = (reason ?? "").trim();
  if (!r0) return { ok: false, error: "差戻し理由を入力してください" };

  const list: any = await admin.from("time_entries").select("id, department, shift_status").in("id", ids);
  if (list.error) return { ok: false, error: list.error.message };
  const targets: string[] = [];
  for (const row of (list.data ?? []) as any[]) {
    if (row.shift_status !== "submitted") continue;
    if (!canApprove(me as any, row.department ?? null)) continue;
    targets.push(row.id);
  }
  if (!targets.length) return { ok: false, error: "差戻し可能なシフトがありません" };
  const now = new Date().toISOString();
  const r: any = await admin.from("time_entries").update({
    shift_status: "rejected", shift_reject_reason: r0,
    shift_approver_email: me.email, shift_approver_name: me.name ?? null,
    shift_approved_at: null, updated_at: now,
  }).in("id", targets);
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/timecard");
  return { ok: true, count: targets.length };
}

/** タイムカード対象ユーザーの ON/OFF を切り替え（設定画面・admin限定）。 */
export async function setTimecardEnabled(email: string, enabled: boolean): Promise<TimecardActionResult> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await timecardMe();
  if (!me || me.role !== "admin") return { ok: false, error: "管理者のみ変更できます" };
  const r: any = await admin.from("app_users").update({ is_timecard_user: enabled }).eq("email", email);
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/settings");
  return { ok: true };
}
