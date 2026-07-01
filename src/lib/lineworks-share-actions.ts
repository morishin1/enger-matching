"use server";

// LINE WORKS へ「編集済みの任意テキスト」を送る共有アクション。
//   LineShareButton（雛形の確認・編集モーダル）から呼ぶ。権限は admin / agent のみ。
import { sendBotMessage, textMessage } from "@/lib/lineworks";
import { recordLineworksMessage } from "@/lib/lineworks-messages";
import { currentAccess } from "@/lib/accounts";

const MAX_LEN = 1800; // LINE WORKS text 上限(2000)より安全側に

export async function sendLineworksText(input: { kind: "channel" | "user"; targetId: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) {
    return { ok: false, error: "権限がありません（管理者またはエージェントのみ）" };
  }
  if (!input.targetId) return { ok: false, error: "送信先が未指定です" };
  const text = String(input.text ?? "").trim();
  if (!text) return { ok: false, error: "本文が空です" };
  if (text.length > MAX_LEN) return { ok: false, error: `本文が長すぎます（${text.length}文字 / 上限${MAX_LEN}文字）` };

  const target = input.kind === "channel" ? { channelId: input.targetId } : { userId: input.targetId };
  const res = await sendBotMessage(target, textMessage(text));
  if (res.ok) {
    await recordLineworksMessage({
      target, direction: "outbound", msg_type: "text", body: text,
      sender_name: access.name?.trim() || access.email || "ENGER",
    });
  }
  return res;
}
