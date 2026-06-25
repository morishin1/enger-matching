import { engerClient, publicAdmin, dbConfigured } from "@/lib/supabase";

export type ChatRole = "company" | "freelance" | "agent";

export type ChatThread = {
  id: string;
  scout_id: string | null;
  engineer_id: string;
  engineer_name: string | null;
  engineer_initials: string | null; // 表示用イニシャル（姓名から導出）
  company: string | null;
  company_email: string | null;
  agent: string | null;
  job_no: number | null;
  job_title: string | null;
  subject: string | null;
  status: string;
  memo: string | null;            // 担当者の手入力メモ
  last_message_at: string;
  created_at: string;
};

// 姓名からイニシャルを作る（例「藤本 太郎」→「藤本」「Taro Yamada」→「T.Y」）。
function initialsOf(name: string | null | undefined): string | null {
  const s = String(name ?? "").trim();
  if (!s) return null;
  // 英字名は各単語の頭文字。日本語名は姓（最初の空白前 or 先頭2文字）。
  if (/^[A-Za-z][A-Za-z.\s'-]*$/.test(s)) {
    const parts = s.split(/\s+/).filter(Boolean);
    return parts.map((p) => p[0]?.toUpperCase()).filter(Boolean).join(".") || null;
  }
  const head = s.split(/\s+|　/)[0] ?? s;
  return head.slice(0, 4);
}

/** engineer_id（profiles.id か email）から ENGERフリーランスの姓名を解決して Map で返す。 */
async function resolveEngineerNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (uniq.length === 0) return out;
  let pub: ReturnType<typeof publicAdmin>;
  try { pub = publicAdmin(); } catch { return out; }
  const uuidLike = uniq.filter((v) => /^[0-9a-f-]{32,36}$/i.test(v));
  const emailLike = uniq.filter((v) => v.includes("@"));
  try {
    if (uuidLike.length) {
      const r: any = await pub.from("profiles").select("id, display_name, name").in("id", uuidLike);
      for (const p of (r.data ?? []) as any[]) { const nm = (p.display_name || p.name || "").trim(); if (p.id && nm) out.set(String(p.id), nm); }
    }
  } catch { /* noop */ }
  try {
    if (emailLike.length) {
      const r: any = await pub.from("profiles").select("email, display_name, name").in("email", emailLike);
      for (const p of (r.data ?? []) as any[]) { const nm = (p.display_name || p.name || "").trim(); if (p.email && nm) out.set(String(p.email), nm); }
    }
  } catch { /* noop */ }
  return out;
}

export type ChatMessage = {
  id: string;
  thread_id: string;
  sender_role: ChatRole;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  created_at: string;
};

export type ChatRead = {
  thread_id: string;
  participant_role: ChatRole;
  participant_id: string;
  last_read_at: string;
};

const THREAD_COLS =
  "id, scout_id, engineer_id, engineer_name, company, company_email, agent, job_no, job_title, subject, status, memo, last_message_at, created_at";
const MSG_COLS = "id, thread_id, sender_role, sender_id, sender_name, body, created_at";

/** 一覧用：スレッド＋最新メッセージのプレビュー＋（自分=agent から見た）未読件数。 */
export type ChatThreadListItem = ChatThread & {
  last_body: string | null;
  last_role: ChatRole | null;
  message_count: number;
  unread: number; // agent から見た未読（自分以外の発言で last_read_at より新しいもの）
};

/**
 * dx（営業）向けにスレッド一覧を取得する。
 * agentId（メール）を渡すと、その担当の最終既読を基準に未読数を計算する。
 */
export async function listChatThreads(agentId?: string | null): Promise<ChatThreadListItem[]> {
  if (!dbConfigured) return [];
  try {
    const sb = engerClient();
    let tr: any = await sb.from("chat_threads").select(THREAD_COLS).order("last_message_at", { ascending: false }).limit(300);
    if (tr.error && /memo|column/i.test(tr.error.message ?? "")) {
      tr = await sb.from("chat_threads").select(THREAD_COLS.replace(", memo", "")).order("last_message_at", { ascending: false }).limit(300);
    }
    const threads = tr.data as any[] | null;
    if (tr.error || !threads?.length) return [];
    const ids = threads.map((t: any) => t.id);
    // ENGERフリーランスの姓名を解決（スナップショットが空でも表示できるように）。
    const nameMap = await resolveEngineerNames(threads.map((t: any) => String(t.engineer_id ?? "")));

    // 対象スレッドのメッセージをまとめて取得し、JS で最新＆未読を集計する。
    const { data: msgs } = await sb
      .from("chat_messages")
      .select("thread_id, sender_role, sender_name, body, created_at")
      .in("thread_id", ids)
      .order("created_at", { ascending: false })
      .limit(5000);
    // agent の最終既読。
    const { data: reads } = await sb
      .from("chat_reads")
      .select("thread_id, last_read_at")
      .eq("participant_role", "agent")
      .eq("participant_id", agentId ?? "")
      .in("thread_id", ids);
    const readAt = new Map<string, string>();
    for (const r of (reads ?? []) as any[]) readAt.set(r.thread_id, r.last_read_at);

    const last = new Map<string, any>();
    const count = new Map<string, number>();
    const unread = new Map<string, number>();
    for (const m of (msgs ?? []) as any[]) {
      // msgs は created_at 降順なので、最初に出会ったものが最新。
      if (!last.has(m.thread_id)) last.set(m.thread_id, m);
      count.set(m.thread_id, (count.get(m.thread_id) ?? 0) + 1);
      const ra = readAt.get(m.thread_id);
      if (m.sender_role !== "agent" && (!ra || m.created_at > ra)) {
        unread.set(m.thread_id, (unread.get(m.thread_id) ?? 0) + 1);
      }
    }

    return (threads as any[]).map((t) => {
      const name = (t.engineer_name && String(t.engineer_name).trim()) || nameMap.get(String(t.engineer_id ?? "")) || null;
      return {
        ...t,
        engineer_name: name,
        engineer_initials: initialsOf(name),
        memo: t.memo ?? null,
        last_body: last.get(t.id)?.body ?? null,
        last_role: (last.get(t.id)?.sender_role ?? null) as ChatRole | null,
        message_count: count.get(t.id) ?? 0,
        unread: unread.get(t.id) ?? 0,
      };
    });
  } catch {
    return [];
  }
}

/** スレッド詳細（本体＋全メッセージ＋参加者ごとの既読）。 */
export async function getChatThread(
  id: string,
): Promise<{ thread: ChatThread; messages: ChatMessage[]; reads: ChatRead[] } | null> {
  if (!dbConfigured) return null;
  try {
    const sb = engerClient();
    let tr: any = await sb.from("chat_threads").select(THREAD_COLS).eq("id", id).maybeSingle();
    if (tr.error && /memo|column/i.test(tr.error.message ?? "")) {
      tr = await sb.from("chat_threads").select(THREAD_COLS.replace(", memo", "")).eq("id", id).maybeSingle();
    }
    const thread = tr.data;
    if (tr.error || !thread) return null;
    const [{ data: messages }, { data: reads }] = await Promise.all([
      sb.from("chat_messages").select(MSG_COLS).eq("thread_id", id).order("created_at", { ascending: true }).limit(2000),
      sb.from("chat_reads").select("thread_id, participant_role, participant_id, last_read_at").eq("thread_id", id),
    ]);
    const nameMap = await resolveEngineerNames([String(thread.engineer_id ?? "")]);
    const name = (thread.engineer_name && String(thread.engineer_name).trim()) || nameMap.get(String(thread.engineer_id ?? "")) || null;
    return {
      thread: { ...thread, engineer_name: name, engineer_initials: initialsOf(name), memo: thread.memo ?? null } as ChatThread,
      messages: (messages ?? []) as ChatMessage[],
      reads: (reads ?? []) as ChatRead[],
    };
  } catch {
    return null;
  }
}

/** 担当(agent)から見た全スレッドの未読合計（ナビのバッジ用）。 */
export async function agentUnreadTotal(agentId?: string | null): Promise<number> {
  const list = await listChatThreads(agentId);
  return list.reduce((n, t) => n + t.unread, 0);
}

/** LP登録一覧（エンジニア）向け：engineer_id ごとのチャット状態。
 *   unread    … 自分(agent)が未読のフリーランス発言数（>0 なら未読バッジ）。
 *   unreplied … スレッドの最新発言が freelance（＝担当が未返信）なら true。
 *   threadId  … 最新スレッド（/chat?t= で開く）。
 */
export type EngineerChatStatus = { threadId: string; unread: number; unreplied: boolean };
export async function listEngineerChatStatus(agentId?: string | null): Promise<Record<string, EngineerChatStatus>> {
  if (!dbConfigured) return {};
  try {
    const sb = engerClient();
    const { data: threads, error } = await sb
      .from("chat_threads")
      .select("id, engineer_id, last_message_at")
      .order("last_message_at", { ascending: false })
      .limit(500);
    if (error || !threads?.length) return {};
    const ids = threads.map((t: any) => t.id);
    const [{ data: msgs }, { data: reads }] = await Promise.all([
      sb.from("chat_messages").select("thread_id, sender_role, created_at").in("thread_id", ids).order("created_at", { ascending: false }).limit(5000),
      sb.from("chat_reads").select("thread_id, last_read_at").eq("participant_role", "agent").eq("participant_id", agentId ?? "").in("thread_id", ids),
    ]);
    const readAt = new Map<string, string>();
    for (const r of (reads ?? []) as any[]) readAt.set(r.thread_id, r.last_read_at);
    const lastByThread = new Map<string, any>();
    const unreadByThread = new Map<string, number>();
    for (const m of (msgs ?? []) as any[]) {
      if (!lastByThread.has(m.thread_id)) lastByThread.set(m.thread_id, m); // created_at 降順なので最初=最新
      const ra = readAt.get(m.thread_id);
      if (m.sender_role === "freelance" && (!ra || m.created_at > ra)) {
        unreadByThread.set(m.thread_id, (unreadByThread.get(m.thread_id) ?? 0) + 1);
      }
    }
    const out: Record<string, EngineerChatStatus> = {};
    for (const t of threads as any[]) {
      const unread = unreadByThread.get(t.id) ?? 0;
      const unreplied = lastByThread.get(t.id)?.sender_role === "freelance";
      const cur = out[t.engineer_id];
      if (!cur) out[t.engineer_id] = { threadId: t.id, unread, unreplied }; // threads は最新順 → 先頭が代表スレッド
      else { cur.unread += unread; cur.unreplied = cur.unreplied || unreplied; }
    }
    return out;
  } catch {
    return {};
  }
}

