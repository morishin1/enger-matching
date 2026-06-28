"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import type { ChatRole } from "@/lib/chat";

type Result = { ok: boolean; error?: string };

function adminOrNull() {
  try {
    return engerAdmin();
  } catch {
    return null;
  }
}

// スレッド作成・削除・タイトル/メモ編集は ENGERdx スタッフ（admin/agent）のみ。
//   人材(フリーランス)・企業ロールには許可しない（これらの操作は人材側に出さない前提）。
async function requireStaff(): Promise<{ ok: true; agent: string | null } | { ok: false; error: string }> {
  const access = await currentAccess();
  const role = access?.role ?? "";
  if (role !== "admin" && role !== "agent") return { ok: false, error: "権限がありません（ENGERスタッフのみ）" };
  return { ok: true, agent: access?.name ?? access?.email ?? null };
}

/**
 * スカウトを起点にスレッドを用意する（無ければ作成、既にあれば既存を返す）。
 * scout_id に一意制約があるため、二重生成は DB 側でも防がれる。
 */
export async function ensureThreadForScout(input: {
  scout_id: string;
  engineer_id: string;
  engineer_name?: string | null;
  company?: string | null;
  job_no?: number | null;
  job_title?: string | null;
  agent?: string | null;
}): Promise<{ ok: boolean; thread_id?: string; error?: string }> {
  const admin = adminOrNull();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" };
  if (!input.engineer_id) return { ok: false, error: "対象フリーランスが未指定です" };

  const { data: existing } = await admin.from("chat_threads").select("id").eq("scout_id", input.scout_id).maybeSingle();
  if (existing?.id) return { ok: true, thread_id: existing.id };

  const access = await currentAccess();
  const agent = input.agent ?? access?.name ?? access?.email ?? null;
  const { data, error } = await admin
    .from("chat_threads")
    .insert({
      scout_id: input.scout_id,
      engineer_id: input.engineer_id,
      engineer_name: input.engineer_name?.trim() || null,
      company: input.company?.trim() || null,
      agent,
      job_no: input.job_no ?? null,
      job_title: input.job_title?.trim() || null,
      subject: input.job_title?.trim() || null,
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/chat");
  return { ok: true, thread_id: data?.id };
}

/** メッセージを投稿する。dx からは既定で agent（営業）として送る。
 *  抜本対応：例外を投げず必ず Result を返す／sender_id 列型の差異を吸収／
 *  権限(RLS/grant)エラーは原因が分かるメッセージにして supabase/chat-fix.sql の実行を促す。 */
export async function sendChatMessage(input: {
  thread_id: string;
  body: string;
  role?: ChatRole;
}): Promise<Result> {
  try {
    const admin = adminOrNull();
    if (!admin) return { ok: false, error: "送信用のサーバ設定が未完了です（SUPABASE_SERVICE_ROLE_KEY 未設定）。" };
    if (!input.thread_id) return { ok: false, error: "スレッドが未指定です" };
    const body = input.body?.trim();
    if (!body) return { ok: false, error: "本文が空です" };

    // セッション解決に失敗しても送信は続行（送信者名は既定値）。
    let access: Awaited<ReturnType<typeof currentAccess>> = null;
    try { access = await currentAccess(); } catch { /* noop */ }
    const role: ChatRole = input.role ?? "agent";
    const sender_id = access?.email ?? null;
    const sender_name = access?.name ?? access?.email ?? "担当";

    // 本番(enger-lp 由来)の chat_messages には sender_kind(NOT NULL) 列があることがある。
    //   ・sender_kind には sender_role と同義の値(agent/company/freelance)を入れる。
    //   ・列が無い/別CHECKで弾かれる環境では sender_kind を外して再挿入（NULL は CHECK を通過）。
    //   ・sender_id は uuid 型の旧環境では email を入れられないため null フォールバック。
    const baseRow = { thread_id: input.thread_id, sender_role: role, sender_name, body };
    const attempts: Array<Record<string, any>> = [
      { sender_id, sender_kind: role },
      { sender_id: null, sender_kind: role },
      { sender_id },
      { sender_id: null },
    ];
    let error: any = null;
    for (const extra of attempts) {
      ({ error } = await admin.from("chat_messages").insert({ ...baseRow, ...extra }));
      if (!error) break;
      // フォールバックで解消しうるエラー(sender_id 型 / sender_kind 列)以外は即中断して報告。
      if (!/uuid|invalid input syntax|sender_id|sender_kind|column .* does not exist/i.test(error.message ?? "")) break;
    }
    if (error) {
      // 権限(RLS/grant)・制約・列欠落エラーは、本番スキーマ未適用が原因のことが多い。対処を明示して返す。
      if (/row-level security|permission denied|violates|relation .* does not exist|column .* does not exist/i.test(error.message ?? "")) {
        return { ok: false, error: `チャットの送信に失敗しました：${error.message}\n中央Supabaseで supabase/chat-fix.sql を実行してください（権限/列/ポリシー未適用の可能性）。` };
      }
      return { ok: false, error: error.message };
    }

    // 送った本人(agent)は読んだ扱いにする（既読列が uuid 型だと email で失敗するため、失敗は無視）。
    if (sender_id) { try { await upsertRead(admin, input.thread_id, "agent", sender_id); } catch { /* noop */ } }
    revalidatePath("/chat");
    revalidateTag("sidebar-counts", "max"); // 送信＝自分は既読化。未読ドットの状態を更新。
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "送信に失敗しました（不明なエラー）" };
  }
}

/** 担当(agent)の既読を更新する。 */
export async function markThreadRead(input: { thread_id: string }): Promise<Result> {
  const admin = adminOrNull();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" };
  const access = await currentAccess();
  const id = access?.email;
  if (!id) return { ok: false, error: "アカウント未確認" };
  const r = await upsertRead(admin, input.thread_id, "agent", id);
  if (!r.ok) return r;
  revalidatePath("/chat");
  revalidateTag("sidebar-counts", "max"); // 既読化したらサイドバーの未読ドットを即時更新。
  return { ok: true };
}

async function upsertRead(
  admin: NonNullable<ReturnType<typeof adminOrNull>>,
  thread_id: string,
  participant_role: ChatRole,
  participant_id: string,
): Promise<Result> {
  const { error } = await admin
    .from("chat_reads")
    .upsert(
      { thread_id, participant_role, participant_id, last_read_at: new Date().toISOString() },
      { onConflict: "thread_id,participant_role,participant_id" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** スレッドのメモ（担当者の手入力・社内専用）を保存する。
 *  保存先はスタッフ専用テーブル chat_thread_memos（service roleのみ。人材には grant されない）。 */
export async function saveThreadMemo(input: { thread_id: string; memo: string }): Promise<Result> {
  const admin = adminOrNull();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" };
  const staff = await requireStaff();
  if (!staff.ok) return staff;
  if (!input.thread_id) return { ok: false, error: "スレッドが未指定です" };
  const memo = (input.memo ?? "").trim() || null;
  const { error } = await admin.from("chat_thread_memos").upsert(
    { thread_id: input.thread_id, memo, updated_at: new Date().toISOString() },
    { onConflict: "thread_id" },
  );
  if (error) {
    if (/chat_thread_memos|relation|does not exist/i.test(error.message)) return { ok: false, error: "メモ用テーブルが未作成です。supabase/chat-thread-memos.sql を実行してください。" };
    return { ok: false, error: error.message };
  }
  revalidatePath("/chat");
  return { ok: true };
}

/** スレッドのタイトル（subject）を保存する。subject は人材側からも参照可能（双方に表示）。 */
export async function updateThreadSubject(input: { thread_id: string; subject: string }): Promise<Result> {
  const admin = adminOrNull();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" };
  const staff = await requireStaff();
  if (!staff.ok) return staff;
  if (!input.thread_id) return { ok: false, error: "スレッドが未指定です" };
  const subject = (input.subject ?? "").trim() || null;
  const { error } = await admin.from("chat_threads").update({ subject }).eq("id", input.thread_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/chat");
  return { ok: true };
}

/** 新規スレッドを作成する（ENGERスタッフのみ）。engineer_id は public.profiles.id。
 *  抜本対応：例外を投げず必ず Result を返す／権限(RLS/grant)・列欠落エラーは原因が分かる
 *  メッセージにして supabase/chat-fix.sql の実行を促す（メッセージ送信と同方針）。 */
export async function createThread(input: { engineer_id: string; engineer_name?: string | null; subject?: string | null }): Promise<{ ok: boolean; thread_id?: string; error?: string }> {
  try {
    const admin = adminOrNull();
    if (!admin) return { ok: false, error: "スレッド作成用のサーバ設定が未完了です（SUPABASE_SERVICE_ROLE_KEY 未設定）。" };
    const staff = await requireStaff();
    if (!staff.ok) return { ok: false, error: staff.error };
    if (!input.engineer_id) return { ok: false, error: "対象フリーランスを選択してください" };
    // enger-lp 由来の chat_threads には dx が値を入れていない NOT NULL 列があることがあり、
    //   「null value in column "X" violates not-null constraint」で作成に失敗する（新規スレッド作成の真因）。
    //   どの列が必須かはアプリ側で分からないため、エラーが指す列を空文字で順次補って再試行する
    //   （text 列はこれで通る。enum/数値等で通らない場合は下の診断メッセージへ）。
    const row: Record<string, any> = {
      engineer_id: input.engineer_id,
      engineer_name: input.engineer_name?.trim() || null,
      agent: staff.agent,
      subject: input.subject?.trim() || null,
      status: "open",
    };
    let data: any = null, error: any = null;
    for (let i = 0; i < 8; i++) {
      const r = await admin.from("chat_threads").insert(row).select("id").maybeSingle();
      data = r.data; error = r.error;
      if (!error) break;
      const m = /null value in column "([^"]+)"/i.exec(error.message ?? "");
      if (m && m[1] && !(m[1] in row)) { row[m[1]] = ""; continue; } // 未設定の NOT NULL 列を空文字で補完して再試行
      break;
    }
    if (error) {
      // 権限(RLS/grant)・列欠落・NOT NULL/CHECK 制約エラーは本番スキーマ未適用が原因のことが多い。対処を明示。
      if (/row-level security|permission denied|violates|relation .* does not exist|column .* does not exist/i.test(error.message ?? "")) {
        return { ok: false, error: `新規スレッドの作成に失敗しました：${error.message}\n中央Supabaseで supabase/chat-fix.sql を実行してください（権限/列/NOT NULL制約の可能性）。` };
      }
      return { ok: false, error: error.message };
    }
    revalidatePath("/chat");
    revalidateTag("sidebar-counts", "max");
    return { ok: true, thread_id: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新規スレッドの作成に失敗しました（不明なエラー）" };
  }
}

/** スレッドを削除する（ENGERスタッフのみ）。
 *  messages / reads / memos は ON DELETE CASCADE で連動削除されるため、人材側からも内容が見えなくなる。 */
export async function deleteThread(input: { thread_id: string }): Promise<Result> {
  const admin = adminOrNull();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" };
  const staff = await requireStaff();
  if (!staff.ok) return staff;
  if (!input.thread_id) return { ok: false, error: "スレッドが未指定です" };
  const { error } = await admin.from("chat_threads").delete().eq("id", input.thread_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/chat");
  return { ok: true };
}
