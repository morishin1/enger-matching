import { engerClient, dbConfigured } from "./supabase";

export type Notification = { id: string; recipient: string; title: string; body: string | null; kind: string; created_at: string; read_at: string | null };

/** 本人宛＋全体宛のお知らせを取得（新しい順）。 */
export async function listNotifications(name: string | null): Promise<Notification[]> {
  if (!dbConfigured) return [];
  try {
    const sb = engerClient();
    let q = sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(50);
    if (name) q = q.or(`recipient.eq.${name},recipient.eq.all`);
    else q = q.eq("recipient", "all");
    const { data, error } = await q;
    if (error || !data) return [];
    return data as Notification[];
  } catch { return []; }
}

export async function unreadCount(name: string | null): Promise<number> {
  const list = await listNotifications(name);
  return list.filter((n) => !n.read_at).length;
}

/** 日報への返信（kind=feedback）の未読件数。ダッシュボード/日報の「新着返信」表示に使う。 */
export async function unreadReplyCount(name: string | null): Promise<number> {
  if (!name || !dbConfigured) return 0;
  try {
    const sb = engerClient();
    const { count, error } = await sb.from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient", name).eq("kind", "feedback").is("read_at", null);
    if (error) return 0;
    return count ?? 0;
  } catch { return 0; }
}
