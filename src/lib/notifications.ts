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
