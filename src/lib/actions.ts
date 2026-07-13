"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { randomBytes } from "crypto";
import { Buffer } from "node:buffer";
import { engerAdmin, publicAdmin } from "./supabase";
import { currentAccess } from "./accounts";
import { canSeeMargin } from "./engagement-access";
import { partnerOwnerCompany } from "./tenant";
import { normalizeSkills } from "./skills";
import { analyzeSkillSheet, driveConfigured } from "./skill-sheet";
import { gmailMessageUrl } from "./gmail";
import { logActivity, logProposalActivity } from "./activity-logs";
import {
  bustCounts, bustRankingCaches, notify, notifyMany, fetchJobForProposal, fetchCandidateForProposal,
  listApproverNames, initialsOf, normKey,
} from "./actions/_shared";
import { callLLM, parseJsonLoose } from "./llm";
import { logUsage } from "./ai-usage";
import { LOST_REASONS, LOST_PHASES } from "./proposal-constants";

export type CandidateInput = {
  code?: string | null;
  name: string;
  title?: string | null;
  company?: string | null;
  affiliation?: string | null;
  skills?: string[];
  tools?: string[];                // 使用経験のあるツール・開発環境（#325）
  rate?: string | null;
  rate_num?: number | null;
  avail?: string | null;
  location?: string | null;        // 最寄駅
  residence?: string | null;       // 居住地（最寄駅とは別。#330④）
  exp?: string | null;
  status?: string | null;
  remote_pref?: string | null;     // リモート希望（マッチングのリモート評価に使用）
  age_band?: string | null;        // 年齢層
  nationality?: string | null;     // 国籍
  rank?: string | null;            // ランク（A/B/C 等）— 人材一覧の絞り込み・モーダルに表示
  skill_level?: string | null;     // スキルレベル
  japanese_level?: string | null;  // 日本語レベル
  comm?: string | null;            // コミュニケーション力
  note?: string | null;            // メール原文（旧「備考」。#347④）
  detail_note?: string | null;     // 人材詳細（メール原文とは別の整形メモ。#347⑤）
  skill_sheet_url?: string | null;
  email?: string | null;          // 人材本人の連絡先（あれば）
  contact_email?: string | null;  // 所属(SES)窓口＝元メールの送信元
  contact_name?: string | null;   // 窓口担当者名（SES窓口・エージェント担当者）。jobs.contact_name と対称。
  source_mail_url?: string | null; // 元メール(Gmail)へのURL
  source_mail_subject?: string | null; // 元メール件名（メール送信時の Re: 件名生成・返信スレッド統合に利用）
  source_mail_at?: string | null;  // 元メール受信日時（最新メールを元メールに残すための比較用）
  operator?: string | null;        // 登録担当（KPI集計用・新規登録時のみ記録）
  signup_source?: string | null;   // 登録経路（"line" 等）。LINE登録チェックON時に "line"。
};

/** 人材CSVの取り込み (service role)。バッチで insert。 */
export async function importCandidates(records: CandidateInput[], sourceLabel: string, operator?: string | null, opts?: { mergeByName?: boolean; overwrite?: boolean }) {
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
      residence: (r as any).residence?.trim() || null, // #347/#330：居住地
      exp: r.exp?.trim() || null,
      status: r.status?.trim() || "提案可",
      remote_pref: r.remote_pref?.trim() || null,
      age_band: r.age_band?.trim() || null,
      nationality: r.nationality?.trim() || null,
      rank: (r as any).rank?.trim() || null, // #347：CSVの「ランク」列を取り込む
      skill_level: r.skill_level?.trim() || null,
      japanese_level: r.japanese_level?.trim() || null,
      comm: r.comm?.trim() || null,
      note: r.note?.trim() || null,                      // #347④：メール原文（旧「備考」）
      detail_note: (r as any).detail_note?.trim() || null, // #347⑤：人材詳細
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
    const FILL = ["title", "company", "source_company", "affiliation", "rate", "rate_num", "avail", "location", "residence", "exp", "remote_pref", "age_band", "nationality", "skill_level", "japanese_level", "comm", "note", "detail_note", "skill_sheet_url", "email", "contact_email", "source_mail_url", "operator"];
    for (const r of rows) {
      const nk = normKey(r.name);
      const ex = nk ? byName.get(nk) : null;
      if (!ex || !ex.id) { stillFresh.push(r); continue; }
      const merged: Record<string, any> = { ...ex, imported_at: now };
      for (const f of FILL) {
        const cur = (ex as any)[f];
        const nv = (r as any)[f];
        // overwrite=true：CSVに値があれば既存を上書き（正しい情報で更新）。
        // overwrite=false：既存が空のときだけ補完。
        if (nv != null && nv !== "" && (opts?.overwrite || cur == null || cur === "")) merged[f] = nv;
      }
      const curSkills: string[] = Array.isArray(ex.skills) ? ex.skills : [];
      const newSkills: string[] = Array.isArray(r.skills) ? r.skills : [];
      if (opts?.overwrite && newSkills.length > 0) {
        // 上書き：CSVのスキルを正とする（既存分も足して取りこぼし防止のため和集合）。
        merged.skills = Array.from(new Set([...newSkills, ...curSkills]));
      } else {
        const union = Array.from(new Set([...curSkills, ...newSkills]));
        if (union.length !== curSkills.length) merged.skills = union;
      }
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
          const stripped = slice.map((b) => { const o: any = { ...b }; for (const k of ["remote_pref", "age_band", "nationality", "skill_level", "japanese_level", "comm", "note", "detail_note", "residence", "skill_sheet_url", "email", "contact_email", "source_mail_url", "operator", "source_company"]) delete o[k]; return o; });
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
    if (error && /skill_sheet_url|email|source_mail_url|source_company|remote_pref|age_band|nationality|skill_level|japanese_level|comm|note|detail_note|residence|operator|column/i.test(error.message)) {
      const stripped = batch.map((b) => { const o: any = { ...b }; for (const k of ["skill_sheet_url", "email", "contact_email", "source_mail_url", "source_company", "remote_pref", "age_band", "nationality", "skill_level", "japanese_level", "comm", "note", "detail_note", "residence", "operator"]) delete o[k]; return o; });
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
  // 注力ONにする時は登録日時(focused_at)を now() で更新する（#316③：一覧に注力登録日を表示。
  //   一度外して再度ONにした時は最新日で上書き）。focused_at 列が未整備な環境では fail-soft でフラグのみ更新。
  const patch: Record<string, unknown> = { is_focus: value };
  if (value) patch.focused_at = new Date().toISOString();
  let { error } = await admin.from(table).update(patch).eq(idField, idValue);
  if (error && /focused_at/.test(error.message)) {
    ({ error } = await admin.from(table).update({ is_focus: value }).eq(idField, idValue));
  }
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
  // 注力ONの一括操作でも登録日時を now() で更新（#316③）。列未整備時は fail-soft でフラグのみ。
  const patch: Record<string, unknown> = { is_focus: value };
  if (value) patch.focused_at = new Date().toISOString();
  let { error } = await admin.from(table).update(patch).in(idField, idValues);
  if (error && /focused_at/.test(error.message)) {
    ({ error } = await admin.from(table).update({ is_focus: value }).in(idField, idValues));
  }
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
  // #327：クローズ解除（value=false）のときは、理由付きクローズ(closeProposalEntity)が付けた
  //   closed_at/closed_reason/closed_by も掃除して整合させる（列未整備の環境では is_closed のみ更新へフォールバック）。
  const patch: Record<string, unknown> = value ? { is_closed: true } : { is_closed: false, closed_at: null, closed_reason: null, closed_by: null };
  let { error } = await admin.from(table).update(patch).in(idField, idValues);
  if (error && /closed_at|closed_reason|closed_by|column/i.test(error.message)) {
    ({ error } = await admin.from(table).update({ is_closed: value }).in(idField, idValues));
  }
  if (error) {
    if (/is_closed|column/i.test(error.message)) return { ok: false, updated: 0, error: "クローズ用カラム未整備です。supabase/closed-flag.sql を実行してください。" };
    return { ok: false, updated: 0, error: error.message };
  }
  if (revalidate) revalidatePath(revalidate);
  bustCounts();
  return { ok: true, updated: idValues.length };
}

/** 提案詳細からの「案件/人材クローズ」。理由は必須。会社評価（取引注意）に連動できる。
 *   ・is_closed=true（一覧の初期表示から外し、マッチング対象外に）＋ closed_reason 等を保存。
 *   ・caution=true かつ company 指定があれば、その会社を「取引注意」にして理由を記録。
 *   ・追加列が未整備の環境では is_closed のみ更新（fail-soft）。 */
export async function closeProposalEntity(input: {
  table: "jobs" | "candidates";
  id: number;                 // job_no または candidate_no
  reason: string;             // 必須（選択式）
  note?: string | null;       // 自由記述（任意）
  company?: string | null;    // 取引注意を立てる会社名（任意）
  caution?: boolean;          // true なら company を取引注意に加点
  proposalId?: string | null; // メモ履歴に自動追記する対象提案
  sideLabel?: string;         // 「案件」or「人材」（メモ文言用）
}): Promise<{ ok: boolean; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!input.id) return { ok: false, error: "対象（案件No/人材No）が未指定です" };
  const reason = (input.reason ?? "").trim();
  if (!reason) return { ok: false, error: "クローズ理由を入力してください" };
  const note = (input.note ?? "").trim();
  const reasonFull = note ? `${reason}（${note}）` : reason;
  const access = await currentAccess();
  const by = access?.name ?? access?.email ?? null;
  const idField = input.table === "jobs" ? "job_no" : "candidate_no";
  const nowIso = new Date().toISOString();
  // is_closed + 理由を保存。理由列が無い環境では is_closed のみで再試行。
  let { error } = await admin.from(input.table).update({ is_closed: true, closed_reason: reasonFull, closed_at: nowIso, closed_by: by }).eq(idField, input.id);
  if (error && /closed_reason|closed_at|closed_by|column/i.test(error.message)) {
    ({ error } = await admin.from(input.table).update({ is_closed: true }).eq(idField, input.id));
  }
  if (error) {
    if (/is_closed|column/i.test(error.message)) return { ok: false, error: "クローズ用カラム未整備です。supabase/closed-flag.sql と close-reason-caution.sql を実行してください。" };
    return { ok: false, error: error.message };
  }
  // 会社評価（取引注意）に連動：caution_count を加点（会社/人材会社起因のとき）。
  if (input.caution && input.company && input.company.trim()) {
    try {
      const nm = input.company.trim();
      const cur: any = await admin.from("companies").select("caution_count").eq("name", nm).maybeSingle();
      const nextCount = (Number(cur?.data?.caution_count) || 0) + 1;
      let r = await admin.from("companies").upsert(
        { name: nm, caution: true, caution_count: nextCount, caution_reason: reasonFull, caution_at: nowIso, caution_by: by },
        { onConflict: "name" },
      );
      // caution_count 列が無い環境は count 無しで再試行、それも無ければスキップ。
      if (r.error && /caution_count/i.test(r.error.message)) {
        r = await admin.from("companies").upsert({ name: nm, caution: true, caution_reason: reasonFull, caution_at: nowIso, caution_by: by }, { onConflict: "name" });
      }
      if (r.error && /caution|column/i.test(r.error.message)) { /* 列未整備はスキップ */ }
    } catch { /* noop */ }
  }
  // メモ履歴に自動追記（例：「【自動記録】案件クローズ：理由◯◯（担当△△）」）。失敗してもクローズは成立。
  if (input.proposalId) {
    try {
      const label = input.sideLabel || (input.table === "jobs" ? "案件" : "人材");
      const memoCat = input.table === "jobs" ? "当社→案件側" : "当社→人材側";
      await addProposalMemo(input.proposalId, memoCat, `【自動記録】${label}クローズ：${reasonFull}（担当 ${by ?? "—"}）`);
    } catch { /* noop */ }
  }
  revalidatePath("/proposals");
  bustCounts();
  return { ok: true };
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
// #234②：「提案中」以降に入ったとみなすステージ（proposed_at を初回記録する対象）。新旧ステージ名を吸収。
const PROPOSED_REACHED_STAGES = new Set([
  "提案中", "確認中", "面談", "合格", "稼働", "稼働決定",
  "提案済", "返信待ち", "返信あり", "面談調整", "クロージング中", "面談合格",
]);

// #333：提案管理の該当マッチングレコードをモーダルで開くための単体取得。
//   /proposals?open=<id> のディープリンクから、ボードに載っていない（見送り/稼働等の）レコードも
//   開けるようにする。案件/人材の番号・クローズ状態も併せて解決してモーダル表示に足る形で返す。
export async function getProposalForModal(id: string) {
  if (!id) return null;
  // 社内(admin/agent/manager/leader)のみ。テナント(client/partner/freelance)には返さない。
  const me = await currentAccess();
  if (!me || ["client", "partner", "freelance"].includes(String(me.role))) return null;
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return null; }
  const pr: any = await admin.from("proposals").select("*").eq("id", id).maybeSingle();
  if (pr.error || !pr.data) return null;
  const p = pr.data as Record<string, any>;
  if (p.job_id) {
    const jr: any = await admin.from("jobs").select("job_no, is_closed").eq("id", p.job_id).maybeSingle();
    if (jr.data) { p.job_no = jr.data.job_no; p.job_closed = jr.data.is_closed; }
  }
  if (p.candidate_id) {
    const cr: any = await admin.from("candidates").select("candidate_no, is_closed, initials, source_company, company").eq("id", p.candidate_id).maybeSingle();
    if (cr.data) { p.candidate_no = cr.data.candidate_no; p.cand_closed = cr.data.is_closed; p.c_init = cr.data.initials; }
  }
  return p;
}

export async function updateProposalFields(id: string, fields: Record<string, any>) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  // 見送り（失注）確定時は「会社名・先方担当者」を必須にする（誰が・どの会社かを失注記録に残す）。UIでも必須化済みの最終防衛線。
  if ("stage" in fields && (String(fields.stage) === "見送り" || String(fields.stage) === "失注")) {
    if (!String(fields.company ?? "").trim() || !String(fields.client_contact ?? "").trim()) {
      return { ok: false, error: "見送りには会社名・先方担当者が必須です" };
    }
  }
  const allowed = ["caller_status", "proposer", "partner", "closer", "client_contact", "lost_reason", "lost_phase", "lost_reason_note", "next_action", "stage", "meeting_date", "meeting_status", "meeting_time", "meeting_format", "meeting_url", "meeting_attendees", "meeting_note", "company", "source", "job_notify_status", "cand_notify_status",
    // 案件側 企業担当 / 人材側 会社名・企業担当・先方担当（proposals-contacts.sql）
    "company_contact", "cand_company", "cand_company_contact", "cand_contact",
    // 失注時の★評価（proposals-lost-rating-delete.sql）
    "cand_rating", "job_rating",
    // #291：見送り/失注になる直前のステージ（proposals-pre-lost-stage.sql）。「提案ボードに戻す」で復元に使う。
    "pre_lost_stage",
    // #334①：進捗状況（返事待ちの別・未処理）＋その最終更新日（proposals-progress-status.sql）。
    "progress_status", "progress_updated_at"];
  // 上記のうち proposals-contacts.sql / proposals-lost-rating-delete.sql / proposals-pre-lost-stage.sql /
  // proposals-progress-status.sql 未適用の環境で存在しない可能性がある列。書込みで
  // 「column ... does not exist」になったら列を外して再試行する。
  const optionalCols = ["company_contact", "cand_company", "cand_company_contact", "cand_contact", "cand_rating", "job_rating", "pre_lost_stage", "progress_status", "progress_updated_at"];
  const now = new Date().toISOString();
  const patch: Record<string, any> = { updated_at: now };
  for (const k of allowed) if (k in fields) patch[k] = fields[k];
  // ステージが変わるときは滞留日数・失注日の起点となる stage_updated_at も更新する。
  if ("stage" in fields) patch.stage_updated_at = now;
  // 失注/見送り 以外のステージへ移すときは、明示的に lost_reason 等を指定していなければ
  // 自動でクリアする。失注 → 提案中 へ戻したのに古い lost_reason が残って「失注分析」に
  // 誤って表示される問題への対処（updateProposalStage と同じ運用ルール）。
  if ("stage" in fields) {
    const newStage = String(fields.stage ?? "");
    const isLostStage = newStage === "見送り" || newStage === "失注";
    if (!isLostStage) {
      if (!("lost_reason" in fields))      patch.lost_reason      = null;
      if (!("lost_phase" in fields))       patch.lost_phase       = null;
      if (!("lost_reason_note" in fields)) patch.lost_reason_note = null;
      // 失注時の★評価も、失注以外へ戻すときはクリア（失注分析に誤って残らないように）。
      if (!("cand_rating" in fields))      patch.cand_rating      = null;
      if (!("job_rating" in fields))       patch.job_rating       = null;
      // #291：見送り直前ステージも、失注以外へ移したら不要になるためクリア（restoreProposalFromLost が
      //   明示的に pre_lost_stage:null を渡す場合はそちらを優先＝上書きしない）。
      if (!("pre_lost_stage" in fields))   patch.pre_lost_stage   = null;
    }
  }
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
  // 連絡先の追加列（proposals-contacts.sql 未適用）が無い環境では、その列を外して再試行。
  if (error && /column/i.test(error.message) && optionalCols.some((c) => c in patch)) {
    const rest: Record<string, any> = { ...patch };
    for (const c of optionalCols) delete rest[c];
    ({ error } = await admin.from("proposals").update(rest).eq("id", id));
  }
  if (error) return { ok: false, error: error.message };

  // #234②：「提案中」以降に入った時、提案到達日時を初回のみ記録（累計集計「提案中」列のソース）。
  //   ※ 既に値があれば上書きしない（is null）。列未整備の環境では握りつぶす。
  if ("stage" in fields && PROPOSED_REACHED_STAGES.has(String(fields.stage ?? ""))) {
    try { await admin.from("proposals").update({ proposed_at: now }).eq("id", id).is("proposed_at", null); }
    catch { /* proposed_at 列が無い環境はスキップ */ }
  }

  // 会社名が入力されていれば企業マスタへ紐づけ（窓口担当=企業担当 / 自社担当=closer）。
  // 企業管理(/companies) でも「その会社の誰が担当か」を一元で確認できるようにする。
  //   ・案件側：company（クライアント名）＋ company_contact（企業担当＝窓口担当者）
  //   ・人材側：cand_company（所属会社）＋ cand_company_contact（企業担当＝窓口担当者）
  const syncCompanyContact = async (name?: any, contact?: any, owner?: any) => {
    const nm = typeof name === "string" ? name.trim() : "";
    if (!nm) return;
    const crow: Record<string, any> = { name: nm };
    if (typeof contact === "string" && contact.trim()) crow.contact_name = contact.trim();
    if (typeof owner === "string" && owner.trim()) crow.owner_staff = owner.trim();
    try {
      const r = await admin.from("companies").upsert(crow, { onConflict: "name" });
      if (r.error && /column|owner_staff|contact_name/i.test(r.error.message)) {
        await admin.from("companies").upsert({ name: nm }, { onConflict: "name" });
      }
    } catch { /* companies 未整備でも提案更新は成功させる */ }
  };
  if ((typeof fields.company === "string" && fields.company.trim()) || (typeof fields.cand_company === "string" && fields.cand_company.trim())) {
    await syncCompanyContact(fields.company, fields.company_contact, fields.closer);
    await syncCompanyContact(fields.cand_company, fields.cand_company_contact, undefined);
    revalidatePath("/companies");
  }

  revalidatePath("/proposals");
  revalidatePath("/analytics");
  bustCounts();
  const changedKeys = allowed.filter((k) => k in fields);
  await logProposalActivity(id, "提案を編集", changedKeys.length ? `変更項目：${changedKeys.join(", ")}` : null);
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
  // 案件・人材は独立クエリなので並列取得（旧環境向けの列フォールバックはヘルパ内に集約）。
  const [job, cand]: [any, any] = await Promise.all([
    fetchJobForProposal(admin, jobNo),
    fetchCandidateForProposal(admin, candNo),
  ]);
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
    const dupId = dups[0].id;
    const nowIso = new Date().toISOString();
    const approverNameDup = (approver ?? "").trim();
    // 提案者名・権限を解決（再申請時の承認状態リセットに使う）。
    let proposerNameDup = (proposer ?? "").trim() || null;
    let privDup = false;
    try {
      const me = await currentAccess();
      if (me) {
        if (!proposerNameDup) proposerNameDup = (me.name ?? "").trim() || null;
        const { canManageDept } = await import("./roles");
        privDup = me.role === "admin" || canManageDept(me.teamRole ?? null);
      }
    } catch { /* 未ログインでも続行 */ }

    const upd: Record<string, any> = { updated_at: nowIso };
    // 既存提案に最新メールのトークン／回答リセットを反映（リンク切れ・旧回答残り対策）。
    if (hasMailTokens) {
      upd.job_action_token = job_action_token; upd.cand_action_token = cand_action_token;
      upd.job_action_type = "未回答"; upd.cand_action_type = "未回答";
    }
    if (pendingMail) upd.pending_mail = pendingMail; // 承認者送信用の最新下書き
    // 承認の再申請：差戻し(rejected)/承認待ちを「pending」へ戻し、承認者を更新。
    //   これが無いと差戻し後に修正・再申請しても rejected のままで承認ボタンが押せない。
    let isReRequest = false;
    if (!privDup && approverNameDup) {
      upd.approval_status = "pending"; upd.approved_at = null; upd.reject_reason = null;
      upd.approver = approverNameDup; upd.stage = "承認待ち"; upd.stage_updated_at = nowIso;
      isReRequest = true;
    } else if (privDup && !approverNameDup) {
      // 権限者の直接送信：承認済み・所属確認へ。
      upd.approval_status = "approved"; upd.reject_reason = null;
      upd.stage = "所属確認"; upd.stage_updated_at = nowIso; upd.approved_at = nowIso;
    }
    try {
      let r: any = await admin.from("proposals").update(upd).eq("id", dupId);
      if (r.error && /pending_mail|approval_status|approved_at|reject_reason|approver|stage_updated_at|column/i.test(r.error.message)) {
        // 承認系/下書き/滞留列が未整備の旧環境ではトークン更新だけにフォールバック。
        const safe: Record<string, any> = { updated_at: nowIso };
        if (hasMailTokens) { safe.job_action_token = job_action_token; safe.cand_action_token = cand_action_token; safe.job_action_type = "未回答"; safe.cand_action_type = "未回答"; }
        await admin.from("proposals").update(safe).eq("id", dupId);
      }
    } catch { /* token列が未整備でも既存返却は続行 */ }

    // 再申請なら承認者（指名＋承認権限者全員）へ通知。
    if (isReRequest) {
      const who = [job.title, cand.name].filter(Boolean).join(" × ");
      const recipients = new Set<string>();
      if (approverNameDup) recipients.add(approverNameDup);
      for (const n of await listApproverNames()) recipients.add(n);
      if (proposerNameDup) recipients.delete(proposerNameDup);
      const body = `${proposerNameDup ?? "担当者"} さんが内容を修正して再申請しました${who ? `：${who}` : ""}。\n提案管理の「承認」タブで確認し、承認のうえメールを送信してください。`;
      await notifyMany(recipients, "提案の承認依頼（再申請）", body, "approval");
    }

    revalidatePath("/proposals");
    revalidatePath("/matching");
    bustRankingCaches(); // 提案済みペアをおすすめ/ランキングから即時に外す
    bustCounts();
    return { ok: true, id: dupId, existed: true };
  }

  // ※ 以前ここで「打合せ未実施の企業への提案ゲート」を掛け、非権限ユーザー（=承認依頼を出す
  //   メンバー）が打合せ記録の無い企業へ提案できないようにしていた。
  //   しかし承認フローでは、承認者（管理者/マネージャー）が送信前に必ず内容をレビューするため、
  //   この時点でブロックすると「打合せ未登録の案件には承認依頼すら出せない（=1件しか送れない）」
  //   状態になり、複数件の承認依頼が出せなかった。
  //   → 承認依頼の段階ではゲートを掛けず、レビュー（承認）を実質的なゲートとする。
  //   （直接送信できる権限者は元々このゲート対象外。）

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

  // 担当者（提案者）は必須（UIでも必須化済み。ここは最終防衛線）。
  if (!proposerName) return { ok: false, error: "担当者（提案者）を選択してください" };

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
  // 承認依頼を通知（権限者は承認不要なのでスキップ）。
  //   指定された承認者に加え、承認権限を持つ全員（admin/経営/マネージャー/リーダー）へ送る。
  //   ＝「指名された承認者1名にしか届かない／氏名不一致で誰にも届かない」取りこぼしを防ぐ。
  if (!proposerIsPrivileged) {
    const who = [job.title, cand.name].filter(Boolean).join(" × ");
    const recipients = new Set<string>();
    if (approverName) recipients.add(approverName);
    for (const n of await listApproverNames()) recipients.add(n);
    if (proposerName) recipients.delete(proposerName); // 自分自身には通知しない
    const body = `${proposerName ?? "担当者"} さんから承認待ちの提案があります${who ? `：${who}` : ""}。\n提案管理の「承認」タブで内容を確認し、承認のうえメールを送信してください。`;
    await notifyMany(recipients, "提案の承認依頼", body, "approval");
  }
  revalidatePath("/proposals");
  revalidatePath("/matching");
  bustRankingCaches(); // 提案済みペアをおすすめ/ランキングから即時に外す
  bustCounts();
  return { ok: true, id: data.id, existed: false, job_action_token, cand_action_token };
}

/** 提案を「記録」する（承認・メール送信なし）。
 *   目的：どの案件にどの人材を提案したかを失わないため／アウトサイドへトスアップするため。
 *   - 承認者は不要。すぐにボード（所属確認）に載せる。approval_status は approved 扱い（承認フローを通さない記録）。
 *   - メールは送らない。後から提案管理 or マッチング画面のメール送信で送付できる。
 *   - 重複（同一 job×candidate）は既存を返す（冪等）。 */
export async function recordProposal(jobNo: number, candNo: number, score?: number, proposer?: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  // job / candidate の解決（独立クエリなので並列化）
  const [job, cand]: [any, any] = await Promise.all([
    fetchJobForProposal(admin, jobNo),
    fetchCandidateForProposal(admin, candNo),
  ]);
  if (!job?.id || !cand?.id) return { ok: false, error: "案件または人材が見つかりません" };

  // 重複チェック（冪等）。既存の場合は保存済みトークンも返す（後段のメール作成で再利用するため）。
  //   旧データで token が NULL のケースは、ここで生成して DB に保存する（self-healing）。
  //   そうしないとメール本文のリンクと DB の token が一致せず「リンク切れ」になる。
  const { data: dups } = await admin.from("proposals").select("id, job_action_token, cand_action_token").eq("job_id", job.id).eq("candidate_id", cand.id).limit(1);
  if (dups && dups.length > 0) {
    let jobTok = (dups[0] as any).job_action_token ?? null;
    let candTok = (dups[0] as any).cand_action_token ?? null;
    if (!jobTok || !candTok) {
      const upd: Record<string, any> = { updated_at: new Date().toISOString() };
      if (!jobTok)  { jobTok  = randomBytes(24).toString("hex"); upd.job_action_token  = jobTok;  upd.job_action_type  = "未回答"; }
      if (!candTok) { candTok = randomBytes(24).toString("hex"); upd.cand_action_token = candTok; upd.cand_action_type = "未回答"; }
      try { await admin.from("proposals").update(upd).eq("id", dups[0].id); } catch { /* 列未整備でも fail-soft */ }
    }
    revalidatePath("/proposals"); revalidatePath("/matching"); bustRankingCaches(); bustCounts();
    return { ok: true, id: dups[0].id, existed: true, job_action_token: jobTok, cand_action_token: candTok };
  }

  // 提案者の既定＝本人（ログイン中）
  let proposerName = (proposer ?? "").trim() || null;
  try {
    const me = await currentAccess();
    if (me && !proposerName) proposerName = (me.name ?? "").trim() || null;
  } catch { /* 未ログインでも続行 */ }
  // 担当者（提案者）は必須（最終防衛線）。操作者・本人名のいずれも無ければ保存しない。
  if (!proposerName) return { ok: false, error: "担当者（提案者）を選択してください（画面右上の操作者を選択してください）" };

  // ※ 以前ここに「打合せ未済企業への提案ゲート」があり、非権限ユーザー（一般メンバー）が
  //   打合せ記録の無い企業には「提案する」で保存できなかった（権限者は素通り）。
  //   アカウントによって保存できる/できないが分かれる原因になっていたため撤廃する。
  //   提案の記録は後から提案管理で確認・整理できるため、記録時点でブロックしない。

  // クロージング担当の既定＝案件の outside_owner（無ければ企業マスタ owner）。アウトサイドへトスアップしやすく。
  let defaultCloser: string | null = (job.outside_owner ?? "").trim() || null;
  if (!defaultCloser && job.client_name) {
    try { const { data: co } = await admin.from("companies").select("owner").ilike("name", job.client_name).maybeSingle(); defaultCloser = ((co as any)?.owner ?? "").trim() || null; } catch { /* companies 未整備 */ }
  }

  const now = new Date().toISOString();
  const job_action_token = randomBytes(24).toString("hex");
  const cand_action_token = randomBytes(24).toString("hex");
  const insertBase = {
    job_id: job.id, candidate_id: cand.id,
    stage: "所属確認", // ボードの初期ステージ。ここから「話を進める／見送り」で進める。
    job_title: job.title, company: job.client_name, candidate_name: cand.name,
    c_init: cand.initials, rate: cand.rate, score: score ?? null, ai: false,
    closer: defaultCloser,
    proposer: proposerName,
    approval_status: "approved", // 記録（承認フローを通さない）
    approved_at: now,
    job_action_type: "未回答", job_action_token,
    cand_action_type: "未回答", cand_action_token,
  } as Record<string, any>;
  // 列未整備の旧環境に段階フォールバック
  let ins: any = await admin.from("proposals").insert({ ...insertBase, stage_updated_at: now }).select("id").single();
  if (ins.error && /approval_status|approved_at|column/i.test(ins.error.message)) {
    const fb = { ...insertBase }; delete fb.approval_status; delete fb.approved_at;
    ins = await admin.from("proposals").insert({ ...fb, stage_updated_at: now }).select("id").single();
  }
  if (ins.error && /stage_updated_at|column/i.test(ins.error.message)) {
    ins = await admin.from("proposals").insert(insertBase).select("id").single();
  }
  if (ins.error) return { ok: false, error: ins.error.message };
  revalidatePath("/proposals"); revalidatePath("/matching"); bustRankingCaches(); bustCounts();
  // メール送信モーダルで再利用するため、生成したトークンを呼び出し側へ返す。
  // 返さないと、後段のメールに焼き込むトークンが DB と一致せず「リンク切れ」になる。
  return { ok: true, id: ins.data?.id ?? null, existed: false, job_action_token, cand_action_token };
}

// ────────────────────────────────────────────────────────
// #345①：マッチングの「このペアは表示させない」（案件×人材の恒久非表示）
// ────────────────────────────────────────────────────────

/** 指定した (案件No × 人材No) のペアをおすすめ／ランキング100から恒久的に非表示にする。
 *   期間に関係なく除外され、他の担当が再度確認しなくてよくするための共有リスト。 */
export async function hidePairs(pairs: { jobNo: number; candNo: number }[]) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const clean = (pairs ?? [])
    .map((p) => ({ job_no: Number(p.jobNo), candidate_no: Number(p.candNo) }))
    .filter((p) => Number.isFinite(p.job_no) && Number.isFinite(p.candidate_no));
  if (clean.length === 0) return { ok: false as const, error: "対象のペアがありません" };
  let by_email: string | null = null, by_name: string | null = null;
  try { const a = await currentAccess(); by_email = a?.email ?? null; by_name = a?.name ?? null; } catch { /* 未ログインでも続行 */ }
  const rows = clean.map((p) => ({ ...p, hidden_by_email: by_email, hidden_by_name: by_name }));
  let { error } = await admin.from("hidden_pairs").upsert(rows, { onConflict: "job_no,candidate_no", ignoreDuplicates: true });
  // hidden_by_* 列が無い旧環境でも保存できるようフォールバック
  if (error && /hidden_by|column/i.test(error.message)) {
    ({ error } = await admin.from("hidden_pairs").upsert(clean, { onConflict: "job_no,candidate_no", ignoreDuplicates: true }));
  }
  if (error) {
    if (/hidden_pairs|relation|does not exist|schema cache/i.test(error.message)) {
      return { ok: false as const, error: "非表示テーブルが未整備です（supabase/hidden-pairs.sql を実行してください）" };
    }
    return { ok: false as const, error: error.message };
  }
  bustRankingCaches(); // 非表示ペアをおすすめ/ランキングから即時に外す
  revalidatePath("/matching");
  return { ok: true as const, hidden: clean.length };
}

/** 非表示にしたペアを元に戻す（再びランキングに出す）。 */
export async function unhidePair(jobNo: number, candNo: number) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("hidden_pairs").delete().eq("job_no", Number(jobNo)).eq("candidate_no", Number(candNo));
  if (error) return { ok: false as const, error: error.message };
  bustRankingCaches();
  revalidatePath("/matching");
  return { ok: true as const };
}

/** 既存提案のレスポンストークン（job_action_token / cand_action_token）を取得。
 *  メール送信モーダルが「📋 提案する」で記録済みの提案を再度開いた時に、DB のトークンを
 *  メール本文の「話を進める／見送り」リンクへ正しく差し込むために使う。
 *  ※ 旧データで token が NULL の場合は、ここで生成して DB に保存する（self-healing）。
 *    そうしないとメールに焼き込まれるリンクのトークンが DB と一致せず、受信者がボタンを
 *    押した時に /respond → /api/respond が 404 を返し「URL が無効か期限切れです」（=リンク切れ）
 *    になる不具合があった。 */
export async function getProposalTokens(proposalId: string): Promise<{ ok: true; jobToken: string | null; candToken: string | null } | { ok: false; error: string }> {
  if (!proposalId) return { ok: false, error: "id がありません" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  try {
    const { data, error } = await admin.from("proposals").select("job_action_token, cand_action_token").eq("id", proposalId).maybeSingle();
    if (error) return { ok: false, error: error.message };
    let jobToken: string | null = (data as any)?.job_action_token ?? null;
    let candToken: string | null = (data as any)?.cand_action_token ?? null;
    // NULL のままだとメールリンクと一致しないので、欠けている側だけ生成して DB に保存する。
    if (!jobToken || !candToken) {
      const upd: Record<string, any> = { updated_at: new Date().toISOString() };
      if (!jobToken)  { jobToken  = randomBytes(24).toString("hex"); upd.job_action_token  = jobToken;  upd.job_action_type  = "未回答"; }
      if (!candToken) { candToken = randomBytes(24).toString("hex"); upd.cand_action_token = candToken; upd.cand_action_type = "未回答"; }
      try { await admin.from("proposals").update(upd).eq("id", proposalId); } catch { /* 列未整備でも fail-soft */ }
    }
    return { ok: true, jobToken, candToken };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
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
export async function getProposalPendingMail(id: string): Promise<{ ok: true; mail: PendingMail | null; jobToken: string | null; candToken: string | null; jobTitle: string | null; company: string | null; candName: string | null; jobSourceMailUrl: string | null; candSourceMailUrl: string | null } | { ok: false; error: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  const me = await currentAccess();
  if (!me) return { ok: false, error: "未ログインです" };
  let r: any = await admin.from("proposals").select("id, approver, approval_status, pending_mail, job_action_token, cand_action_token, job_title, company, candidate_name, job_id, candidate_id").eq("id", id).maybeSingle();
  if (r.error && /pending_mail|column/i.test(r.error.message)) {
    r = await admin.from("proposals").select("id, approver, approval_status, job_action_token, cand_action_token, job_title, company, candidate_name, job_id, candidate_id").eq("id", id).maybeSingle();
  }
  if (r.error) return { ok: false, error: r.error.message };
  if (!r.data) return { ok: false, error: "提案が見つかりません" };
  const { ownerMatches } = await import("./owner-match");
  const isApprover = me.name && ownerMatches(me.name, r.data.approver ?? "");
  if (me.role !== "admin" && !isApprover) return { ok: false, error: "閲覧権限がありません（承認者のみ）" };

  // 元メールへの返信スレッド連結用に、案件・人材それぞれの source_mail_url を引いて返す。
  //   列が無い旧環境は null フォールバック（新規メール扱いで送信される）。
  let jobSourceMailUrl: string | null = null;
  let candSourceMailUrl: string | null = null;
  try {
    if (r.data.job_id) {
      const jr: any = await admin.from("jobs").select("source_mail_url").eq("id", r.data.job_id).maybeSingle();
      jobSourceMailUrl = jr?.data?.source_mail_url ?? null;
    }
    if (r.data.candidate_id) {
      const cr: any = await admin.from("candidates").select("source_mail_url").eq("id", r.data.candidate_id).maybeSingle();
      candSourceMailUrl = cr?.data?.source_mail_url ?? null;
    }
  } catch { /* 列未整備は無視 */ }

  return {
    ok: true,
    mail: (r.data.pending_mail ?? null) as PendingMail | null,
    jobToken: r.data.job_action_token ?? null,
    candToken: r.data.cand_action_token ?? null,
    jobTitle: r.data.job_title ?? null,
    company: r.data.company ?? null,
    candName: r.data.candidate_name ?? null,
    jobSourceMailUrl,
    candSourceMailUrl,
  };
}

/** 提案者・承認者・管理者が「メール下書き(pending_mail)」を取得する。
 *   差戻し後に提案者が「メール内容を見る／編集」を押した時に、過去に書いた下書きを
 *   復元できるようにするための公開ロード関数。閲覧権限は提案者・承認者・admin に絞る。 */
export async function getProposalDraft(id: string): Promise<{ ok: true; mail: PendingMail | null } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: "id がありません" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  const me = await currentAccess();
  if (!me) return { ok: false, error: "未ログインです" };
  let r: any = await admin.from("proposals").select("id, approver, proposer, pending_mail").eq("id", id).maybeSingle();
  if (r.error && /pending_mail|column/i.test(r.error.message)) {
    // pending_mail 列が無い旧環境はドラフト無しとして返す（エラーにしない）。
    return { ok: true, mail: null };
  }
  if (r.error) return { ok: false, error: r.error.message };
  if (!r.data) return { ok: false, error: "提案が見つかりません" };
  const { ownerMatches } = await import("./owner-match");
  const isApprover = me.name && ownerMatches(me.name, r.data.approver ?? "");
  const isProposer = me.name && ownerMatches(me.name, r.data.proposer ?? "");
  if (me.role !== "admin" && !isApprover && !isProposer) return { ok: false, error: "閲覧権限がありません" };
  return { ok: true, mail: (r.data.pending_mail ?? null) as PendingMail | null };
}

/** 承認者が「メール内容を確認して送信」を押した直後に呼ぶ：
 *   承認確定＋ステージ進行（→所属確認）だけ先に行う。
 *   実送信は別タブで `/mail-compose?send=1` から行うため、pending_mail（メール下書き）は
 *   消さずに残す。送信完了時の記録（mail_sent_at/by）は markProposalMailSentAndApprove で行う。
 *   ※ このアクションは冪等：既に approved/所属確認になっていてもエラーにせず ok を返す。 */
export async function approveProposalForSend(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  const me = await currentAccess();
  if (!me) return { ok: false, error: "未ログインです" };
  const cur: any = await admin.from("proposals").select("id, approver, approval_status, stage").eq("id", id).maybeSingle();
  if (cur.error) return { ok: false, error: cur.error.message };
  if (!cur.data) return { ok: false, error: "提案が見つかりません" };
  const { ownerMatches } = await import("./owner-match");
  const isApprover = me.name && ownerMatches(me.name, cur.data.approver ?? "");
  if (me.role !== "admin" && !isApprover) return { ok: false, error: "承認権限がありません（承認者のみ）" };

  const now = new Date().toISOString();
  const upd: Record<string, any> = {
    approval_status: "approved",
    approved_at: now,
    approver_email: me.email,
    reject_reason: null,
    stage: "所属確認",
    stage_updated_at: now,
    updated_at: now,
    // pending_mail は別タブの送信モーダルで使うため、ここでは残す。
  };
  let r: any = await admin.from("proposals").update(upd).eq("id", id);
  if (r.error && /approver_email|approved_at|approval_status|stage_updated_at|column/i.test(r.error.message)) {
    // 旧スキーマでも最低限ステージ進行は通す
    r = await admin.from("proposals").update({ stage: "所属確認", updated_at: now }).eq("id", id);
  }
  if (r.error) return { ok: false, error: r.error.message };
  revalidatePath("/proposals");
  bustCounts();
  return { ok: true };
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
 *  stage_updated_at 列が未追加の環境では自動で外して再試行。
 *  ※ 失注/見送り から非・失注ステージへ戻すときは lost_reason/lost_phase/lost_reason_note も
 *    自動でクリアする。そうしないと「失注分析」の集計やカード表示に古い失注理由が残り、
 *    「戻したのに失注として数値に出ている」誤解を招く（restoreProposal と同じ動き）。 */
export async function updateProposalStage(id: string, stage: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です（Vercel env を設定してください）" }; }
  const now = new Date().toISOString();
  const isLostStage = stage === "見送り" || stage === "失注";
  const patch: Record<string, any> = { stage, updated_at: now, stage_updated_at: now };
  if (!isLostStage) { patch.lost_reason = null; patch.lost_phase = null; patch.lost_reason_note = null; }
  let r: any = await admin.from("proposals").update(patch).eq("id", id);
  if (r.error && /stage_updated_at|lost_reason_note|column/i.test(r.error.message)) {
    // 旧環境フォールバック：未整備の列を順に落として再試行
    const { lost_reason_note: _a, stage_updated_at: _b, ...rest } = patch;
    r = await admin.from("proposals").update(rest).eq("id", id);
  }
  if (r.error && /lost_reason|lost_phase|column/i.test(r.error.message)) {
    r = await admin.from("proposals").update({ stage, updated_at: now }).eq("id", id);
  }
  const error = r.error;
  if (error) return { ok: false, error: error.message };
  // 「面談」または「合格」に入った時、面談到達日時を初回のみ記録（累計集計「面談」列のソース）。
  //   ※ 既に値があれば上書きしない（is null 条件）。列未整備の環境では握りつぶす。
  if (stage === "面談" || stage === "合格") {
    try { await admin.from("proposals").update({ meeting_reached_at: now }).eq("id", id).is("meeting_reached_at", null); }
    catch { /* meeting_reached_at 列が無い環境はスキップ */ }
  }
  // #234②：「提案中」以降に入った時、提案到達日時を初回のみ記録（累計集計「提案中」列のソース）。
  if (PROPOSED_REACHED_STAGES.has(stage)) {
    try { await admin.from("proposals").update({ proposed_at: now }).eq("id", id).is("proposed_at", null); }
    catch { /* proposed_at 列が無い環境はスキップ */ }
  }
  revalidatePath("/proposals");
  revalidatePath("/analytics");
  bustCounts();
  await logProposalActivity(id, "ステージ変更", `→ ${stage}`);
  return { ok: true };
}

/** 提案の実削除（内部用）。紐づく稼働があれば一緒に削除。権限チェックは呼び出し側で行う。 */
async function hardDeleteProposal(id: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!id) return { ok: false, error: "id がありません" };
  try { await admin.from("engagements").delete().eq("proposal_id", id); } catch { /* engagements未整備でも続行 */ }
  const { error } = await admin.from("proposals").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals"); bustCounts(); revalidatePath("/progress");
  return { ok: true };
}

/** 提案を削除（管理者のみ）。記録ミスの取り消し。紐づく稼働があれば一緒に削除。 */
export async function deleteProposal(id: string) {
  const me = await currentAccess();
  if (!me || me.role !== "admin") return { ok: false, error: "提案の削除は管理者のみ可能です" };
  let label: string | null = null;
  try {
    const admin = engerAdmin();
    const r: any = await admin.from("proposals").select("candidate_name, job_title").eq("id", id).maybeSingle();
    if (r.data) label = `${r.data.candidate_name ?? "—"} × ${r.data.job_title ?? "—"}`;
  } catch { /* noop */ }
  const del = await hardDeleteProposal(id);
  if (del.ok) await logActivity({ action: "提案を削除", targetType: "proposal", targetId: id, targetLabel: label });
  return del;
}

/** 提案削除の権限（クライアントUIのボタン出し分け用）。
 *  承認制は廃止。admin / agent（社内メンバー）は承認なしで即削除できる。 */
export async function getProposalDeletePermissions(): Promise<{ canRequest: boolean; canApprove: boolean }> {
  const me = await currentAccess();
  const canDelete = !!me && (me.role === "admin" || me.role === "agent");
  // canApprove=即削除可。承認制を廃止したので canRequest と同値（社内メンバーは即削除）。
  return { canRequest: canDelete, canApprove: canDelete };
}

/**
 * 提案削除。理由必須。承認制は廃止し、admin / agent とも**承認なしで即削除**する。
 *   ・追跡性は操作ログ(activity_logs)に「誰が・いつ・何を・理由」を記録して担保する。
 */
export async function requestProposalDeletion(id: string, reason: string): Promise<{ ok: boolean; deleted?: boolean; error?: string }> {
  const me = await currentAccess();
  if (!me || (me.role !== "admin" && me.role !== "agent")) return { ok: false, error: "権限がありません" };
  if (!id) return { ok: false, error: "id がありません" };
  const rsn = String(reason ?? "").trim();
  if (!rsn) return { ok: false, error: "削除理由を入力してください" };

  // 削除前に対象ラベル（候補者 × 案件）を取得（削除後は引けないため）。
  let label: string | null = null;
  try {
    const admin = engerAdmin();
    const r: any = await admin.from("proposals").select("candidate_name, job_title").eq("id", id).maybeSingle();
    if (r.data) label = `${r.data.candidate_name ?? "—"} × ${r.data.job_title ?? "—"}`;
  } catch { /* ラベル取得失敗は無視 */ }

  const del = await hardDeleteProposal(id);
  if (!del.ok) return del;
  await logActivity({ action: "提案を削除", targetType: "proposal", targetId: id, targetLabel: label, detail: `理由：${rsn}` });
  return { ok: true, deleted: true };
}

/** 削除申請を承認して実削除（管理者のみ。承認制廃止後は既存の申請済みレコードの救済用に残置）。 */
export async function approveProposalDeletion(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await currentAccess();
  if (!me || me.role !== "admin") return { ok: false, error: "削除の承認は管理者のみ可能です" };
  if (!id) return { ok: false, error: "id がありません" };
  let label: string | null = null;
  try {
    const admin = engerAdmin();
    const r: any = await admin.from("proposals").select("candidate_name, job_title").eq("id", id).maybeSingle();
    if (r.data) label = `${r.data.candidate_name ?? "—"} × ${r.data.job_title ?? "—"}`;
  } catch { /* noop */ }
  const del = await hardDeleteProposal(id);
  if (del.ok) await logActivity({ action: "提案を削除（申請を承認）", targetType: "proposal", targetId: id, targetLabel: label });
  return del;
}

/** 削除申請を却下（管理者のみ）。pending を解除して提案は残す。 */
export async function rejectProposalDeletion(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await currentAccess();
  if (!me || me.role !== "admin") return { ok: false, error: "削除の却下は管理者のみ可能です" };
  if (!id) return { ok: false, error: "id がありません" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { error } = await admin.from("proposals").update({
    delete_requested_at: null, delete_reason: null, delete_requested_by: null,
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals");
  return { ok: true };
}

/** 提案の一括削除（リストのチェックボックス選択分・管理者のみ）。記録ミスの一括取り消し用。 */
export async function bulkDeleteProposals(ids: string[]) {
  const me = await currentAccess();
  if (!me || me.role !== "admin") return { ok: false, error: "一括削除は管理者のみ可能です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const clean = Array.from(new Set((ids ?? []).filter((x) => typeof x === "string" && x)));
  if (clean.length === 0) return { ok: false, error: "削除対象がありません" };
  try { await admin.from("engagements").delete().in("proposal_id", clean); } catch { /* engagements未整備でも続行 */ }
  const { error } = await admin.from("proposals").delete().in("id", clean);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals"); bustCounts(); revalidatePath("/progress");
  await logActivity({ action: "提案を一括削除", targetType: "proposal", detail: `${clean.length}件` });
  return { ok: true, count: clean.length };
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

/** 見送り/失注/稼働化した提案をボードに戻す。
 *  #291：見送り/失注の場合は「見送りになる直前のステージ」(pre_lost_stage) へ復元し、
 *    提案ボードのいずれかのフォルダに再表示・失注一覧からは消える。
 *    記録が無い（この機能追加より前の失注、または pre_lost_stage 未整備環境）場合は
 *    従来どおり「所属確認」へ戻す。
 *  #296①：失注フェーズ／失注理由／理由メモ／★評価は消さずに残す（直前の記録をそのまま見られる状態）。
 *    ステージが「見送り/失注」でなくなるため失注分析タブからは外れるが、値は保持され、
 *    再度「見送りを確定」したときに直前の値がフォームに前入力される（最新の入力で上書き＝#296②）。 */
export async function restoreProposal(id: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!id) return { ok: false, error: "id がありません" };
  // 稼働化済みなら稼働も取り消し
  try { await admin.from("engagements").delete().eq("proposal_id", id); } catch { /* 続行 */ }

  // #291：見送り直前のステージ（pre_lost_stage）が有効なステージ名なら復元先に採用。
  let targetStage = "所属確認";
  try {
    const { PROPOSAL_STAGES } = await import("./proposal-constants");
    const row: any = (await admin.from("proposals").select("pre_lost_stage").eq("id", id).maybeSingle()).data;
    const pls = String(row?.pre_lost_stage ?? "").trim();
    if (pls && (PROPOSAL_STAGES as readonly string[]).includes(pls)) targetStage = pls;
  } catch { /* pre_lost_stage 列未整備でも従来どおり「所属確認」で続行 */ }

  const now = new Date().toISOString();
  // #296①：lost_reason/lost_phase/lost_reason_note/★評価はクリアしない（直前の記録を保持）。
  //   pre_lost_stage だけは復元後に不要になるので null に戻す（列が無い環境向けにフォールバックあり）。
  const fullPatch = { stage: targetStage, pre_lost_stage: null, updated_at: now, stage_updated_at: now };
  let rr: any = await admin.from("proposals").update(fullPatch).eq("id", id);
  if (rr.error && /pre_lost_stage|column/i.test(rr.error.message)) {
    const { pre_lost_stage: _p, ...rest } = fullPatch;
    rr = await admin.from("proposals").update(rest).eq("id", id);
  }
  if (rr.error && /stage_updated_at|column/i.test(rr.error.message)) {
    rr = await admin.from("proposals").update({ stage: targetStage, updated_at: now }).eq("id", id);
  }
  const error = rr.error;
  if (error) return { ok: false, error: error.message };
  revalidatePath("/proposals"); revalidatePath("/analytics"); bustCounts(); revalidatePath("/progress");
  await logProposalActivity(id, "提案ボードに戻す", `→ ${targetStage}（失注記録は保持）`);
  return { ok: true, stage: targetStage };
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
  // 対応特性タグ（属人知の資産化）
  contact_pref?: string; response_speed?: string; decision_speed?: string;
  // 取引注意（既存の caution 列を企業モーダルから編集可能に。true のときは理由必須）
  caution?: boolean; caution_reason?: string;
};

/** 企業を新規登録/更新 (name で upsert)。 */
export async function saveCompany(input: CompanyInput) {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "企業名を入力してください" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const row: Record<string, any> = { name };
  for (const k of ["industry", "tier", "status", "owner_staff", "contact_name", "contact_email", "phone", "website", "address", "note", "contact_pref", "response_speed", "decision_speed"] as const) {
    const v = (input as any)[k];
    if (v !== undefined) row[k] = typeof v === "string" ? (v.trim() || null) : v;
  }
  // 取引注意：ON にするなら理由必須（属人的な「合わない/電話つながらない」を根拠つきで全員に共有する）。
  if (typeof input.caution === "boolean") {
    row.caution = input.caution;
    if (input.caution) {
      const reason = (input.caution_reason ?? "").trim();
      if (!reason) return { ok: false, error: "取引注意にする場合は理由を入力してください（例：電話がつながらない／条件が合わない 等）" };
      const access = await currentAccess();
      row.caution_reason = reason;
      row.caution_at = new Date().toISOString();
      row.caution_by = access?.name ?? access?.email ?? null;
    }
  }
  const dropKeys = (src: Record<string, any>, keys: string[]) => { const o = { ...src }; for (const k of keys) delete o[k]; return o; };
  let { error } = await admin.from("companies").upsert(row, { onConflict: "name" });
  // 未整備の列を段階的に外して再試行（fail-soft）。まず新規の対応特性タグだけ外し、
  //   既存の取引注意(caution)列はできる限り残す（caution は close-reason-caution.sql で既出＝本番に存在するため、
  //   タグ列が無いだけで caution フラグの保存が落ちないようにする）。
  if (error && /contact_pref|response_speed|decision_speed|caution|column/i.test(error.message)) {
    let attempt = dropKeys(row, ["contact_pref", "response_speed", "decision_speed"]);
    ({ error } = await admin.from("companies").upsert(attempt, { onConflict: "name" }));
    // それでも caution 列が無い（ごく古い環境）なら caution 系も外して基本列のみで保存。
    if (error && /caution|column/i.test(error.message)) {
      attempt = dropKeys(attempt, ["caution", "caution_reason", "caution_at", "caution_by"]);
      ({ error } = await admin.from("companies").upsert(attempt, { onConflict: "name" }));
    }
    if (!error) { revalidatePath("/companies"); return { ok: true, warn: "一部の追加列が未整備のため、可能な範囲で保存しました（supabase/companies-crm-loop.sql を実行してください）" }; }
  }
  if (error) return { ok: false, error: error.message };
  revalidatePath("/companies");
  return { ok: true };
}

/** 見送り（失注）理由をAIが下書き推定する。提案IDから メモ・元メール・面談メモ を server 側で集め、
 *  LOST_REASONS/LOST_PHASES の中から最も妥当なコードと理由メモ案を返す（担当が確認・修正して確定）。
 *  ※ 保存はしない（フォーム前入力のみ）。入力の手間を下げて「E3:その他＋一行」への逃げを減らすのが目的。 */
export async function suggestLostReason(proposalId: string): Promise<{ ok: boolean; error?: string; reason?: string; phase?: string; note?: string }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません" };
  const id = (proposalId ?? "").trim();
  if (!id) return { ok: false, error: "提案IDがありません" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  // 提案本体・メモ・元メール本文を収集（クライアントを信頼せず server 側で再取得）。
  let ctx = "";
  try {
    const pr: any = await admin.from("proposals")
      .select("job_title, company, c_init, stage, meeting_status, caller_status, job_id, candidate_id")
      .eq("id", id).maybeSingle();
    const p = pr.data ?? {};
    const memoRes: any = await admin.from("proposal_memos")
      .select("category, body, created_at").eq("proposal_id", id)
      .order("created_at", { ascending: false }).limit(60);
    const memos = (memoRes.data ?? []) as { category: string; body: string; created_at: string }[];
    let jobDetail: string | null = null, candDetail: string | null = null;
    if (p.job_id) { const jr: any = await admin.from("jobs").select("detail").eq("id", p.job_id).maybeSingle(); jobDetail = jr.data?.detail ?? null; }
    if (p.candidate_id) { const cr: any = await admin.from("candidates").select("note, exp").eq("id", p.candidate_id).maybeSingle(); candDetail = cr.data?.note ?? cr.data?.exp ?? null; }
    const memoText = memos.map((m) => `・[${m.category}] ${String(m.body ?? "").replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
    ctx = [
      `案件: ${p.job_title ?? "—"} / 会社: ${p.company ?? "—"} / 人材: ${p.c_init ?? "—"}`,
      `現ステージ: ${p.stage ?? "—"} / 面談状況: ${p.meeting_status ?? "—"} / 架電状況: ${p.caller_status ?? "—"}`,
      memoText ? `やり取り記録（新しい順）:\n${memoText}` : "",
      jobDetail ? `案件メール抜粋: ${String(jobDetail).replace(/\s+/g, " ").slice(0, 800)}` : "",
      candDetail ? `人材メール抜粋: ${String(candDetail).replace(/\s+/g, " ").slice(0, 800)}` : "",
    ].filter(Boolean).join("\n").slice(0, 6000);
  } catch (e) {
    return { ok: false, error: "提案情報の取得に失敗しました" };
  }
  if (ctx.replace(/\s/g, "").length < 40) return { ok: false, error: "推定に使える記録が不足しています（メモや元メールが必要です）。手動で入力してください。" };

  const system = [
    "あなたはSES/人材紹介の営業マネージャーです。提案が見送り（失注）になった原因を、記録から最も妥当に推定します。",
    "必ず次のJSONだけを出力：{\"reason\":\"<失注理由コード>\",\"phase\":\"<失注フェーズ>\",\"note\":\"<40〜120字の理由メモ>\"}",
    `reason は次のいずれかの文字列を丸ごと選ぶ（接頭コード込みで一致させる）：\n${LOST_REASONS.map((r) => `- ${r}`).join("\n")}`,
    `phase は次のいずれか：${LOST_PHASES.join(" / ")}`,
    "note は事実ベースで具体的に（担当者名・社名などの固有名詞は避け、単価/タイミング/競合/連絡状況などの要因を書く）。記録から読み取れない憶測は書かない。根拠が薄いときは reason を 'E3: その他' にする。",
  ].join("\n");
  const res = await callLLM({ system, prompt: `【失注の記録】\n${ctx}`, maxTokens: 400, temperature: 0.2 });
  if (!res.ok) return { ok: false, error: res.error || "AI推定に失敗しました" };
  await logUsage("lost-reason", res.model, res.usage, access.email ?? null);
  const out = parseJsonLoose<{ reason?: string; phase?: string; note?: string }>(res.text);
  if (!out) return { ok: false, error: "AIの応答を解析できませんでした。もう一度お試しください。" };
  // ホワイトリスト検証：完全一致 → 接頭コード一致 → 既定。
  const pickReason = (v?: string): string => {
    const s = (v ?? "").trim();
    if (LOST_REASONS.includes(s)) return s;
    const code = s.split(/[:：]/)[0].trim().toUpperCase();
    const byCode = LOST_REASONS.find((r) => r.toUpperCase().startsWith(code + ":") || r.toUpperCase().startsWith(code + "："));
    return byCode ?? "E3: その他";
  };
  const pickPhase = (v?: string): string => {
    const s = (v ?? "").trim();
    if (!s) return ""; // 空は許容（クライアントは r.phase が空なら無視）
    if (LOST_PHASES.includes(s)) return s;
    // 先頭の 1〜4 の番号で対応づけ（"3" / "3. 提案後失注" 等）。
    const num = s.match(/[1-4]/)?.[0];
    if (num) { const byNum = LOST_PHASES.find((p) => p.startsWith(num + ".")); if (byNum) return byNum; }
    // 番号が無ければラベル文言の部分一致（空文字の全一致バグを避けるため s は非空を保証済み）。
    return LOST_PHASES.find((p) => p.includes(s) || s.includes(p.replace(/^\d+\.\s*/, ""))) ?? "";
  };
  return { ok: true, reason: pickReason(out.reason), phase: pickPhase(out.phase), note: (out.note ?? "").trim().slice(0, 200) || undefined };
}

/** 企業のWEB評判をAIで要約する（社内・admin/agent のみ）。runtime に検索APIは無いため、
 *  指定URL（未指定なら企業サイト website）を fetch → AIが読み取れる範囲で要約し、必ず「要確認」を明示。
 *  口コミページや記事のURLを渡すと評判の材料が増える。結果は companies に保存して再表示する。 */
export async function summarizeCompanyReputation(name: string, url?: string): Promise<{ ok: boolean; error?: string; summary?: string; source?: string; at?: string }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません（管理者またはエージェントのみ）" };
  const nm = (name ?? "").trim();
  if (!nm) return { ok: false, error: "企業名がありません" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  // 参照URLの決定：明示指定 > 企業マスタの website。
  let target = (url ?? "").trim();
  if (!target) {
    try { const wr: any = await admin.from("companies").select("website").eq("name", nm).maybeSingle(); target = (wr.data?.website ?? "").trim(); } catch { /* noop */ }
  }
  if (!/^https?:\/\/.+/i.test(target)) return { ok: false, error: "参照URLがありません。企業サイトURLを登録するか、口コミ/記事のURLを指定してください（https://…）。" };

  let text = "";
  try {
    const res = await fetch(target, { headers: { "User-Agent": "ENGER-bot/1.0" }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { ok: false, error: `参照ページの取得に失敗しました (HTTP ${res.status})` };
    const html = await res.text();
    text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 7000);
  } catch {
    return { ok: false, error: "参照ページの取得に失敗しました。URLをご確認ください。" };
  }
  if (text.length < 80) return { ok: false, error: "本文を十分に取得できませんでした。別のURL（口コミ/記事）をお試しください。" };

  const system = [
    "あなたは企業与信の調査補助です。与えられたWEB本文だけから、取引判断の参考になる情報を日本語で簡潔に要約します。",
    "誇張・創作は禁止。本文から読み取れない内容は書かない。ネガティブ材料（未払い/訴訟/炎上/離職/評判悪化 等）が本文にあれば negative_signals に列挙、無ければ空配列。",
    "必ず次のJSONだけを出力：{\"summary\":\"事業・評判の要約(3-5文)\",\"negative_signals\":[\"…\"],\"needs_verification\":true}",
  ].join("\n");
  const res = await callLLM({ system, prompt: `参照URL：${target}\n本文：\n${text}`, maxTokens: 700, temperature: 0.3 });
  if (!res.ok) return { ok: false, error: res.error || "AI要約に失敗しました" };
  await logUsage("reputation", res.model, res.usage, access.email ?? null);
  const out = parseJsonLoose<{ summary?: string; negative_signals?: string[]; needs_verification?: boolean }>(res.text);
  if (!out || !out.summary) return { ok: false, error: "AIの応答を解析できませんでした。もう一度お試しください。" };
  const neg = Array.isArray(out.negative_signals) ? out.negative_signals.filter(Boolean) : [];
  const summary = [
    "⚠ 参考情報（AI要約・未検証＝要確認）",
    out.summary.trim(),
    neg.length ? `\n【ネガティブ材料の可能性】\n${neg.map((s) => `・${s}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
  const at = new Date().toISOString();

  let { error } = await admin.from("companies").upsert(
    { name: nm, web_reputation: summary, web_reputation_source: target, web_reputation_at: at, web_reputation_by: access.name ?? access.email ?? null },
    { onConflict: "name" },
  );
  if (error && /web_reputation|column/i.test(error.message)) {
    return { ok: false, error: "評判要約の保存列が未整備です（supabase/companies-crm-loop.sql を実行してください）" };
  }
  if (error) return { ok: false, error: error.message };
  revalidatePath("/companies");
  return { ok: true, summary, source: target, at };
}

/** 打合せ記録の保存に連動して企業マスタへ反映する。
 *   ・既存企業 … 窓口担当者(contact_name)のみ同期（入力があれば上書き。自社担当は触らない）。
 *   ・新規企業 … name＋窓口担当者＋自社担当者(owner_staff) を新規登録する。
 *   企業名（name）は ilike で既存判定（表記ゆれは呼び出し側で吸収済みの想定）。 */
export async function upsertMeetingCompany(input: { name: string; contact_name?: string | null; our_owner?: string | null }): Promise<{ ok: boolean; existed?: boolean; error?: string }> {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: true };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const contact = (input.contact_name ?? "").trim();
  const owner = (input.our_owner ?? "").trim();
  const ex: any = await admin.from("companies").select("name").ilike("name", name).maybeSingle();
  if (ex?.data?.name) {
    // 既存：窓口担当者のみ同期（入力があるときだけ上書き）。
    if (contact) {
      const { error } = await admin.from("companies").update({ contact_name: contact }).eq("name", ex.data.name);
      if (error && !/contact_name|column/i.test(error.message)) return { ok: false, error: error.message };
    }
    revalidatePath("/companies");
    return { ok: true, existed: true };
  }
  // 新規：企業マスタに登録（窓口担当者＋自社担当者）。
  const row: Record<string, any> = { name };
  if (contact) row.contact_name = contact;
  if (owner) row.owner_staff = owner;
  let { error } = await admin.from("companies").upsert(row, { onConflict: "name" });
  if (error && /owner_staff|contact_name|column/i.test(error.message)) {
    ({ error } = await admin.from("companies").upsert({ name }, { onConflict: "name" }));
  }
  if (error) return { ok: false, error: error.message };
  revalidatePath("/companies");
  return { ok: true, existed: false };
}

/** 企業の打合せ完了フラグの「現在のDB状態」を返す診断アクション。
 *  企業詳細モーダルの診断ボタンから呼び、保存できているのに表示に出ないのか・
 *  そもそも保存自体が効いていないのかを画面で切り分けるために使う。 */
export type CompanyDiagnosis = {
  ok: boolean;
  error?: string;
  hasServiceKey: boolean;
  hasMeetingDoneCol: boolean | null;
  hasMeetingDoneAtCol: boolean | null;
  input: string;
  inputNormalized: string;
  matches: { id: string; name: string; meeting_done: boolean | null; meeting_done_at: string | null; nameBytesHex: string }[];
};
export async function diagnoseCompanyMeetingDone(name: string): Promise<CompanyDiagnosis> {
  const n = (name ?? "").trim();
  const normKey = (s?: string | null) => (s ?? "")
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[\s　]/g, "");
  const out: CompanyDiagnosis = {
    ok: true,
    hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasMeetingDoneCol: null,
    hasMeetingDoneAtCol: null,
    input: n,
    inputNormalized: normKey(n),
    matches: [],
  };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ...out, ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定（本番ランタイムに反映されていません）" }; }
  // 列の有無を probe
  try { const p1: any = await admin.from("companies").select("meeting_done").limit(1); out.hasMeetingDoneCol = !p1.error; }
  catch { out.hasMeetingDoneCol = false; }
  try { const p2: any = await admin.from("companies").select("meeting_done_at").limit(1); out.hasMeetingDoneAtCol = !p2.error; }
  catch { out.hasMeetingDoneAtCol = false; }
  // 正規化キーで一致する既存行を全部返す（不可視文字を含む可能性があるので name のバイト16進も併記）。
  try {
    const all: any = await admin.from("companies").select("id, name, meeting_done, meeting_done_at").limit(50000);
    if (all.error) return { ...out, ok: false, error: `companies 読み出し失敗: ${all.error.message}` };
    const target = normKey(n);
    for (const r of (all.data ?? []) as any[]) {
      if (normKey(r.name) !== target) continue;
      const bytes = Buffer.from(String(r.name), "utf8");
      out.matches.push({
        id: r.id, name: r.name,
        meeting_done: r.meeting_done ?? null,
        meeting_done_at: r.meeting_done_at ?? null,
        nameBytesHex: bytes.slice(0, 64).toString("hex"),
      });
    }
  } catch (e) { return { ...out, ok: false, error: e instanceof Error ? e.message : String(e) }; }
  return out;
}

/** 企業の「打ち合わせ完了」手動フラグを切替（詳細画面のチェック用）。
 *  companies 行が無ければ name で作成（upsert）。meeting_done 列が未追加なら案内を返す。 */
export async function setCompanyMeetingDone(name: string, done: boolean): Promise<{ ok: boolean; error?: string }> {
  const n = (name ?? "").trim();
  if (!n) return { ok: false, error: "企業名が空です" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await currentAccess();
  // 明示的に「未」にしたケースを「未設定」と区別するため、off の場合でも meeting_done_at を立てる。
  //   ※ こうしないと、打合せ記録(meeting_count>0)が後から自動で「済」を上書きしてしまい、解除しても外れない事故になる。
  const now = new Date().toISOString();
  const operator = (me?.name ?? "").trim() || null;
  const patch: Record<string, any> = {
    meeting_done: !!done,
    meeting_done_at: now,
    meeting_done_by: operator,
  };

  // 既存行を正規化名（前後/内部の空白・全角空白・不可視文字を除き Unicode NFC した値）で照合し、
  // 見つかったら id 指定で UPDATE する。これをしないと、案件メール由来の名前と
  // 手動入力した名前が「微妙に違う」（末尾の全角空白、ゼロ幅スペース、NFD 等）だけで
  // onConflict("name") が外れて新しい行が挿入され、一覧側の登録行は更新されないという
  // 「保存は成功するのに一覧に反映されない」事故になる。
  const normKey = (s?: string | null) => (s ?? "")
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "") // ゼロ幅スペース/ZWNJ/ZWJ/BOM
    .replace(/[\s　]/g, "");           // 半角/全角の空白すべて
  const target = normKey(n);
  let updated = false;
  try {
    const all: any = await admin.from("companies").select("id, name").limit(50000);
    if (!all.error && Array.isArray(all.data)) {
      const matches = (all.data as any[]).filter((r) => normKey(r.name) === target);
      if (matches.length > 0) {
        const ids = matches.map((m) => m.id);
        // 列未整備時のフォールバックを段階的に試す。
        let r: any = await admin.from("companies").update(patch).in("id", ids);
        if (r.error && /meeting_done_by|column/i.test(r.error.message)) {
          const { meeting_done_by: _b, ...p2 } = patch;
          r = await admin.from("companies").update(p2).in("id", ids);
        }
        if (r.error && /meeting_done_at|column/i.test(r.error.message)) {
          r = await admin.from("companies").update({ meeting_done: !!done }).in("id", ids);
        }
        if (r.error) {
          if (/meeting_done|column/i.test(r.error.message)) return { ok: false, error: "打合せ完了列が未整備です（supabase/companies-meeting-done.sql を実行してください）" };
          return { ok: false, error: r.error.message };
        }
        updated = true;
      }
    }
  } catch { /* 続行してフォールバックの upsert を試す */ }

  if (!updated) {
    // 既存行が見つからなければ新規追加（trim 済み名）。これも列未整備に段階フォールバック。
    const full: Record<string, any> = { name: n, ...patch };
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
  }
  revalidatePath("/companies");
  revalidateTag("approved-companies", "max"); // 案件/人材の承認バッジを即時更新
  return { ok: true };
}

/** 複数企業の「打ち合わせ完了」を一括更新（service role）。
 *   既存の単体トグル(setCompanyMeetingDone)と同じく、監査列が未整備でもフラグ本体は保存。
 *   1名以上失敗してもまとめて結果を返す。 */
export async function bulkSetCompaniesMeetingDone(names: string[], done: boolean): Promise<{ ok: boolean; updated: number; failed?: string[]; error?: string }> {
  const list = Array.from(new Set((names ?? []).map((s) => (s ?? "").trim()).filter(Boolean)));
  if (list.length === 0) return { ok: true, updated: 0 };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, updated: 0, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const me = await currentAccess();
  const now = new Date().toISOString();
  const operator = (me?.name ?? "").trim() || null;
  // 解除(off)した場合も meeting_done_at を立てる（明示的「未」を識別し、自動「済」に上書きされないようにする）。
  const patch: Record<string, any> = {
    meeting_done: !!done,
    meeting_done_at: now,
    meeting_done_by: operator,
  };

  // 単体と同じく、既存行を正規化名（空白/不可視文字除去・NFC）で照合して id 指定 UPDATE。
  // 名前の微差で新行が挿入され「保存できたのに一覧に反映されない」状態を回避する。
  const normKey = (s?: string | null) => (s ?? "")
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[\s　]/g, "");
  const targets = new Set(list.map(normKey));
  const matched: { id: string; name: string }[] = [];
  try {
    const all: any = await admin.from("companies").select("id, name").limit(50000);
    if (!all.error && Array.isArray(all.data)) {
      for (const r of all.data as any[]) {
        if (targets.has(normKey(r.name))) matched.push(r);
      }
    }
  } catch { /* 続行 */ }

  // 既存マッチは id 指定でまとめて UPDATE。
  if (matched.length > 0) {
    const ids = matched.map((m) => m.id);
    let r: any = await admin.from("companies").update(patch).in("id", ids);
    if (r.error && /meeting_done_by|column/i.test(r.error.message)) {
      const { meeting_done_by: _b, ...p2 } = patch;
      r = await admin.from("companies").update(p2).in("id", ids);
    }
    if (r.error && /meeting_done_at|column/i.test(r.error.message)) {
      r = await admin.from("companies").update({ meeting_done: !!done }).in("id", ids);
    }
    if (r.error) {
      if (/meeting_done|column/i.test(r.error.message)) return { ok: false, updated: 0, error: "打合せ完了列が未整備です（supabase/companies-meeting-done.sql を実行してください）" };
      return { ok: false, updated: 0, error: r.error.message };
    }
  }

  // 既存が無かった企業名だけを新規 INSERT（trim 済み名）。
  const matchedKeys = new Set(matched.map((m) => normKey(m.name)));
  const toInsertNames = list.filter((n) => !matchedKeys.has(normKey(n)));
  if (toInsertNames.length > 0) {
    const rows: Record<string, any>[] = toInsertNames.map((n) => ({ name: n, ...patch }));
    let { error } = await admin.from("companies").upsert(rows, { onConflict: "name" });
    if (error && /meeting_done_by|column/i.test(error.message)) {
      const noBy = rows.map(({ meeting_done_by: _b, ...r }) => r);
      ({ error } = await admin.from("companies").upsert(noBy, { onConflict: "name" }));
    }
    if (error && /meeting_done_at|column/i.test(error.message)) {
      const onlyFlag = toInsertNames.map((n) => ({ name: n, meeting_done: !!done }));
      ({ error } = await admin.from("companies").upsert(onlyFlag, { onConflict: "name" }));
    }
    if (error) {
      if (/meeting_done|column/i.test(error.message)) return { ok: false, updated: 0, error: "打合せ完了列が未整備です（supabase/companies-meeting-done.sql を実行してください）" };
      if (/unique|on conflict|companies_name_uniq/i.test(error.message)) return { ok: false, updated: 0, error: "企業名の一意制約が未整備です（supabase/companies-extend.sql を実行してください）" };
      return { ok: false, updated: 0, error: error.message };
    }
  }
  revalidatePath("/companies");
  revalidateTag("approved-companies", "max");
  return { ok: true, updated: list.length };
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
  enger_fb?: string; hit_points?: string; company_type?: string; miss_points?: string; needs?: string;
  strategy?: string; next_action_us?: string; next_action_them?: string;
  competitors?: string[]; competitor_detail?: string; tags?: string[];
  transcript_url?: string; publishable?: string; follow_up_date?: string | null;
  job_info_count?: number | null; cand_info_count?: number | null; // 仕入れKGI：案件/人材情報の獲得件数
};

const toCount0 = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);

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
    company_type: input.company_type?.trim() || null,
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
    job_info_count: toCount0(input.job_info_count),
    cand_info_count: toCount0(input.cand_info_count),
  };
  let { error } = await admin.from("meetings").insert(row);
  // meeting_time / follow_up_date / company_type / *_info_count 列未追加でも落ちないようフォールバック
  if (error && /meeting_time|follow_up_date|company_type|info_count|column/i.test(error.message)) {
    const r2: any = { ...row }; delete r2.meeting_time; delete r2.follow_up_date; delete r2.company_type; delete r2.job_info_count; delete r2.cand_info_count;
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
  setStr("enger_fb"); setStr("hit_points"); setStr("company_type"); setStr("miss_points"); setStr("needs");
  setStr("strategy"); setStr("next_action_us"); setStr("next_action_them");
  if (input.competitors !== undefined) patch.competitors = input.competitors;
  setStr("competitor_detail");
  if (input.tags !== undefined) patch.tags = input.tags;
  setStr("transcript_url"); setStr("publishable"); setStr("follow_up_date");
  if (input.job_info_count !== undefined) patch.job_info_count = toCount0(input.job_info_count);
  if (input.cand_info_count !== undefined) patch.cand_info_count = toCount0(input.cand_info_count);
  let { error } = await admin.from("meetings").update(patch).eq("id", id);
  if (error && /meeting_time|follow_up_date|company_type|info_count|column/i.test(error.message)) {
    const p2: any = { ...patch }; delete p2.meeting_time; delete p2.follow_up_date; delete p2.company_type; delete p2.job_info_count; delete p2.cand_info_count;
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
  detail?: string | null;         // 取込メール原文（ドロワーでは「メール原文」として表示）
  detail_note?: string | null;    // #331⑧：手入力の案件詳細（メール原文とは別の整形メモ）
  status?: string | null;
  contact_name?: string | null;   // 案件窓口の担当者名
  contact_email?: string | null;  // 案件窓口＝元メールの送信元（返信先）
  nationality_requirement?: string | null; // #310：国籍制限（日本国籍のみ/国籍不問/不明）
  freelance_ng?: string | null;    // #368：フリーランスの応募（"NG" / 空欄）
  source_mail_url?: string | null; // 元メール(Gmail)へのURL
  source_mail_at?: string | null;  // 元メール受信日時（最新メールを元メールに残すための比較用）
  operator?: string | null;        // 登録担当（KPI集計用）
  signup_source?: string | null;   // 登録経路（"line" 等）。LINE登録チェックON時に "line"。
};

/** 案件CSVの取り込み (service role)。title+client_name の重複は無視。 */
export async function importJobs(records: JobInput[], sourceLabel: string, operator?: string | null, opts?: { mergeExisting?: boolean; overwrite?: boolean }) {
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
      detail_note: r.detail_note?.trim() || null, // #344：CSVの「案件詳細」列（メール原文=detailとは別）
      // #389：CSVの「フリーランスNG」列。"NG"（大文字小文字不問）→ "NG"、空欄 → null（そのまま反映）。
      //   CSV に列自体が無い場合は undefined のまま（JSON化で落ちる）＝既存値に触れない。
      freelance_ng: r.freelance_ng === undefined ? undefined : ((r.freelance_ng ?? "").toString().trim().toUpperCase() === "NG" ? "NG" : null),
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
  // #389：DB列未整備（SQL未実行）でfail-softが外した列。空でなければ呼び出し元へ返し、
  //   「取り込んだのに反映されない」をサイレントにしない（案件詳細/フリーランスNGが消えた事故の再発防止）。
  const skippedCols = new Set<string>();
  // fail-soft の除外対象（任意列）。バッチ内にこれらの値があるときだけ「保存されなかった列」として報告する。
  const OPTIONAL_JOB_COLS = ["contact_email", "contact_name", "source_mail_url", "operator", "detail_note", "freelance_ng"] as const;
  const noteSkipped = (batch: any[]) => {
    for (const c of OPTIONAL_JOB_COLS) if (batch.some((b) => b[c] != null && b[c] !== "")) skippedCols.add(c);
  };
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
    const FILL = ["role_label", "salary_min", "salary_max", "remote_type", "flow_note", "work_location", "start_date", "detail", "detail_note", "freelance_ng", "status", "contact_name", "contact_email", "source_mail_url", "operator"];
    const mergedRows: any[] = [];
    for (const r of rows) {
      const k = tk(r.title, r.client_name);
      const ex = byKey.get(k);
      if (!ex?.id) { stillNew.push(r); continue; }
      const m: Record<string, any> = { ...ex, is_published: true, imported_at: now };
      for (const f of FILL) {
        const cur = (ex as any)[f];
        const nv = (r as any)[f];
        // overwrite=true：CSVに値があれば上書き。false：既存が空のときだけ補完。
        if (nv != null && nv !== "" && (opts?.overwrite || cur == null || cur === "")) m[f] = nv;
      }
      const curSkills: string[] = Array.isArray(ex.skills) ? ex.skills : [];
      const newSkills: string[] = Array.isArray((r as any).skills) ? (r as any).skills : [];
      if (opts?.overwrite && newSkills.length > 0) {
        m.skills = Array.from(new Set([...newSkills, ...curSkills]));
      } else {
        const union = Array.from(new Set([...curSkills, ...newSkills]));
        if (union.length !== curSkills.length) m.skills = union;
      }
      // #389：上書きモードでは CSV の「フリーランスNG」列の値（NG/空欄）をそのまま反映する。
      //   空欄（null）は FILL の空値スキップに掛かるため、列が存在するときだけ明示的に代入。
      if (opts?.overwrite && (r as any).freelance_ng !== undefined) m.freelance_ng = (r as any).freelance_ng;
      mergedRows.push(m);
    }
    // ★ 一括 upsert（id 衝突＝既存IDの UPDATE）に変更
    if (mergedRows.length > 0) {
      const UB = 300; // detail を含むため小さめ
      for (let i = 0; i < mergedRows.length; i += UB) {
        const slice = mergedRows.slice(i, i + UB);
        let { error, count } = await admin.from("jobs").upsert(slice, { onConflict: "id", count: "exact" });
        if (error && /column/i.test(error.message)) {
          noteSkipped(slice); // #389：外した列を報告（サイレント消失防止）
          const stripped = slice.map((b) => { const o: any = { ...b }; for (const k2 of OPTIONAL_JOB_COLS) delete o[k2]; return o; });
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
    // contact_email / source_mail_url / operator / detail_note / freelance_ng 列が未追加（SQL未実行）でも落ちないよう、その列を外して再試行
    if (error && /contact_email|contact_name|source_mail_url|operator|detail_note|freelance_ng|column/i.test(error.message)) {
      noteSkipped(batch); // #389：外した列を報告（サイレント消失防止）
      const stripped = batch.map((b) => { const o: any = { ...b }; for (const k2 of OPTIONAL_JOB_COLS) delete (o as any)[k2]; return o; });
      ({ error, count } = await admin.from("jobs").upsert(stripped, { onConflict: "title,client_name", ignoreDuplicates: true, count: "exact" }));
    }
    if (error) return { ok: false, inserted, error: error.message };
    inserted += count ?? batch.length;
  }

  revalidatePath("/jobs");
  bustCounts();
  // #389：skippedCols が空でない＝DB列未整備で一部の列が保存されていない（SQL Editor で該当SQLの実行が必要）。
  return { ok: true, inserted, merged, skippedCols: Array.from(skippedCols) };
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

/** 案件の手動1件 upsert。title×client_name で既存があれば更新、無ければ挿入。
 *  updatePolicy で「既存があるときの上書き方針」を制御できる：
 *    - "full"        既定。提供された全項目を上書き
 *    - "price-only"  金額系（salary_min/max/salary_label）のみ上書き
 *    - "period-only" 募集時期系（start_date）のみ上書き
 *    - "fill-empty"  既存が空の項目だけ補完（既に値がある項目は据え置き）
 *    - "skip"        既存があれば何もしない（新規時のみ挿入） */
export type UpdatePolicy = "full" | "price-only" | "period-only" | "fill-empty" | "skip";

const PRICE_FIELDS_JOB = new Set(["salary_min", "salary_max", "salary_label"]);
const PERIOD_FIELDS_JOB = new Set(["start_date"]);
const PRICE_FIELDS_CAND = new Set(["rate", "rate_num"]);
const PERIOD_FIELDS_CAND = new Set(["avail"]);

// 元メール情報（リンク/件名/受信日時）は汎用ループから外し、専用ロジックで「最新メールが勝つ」よう更新する。
const SOURCE_MAIL_FIELDS = new Set(["source_mail_url", "source_mail_subject", "source_mail_at"]);

/**
 * 元メール(受信箱 inbox_emails)の件名を source_mail_url から解決する。
 *   送信確認画面で source_mail_subject が未取得（取込後にメール紐付けされた等）でも、
 *   source_mail_url（＝返信スレッド連結先）があれば受信箱から元件名を引いて
 *   「Re: <元件名>」を表示・送信できるようにする。表示と実送信の件名を一致させるため。
 */
export async function getSourceMailSubject(url?: string | null): Promise<{ ok: boolean; subject?: string | null }> {
  try {
    const id = extractGmailIdFromUrl(url);
    if (!id) return { ok: false };
    const admin = engerAdmin();
    const r: any = await admin.from("inbox_emails").select("subject").eq("gmail_message_id", id).maybeSingle();
    if (r.error) return { ok: false };
    const subject = (r.data?.subject ?? null) as string | null;
    return { ok: true, subject: subject && subject.trim() ? subject.trim() : null };
  } catch {
    return { ok: false };
  }
}

// source_mail_url（16進ID単体 / Gmail URL の #all/<id> / ?th=<id> 等）から Gmail Message-ID を抽出。
function extractGmailIdFromUrl(v?: string | null): string | null {
  if (!v) return null;
  const s = String(v).trim().replace(/^["']+|["']+$/g, "");
  if (!s) return null;
  if (/^[0-9a-f]{8,}$/i.test(s)) return s;
  const m = s.match(/[/#?&](?:th=|all\/|inbox\/|sent\/)?([0-9a-f]{12,})(?:[/?&]|$)/i);
  return m?.[1] ?? null;
}

/**
 * 元メール情報（source_mail_url / source_mail_subject / source_mail_at）の更新分を解決する。
 *   ・取込は received_at 降順（新しい順）で処理されるため、同一案件/人材の新旧メールが
 *     1バッチに混ざると「最後に処理された＝最古」が上書きしてしまう順序依存バグがあった。
 *   ・ここでは受信日時(source_mail_at)で比較し、"新しいメールのときだけ" 上書きする。
 *     これで取込順に関係なく、常に最新メールのリンク/件名が残る
 *     （＝ENGERから送ると最新メールへの返信になる）。
 *   ・price-only / period-only / skip では元メール情報は触らない。
 *   ・fill-empty は既存が空のときだけ補完。
 */
async function resolveSourceMailUpdate(
  admin: ReturnType<typeof engerAdmin>, table: "candidates" | "jobs",
  id: string, row: Record<string, any>, policy: UpdatePolicy,
): Promise<Record<string, any>> {
  if (policy === "price-only" || policy === "period-only" || policy === "skip") return {};
  const incomingUrl = row.source_mail_url ?? null;
  const incomingSubject = row.source_mail_subject ?? null;
  const incomingAt = row.source_mail_at ?? null;
  if (!incomingUrl && !incomingSubject && !incomingAt) return {};

  let existing: any = null;
  try {
    const ex: any = await admin.from(table).select("source_mail_at, source_mail_url").eq("id", id).maybeSingle();
    existing = ex.error ? null : (ex.data ?? null);
  } catch { existing = null; }

  const pack = () => {
    const out: Record<string, any> = {};
    if (incomingUrl) out.source_mail_url = incomingUrl;
    if (incomingSubject) out.source_mail_subject = incomingSubject;
    if (incomingAt) out.source_mail_at = incomingAt;
    return out;
  };

  // fill-empty: 既存に元メールURLが無いときだけ補完
  if (policy === "fill-empty") return existing?.source_mail_url ? {} : pack();

  // full: 最新が勝つ。受信日時で比較。
  const exAt = existing?.source_mail_at ? new Date(existing.source_mail_at).getTime() : null;
  const inAt = incomingAt ? new Date(incomingAt).getTime() : null;
  let overwrite: boolean;
  if (inAt != null && exAt != null) overwrite = inAt >= exAt;       // 双方に日時 → 新しい方を採用
  else if (inAt != null && exAt == null) overwrite = true;          // 既存に日時無 → 新情報で更新
  else if (inAt == null && exAt == null) overwrite = true;          // 双方不明 → 最新登録で更新（従来挙動）
  else overwrite = false;                                           // incoming不明・既存に日時あり → 既存維持
  return overwrite ? pack() : {};
}

export async function upsertJobManual(rec: JobInput, opts?: { updatePolicy?: UpdatePolicy }) {
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
    detail_note: rec.detail_note?.trim() || null, // #344：手入力の案件詳細（メール原文=detailとは別）
    status: rec.status?.trim() || "募集中",
    contact_name: rec.contact_name?.trim() || null,
    contact_email: rec.contact_email?.trim() || null,
    source_mail_url: rec.source_mail_url?.trim() || null,
    source_mail_at: rec.source_mail_at ?? null,
    rank: "-",
    is_published: true,
    source_csv: "manual",
    signup_source: rec.signup_source?.trim() || null,
    operator: rec.operator?.trim() || null,
    owner_company: ownerCompany,
    imported_at: now,
  };

  const stripCols = (o: Record<string, any>) => { const c = { ...o }; delete c.contact_name; delete c.contact_email; delete c.source_mail_url; delete c.source_mail_at; delete c.operator; delete c.owner_company; delete c.signup_source; delete c.detail_note; return c; };
  const policy: UpdatePolicy = opts?.updatePolicy ?? "full";
  // 既存案件を更新・再公開する（複数ヒット時は最若番を採用）
  const updateExisting = async (id: string, jobNo: number, wasPublished: boolean) => {
    // skip: 既存があれば何もしない（新規時のみ挿入したいケース）
    if (policy === "skip") return { ok: true as const, action: "skipped" as const, job_no: jobNo, republished: false };

    // fill-empty: 既存行の値を取得し、既存が空の項目だけ更新対象に含める
    let existingFields: Record<string, any> | null = null;
    if (policy === "fill-empty") {
      const ex: any = await admin.from("jobs").select("*").eq("id", id).maybeSingle();
      existingFields = ex.data ?? null;
    }

    const update: Record<string, any> = { is_published: true, imported_at: now };
    for (const [k, v] of Object.entries(row)) {
      if (k === "is_published" || k === "imported_at" || k === "created_at" || k === "operator" || k === "owner_company") continue; // operator/所有は登録時のみ
      if (SOURCE_MAIL_FIELDS.has(k)) continue; // 元メール情報は下で「最新が勝つ」判定して更新
      if (v == null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (policy === "price-only" && !PRICE_FIELDS_JOB.has(k)) continue;
      if (policy === "period-only" && !PERIOD_FIELDS_JOB.has(k)) continue;
      if (policy === "fill-empty" && existingFields) {
        const cur = existingFields[k];
        if (cur != null && cur !== "" && !(Array.isArray(cur) && cur.length === 0)) continue;
      }
      update[k] = v;
    }
    // 元メール情報は受信日時で「最新メールが勝つ」よう更新（取込順に依存しない）。
    Object.assign(update, await resolveSourceMailUpdate(admin, "jobs", id, row, policy));
    let r: any = await admin.from("jobs").update(update).eq("id", id);
    if (r.error && /contact_email|contact_name|source_mail_url|source_mail_at|owner_company|column/i.test(r.error.message)) {
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
  if (r.error && /contact_email|contact_name|source_mail_url|source_mail_at|owner_company|column/i.test(r.error.message)) {
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

/** 人材の手動1件 upsert。name×company で既存があれば更新、無ければ挿入。
 *  updatePolicy で「既存があるときの上書き方針」を制御できる（UpdatePolicy 型参照）。 */
export async function upsertCandidateManual(rec: CandidateInput, opts?: { updatePolicy?: UpdatePolicy }) {
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
    residence: (rec as any).residence?.trim() || null, // #347/#330：居住地
    exp: rec.exp?.trim() || null,
    status: rec.status?.trim() || "提案可",
    remote_pref: rec.remote_pref?.trim() || null,
    // 新規登録フォーム＋AI抽出で扱う追加属性（要望⑦）。
    age_band: rec.age_band?.trim() || null,
    nationality: rec.nationality?.trim() || null,
    rank: (rec as any).rank?.trim() || null,
    note: rec.note?.trim() || null,                      // #347④：メール原文
    detail_note: (rec as any).detail_note?.trim() || null, // #347⑤：人材詳細
    skill_sheet_url: rec.skill_sheet_url?.trim() || null,
    email: rec.email?.trim() || null,
    contact_email: rec.contact_email?.trim() || null,
    contact_name: rec.contact_name?.trim() || null,
    source_mail_url: rec.source_mail_url?.trim() || null,
    source_mail_subject: rec.source_mail_subject?.trim() || null,
    source_mail_at: rec.source_mail_at ?? null,
    operator: rec.operator?.trim() || null,
    owner_company: ownerCompany,
    score: 0,
    source_csv: "manual",
    signup_source: rec.signup_source?.trim() || null,
    imported_at: now,
  };

  const stripCols = (o: Record<string, any>) => { const c = { ...o }; delete c.email; delete c.contact_email; delete c.contact_name; delete c.source_mail_url; delete c.source_mail_subject; delete c.source_mail_at; delete c.skill_sheet_url; delete c.operator; delete c.owner_company; delete c.remote_pref; delete c.signup_source; delete c.age_band; delete c.nationality; delete c.rank; delete c.note; delete c.detail_note; delete c.residence; return c; };
  const policy: UpdatePolicy = opts?.updatePolicy ?? "full";
  const updateExisting = async (id: string, candidateNo: number) => {
    if (policy === "skip") return { ok: true as const, action: "skipped" as const, candidate_no: candidateNo };

    let existingFields: Record<string, any> | null = null;
    if (policy === "fill-empty") {
      const ex: any = await admin.from("candidates").select("*").eq("id", id).maybeSingle();
      existingFields = ex.data ?? null;
    }

    const update: Record<string, any> = { imported_at: now };
    for (const [k, v] of Object.entries(row)) {
      if (k === "imported_at" || k === "operator" || k === "owner_company") continue; // operator/所有は登録時のみ
      if (SOURCE_MAIL_FIELDS.has(k)) continue; // 元メール情報は下で「最新が勝つ」判定して更新
      if (v == null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (policy === "price-only" && !PRICE_FIELDS_CAND.has(k)) continue;
      if (policy === "period-only" && !PERIOD_FIELDS_CAND.has(k)) continue;
      if (policy === "fill-empty" && existingFields) {
        const cur = existingFields[k];
        if (cur != null && cur !== "" && !(Array.isArray(cur) && cur.length === 0)) continue;
      }
      update[k] = v;
    }
    // 元メール情報は受信日時で「最新メールが勝つ」よう更新（取込順に依存しない）。
    Object.assign(update, await resolveSourceMailUpdate(admin, "candidates", id, row, policy));
    let r: any = await admin.from("candidates").update(update).eq("id", id);
    if (r.error && /skill_sheet_url|email|source_mail_url|source_mail_subject|source_mail_at|owner_company|column/i.test(r.error.message)) {
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
  if (r.error && /skill_sheet_url|email|source_mail_url|source_mail_subject|source_mail_at|owner_company|remote_pref|column/i.test(r.error.message)) {
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
  source?: string; // 登録元（"line" 等）。LINE登録チェックON時に "line" を渡す。
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
  if (input.source?.trim()) insertRow.source = input.source.trim();
  insertRow.stage_updated_at = new Date().toISOString();

  let r: any = await admin.from("proposals").insert(insertRow).select("id").single();
  if (r.error && /stage_updated_at|column/i.test(r.error.message)) {
    const { stage_updated_at: _drop, ...rest } = insertRow;
    r = await admin.from("proposals").insert(rest).select("id").single();
  }
  // source 列が未整備（proposals-source.sql 未適用）の環境では source を外して再試行。
  if (r.error && /source|column/i.test(r.error.message) && "source" in insertRow) {
    const { source: _s, ...rest } = insertRow;
    r = await admin.from("proposals").insert(rest).select("id").single();
  }
  if (r.error && /proposer|partner|closer|client_contact|meeting_date|next_action|column/i.test(r.error.message)) {
    const stripped: Record<string, any> = { ...insertRow };
    delete stripped.proposer; delete stripped.partner; delete stripped.closer;
    delete stripped.client_contact; delete stripped.meeting_date; delete stripped.next_action;
    delete stripped.source;
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
  // #325：使用経験のあるツール・開発環境（text[]）。前後空白除去＋空要素・重複を除去。
  if (fields.tools !== undefined) row.tools = Array.from(new Set((fields.tools ?? []).map((s) => String(s).trim()).filter(Boolean)));
  if (fields.rate !== undefined) { const r = trim(fields.rate); row.rate = r; if (r) { const n = Number((r.match(/\d+/g) ?? []).map(Number).filter((x) => x > 0)[0]); if (Number.isFinite(n)) row.rate_num = n; } }
  if (fields.avail !== undefined) row.avail = trim(fields.avail);
  if (fields.location !== undefined) row.location = trim(fields.location);
  if ((fields as any).residence !== undefined) row.residence = trim((fields as any).residence); // #330④：居住地
  if (fields.remote_pref !== undefined) row.remote_pref = trim(fields.remote_pref);
  if (fields.nationality !== undefined) row.nationality = trim(fields.nationality);
  if (fields.age_band !== undefined) row.age_band = trim(fields.age_band);
  if (fields.exp !== undefined) row.exp = trim(fields.exp);
  if (fields.status !== undefined) row.status = trim(fields.status);
  if (fields.note !== undefined) row.note = trim(fields.note); // #347④：メール原文（旧「備考」）
  if ((fields as any).detail_note !== undefined) row.detail_note = trim((fields as any).detail_note); // #347⑤：人材詳細（メール原文とは別の整形メモ）
  if (fields.skill_sheet_url !== undefined) row.skill_sheet_url = trim(fields.skill_sheet_url);
  if ((fields as any).email !== undefined) row.email = trim((fields as any).email);
  if ((fields as any).contact_email !== undefined) row.contact_email = trim((fields as any).contact_email);
  if ((fields as any).source_mail_url !== undefined) row.source_mail_url = trim((fields as any).source_mail_url);
  if ((fields as any).source_company !== undefined) row.source_company = trim((fields as any).source_company);
  if ((fields as any).flow_depth !== undefined) {
    const v = (fields as any).flow_depth;
    row.flow_depth = (v === null || v === "" || v === undefined) ? null : Number(v);
  }
  if (fields.signup_source !== undefined) row.signup_source = trim(fields.signup_source);
  // source_company の同期：会社名(=company)を変更する場合は source_company も同期しておく
  if (row.company !== undefined && (fields as any).source_company === undefined) row.source_company = row.company;
  // updated_at 列が無い環境（旧スキーマ）でも保存できるよう、stripped で落とせるように。
  const stripped = (o: Record<string, any>) => { const c = { ...o }; delete c.email; delete c.contact_email; delete c.source_mail_url; delete c.skill_sheet_url; delete c.source_company; delete c.flow_depth; delete c.remote_pref; delete c.nationality; delete c.age_band; delete c.signup_source; delete c.tools; delete c.residence; delete c.detail_note; return c; };
  const withoutUpdatedAt = (o: Record<string, any>) => { const c = { ...o }; delete c.updated_at; return c; };
  let r: any = await admin.from("candidates").update(row).eq("candidate_no", candidateNo);
  if (r.error && /updated_at|column|schema cache/i.test(r.error.message)) {
    // updated_at 列がないテーブル定義 → タイムスタンプは省いて再試行
    r = await admin.from("candidates").update(withoutUpdatedAt(row)).eq("candidate_no", candidateNo);
  }
  if (r.error && /skill_sheet_url|email|source_mail_url|source_company|flow_depth|remote_pref|nationality|age_band|signup_source|tools|residence|detail_note|column/i.test(r.error.message)) {
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
  if ((fields as any).detail_note !== undefined) row.detail_note = trim((fields as any).detail_note);
  if (fields.status !== undefined) row.status = trim(fields.status);
  if ((fields as any).contact_name !== undefined) row.contact_name = trim((fields as any).contact_name);
  if ((fields as any).contact_email !== undefined) row.contact_email = trim((fields as any).contact_email);
  if ((fields as any).nationality_requirement !== undefined) row.nationality_requirement = trim((fields as any).nationality_requirement);
  // #368：フリーランスの応募（"NG" or null）。空欄は null に倒す。
  if ((fields as any).freelance_ng !== undefined) { const v = trim((fields as any).freelance_ng); row.freelance_ng = v === "NG" ? "NG" : null; }
  if ((fields as any).source_mail_url !== undefined) row.source_mail_url = trim((fields as any).source_mail_url);
  if ((fields as any).is_published !== undefined) row.is_published = (fields as any).is_published;
  if ((fields as any).accept_flow_depth !== undefined) {
    const v = (fields as any).accept_flow_depth;
    row.accept_flow_depth = (v === null || v === "" || v === undefined) ? null : Number(v);
  }
  if (fields.signup_source !== undefined) row.signup_source = trim(fields.signup_source);
  const OPTIONAL_COLS = ["contact_name", "contact_email", "nationality_requirement", "freelance_ng", "source_mail_url", "accept_flow_depth", "signup_source", "detail_note"];
  const stripped = (o: Record<string, any>) => { const c = { ...o }; for (const k of OPTIONAL_COLS) delete c[k]; return c; };
  const withoutUpdatedAt = (o: Record<string, any>) => { const c = { ...o }; delete c.updated_at; return c; };
  let r: any = await admin.from("jobs").update(row).eq("job_no", jobNo);
  if (r.error && /updated_at|column|schema cache/i.test(r.error.message)) {
    // updated_at 列がない旧スキーマ → タイムスタンプは省いて再試行
    r = await admin.from("jobs").update(withoutUpdatedAt(row)).eq("job_no", jobNo);
  }
  // #310/#331：nationality_requirement / detail_note 等の列が未整備の環境でも保存が通るよう、任意列を外して再試行（fail-soft）。
  // #389：外した列は skipped として返し、呼び出し元が「保存されなかった」と明示できるようにする
  //   （「案件詳細を保存」が成功トーストなのに実際は保存されない事故の再発防止）。
  let skipped: string[] = [];
  if (r.error && /nationality_requirement|freelance_ng|contact_email|contact_name|source_mail_url|accept_flow_depth|signup_source|detail_note|column/i.test(r.error.message)) {
    skipped = OPTIONAL_COLS.filter((k) => k in row);
    r = await admin.from("jobs").update(stripped(withoutUpdatedAt(row))).eq("job_no", jobNo);
  }
  if (r.error) return { ok: false as const, error: r.error.message };
  revalidatePath(`/jobs/${jobNo}`); revalidatePath("/jobs"); bustCounts();
  return { ok: true as const, skipped };
}

// ────────────────────────────────────────────────────────
// 提案メモ（連絡記録/当社→案件側/案件側→当社/当社→人材側/人材側→当社）
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
  // 注意：revalidatePath("/proposals") は呼ばない。提案ボードはメモをサーバ側で読まず
  //   （モーダルが /api/proposals/[id]/memos で個別取得する）、重いボード再レンダリングを
  //   保存のたびに待たされて「保存中…」が固まる原因になっていた。メモはクライアントで再取得する。
  return { ok: true as const, memo: r.data };
}

export async function deleteProposalMemo(memoId: string) {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false as const, error: "サーバ設定エラー" }; }
  if (!memoId) return { ok: false as const, error: "メモIDが必要です" };
  const r: any = await admin.from("proposal_memos").delete().eq("id", memoId);
  if (r.error) return { ok: false as const, error: r.error.message };
  // revalidatePath は呼ばない（addProposalMemo と同じ理由・クライアントで再取得）。
  return { ok: true as const };
}

// ────────────────────────────────────────────────────────
// 受信メール（Gmail 同期・AI抽出・登録）
//   - 同期: Gmail API で最新メールを取得して inbox_emails に保存（AIは使わない・無料）
//   - 抽出: 1通ずつ Claude Haiku に投げて { kind, summary, data } を取得（営業が手動で発火）
//   - 登録: extracted_data から jobs/candidates テーブルに insert（既存 upsert*Manual を流用）
// ────────────────────────────────────────────────────────

// 受信メールの保存済み添付（スキルシート等）。inbox_emails.attachments(jsonb) に格納。
export type InboxAttachment = { name: string; url: string; path: string; size: number; mime: string };

// スキルシートらしい添付か（画像の署名/ロゴは除外、文書・PDF・圧縮を対象）。
const SKILL_SHEET_EXT = /\.(pdf|xlsx?|xlsm|docx?|pptx?|csv|txt|zip|rtf|odt|ods)$/i;
function isLikelySkillSheet(name: string, mime: string): boolean {
  if (SKILL_SHEET_EXT.test(name || "")) return true;
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return false;      // 署名画像・ロゴなどは対象外
  return m.startsWith("application/") || m === "text/plain" || m === "text/csv";
}
// Storage キー用にファイル名を安全化（日本語等は _ に。表示名は元の filename を使う）。
function sanitizeStorageName(name: string): string {
  const base = String(name || "file").split(/[\\/]/).pop() || "file";
  const cleaned = base.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(0, 120);
  return cleaned && cleaned !== "_" ? cleaned : "file";
}

// メールの添付を Storage(skillsheets/inbox/<messageId>/...) に保存し、公開URL配列を返す。
//   ・公開バケットなのでログイン不要の永続URL（本文にリンク表示・DL可）。
//   ・スキルシート系（文書/PDF/圧縮）のみ・最大5件・25MB上限。失敗は握りつぶして続行。
async function persistInboxAttachments(messageId: string, atts: Array<{ filename: string; attachmentId: string; mimeType: string; size: number }>): Promise<InboxAttachment[]> {
  if (!Array.isArray(atts) || atts.length === 0) return [];
  const { fetchAttachment } = await import("./gmail-api");
  let pub: ReturnType<typeof publicAdmin>;
  try { pub = publicAdmin(); } catch { return []; }
  const docs = atts.filter((a) => isLikelySkillSheet(a.filename, a.mimeType)).slice(0, 5);
  const out: InboxAttachment[] = [];
  for (let i = 0; i < docs.length; i++) {
    const a = docs[i];
    if (a.size && a.size > 25 * 1024 * 1024) continue; // 25MB超はスキップ
    try {
      const got = await fetchAttachment(messageId, a.attachmentId);
      if (!got.ok) continue;
      const buf = Buffer.from(got.base64url.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      const path = `inbox/${messageId}/${i}_${sanitizeStorageName(a.filename)}`;
      const up: any = await pub.storage.from("skillsheets").upload(path, buf, { contentType: a.mimeType || "application/octet-stream", upsert: true });
      if (up?.error) continue;
      const url = pub.storage.from("skillsheets").getPublicUrl(path)?.data?.publicUrl;
      if (!url) continue;
      out.push({ name: a.filename, url, path, size: a.size || buf.length, mime: a.mimeType || "" });
    } catch { /* 1件失敗しても続行 */ }
  }
  return out;
}

export async function syncInboxFromGmail(opts?: { query?: string; max?: number; fetchCap?: number }): Promise<{ ok: boolean; synced?: number; skipped?: number; found?: number; remaining?: number; account?: string | null; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const { gmailConfigured, listMessageIds, fetchMessage, getGmailProfile } = await import("./gmail-api");
  if (!gmailConfigured()) return { ok: false, error: "Gmail OAuth 未設定です（GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN を Vercel に設定してください）" };

  // 接続先メールボックスを把握（refresh token が想定アカウントに紐づいているか診断）
  const prof = await getGmailProfile();
  if (!prof.ok) return { ok: false, error: `Gmail 接続エラー ${prof.error}` };
  const account = prof.emailAddress;

  // windowMax：7日以内で「件数把握」する上限（ID取得は軽量なのでページングで多めに拾う）。
  // fetchCap：1回の同期で本文取得する新規上限（Vercel 60s 制限内。超過分は remaining で次回に回す）。
  const windowMax = Math.min(3000, Math.max(1, opts?.max ?? 500));
  const fetchCap = Math.min(600, Math.max(1, opts?.fetchCap ?? 500));
  const list = await listMessageIds({ q: opts?.query ?? `${INBOX_EXCLUDE_QUERY} newer_than:7d`, maxResults: windowMax });
  if (!list.ok) return { ok: false, error: list.error, account };
  if (list.ids.length === 0) return { ok: true, synced: 0, skipped: 0, found: 0, remaining: 0, account };

  // 既存の message_id を取得（重複保存をスキップ）。IN句が長くなりすぎないよう分割して問い合わせ。
  const seen = new Set<string>();
  for (let i = 0; i < list.ids.length; i += 400) {
    const chunk = list.ids.slice(i, i + 400);
    const ex: any = await admin.from("inbox_emails").select("gmail_message_id").in("gmail_message_id", chunk);
    for (const r of (ex.data ?? [])) seen.add(r.gmail_message_id);
  }
  // 新規（未取込）。list.ids は新しい順なので、今回は新しい方から fetchCap 件を取得し、残りは次回同期へ。
  const newIdsAll = list.ids.filter((id) => !seen.has(id));
  const newIds = newIdsAll.slice(0, fetchCap);
  const remaining = newIdsAll.length - newIds.length;

  let synced = 0;
  let skippedBounce = 0;
  // 同時8本で取得（最大500件の初回取込を短縮。Gmail API は概ね 250 quota/秒・messages.get=5units なので余裕）。
  //   ※ 取込は1通ずつ insert するため、途中でタイムアウトしても取得済み分は保存され、次回同期で残りを取得（重複排除あり）。
  const POOL = 8; let idx = 0;
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
    // #292：添付（スキルシート等）を、取込画面に表示される前（＝insert する前）に Storage へ保存し、
    //   公開URL（誰でも閲覧可能）を本文の末尾へ「スキルシート：[URL]」の形でテキスト挿入する。
    //   ・添付が無い/スキルシートらしい添付が1つも保存できない場合は本文を一切変更しない（従来どおり）。
    //   ・列/バケット未整備や保存失敗でも取込自体は止めない（try/catch）。
    let saved: InboxAttachment[] = [];
    let bodyWithSheet = m.body;
    if (m.attachments && m.attachments.length > 0) {
      try {
        saved = await persistInboxAttachments(m.id, m.attachments);
        if (saved.length > 0) {
          const links = saved.map((a) => `スキルシート：${a.url}`).join("\n");
          bodyWithSheet = m.body ? `${m.body}\n\n${links}` : links;
        }
      } catch { /* attachments 列未整備・保存失敗は無視（本文は無変更） */ }
    }
    const insertBase = {
      gmail_message_id: m.id, gmail_thread_id: m.threadId || null,
      subject: m.subject, from_email: m.fromEmail, from_name: m.fromName, to_email: m.toEmail,
      body: bodyWithSheet, body_html: m.bodyHtml || null,
      has_attachment: m.hasAttachment, attachment_names: m.attachmentNames.length ? m.attachmentNames : null,
      received_at: m.receivedAt,
    };
    const ins: any = await admin.from("inbox_emails").insert({ ...insertBase, attachments: saved.length ? saved : null });
    // attachments 列が未整備の環境（列なしDB）向けフォールバック。本文への追記（bodyWithSheet）は維持する。
    if (ins.error && /attachments|column/i.test(ins.error.message ?? "")) await admin.from("inbox_emails").insert(insertBase);
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
  return { ok: true, synced, skipped: seen.size + skippedBounce, found: list.ids.length, remaining, account };
}

// 受信メールを期間指定でエクスポート（ローカル整形用のダウンロード）。
//   ・カレンダーで選んだ from/to（YYYY-MM-DD、JST 基準の当日境界）で received_at を絞る。
//   ・生メール（gmail_message_id/件名/差出人/本文）＋ 既存のAI抽出結果を返す。
//     → gmail_message_id を突き合わせキーにして、ローカルで磨いたプロンプトの結果を後で取り込める。
//   ・CSV/JSONL への整形とファイル保存はクライアント側（Blob ダウンロード）で行う。
export type InboxExportRow = {
  gmail_message_id: string | null;
  received_at: string | null;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  body: string | null;
  has_attachment: boolean | null;
  attachment_names: string[] | null;
  extracted_kind: string | null;
  extracted_summary: string | null;
  extracted_data: any;
  registered_job_no: number | null;
  registered_candidate_no: number | null;
  is_archived: boolean | null;
};

const INBOX_EXPORT_MAX = 20000;      // 安全上限（暴走防止）。実用上は期間内全件が落ちる。
const INBOX_EXPORT_BATCH = 1000;     // PostgREST の max-rows 上限に切られないよう range() で分割取得。

// from/to は「YYYY-MM-DD」（当日境界）または「YYYY-MM-DDTHH:mm」（時刻指定・JST）を受ける。
//   例：2026-06-28T17:00 〜 2026-06-29T13:30 → その時刻範囲のメールだけを書き出す。
function inboxRangeIso(v: string | undefined, side: "from" | "to"): string | null {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return side === "from" ? `${s}T00:00:00+09:00` : `${s}T23:59:59.999+09:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return side === "from" ? `${s}:00+09:00` : `${s}:59.999+09:00`;
  return null;
}

export async function exportInboxEmails(opts: { from?: string; to?: string; includeArchived?: boolean }): Promise<{ ok: boolean; rows?: InboxExportRow[]; count?: number; capped?: boolean; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  const fromIso = inboxRangeIso(opts.from, "from");
  const toIso = inboxRangeIso(opts.to, "to");
  // 1回のクエリだと PostgREST の応答行数上限（既定1000前後）で黙って切られるため、
  // range() で1000件ずつページングして期間内を全件収集する（上限 INBOX_EXPORT_MAX）。
  const rows: InboxExportRow[] = [];
  for (let offset = 0; offset < INBOX_EXPORT_MAX; offset += INBOX_EXPORT_BATCH) {
    let qb: any = admin.from("inbox_emails")
      .select("gmail_message_id, received_at, from_name, from_email, subject, body, has_attachment, attachment_names, extracted_kind, extracted_summary, extracted_data, registered_job_no, registered_candidate_no, is_archived")
      .order("received_at", { ascending: false })
      .range(offset, offset + INBOX_EXPORT_BATCH - 1);
    if (fromIso) qb = qb.gte("received_at", fromIso);
    if (toIso) qb = qb.lte("received_at", toIso);
    if (!opts.includeArchived) qb = qb.eq("is_archived", false);
    const r: any = await qb;
    if (r.error) return { ok: false, error: r.error.message };
    const batch: InboxExportRow[] = r.data ?? [];
    rows.push(...batch);
    if (batch.length < INBOX_EXPORT_BATCH) break; // 期間内を取り切った
  }
  return { ok: true, rows, count: rows.length, capped: rows.length >= INBOX_EXPORT_MAX };
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
const PASTE_EXTRACT_SYSTEM = "あなたはエンジニア人材紹介エージェントの入力補助アシスタントです。LINEやメールで送られてきた自由文から、案件または人材の情報を構造化して抽出します。出力は指定の JSON のみ（説明文・コードブロック不要）。分からない項目は null。ただし『skills（スキル）』は後段のマッチングで相手を探す最重要キーになるため、本文中に出てくる技術キーワード（プログラミング言語・フレームワーク・ライブラリ・クラウド・DB・OS・ミドルウェア・ツール・資格・専門領域）を可能な限り漏れなく拾い、配列で返すこと（表記揺れ・略記もそのまま採用）。本当に技術的記載が一切ない場合のみ空配列にする。";

const PASTE_JOB_PROMPT = (text: string) => `次の文章は「案件（求人）」の情報です。JSON のみ出力してください。
形式:
{
  "title": "案件名(短く)",
  "client_name": "クライアント企業名" | null,
  "role_label": "職種(SE/PM/インフラ等)" | null,
  "skills": ["必須/歓迎/使用技術のスキル名(最大12)"],
  "salary_min": 数値(万) | null,
  "salary_max": 数値(万) | null,
  "remote_type": "full_remote" | "partial_remote" | "onsite" | null,
  "flow_note": "商流の制限(例: 二社下まで)" | null,
  "work_location": "勤務地" | null,
  "start_date": "YYYY-MM-DD または 自由文(例: 即日/6月)" | null,
  "status": "ステータス(例: 募集中)" | null,
  "contact_name": "窓口担当者名" | null,
  "contact_email": "窓口メール（返信先）" | null,
  "source_mail_url": "元メールのURLまたは Gmail メッセージID" | null,
  "detail": "案件詳細：求められる経験/スキル要件・国籍要件・年代制限・業務内容など本文の要点（LINE/メール原文の重要部分を抜粋）"
}
単価は「万」単位の数値に正規化（例: 70万→70, 700,000円→70）。範囲があれば min/max 両方。
skills は最重要。必須スキル・歓迎スキル・使用技術・開発環境として本文に出てくる技術キーワード（言語/FW/ライブラリ/クラウド/DB/OS/ミドルウェア/ツール）を漏れなく抽出する。明示の箇条書きが無くても、業務内容・職種から使用技術を読み取って列挙する。技術的記載が皆無のときのみ空配列。
国籍要件（例: 日本国籍のみ）・年代制限（例: 30代まで）は detail に明示的に書く（抽出元に明記がある場合のみ）。
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
  "location": "希望勤務地（最寄駅含む）" | null,
  "remote_pref": "希望リモート区分(自由文)" | null,
  "status": "ステータス(例: 提案可)" | null,
  "age_band": "年代(例: 20代/30代前半/40代後半)" | null,
  "nationality": "国籍(例: 日本/中国/ベトナム)" | null,
  "rank": "ランク(例: A/B/C / 上級/中級/初級)" | null,
  "contact_name": "窓口担当者名（SES窓口・エージェント担当者の氏名）" | null,
  "contact_email": "窓口メール（返信先）" | null,
  "source_mail_url": "元メールのURLまたは Gmail メッセージID" | null,
  "note": "備考（LINE/メールの原文要約や、本人連絡先・特記事項などの自由テキスト）"
}
skills は最重要。経歴・自己PR・得意分野・職種から、本文に出てくる技術キーワード（言語/FW/ライブラリ/クラウド/DB/OS/ミドルウェア/ツール/資格）を漏れなく抽出する。明示の「スキル：」欄が無くても経歴文・案件実績から技術を読み取って列挙する。技術的記載が皆無のときのみ空配列。
--- 文章 ---
${text}`;

/** 貼り付けテキストを AI で構造化（kind=candidates|jobs）。フォーム初期値用の文字列マップを返す。 */
/** 貼り付けテキストの AI 構造化（認証チェックなし）。サーバ内部・Webhook（LINE WORKS 取込）から再利用する。 */
export async function extractEntityFields(kind: "candidates" | "jobs", text: string): Promise<{ ok: true; fields: Record<string, string>; summary?: string } | { ok: false; error: string }> {
  const raw = (text ?? "").trim();
  if (raw.length < 4) return { ok: false, error: "テキストが短すぎます。LINE/メールの本文を貼り付けてください。" };

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
    fields.status = s(d.status);
    fields.contact_name = s(d.contact_name);
    fields.contact_email = s(d.contact_email);
    // source_mail フィールドは Gmail メッセージID/URL をそのまま受け取り、submit 時に
    // gmailMessageUrl で URL 化される（フォーム側の f.source_mail と一致）。
    fields.source_mail = s(d.source_mail_url);
    fields.detail = s(d.detail);
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
    fields.remote_pref = s(d.remote_pref);
    fields.status = s(d.status);
    fields.age_band = s(d.age_band);
    fields.nationality = s(d.nationality);
    fields.rank = s(d.rank);
    fields.contact_name = s(d.contact_name);
    fields.contact_email = s(d.contact_email);
    fields.source_mail = s(d.source_mail_url);
    fields.note = s(d.note);
  }
  // 空キーは落とす（既存入力を上書きしないため）
  for (const k of Object.keys(fields)) if (!fields[k]) delete fields[k];
  return { ok: true, fields };
}

/** UI（ログインユーザー）向けラッパー。未ログインは拒否したうえで extractEntityFields を呼ぶ。 */
export async function parseEntityText(kind: "candidates" | "jobs", text: string): Promise<{ ok: true; fields: Record<string, string>; summary?: string } | { ok: false; error: string }> {
  const me = await currentAccess();
  if (!me) return { ok: false, error: "未ログインです" };
  return extractEntityFields(kind, text);
}

export async function registerInboxAsJob(inboxId: string, override?: Partial<JobInput>, opts?: { updatePolicy?: UpdatePolicy }): Promise<{ ok: boolean; job_no?: number; action?: string; error?: string }> {
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
    // 元メール受信日時。再取込時に「最新メールを元メールに残す」比較に使う。
    source_mail_at: row.received_at ?? null,
  };
  const res = await upsertJobManual(input, { updatePolicy: opts?.updatePolicy });
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
  return { ok: true, job_no: (res as any).job_no, action: (res as any).action };
}

export async function registerInboxAsCandidate(inboxId: string, override?: Partial<CandidateInput>, opts?: { updatePolicy?: UpdatePolicy }): Promise<{ ok: boolean; candidate_no?: number; action?: string; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  const row: any = (await admin.from("inbox_emails").select("*").eq("id", inboxId).maybeSingle()).data;
  if (!row) return { ok: false, error: "メールが見つかりません" };
  const d = row.extracted_data ?? {};
  // スキルシートが添付で届いた会社向け：本文にリンクが無ければ、保存済み添付の公開URLを採用。
  //   （リンクで送る会社は d.skill_sheet_url を優先、添付で送る会社は attachments[0].url を使う）
  const attachUrl: string | null = Array.isArray(row.attachments)
    ? (row.attachments.find((a: any) => a && typeof a.url === "string" && a.url)?.url ?? null)
    : null;
  const skillSheetUrl = override?.skill_sheet_url ?? d.skill_sheet_url ?? attachUrl ?? null;
  // #268: 添付で届いたスキルシートは本文にURLが載っていないため、人材の本文（note）にも
  //   リンクを追記して「本文で誰でもリンクが見られる」状態にする（リンク送付の会社は本文に既にある）。
  const baseNote = row.body?.slice(0, 1500) ?? null;
  const noteWithSheet = skillSheetUrl && !(baseNote ?? "").includes(skillSheetUrl)
    ? `${baseNote ?? ""}${baseNote ? "\n\n" : ""}スキルシート：\n${skillSheetUrl}`
    : baseNote;
  const input: CandidateInput = {
    name: override?.name ?? d.name ?? row.from_name ?? "(氏名未抽出)",
    title: override?.title ?? d.title ?? null,
    company: override?.company ?? d.company ?? null,
    skills: override?.skills ?? (Array.isArray(d.skills) ? d.skills : []),
    rate: override?.rate ?? d.rate ?? null,
    exp: override?.exp ?? d.exp ?? null,
    remote_pref: override?.remote_pref ?? d.remote_pref ?? null,
    skill_sheet_url: skillSheetUrl,
    note: noteWithSheet,
    contact_email: row.from_email ?? null,
    // 受信アカウント(authuser)付きの正しい原本URLを保存（u/0 固定だと別アカウントで開けない）。
    source_mail_url: gmailMessageUrl(row.gmail_message_id),
    // 元メールの件名スナップショット。送信時に「Re: <元件名>」として返信スレッドに乗せる。
    source_mail_subject: row.subject ?? null,
    // 元メール受信日時。再取込時に「最新メールを元メールに残す」比較に使う。
    source_mail_at: row.received_at ?? null,
  };
  const res = await upsertCandidateManual(input, { updatePolicy: opts?.updatePolicy });
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
  return { ok: true, candidate_no: (res as any).candidate_no, action: (res as any).action };
}

// ────────────────────────────────────────────────────────
// CSV/JSONL 書き戻しインポート（ローカルで整形した抽出結果を DB へ反映）
//   ・gmail_message_id で inbox_emails を突き合わせ、extracted_kind/data を書き戻してから
//     既存の registerInboxAsJob/Candidate（＝upsert*Manual）で登録する。
//   ・【二重登録防止（必須）】2層でガード：
//       Layer A: 既に registered_at のあるメールは既定でスキップ（allowReregister で解除）。
//       Layer B: upsert*Manual が title×client / name×company で既存に統合（新規重複を作らない）。
//   ・dryRun=true で「実行せず結果だけ」を返す（インポート前の二重登録チェックに使う）。
// ────────────────────────────────────────────────────────
export type InboxImportRow = { gmail_message_id?: string; extracted_kind?: string; extracted_summary?: string; extracted_data?: any };
export type InboxImportStatus =
  | "job_new" | "job_merged" | "cand_new" | "cand_merged" | "archived"
  | "already_registered" | "not_found" | "invalid" | "error";
export type InboxImportResult = { gmail_message_id: string; status: InboxImportStatus; detail?: string };
export type InboxImportSummary = {
  total: number; jobNew: number; jobMerged: number; candNew: number; candMerged: number;
  archived: number; alreadyRegistered: number; notFound: number; invalid: number; error: number;
};

function normalizeImportKind(v: unknown): "job" | "candidate" | "skip" | "spam" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  // 曖昧一致で誤判定しないよう限定（例：「求人」は案件、「人材」のみ人材。単独の「人」等は不採用）。
  if (/^job$|案件|求人/.test(s)) return "job";
  if (/^cand|^candidate$|人材/.test(s)) return "candidate";
  if (/^spam$|スパム|迷惑/.test(s)) return "spam";
  if (/^skip$|スキップ|除外|無関係/.test(s)) return "skip";
  return null;
}

// 既存案件番号（title×client_name×owner_company で突合。upsertJobManual と同じキー）。read-only。
async function findExistingJobNo(admin: ReturnType<typeof engerAdmin>, ownerCompany: string | null, title: string, client: string | null): Promise<number | null> {
  let q: any = admin.from("jobs").select("job_no").eq("title", title);
  q = client ? q.eq("client_name", client) : q.is("client_name", null);
  if (ownerCompany != null) q = q.eq("owner_company", ownerCompany); else { try { q = q.is("owner_company", null); } catch { /* 列未整備 */ } }
  const r: any = await q.order("job_no", { ascending: true }).limit(1);
  return r.error ? null : (r.data?.[0]?.job_no ?? null);
}

// 既存人材番号（name×company×owner_company で突合。upsertCandidateManual と同じキー）。read-only。
async function findExistingCandidateNo(admin: ReturnType<typeof engerAdmin>, ownerCompany: string | null, name: string, company: string | null): Promise<number | null> {
  let q: any = admin.from("candidates").select("candidate_no").eq("name", name);
  q = company ? q.eq("company", company) : q.is("company", null);
  if (ownerCompany != null) q = q.eq("owner_company", ownerCompany); else { try { q = q.is("owner_company", null); } catch { /* 列未整備 */ } }
  const r: any = await q.order("candidate_no", { ascending: true }).limit(1);
  return r.error ? null : (r.data?.[0]?.candidate_no ?? null);
}

export async function importInboxExtractions(
  rows: InboxImportRow[],
  opts?: { dryRun?: boolean; allowReregister?: boolean },
): Promise<{ ok: boolean; results?: InboxImportResult[]; summary?: InboxImportSummary; error?: string }> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "取り込む行がありません" };
  if (rows.length > 5000) return { ok: false, error: "一度に取り込める上限（5000行）を超えています。分割してください。" };

  const dryRun = !!opts?.dryRun;
  const allowRe = !!opts?.allowReregister;
  const ownerCompany = await partnerOwnerCompany();
  const nowIso = new Date().toISOString();
  const results: InboxImportResult[] = [];
  // ファイル内重複を実行時と一致させるための追跡（特に dryRun は DB未書込のため自前で見る）。
  const seenGids = new Set<string>();
  const seenJobKeys = new Set<string>();
  const seenCandKeys = new Set<string>();

  for (const raw of rows) {
    const gid = String(raw?.gmail_message_id ?? "").trim();
    if (!gid) { results.push({ gmail_message_id: "(空)", status: "invalid", detail: "gmail_message_id がありません" }); continue; }
    // 同一ファイル内で同じメールが複数行あれば、2件目以降は登録済み扱い（実行時と同じ挙動）。
    if (seenGids.has(gid)) { results.push({ gmail_message_id: gid, status: "already_registered", detail: "同一ファイル内で重複（スキップ）" }); continue; }
    const kind = normalizeImportKind(raw?.extracted_kind);
    const data: any = (raw?.extracted_data && typeof raw.extracted_data === "object" && !Array.isArray(raw.extracted_data)) ? raw.extracted_data : {};
    const summary = raw?.extracted_summary != null ? String(raw.extracted_summary) : null;

    if (data && data._parse_error) { results.push({ gmail_message_id: gid, status: "invalid", detail: "extracted_data のJSONが不正です" }); continue; }
    if (!kind) { results.push({ gmail_message_id: gid, status: "invalid", detail: "kind 不明（job/candidate/skip/spam を指定）" }); continue; }

    // inbox_emails 突き合わせ
    const em: any = (await admin.from("inbox_emails")
      .select("id, subject, from_name, registered_at, registered_job_no, registered_candidate_no")
      .eq("gmail_message_id", gid).maybeSingle()).data;
    if (!em) { results.push({ gmail_message_id: gid, status: "not_found", detail: "未取込。先に Gmail 同期が必要です" }); continue; }

    // Layer A: 既登録は既定でスキップ（二重登録防止）
    if (em.registered_at && !allowRe) {
      const d = em.registered_job_no ? `案件#${em.registered_job_no}` : em.registered_candidate_no ? `人材#${em.registered_candidate_no}` : "登録済";
      results.push({ gmail_message_id: gid, status: "already_registered", detail: `${d}（スキップ）` });
      continue;
    }
    // ここから実際に処理する行として記録（2件目以降の同一gidは上でスキップされる）。
    seenGids.add(gid);
    // 上書き方針：既登録メールの再登録(allowRe)のみ full（意図的な上書き）。新規メールの
    //   既存統合は fill-empty（既存の入力値を壊さない）。allowRe と full を分離する。
    const policy: UpdatePolicy = em.registered_at ? "full" : "fill-empty";

    if (kind === "skip" || kind === "spam") {
      if (!dryRun) {
        await admin.from("inbox_emails").update({
          extracted_kind: kind, extracted_summary: summary, extracted_data: data, extracted_at: nowIso, is_archived: true,
        }).eq("id", em.id);
      }
      results.push({ gmail_message_id: gid, status: "archived", detail: kind === "spam" ? "スパム→アーカイブ" : "スキップ→アーカイブ" });
      continue;
    }

    if (kind === "job") {
      const title = String(data.title ?? em.subject ?? "").trim();
      if (!title) { results.push({ gmail_message_id: gid, status: "invalid", detail: "案件名(title)が空" }); continue; }
      const client = data.client_name ? String(data.client_name).trim() : null;
      const existingNo = await findExistingJobNo(admin, ownerCompany, title, client);
      if (dryRun) {
        // ファイル内の先行行と同キーなら実行時は統合される → dryRun でも統合として表示。
        const key = `${title} ${client ?? ""}`;
        const merged = existingNo != null || seenJobKeys.has(key);
        seenJobKeys.add(key);
        results.push({ gmail_message_id: gid, status: merged ? "job_merged" : "job_new", detail: existingNo ? `既存 案件#${existingNo} に統合` : merged ? "ファイル内の先行行に統合" : `新規（${title}）` });
        continue;
      }
      await admin.from("inbox_emails").update({ extracted_kind: "job", extracted_summary: summary, extracted_data: data, extracted_at: nowIso }).eq("id", em.id);
      const res = await registerInboxAsJob(em.id, undefined, { updatePolicy: policy });
      if (!res.ok) { results.push({ gmail_message_id: gid, status: "error", detail: res.error }); continue; }
      results.push({ gmail_message_id: gid, status: res.action === "updated" ? "job_merged" : "job_new", detail: `案件#${res.job_no}` });
      continue;
    }

    // kind === "candidate"
    const name = String(data.name ?? em.from_name ?? "").trim();
    if (!name) { results.push({ gmail_message_id: gid, status: "invalid", detail: "氏名(name)が空" }); continue; }
    const company = data.company ? String(data.company).trim() : null;
    const existingNo = await findExistingCandidateNo(admin, ownerCompany, name, company);
    if (dryRun) {
      const key = `${name} ${company ?? ""}`;
      const merged = existingNo != null || seenCandKeys.has(key);
      seenCandKeys.add(key);
      results.push({ gmail_message_id: gid, status: merged ? "cand_merged" : "cand_new", detail: existingNo ? `既存 人材#${existingNo} に統合` : merged ? "ファイル内の先行行に統合" : `新規（${name}）` });
      continue;
    }
    await admin.from("inbox_emails").update({ extracted_kind: "candidate", extracted_summary: summary, extracted_data: data, extracted_at: nowIso }).eq("id", em.id);
    const res = await registerInboxAsCandidate(em.id, undefined, { updatePolicy: policy });
    if (!res.ok) { results.push({ gmail_message_id: gid, status: "error", detail: res.error }); continue; }
    results.push({ gmail_message_id: gid, status: res.action === "updated" ? "cand_merged" : "cand_new", detail: `人材#${res.candidate_no}` });
  }

  const summary: InboxImportSummary = {
    total: results.length,
    jobNew: results.filter((r) => r.status === "job_new").length,
    jobMerged: results.filter((r) => r.status === "job_merged").length,
    candNew: results.filter((r) => r.status === "cand_new").length,
    candMerged: results.filter((r) => r.status === "cand_merged").length,
    archived: results.filter((r) => r.status === "archived").length,
    alreadyRegistered: results.filter((r) => r.status === "already_registered").length,
    notFound: results.filter((r) => r.status === "not_found").length,
    invalid: results.filter((r) => r.status === "invalid").length,
    error: results.filter((r) => r.status === "error").length,
  };
  if (!dryRun) { revalidatePath("/mail"); revalidatePath("/jobs"); revalidatePath("/people"); bustCounts(); }
  return { ok: true, results, summary };
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
  updatePolicy?: UpdatePolicy;
}): Promise<{ ok: boolean; registered?: number; failed?: number; error?: string }> {
  if (!Array.isArray(input.items) || input.items.length === 0) return { ok: false, error: "登録対象がありません" };
  let registered = 0, failed = 0;
  const updatePolicy = input.updatePolicy ?? "full";
  for (const it of input.items) {
    try {
      const res = input.kind === "jobs"
        ? await registerInboxAsJob(it.inbox_id, it.override as Partial<JobInput> | undefined, { updatePolicy })
        : await registerInboxAsCandidate(it.inbox_id, it.override as Partial<CandidateInput> | undefined, { updatePolicy });
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
  sender: "enger" | "8grp" | "its"; to: string; subject: string; text: string;
  html?: string | null;
  cc?: string | null; bcc?: string | null; replyTo?: string | null;
  relatedKind?: string | null; relatedId?: string | null;
  // 元メールの Gmail メッセージID（受信箱の gmail_message_id / 16進形式）。
  //   指定すると Gmail API で RFC822 Message-ID を解決し、In-Reply-To / References
  //   ヘッダを付けて送信。Gmail 側で元スレッドに連結された返信として表示される。
  //   未指定または解決失敗時は通常の新規メールとして送信する（フォールバック）。
  originalGmailId?: string | null;
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  // 送信は社内（管理者/エージェント）のみ
  const access = await currentAccess();
  const role = access?.role ?? "admin";
  if (role !== "admin" && role !== "agent") return { ok: false, error: "メール送信の権限がありません" };

  // 差出人表示はメーラ側 (SMTP_*_FROM_NAME) の既定値（無ければアドレス自身）を使う。
  //   個人名で名乗らない方針：取引先には共有メールボックス運用であることを示し、
  //   担当者不在時も他メンバーが対応できる体制をヘッダ上でも明確にする。
  const { SHARED_MAILBOX } = await import("./proposal-constants");
  const { availableSenders, sendMail } = await import("./mailer");

  // 返信先＝共有メールボックス（its@gw.8grp.co.jp）。相手が単純に「返信」しても共有箱に届き、
  //   担当者が不在でも他のメンバーが対応できる。明示指定があればそちらを優先。
  const replyTo = input.replyTo?.trim() || SHARED_MAILBOX;

  // CC に送信者本人（ログイン者）の個人アドレスを自動追加。
  //   返信は共有箱に届きつつ、本人も CC で確認できる（取りこぼし防止）。
  const ccList = (input.cc ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const myEmail = (access?.email ?? "").trim();
  if (myEmail && !ccList.some((a) => a.toLowerCase() === myEmail.toLowerCase())) {
    ccList.push(myEmail);
  }
  const mergedCc = ccList.join(", ") || null;

  // BCC は SHARED_MAILBOX へのコピー（送信内容の共有保管用）。
  //   ただし送信元アドレス自体が SHARED_MAILBOX のとき（sender=its）は、
  //   Gmail が「送信済み」に自動保存するので自己BCCは不要・むしろ二重保存になる。
  const senderProfile = availableSenders().find((s) => s.key === input.sender);
  const senderAddr = (senderProfile?.address ?? "").toLowerCase();
  const sharedAddr = SHARED_MAILBOX.toLowerCase();
  const skipShareBcc = senderAddr === sharedAddr;

  const bccList = (input.bcc ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!skipShareBcc && !bccList.some((a) => a.toLowerCase() === sharedAddr)) {
    bccList.push(SHARED_MAILBOX);
  }
  const mergedBcc = bccList.join(", ") || null;

  // 元メール（受信箱）への返信スレッド連結用に RFC822 Message-ID と件名を解決。
  //   Gmail のスレッド表示は In-Reply-To/References ヘッダだけでなく「件名一致」も用いるため、
  //   返信時は元メールの件名（Re: 付き）に強制する。これにより、件名が元メールと揃わず新規
  //   メール扱いになっていた事象（特に人材側：source_mail_subject 欠落で固定件名にフォールバック）
  //   を、案件側・人材側ともに根本解消する。失敗時はフォールバックで通常（新規）送信。
  let inReplyTo: string | null = null;
  let subjectToSend = input.subject;
  if (input.originalGmailId) {
    try {
      const { fetchOriginalMessageMeta } = await import("./gmail-api");
      const meta = await fetchOriginalMessageMeta(String(input.originalGmailId));
      inReplyTo = meta.messageId;
      if (meta.subject) {
        const s = meta.subject.trim();
        subjectToSend = /^re:/i.test(s) ? s : `Re: ${s}`;
      }
    } catch { /* 解決失敗は無視（フォールバックで新規メール） */ }
  }

  const res = await sendMail({
    sender: input.sender, to: input.to, subject: subjectToSend, text: input.text,
    html: input.html || null,
    cc: mergedCc, bcc: mergedBcc, replyTo,
    inReplyTo,
    references: inReplyTo,
  });
  if (!res.ok) return { ok: false, error: res.error };

  // 送信ログを残す（列未整備でも送信自体は成功扱い）。
  //   SMTP 応答（accepted/rejected/response）も記録して、「アプリは送信成功だが受信者に届かない」
  //   事象（Workspace 側 silent drop 等）を後から追跡できるようにする。
  const smtpResponse = (res as any).response ?? null;
  const smtpAccepted = Array.isArray((res as any).accepted) ? (res as any).accepted.join(", ") : null;
  const smtpRejected = Array.isArray((res as any).rejected) ? (res as any).rejected.join(", ") : null;
  try {
    const admin = engerAdmin();
    const baseRow: Record<string, any> = {
      sender_key: input.sender, from_address: res.from, to_address: input.to,
      cc_address: mergedCc || null, bcc_address: mergedBcc || null,
      subject: subjectToSend, body: input.text, message_id: res.messageId,
      sent_by_email: access?.email ?? null, sent_by_name: access?.name ?? null,
      related_kind: input.relatedKind || null, related_id: input.relatedId || null,
      smtp_response: smtpResponse,
      smtp_accepted: smtpAccepted,
      smtp_rejected: smtpRejected,
    };
    let ir: any = await admin.from("mail_sent").insert(baseRow);
    if (ir.error && /smtp_response|smtp_accepted|smtp_rejected|column/i.test(ir.error.message ?? "")) {
      // smtp_* 列が未マイグレ環境向けフォールバック
      const { smtp_response: _r, smtp_accepted: _a, smtp_rejected: _j, ...legacy } = baseRow;
      ir = await admin.from("mail_sent").insert(legacy);
    }
  } catch { /* ログ失敗は無視 */ }
  return { ok: true, messageId: res.messageId };
}

/** SMTP 接続テスト（管理者）。設定が正しいか本文を送らず確認。 */
export async function testSmtpAction(sender: "enger" | "8grp" | "its"): Promise<{ ok: boolean; error?: string }> {
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
  const { canManageDept } = await import("./roles");
  const isManager = canManageDept(access.teamRole);
  if (input.scope === "team" && access.role !== "admin" && !isManager)
    return { ok: false, error: "チーム目標は管理者/マネージャーのみ設定できます" };

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "DB 接続できません" }; }

  // 個人目標：email が空でも名前から app_users/staff で引き直す（クライアントが email を
  //   解決できなくても admin/マネージャーの保存が通るようにする）。
  let ownerEmail = (input.ownerEmail ?? "").trim().toLowerCase();
  const ownerName = (input.ownerName ?? "").trim();
  if (input.scope === "person" && !ownerEmail && ownerName) {
    try {
      const { ownerMatches } = await import("./owner-match");
      let au: any = await admin.from("app_users").select("name, email, role").in("role", ["admin", "agent"]);
      if (au.error) au = await admin.from("app_users").select("name, email");
      const list = (au.data ?? []) as any[];
      const exact = list.find((u) => String(u?.name ?? "").trim() === ownerName);
      const loose = exact ? null : list.find((u) => ownerMatches(String(u?.name ?? ""), ownerName));
      const matched = exact ?? loose;
      if (matched?.email) ownerEmail = String(matched.email).trim().toLowerCase();
    } catch { /* noop */ }
    if (!ownerEmail) {
      try {
        const st: any = await admin.from("staff").select("name, email").not("email", "is", null);
        const { ownerMatches } = await import("./owner-match");
        const list = (st.data ?? []) as any[];
        const exact = list.find((s) => String(s?.name ?? "").trim() === ownerName);
        const loose = exact ? null : list.find((s) => ownerMatches(String(s?.name ?? ""), ownerName));
        const matched = exact ?? loose;
        if (matched?.email) ownerEmail = String(matched.email).trim().toLowerCase();
      } catch { /* noop */ }
    }
  }

  // 権限：個人目標は admin/マネージャー or 本人のみ。email が解決できていない場合はここで弾く。
  if (input.scope === "person") {
    if (access.role !== "admin" && !isManager && ownerEmail !== access.email.toLowerCase())
      return { ok: false, error: "他人の目標は変更できません" };
    if (!ownerEmail)
      return { ok: false, error: `「${ownerName || "対象メンバー"}」のメールが解決できませんでした。設定→アカウントで該当メンバーのメールを登録してください。` };
  }

  const metrics = Object.entries(input.targets).filter(([, v]) => typeof v === "number" && v >= 0);
  if (metrics.length === 0) return { ok: true };

  // 1週間×1対象×対象指標の既存行を一旦削除してから入れ直す（partial-unique を回避）。
  let del: any = admin.from("kpi_targets").delete()
    .eq("scope", input.scope).eq("week_start", input.weekStart)
    .in("metric", metrics.map(([m]) => m));
  if (input.scope === "person") del = del.eq("owner_email", ownerEmail);
  else                          del = del.eq("team_key", input.teamKey ?? "its");
  const dr = await del;
  if (dr.error) return { ok: false, error: dr.error.message };

  const rows = metrics.map(([metric, target]) => ({
    scope: input.scope,
    owner_email: input.scope === "person" ? ownerEmail : null,
    owner_name:  input.scope === "person" ? (ownerName || null) : null,
    team_key:    input.scope === "team"   ? (input.teamKey    ?? "its") : null,
    week_start:  input.weekStart,
    metric,
    target: target as number,
    updated_at: new Date().toISOString(),
  }));
  const ir = await admin.from("kpi_targets").insert(rows);
  if (ir.error) return { ok: false, error: ir.error.message };
  revalidatePath("/dashboard");
  revalidatePath("/kpi");
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

// タイムカード機能は src/lib/actions/timecard.ts に分割。
//   ※ "use server" ファイルは再エクスポート不可（全エクスポートが async 関数定義である必要が
//     あるため）。利用側は "@/lib/actions/timecard" から直接 import する。
