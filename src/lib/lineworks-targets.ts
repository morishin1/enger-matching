// ============================================================
// LINE WORKS 送信先（ENGER → LINE 共有の宛先候補）
//   Bot が参加するトークから webhook が届いたら、その送信先(channelId / userId)を
//   enger.lineworks_targets に記憶する。マッチング画面の「LINEに送る」で宛先候補に使う。
//   テーブル(supabase/lineworks-targets.sql)が未作成でも本処理は落とさない（fail-soft）。
// ============================================================
import { engerAdmin, dbConfigured } from "./supabase";
import type { LwTarget } from "./lineworks";

export type LineworksTarget = {
  id: string;
  kind: "channel" | "user";
  target_id: string;
  name: string | null;
  last_text: string | null;
  last_seen_at: string;
};

/** webhook で届いたトークの送信先を記憶（最終受信時刻・直近本文を更新）。fail-soft。 */
export async function recordLineworksTarget(t: LwTarget, lastText?: string | null): Promise<void> {
  if (!dbConfigured) return;
  const kind: "channel" | "user" | null = t.channelId ? "channel" : t.userId ? "user" : null;
  const target_id = t.channelId ?? t.userId ?? null;
  if (!kind || !target_id) return;
  try {
    const admin = engerAdmin();
    await admin.from("lineworks_targets").upsert(
      {
        kind,
        target_id,
        last_text: (lastText ?? "").trim().slice(0, 200) || null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "kind,target_id" },
    );
  } catch {
    /* テーブル未作成等でも webhook 本処理は継続させる */
  }
}

/** 記憶済みの送信先を新しい順に取得（「LINEに送る」の宛先プルダウン用）。 */
export async function listLineworksTargets(limit = 30): Promise<LineworksTarget[]> {
  if (!dbConfigured) return [];
  try {
    const admin = engerAdmin();
    const { data, error } = await admin
      .from("lineworks_targets")
      .select("id, kind, target_id, name, last_text, last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []) as LineworksTarget[];
  } catch {
    return [];
  }
}
