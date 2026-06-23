// AI応答の共有キャッシュ（enger.ai_cache）。
//   入力が同じなら結果も同じ AI 呼び出し（再ランキング/ブリーフィング/メール抽出）を、
//   インスタンスを跨いでキャッシュして再課金を防ぐ。
//   2層構成: L1=プロセス内 Map（即時・無料、同一インスタンスのヒット用）/ L2=Supabase（共有）。
//   fail-soft: テーブル未作成・接続エラー時は null / no-op を返し、呼び出し側は通常の
//   LLM 呼び出しにフォールバックする（＝従来どおり動く。キャッシュが効かないだけ）。

import { createHash } from "crypto";
import { engerAdmin } from "./supabase";

// L1: プロセス内キャッシュ（インスタンス再起動で消えるが、同一インスタンス内のヒットは即返せる）。
const memo = new Map<string, { at: number; value: unknown }>();
const MEMO_MAX = 500;

/** feature と生キーから固定長のキャッシュキー（sha256 hex）を作る。長い入力でも安全に主キー化できる。 */
const keyOf = (feature: string, raw: string) => createHash("sha256").update(feature + "|" + raw).digest("hex");

/** キャッシュ取得。maxAgeSec より新しいヒットのみ返す。無ければ null（=呼び出し側で計算）。 */
export async function getAiCache<T = unknown>(feature: string, rawKey: string, maxAgeSec: number): Promise<T | null> {
  const key = keyOf(feature, rawKey);
  const m = memo.get(key);
  if (m && Date.now() - m.at <= maxAgeSec * 1000) return m.value as T;
  try {
    const admin = engerAdmin();
    const since = new Date(Date.now() - maxAgeSec * 1000).toISOString();
    const res: any = await admin.from("ai_cache").select("value").eq("key", key).gte("created_at", since).maybeSingle();
    if (res.error || !res.data) return null;
    const value = res.data.value as T;
    memo.set(key, { at: Date.now(), value }); // L1 に昇格
    return value;
  } catch { return null; }
}

/** キャッシュ保存（L1 + L2）。失敗しても本処理は止めない（次回また計算するだけ）。 */
export async function setAiCache(feature: string, rawKey: string, value: unknown): Promise<void> {
  const key = keyOf(feature, rawKey);
  if (memo.size > MEMO_MAX) memo.clear();
  memo.set(key, { at: Date.now(), value });
  try {
    const admin = engerAdmin();
    await admin.from("ai_cache").upsert({ key, feature, value, created_at: new Date().toISOString() }, { onConflict: "key" });
  } catch { /* テーブル未作成等は無視 */ }
}
