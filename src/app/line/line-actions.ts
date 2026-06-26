"use server";

// LINE 会話タブ（/line のトークビュー）用サーバーアクション。
//   ・getLineworksThread : 指定トークのメッセージ履歴を取得
//   ・sendLineworksReply : ENGER からそのトークへテキスト返信（送信＋履歴保存）
// 権限は admin / agent のみ。
import { listLineworksMessages, recordLineworksMessage, type LineworksMessage } from "@/lib/lineworks-messages";
import { sendBotMessage, textMessage } from "@/lib/lineworks";
import { currentAccess } from "@/lib/accounts";

export async function getLineworksThread(
  kind: "channel" | "user",
  targetId: string,
): Promise<{ ok: boolean; error?: string; messages: LineworksMessage[] }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) {
    return { ok: false, error: "権限がありません", messages: [] };
  }
  if (!targetId) return { ok: false, error: "送信先が未指定です", messages: [] };
  const messages = await listLineworksMessages(kind, targetId);
  return { ok: true, messages };
}

export async function sendLineworksReply(input: {
  kind: "channel" | "user";
  targetId: string;
  text: string;
}): Promise<{ ok: boolean; error?: string; message?: LineworksMessage }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) {
    return { ok: false, error: "権限がありません（管理者またはエージェントのみ）" };
  }
  const text = input.text?.trim();
  if (!text) return { ok: false, error: "本文が空です" };
  if (!input.targetId) return { ok: false, error: "送信先が未指定です" };

  const target = input.kind === "channel" ? { channelId: input.targetId } : { userId: input.targetId };
  const res = await sendBotMessage(target, textMessage(text));
  if (!res.ok) return res;

  const op = access.name?.trim() || access.email || "ENGER";
  await recordLineworksMessage({ target, direction: "outbound", msg_type: "text", body: text, sender_name: op });
  return { ok: true };
}
