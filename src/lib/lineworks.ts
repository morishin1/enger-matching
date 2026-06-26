// ============================================================
// LINE WORKS 連携クライアント（Bot API 2.0）
//   ・Webhook 署名検証（Bot Secret による HMAC-SHA256）
//   ・Service Account 認証（OAuth 2.0 / JWT Bearer）→ アクセストークン取得（メモリキャッシュ）
//   ・Bot メッセージ送信（テキスト / カルーセル）
//
// 必要な環境変数（未設定なら lineworksConfigured()=false で全機能 no-op）:
//   LINEWORKS_CLIENT_ID        … API 2.0 アプリの Client ID
//   LINEWORKS_CLIENT_SECRET    … 同 Client Secret
//   LINEWORKS_SERVICE_ACCOUNT  … Service Account（xxx.serviceaccount@example）
//   LINEWORKS_PRIVATE_KEY      … Service Account の秘密鍵(PEM)。改行は \n でエスケープ可
//   LINEWORKS_BOT_ID           … Bot ID（数値）
//   LINEWORKS_BOT_SECRET       … Webhook 署名検証用の Bot Secret
//
// ※ メッセージ JSON / エンドポイントは LINE WORKS Developers の最新仕様に合わせて
//    調整してください（本実装は API 2.0 の一般的な形に準拠）。
// ============================================================
import crypto from "node:crypto";

const CLIENT_ID = process.env.LINEWORKS_CLIENT_ID;
const CLIENT_SECRET = process.env.LINEWORKS_CLIENT_SECRET;
const SERVICE_ACCOUNT = process.env.LINEWORKS_SERVICE_ACCOUNT;
const PRIVATE_KEY = (process.env.LINEWORKS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
const BOT_ID = process.env.LINEWORKS_BOT_ID;
const BOT_SECRET = process.env.LINEWORKS_BOT_SECRET;

const AUTH_URL = "https://auth.worksmobile.com/oauth2/v2.0/token";
const API_BASE = "https://www.worksapis.com/v1.0";

/** 連携に必要な環境変数が揃っているか。未設定時は Webhook 処理を no-op にする。 */
export function lineworksConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && SERVICE_ACCOUNT && PRIVATE_KEY && BOT_ID);
}

/** Webhook 署名（X-WORKS-Signature）を検証する。Bot Secret 未設定時は検証をスキップ（true）。 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!BOT_SECRET) return true; // 署名鍵未設定なら検証しない（開発用）
  if (!signature) return false;
  try {
    const expected = crypto.createHmac("sha256", BOT_SECRET).update(rawBody, "utf8").digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---- アクセストークン（JWT Bearer / メモリキャッシュ）------------------
let cachedToken: { token: string; exp: number } | null = null;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function buildAssertionJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: CLIENT_ID, sub: SERVICE_ACCOUNT, iat: now, exp: now + 3600 }));
  const data = `${header}.${payload}`;
  const sig = crypto.createSign("RSA-SHA256").update(data).sign(PRIVATE_KEY);
  return `${data}.${b64url(sig)}`;
}

async function getAccessToken(): Promise<string | null> {
  if (!lineworksConfigured()) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;
  try {
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        assertion: buildAssertionJwt(),
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        scope: "bot bot.message",
      }),
    });
    if (!res.ok) return null;
    const d: any = await res.json();
    if (!d?.access_token) return null;
    cachedToken = { token: d.access_token, exp: now + (Number(d.expires_in) || 3600) };
    return cachedToken.token;
  } catch {
    return null;
  }
}

// ---- メッセージ送信 ----------------------------------------------------
export type LwTarget = { channelId?: string | null; userId?: string | null };

/** Bot メッセージを送信（グループは channelId、1:1 は userId）。fail-soft。 */
export async function sendBotMessage(target: LwTarget, content: unknown): Promise<{ ok: boolean; error?: string }> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "LINE WORKS 未設定/認証失敗" };
  const dest = target.channelId
    ? `${API_BASE}/bots/${BOT_ID}/channels/${encodeURIComponent(target.channelId)}/messages`
    : target.userId
      ? `${API_BASE}/bots/${BOT_ID}/users/${encodeURIComponent(target.userId)}/messages`
      : null;
  if (!dest) return { ok: false, error: "送信先(channelId/userId)がありません" };
  try {
    const res = await fetch(dest, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) return { ok: false, error: `送信失敗 HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- メッセージ組み立て ------------------------------------------------
export const textMessage = (text: string) => ({ type: "text", text });

export type MatchColumn = { title: string; text: string; url: string };

/** マッチ結果カルーセル（最大10カラム）。各カードは ENGER の該当画面へ飛ぶ uri アクション付き。 */
export function matchCarousel(columns: MatchColumn[]) {
  return {
    type: "carousel",
    columns: columns.slice(0, 10).map((c) => ({
      title: c.title.slice(0, 40),
      text: c.text.slice(0, 100),
      actions: [{ type: "uri", label: "ENGERで開く", uri: c.url }],
    })),
  };
}
