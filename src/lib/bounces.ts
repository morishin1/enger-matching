// バウンス（送達不能）レコードの取得ヘルパ。
//   ・マッチング/提案画面で contact_email の送達状態を警告するために使う。
//   ・テーブル未整備でも落ちないようフォールバック。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export type BounceRecord = {
  recipient_email: string;
  bounce_count: number;
  last_bounced_at: string | null;
  last_subject: string | null;
  last_reason: string | null;
};

/** 指定メールアドレスの一括チェック。email(小文字) → BounceRecord のマップを返す。 */
export async function getBouncedSet(emails: (string | null | undefined)[]): Promise<Map<string, BounceRecord>> {
  const out = new Map<string, BounceRecord>();
  if (!dbConfigured) return out;
  const targets = Array.from(new Set(emails.map((e) => (e ?? "").toLowerCase().trim()).filter(Boolean)));
  if (targets.length === 0) return out;
  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }
  try {
    const r: any = await sb.from("bounce_records")
      .select("recipient_email, bounce_count, last_bounced_at, last_subject, last_reason")
      .in("recipient_email", targets);
    for (const row of (r.data ?? []) as BounceRecord[]) {
      out.set(row.recipient_email.toLowerCase(), row);
    }
  } catch { /* bounce_records 未整備 */ }
  return out;
}

/** ダッシュボードのサマリ（件数＋多発トップ）。 */
export async function getBounceSummary(limit = 5): Promise<{ available: boolean; total: number; uniqueRecipients: number; top: BounceRecord[] }> {
  const empty = { available: false, total: 0, uniqueRecipients: 0, top: [] as BounceRecord[] };
  if (!dbConfigured) return empty;
  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }
  try {
    const r: any = await sb.from("bounce_records")
      .select("recipient_email, bounce_count, last_bounced_at, last_subject, last_reason")
      .order("bounce_count", { ascending: false })
      .limit(Math.max(limit, 100));
    const rows = (r.data ?? []) as BounceRecord[];
    const total = rows.reduce((s, x) => s + (x.bounce_count ?? 0), 0);
    return { available: true, total, uniqueRecipients: rows.length, top: rows.slice(0, limit) };
  } catch { return empty; }
}
