// ============================================================
// LINE WORKS メッセージ履歴（ENGER内で「LINEのやりとり」を表示するため）
//   webhook受信(inbound)・Bot/ENGER送信(outbound) を enger.lineworks_messages に保存し、
//   トークルーム(kind+target_id)ごとにスレッド表示する。
//   テーブル(supabase/lineworks-messages.sql)が未作成でも本処理は落とさない（fail-soft）。
// ============================================================
import { engerAdmin, dbConfigured } from "./supabase";
import type { LwTarget } from "./lineworks";

export type LineworksCard = { title: string; text: string; url: string };

export type LineworksMessage = {
  id: string;
  kind: "channel" | "user";
  target_id: string;
  direction: "inbound" | "outbound";
  msg_type: "text" | "cards";
  body: string | null;
  cards: LineworksCard[] | null;
  sender_name: string | null;
  created_at: string;
};

/** LwTarget から (kind, target_id) を取り出す。channelId 優先・どちらも無ければ null。 */
export function targetKindId(t: LwTarget): { kind: "channel" | "user"; target_id: string } | null {
  if (t.channelId) return { kind: "channel", target_id: t.channelId };
  if (t.userId) return { kind: "user", target_id: t.userId };
  return null;
}

/** 1件保存（fail-soft）。 */
export async function recordLineworksMessage(input: {
  target: LwTarget;
  direction: "inbound" | "outbound";
  msg_type?: "text" | "cards";
  body?: string | null;
  cards?: LineworksCard[] | null;
  sender_name?: string | null;
}): Promise<void> {
  if (!dbConfigured) return;
  const ki = targetKindId(input.target);
  if (!ki) return;
  try {
    const admin = engerAdmin();
    await admin.from("lineworks_messages").insert({
      kind: ki.kind,
      target_id: ki.target_id,
      direction: input.direction,
      msg_type: input.msg_type ?? "text",
      body: input.body ?? null,
      cards: input.cards ?? null,
      sender_name: input.sender_name ?? null,
    });
  } catch {
    /* テーブル未作成等でも webhook 本処理は継続させる */
  }
}

/** 指定トークのメッセージを古い順に取得（スレッド表示用）。 */
export async function listLineworksMessages(
  kind: "channel" | "user",
  target_id: string,
  limit = 300,
): Promise<LineworksMessage[]> {
  if (!dbConfigured || !target_id) return [];
  try {
    const admin = engerAdmin();
    const { data, error } = await admin
      .from("lineworks_messages")
      .select("id, kind, target_id, direction, msg_type, body, cards, sender_name, created_at")
      .eq("kind", kind)
      .eq("target_id", target_id)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) return [];
    return (data ?? []) as LineworksMessage[];
  } catch {
    return [];
  }
}
