// ============================================================
// LINE WORKS 取込の「スキル待ち」保留ドラフト（対話補完用）
//   #案件/#人材 でスキルが無い投稿を一時保存し、Bot が聞き返したスキルで登録を完了する。
//   テーブル(supabase/lineworks-pending.sql)が未作成でも webhook 本処理は落とさない（fail-soft）。
// ============================================================
import { engerAdmin, dbConfigured } from "./supabase";
import type { LwTarget } from "./lineworks";

export type PendingDraft = {
  sender_key: string;
  kind: "candidates" | "jobs";
  fields: Record<string, string>;
  reply_target: LwTarget | null;
  created_at: string;
};

const TTL_MS = 60 * 60 * 1000; // 1時間で失効

/** スキル待ちの保留ドラフトを保存（sender_key で 1 件・最新で上書き）。
 *  保存できたら true（＝対話補完が使える）。テーブル未作成等で保存不可なら false（呼び出し側は従来導線にフォールバック）。 */
export async function savePendingDraft(senderKey: string, kind: "candidates" | "jobs", fields: Record<string, string>, replyTarget: LwTarget): Promise<boolean> {
  if (!dbConfigured || !senderKey) return false;
  try {
    const admin = engerAdmin();
    const r: any = await admin.from("lineworks_pending").upsert(
      { sender_key: senderKey, kind, fields, reply_target: replyTarget, created_at: new Date().toISOString() },
      { onConflict: "sender_key" },
    );
    return !r?.error;
  } catch { return false; }
}

/** 保留ドラフトを取得（TTL 超過は無効化して null）。fail-soft。 */
export async function getPendingDraft(senderKey: string): Promise<PendingDraft | null> {
  if (!dbConfigured || !senderKey) return null;
  try {
    const admin = engerAdmin();
    const r: any = await admin.from("lineworks_pending").select("sender_key, kind, fields, reply_target, created_at").eq("sender_key", senderKey).maybeSingle();
    if (r.error || !r.data) return null;
    if (Date.now() - new Date(r.data.created_at).getTime() > TTL_MS) { await clearPendingDraft(senderKey); return null; }
    return r.data as PendingDraft;
  } catch { return null; }
}

/** 保留ドラフトを削除（登録完了・破棄時）。fail-soft。 */
export async function clearPendingDraft(senderKey: string): Promise<void> {
  if (!dbConfigured || !senderKey) return;
  try { const admin = engerAdmin(); await admin.from("lineworks_pending").delete().eq("sender_key", senderKey); } catch { /* noop */ }
}
