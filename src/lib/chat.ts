import { engerClient, dbConfigured } from "@/lib/supabase";

export type ChatRole = "company" | "freelance" | "agent";

export type ChatThread = {
  id: string;
  scout_id: string | null;
  engineer_id: string;
  engineer_name: string | null;
  company: string | null;
  company_email: string | null;
  agent: string | null;
  job_no: number | null;
  job_title: string | null;
  subject: string | null;
  status: string;
  last_message_at: string;
  created_at: string;
};

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
  "id, scout_id, engineer_id, engineer_name, company, company_email, agent, job_no, job_title, subject, status, last_message_at, created_at";
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
    const { data: threads, error } = await sb
      .from("chat_threads")
      .select(THREAD_COLS)
      .order("last_message_at", { ascending: false })
      .limit(300);
    if (error || !threads?.length) return [];
    const ids = threads.map((t: any) => t.id);

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

    return (threads as any[]).map((t) => ({
      ...t,
      last_body: last.get(t.id)?.body ?? null,
      last_role: (last.get(t.id)?.sender_role ?? null) as ChatRole | null,
      message_count: count.get(t.id) ?? 0,
      unread: unread.get(t.id) ?? 0,
    }));
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
    const { data: thread, error } = await sb.from("chat_threads").select(THREAD_COLS).eq("id", id).maybeSingle();
    if (error || !thread) return null;
    const [{ data: messages }, { data: reads }] = await Promise.all([
      sb.from("chat_messages").select(MSG_COLS).eq("thread_id", id).order("created_at", { ascending: true }).limit(2000),
      sb.from("chat_reads").select("thread_id, participant_role, participant_id, last_read_at").eq("thread_id", id),
    ]);
    return {
      thread: thread as ChatThread,
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
