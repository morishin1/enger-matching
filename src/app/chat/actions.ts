"use server";

import { revalidatePath } from "next/cache";
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

/** メッセージを投稿する。dx からは既定で agent（営業）として送る。 */
export async function sendChatMessage(input: {
  thread_id: string;
  body: string;
  role?: ChatRole;
}): Promise<Result> {
  const admin = adminOrNull();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" };
  if (!input.thread_id) return { ok: false, error: "スレッドが未指定です" };
  const body = input.body?.trim();
  if (!body) return { ok: false, error: "本文が空です" };

  const access = await currentAccess();
  const role: ChatRole = input.role ?? "agent";
  const sender_id = access?.email ?? null;
  const sender_name = access?.name ?? access?.email ?? "担当";

  const { error } = await admin.from("chat_messages").insert({
    thread_id: input.thread_id,
    sender_role: role,
    sender_id,
    sender_name,
    body,
  });
  if (error) return { ok: false, error: error.message };

  // 送った本人(agent)は読んだ扱いにする。
  if (sender_id) await upsertRead(admin, input.thread_id, "agent", sender_id);
  revalidatePath("/chat");
  return { ok: true };
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

/** スレッドを終了/再開する。 */
export async function setThreadStatus(input: { thread_id: string; status: "open" | "closed" }): Promise<Result> {
  const admin = adminOrNull();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" };
  const { error } = await admin.from("chat_threads").update({ status: input.status }).eq("id", input.thread_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/chat");
  return { ok: true };
}
