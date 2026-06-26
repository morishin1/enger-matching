"use server";

// マッチング画面の「LINEに送る」用サーバーアクション。
//   選択中の 1組（人材 × 案件）を、記憶済みの LINE WORKS トークへ送信する。
//   送信は Bot（service account）経由。権限は admin / agent のみ。
import { sendBotMessage, textMessage, matchCarousel } from "@/lib/lineworks";
import { recordLineworksMessage } from "@/lib/lineworks-messages";
import { currentAccess } from "@/lib/accounts";

const BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://dx.enger.jp").replace(/\/$/, "");

export async function sendMatchToLineworks(input: {
  kind: "channel" | "user";
  targetId: string;
  candidateName: string;
  jobTitle: string;
  personNo?: number | null;
  jobNo?: number | null;
  score?: number | null;
  matchedSkills?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) {
    return { ok: false, error: "権限がありません（管理者またはエージェントのみ）" };
  }
  if (!input.targetId) return { ok: false, error: "送信先が未指定です" };

  const target = input.kind === "channel" ? { channelId: input.targetId } : { userId: input.targetId };
  const scoreText = input.score != null ? `マッチ度${input.score}%` : "";
  const skills = (input.matchedSkills ?? []).slice(0, 4).join(", ");
  // ENGER の該当ペアを開くリンク（人材→案件の絞り込みビュー）。
  const link = `${BASE}/matching?` + [
    input.personNo ? `person=${input.personNo}` : "",
    input.jobNo ? `job=${input.jobNo}` : "",
  ].filter(Boolean).join("&");

  const op = access.name?.trim() || access.email || "ENGER";
  // 1通目：共有の見出しテキスト（誰が・何を共有したか）。
  const headText = `📤 ${op} がマッチを共有しました\n${input.candidateName} × ${input.jobTitle}${scoreText ? `（${scoreText}）` : ""}`;
  const head = await sendBotMessage(target, textMessage(headText));
  if (!head.ok) return head;
  await recordLineworksMessage({ target, direction: "outbound", msg_type: "text", body: headText, sender_name: op });

  // 2通目：カルーセル（1カード）。「ENGERで開く」で該当マッチに直行できる。
  const cols = [
    {
      title: `${input.candidateName} × ${input.jobTitle}`,
      text: [scoreText, skills].filter(Boolean).join(" / ") || "ENGERで詳細を確認",
      url: link,
    },
  ];
  const res = await sendBotMessage(target, matchCarousel(cols));
  if (res.ok) await recordLineworksMessage({ target, direction: "outbound", msg_type: "cards", cards: cols, sender_name: op });
  return res;
}
