// Slack Incoming Webhook 通知ヘルパ。
//   SLACK_WEBHOOK_URL が未設定なら静かに skip（ローカル/プレビュー環境でエラーにしない）。
//   送信失敗もログだけ残してユーザー操作は止めない（通知はあくまでオマケ）。
//
// 設定:
//   SLACK_WEBHOOK_URL    Slack Incoming Webhook の URL（必須・コードに直書きしない）
//   NEXT_PUBLIC_APP_URL  リンク先のベース URL（例: https://dx.enger.jp）。未設定時は相対パスのみ表示。

const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

/** ベース URL を付けた絶対 URL を返す。未設定なら相対のまま。 */
export const appUrl = (path: string): string => (BASE_URL ? `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}` : path);

/** Slack に通知。失敗時も例外にしない。 */
export async function notifySlack(payload: { text: string; blocks?: any[] }): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { ok: true, skipped: true };
  try {
    const body = JSON.stringify(payload.blocks ? { text: payload.text, blocks: payload.blocks } : { text: payload.text });
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.warn("[slack] webhook responded", res.status, await res.text().catch(() => ""));
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    console.warn("[slack] webhook failed", e?.message ?? e);
    return { ok: false, error: String(e?.message ?? e) };
  }
}
