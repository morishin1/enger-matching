"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin, publicAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { normalizeSkills } from "@/lib/skills";
import { classifySource } from "@/lib/engineers";

type Result = { ok: boolean; error?: string };

/** エンジニアへの対応を1件記録（誰が・いつ・何をしたか）。 */
export async function addEngineerAction(input: { engineer_id: string; engineer_name?: string | null; action: string; note?: string | null }): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!input.engineer_id) return { ok: false, error: "対象エンジニアが未指定です" };
  if (!input.action?.trim()) return { ok: false, error: "対応内容が未選択です" };

  const access = await currentAccess();
  const operator = access?.name || access?.email || null;

  const { error } = await admin.from("engineer_actions").insert({
    engineer_id: input.engineer_id,
    engineer_name: input.engineer_name?.trim() || null,
    action: input.action.trim(),
    note: input.note?.trim() || null,
    operator,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/engineers");
  return { ok: true };
}

/** エンジニアへスカウトを送る。対応履歴にも「スカウト送信」を自動記録。 */
export async function sendScout(input: { engineer_id: string; engineer_name?: string | null; job_title?: string | null; message: string }): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!input.engineer_id) return { ok: false, error: "対象エンジニアが未指定です" };
  if (!input.message?.trim()) return { ok: false, error: "スカウト本文が空です" };

  const access = await currentAccess();
  const agent = access?.name || access?.email || null;
  const engineer_name = input.engineer_name?.trim() || null;
  const job_title = input.job_title?.trim() || null;

  const { error } = await admin.from("scouts").insert({
    engineer_id: input.engineer_id,
    engineer_name,
    agent,
    job_title,
    message: input.message.trim(),
    status: "sent",
  });
  if (error) return { ok: false, error: error.message };

  // 履歴にも残す（重複アプローチ防止・引き継ぎ）
  await admin.from("engineer_actions").insert({
    engineer_id: input.engineer_id,
    engineer_name,
    action: "スカウト送信",
    note: job_title ? `案件: ${job_title}` : null,
    operator: agent,
  });

  // 提案管理(返信待ち)にも反映：スカウト後の動きを営業が追えるように（best-effort）
  try {
    if (engineer_name) {
      const cInit = engineer_name.slice(0, 2);
      const { data: dup } = await admin.from("proposals")
        .select("id").eq("candidate_name", engineer_name).eq("job_title", job_title ?? "").is("candidate_id", null).maybeSingle();
      if (!dup?.id) {
        await admin.from("proposals").insert({
          job_id: null, candidate_id: null, stage: "提案済",
          job_title: job_title ?? "（スカウト）", candidate_name: engineer_name, c_init: cInit,
          proposer: agent, ai: false, next_action: "スカウト送信（返信待ち）",
        });
      }
    }
  } catch { /* proposals 未整備でもスカウトは成功 */ }

  revalidatePath("/engineers");
  revalidatePath("/proposals");
  return { ok: true };
}

/** 応募を作成（dx側からも応募を起票できるよう。enger.jp が INSERT する経路と並行）。
 *  作成時は notifications にお知らせを投函（DBトリガー未実行環境でもアプリ側で確実に通知）。 */
export async function createApplication(input: { engineer_id: string; engineer_name?: string | null; job_id?: string | null; job_no?: string | null; job_title?: string | null; message?: string | null }): Promise<{ ok: boolean; existed?: boolean; id?: string; error?: string }> {
  const access = await currentAccess();
  if (!access) return { ok: false, error: "未認証です" };
  if (!input.engineer_id) return { ok: false, error: "engineer_id がありません" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー" }; }
  try {
    // 重複チェック（engineer_id × job_id）。既にあれば既存を返す。
    if (input.job_id) {
      const dup: any = await admin.from("applications").select("id").eq("engineer_id", input.engineer_id).eq("job_id", input.job_id).maybeSingle();
      if (dup.data?.id) return { ok: true, existed: true, id: dup.data.id };
    }
    const ins: any = await admin.from("applications").insert({
      engineer_id: input.engineer_id,
      engineer_name: input.engineer_name ?? null,
      job_id: input.job_id ?? null,
      job_no: input.job_no ?? null,
      job_title: input.job_title ?? null,
      message: input.message ?? null,
      stage: "応募",
    }).select("id").maybeSingle();
    if (ins.error) return { ok: false, error: ins.error.message };
    // 通知（DBトリガーが入っていない環境向け・冗長で安全）
    try {
      await admin.from("notifications").insert({
        recipient: "all",
        title: "新しい応募がありました",
        body: `${input.engineer_name ?? "人材"} さんが「${input.job_title ?? "案件"}」(No.${input.job_no ?? "-"}) に応募しました。`,
        kind: "info",
      });
    } catch { /* 通知失敗は無視 */ }
    revalidatePath("/notifications");
    return { ok: true, existed: false, id: ins.data?.id };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 応募の選考ステージを更新（営業/管理者）。応募→面談合格→稼働を追跡。
 *  ステージ変更時に notifications にお知らせを投函（操作した営業が誰か、どの応募がどう動いたか）。 */
export async function updateApplicationStage(id: string, stage: string): Promise<Result> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません" };
  const allowed = ["応募", "書類選考", "面談", "面談合格", "稼働", "見送り"];
  if (!allowed.includes(stage)) return { ok: false, error: "不正なステージです" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  // 変更前ステージ + 関連情報を取得（通知本文用）
  const prev: any = await admin.from("applications").select("stage, engineer_name, job_title, job_no").eq("id", id).maybeSingle();
  const before = prev?.data?.stage ?? "応募";
  const { error } = await admin.from("applications").update({ stage, stage_updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  // お知らせ投函（担当営業 = 操作した本人。'all' でチーム全員にも見えるように同報）
  try {
    const eng = prev?.data?.engineer_name ?? "—";
    const job = prev?.data?.job_title ?? prev?.data?.job_no ?? "—";
    const op = access?.name?.trim() || access?.email || "管理者";
    const title = `📋 応募ステージ更新：${eng}`;
    const body = [
      `案件：${job}`,
      `変更：${before} → ${stage}`,
      `操作：${op}`,
    ].join("\n");
    await admin.from("notifications").insert([
      { recipient: op, title, body, kind: "info" },
      { recipient: "all", title, body, kind: "info" },
    ]);
  } catch { /* 通知失敗してもステージ更新は成功とする */ }
  revalidatePath("/engineers");
  revalidatePath("/notifications");
  return { ok: true };
}

/** 対応履歴を1件削除（誤記録の取り消し）。 */
export async function deleteEngineerAction(id: string): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!id) return { ok: false, error: "IDが未指定です" };
  const { error } = await admin.from("engineer_actions").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/engineers");
  return { ok: true };
}

/**
 * サイト経由登録のエンジニア(public.profiles)を、enger.candidates に「候補者」として
 * 取り込み、マッチング画面でそのまま使えるようにする。
 *   - 同名(name)で既に取り込み済みなら既存の candidate_no を返す
 *   - source_csv に登録元(エンジャーLP/無限道場LP/...)を記録して辿れるようにする
 */
export async function convertEngineerToCandidate(engineerId: string): Promise<{ ok: boolean; candidate_no?: number; error?: string }> {
  try {
    const pub = publicAdmin();
    const er: any = await pub.from("profiles").select("id, display_name, github_login, name, role, primary_language, skills, estimated_pay_low, estimated_pay_mid, estimated_pay_high, headline, bio, skill_sheet_url, portfolio_url, email").eq("id", engineerId).maybeSingle();
    if (er.error || !er.data) return { ok: false, error: "エンジニアが見つかりません" };
    const e = er.data;
    const name = (e.display_name || e.github_login || e.name || "").trim();
    if (!name) return { ok: false, error: "氏名が取得できません（display_name/github_login/name すべて空）" };
    const src = classifySource(e);

    let admin: ReturnType<typeof engerAdmin>;
    try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
    const existing: any = await admin.from("candidates").select("candidate_no").eq("name", name).limit(1).maybeSingle();
    if (existing.data?.candidate_no) return { ok: true, candidate_no: existing.data.candidate_no };

    const skills = (Array.isArray(e.skills) ? e.skills.map((s: any) => s?.name).filter(Boolean) : []) as string[];
    const allSkills = e.primary_language ? [e.primary_language, ...skills] : skills;
    const rate = e.estimated_pay_mid ? `¥${e.estimated_pay_mid}万`
      : (e.estimated_pay_low && e.estimated_pay_high ? `¥${e.estimated_pay_low}〜${e.estimated_pay_high}万` : null);
    const initials = (name.split(/\s+/)[0]?.[0] ?? "") + (name.split(/\s+/)[1]?.[0] ?? "");

    const row: Record<string, any> = {
      name,
      initials,
      title: e.headline || e.primary_language || null,
      skills: normalizeSkills(allSkills),
      rate,
      exp: e.bio?.toString().slice(0, 500) || null,
      status: "提案可",
      email: e.email || null,
      skill_sheet_url: e.skill_sheet_url || null,
      source_csv: `engineer:${src.key}`,
      imported_at: new Date().toISOString(),
    };
    const stripped = (o: Record<string, any>) => { const c = { ...o }; delete c.email; delete c.skill_sheet_url; return c; };
    let ins: any = await admin.from("candidates").insert(row).select("candidate_no").maybeSingle();
    if (ins.error && /skill_sheet_url|email|column/i.test(ins.error.message)) {
      ins = await admin.from("candidates").insert(stripped(row)).select("candidate_no").maybeSingle();
    }
    if (ins.error) return { ok: false, error: ins.error.message };
    revalidatePath("/people");
    return { ok: true, candidate_no: ins.data?.candidate_no };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
