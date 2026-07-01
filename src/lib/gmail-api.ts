// Gmail API クライアント（サーバ専用・読取のみ）。受信メールを Supabase へ取り込むために使う。
//   OAuth 2.0 リフレッシュトークン方式。一度発行したら長期利用可能。
//
// 必要な環境変数:
//   GMAIL_CLIENT_ID         OAuth クライアント ID
//   GMAIL_CLIENT_SECRET     OAuth クライアント シークレット
//   GMAIL_REFRESH_TOKEN     一度取得したリフレッシュトークン
//   GMAIL_USER_EMAIL        対象アドレス（オーディット用・任意）

import { Buffer } from "node:buffer";

export function gmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
}

// access_token は1時間で切れるのでモジュール内キャッシュ
let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.exp > Date.now() / 1000 + 30) return cachedToken.token;
  if (!gmailConfigured()) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) return null;
  const data: any = await r.json();
  if (!data?.access_token) return null;
  cachedToken = { token: data.access_token, exp: Math.floor(Date.now() / 1000) + Math.min(3500, Number(data.expires_in ?? 3500)) };
  return cachedToken.token;
}

export type GmailAttachmentMeta = { filename: string; attachmentId: string; mimeType: string; size: number };

export type GmailMessage = {
  id: string;
  threadId: string;
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  toEmail: string | null;
  body: string;
  bodyHtml: string;
  hasAttachment: boolean;
  attachmentNames: string[];
  attachments: GmailAttachmentMeta[];
  receivedAt: string | null;
};

/** メッセージID一覧を取得（既定: 直近1週間・最大100件）。 */
export async function listMessageIds(opts?: { q?: string; maxResults?: number }): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "Gmail 認証情報が未設定です（GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN）" };
  const q = opts?.q ?? "newer_than:7d";
  const max = Math.min(500, opts?.maxResults ?? 100);
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", String(max));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    let detail = "";
    try { const e: any = await r.json(); detail = e?.error?.message ? `: ${e.error.message}` : ""; } catch { /* noop */ }
    return { ok: false, error: `Gmail list HTTP ${r.status}${detail}` };
  }
  const data: any = await r.json();
  const ids: string[] = (data?.messages ?? []).map((m: any) => m.id).filter(Boolean);
  return { ok: true, ids };
}

/** 接続中アカウントのプロフィール（診断用）。どのメールボックスに繋がっているか確認できる。 */
export async function getGmailProfile(): Promise<{ ok: true; emailAddress: string | null; messagesTotal: number | null } | { ok: false; error: string }> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "Gmail 認証情報が未設定です（または refresh token が無効）" };
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    let detail = "";
    try { const e: any = await r.json(); detail = e?.error?.message ? `: ${e.error.message}` : ""; } catch { /* noop */ }
    return { ok: false, error: `Gmail profile HTTP ${r.status}${detail}` };
  }
  const data: any = await r.json();
  return { ok: true, emailAddress: data?.emailAddress ?? null, messagesTotal: typeof data?.messagesTotal === "number" ? data.messagesTotal : null };
}

const headerVal = (headers: any[], name: string): string | null => {
  const lower = name.toLowerCase();
  const h = headers?.find((x: any) => String(x.name).toLowerCase() === lower);
  return h?.value ?? null;
};

function parseFromHeader(raw: string | null): { fromName: string | null; fromEmail: string | null } {
  if (!raw) return { fromName: null, fromEmail: null };
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { fromName: m[1].trim() || null, fromEmail: m[2].trim() || null };
  if (/^[^\s@]+@[^\s@]+$/.test(raw.trim())) return { fromName: null, fromEmail: raw.trim() };
  return { fromName: raw.trim(), fromEmail: null };
}

function decodeBase64Url(b64: string): string {
  try { return Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"); }
  catch { return ""; }
}

function extractParts(payload: any, out: { plain: string[]; html: string[]; attachments: GmailAttachmentMeta[] }): void {
  if (!payload) return;
  const mime = String(payload.mimeType ?? "");
  if (mime === "text/plain" && payload.body?.data) out.plain.push(decodeBase64Url(payload.body.data));
  else if (mime === "text/html" && payload.body?.data) out.html.push(decodeBase64Url(payload.body.data));
  else if (payload.filename && payload.body?.attachmentId) out.attachments.push({
    filename: String(payload.filename),
    attachmentId: String(payload.body.attachmentId),
    mimeType: mime,
    size: Number(payload.body.size ?? 0),
  });
  for (const p of (payload.parts ?? [])) extractParts(p, out);
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

/** 元メールの RFC822 Message-ID ヘッダだけを取得する軽量版。
 *   返信メール送信時に In-Reply-To / References ヘッダへ入れてスレッド連結するために使う。
 *   format=metadata で Message-ID ヘッダのみ要求するため、フル取得より速く・帯域も小さい。
 *   Gmail 認証が未設定／取得失敗時は null（呼び出し側はフォールバックで通常送信）。 */
export async function fetchOriginalMessageId(gmailId: string): Promise<string | null> {
  try {
    if (!gmailId) return null;
    const token = await getAccessToken();
    if (!token) return null;
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}?format=metadata&metadataHeaders=Message-ID`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const data: any = await r.json();
    const headers: any[] = data?.payload?.headers ?? [];
    const raw = headerVal(headers, "Message-ID") ?? headerVal(headers, "Message-Id");
    if (!raw) return null;
    // <abc@example.com> の形式に揃える（無ければ追加）。
    const trimmed = String(raw).trim();
    return /^<.+>$/.test(trimmed) ? trimmed : `<${trimmed.replace(/^<|>$/g, "")}>`;
  } catch {
    return null;
  }
}

/** 元メールの RFC822 Message-ID と Subject をまとめて取得する軽量版。
 *   返信メール送信時の In-Reply-To/References（スレッド連結）＋件名一致（Gmail のスレッド表示は
 *   ヘッダだけでなく件名一致も用いる）に使う。失敗時は両方 null。 */
export async function fetchOriginalMessageMeta(gmailId: string): Promise<{ messageId: string | null; subject: string | null }> {
  const empty = { messageId: null, subject: null };
  try {
    if (!gmailId) return empty;
    const token = await getAccessToken();
    if (!token) return empty;
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return empty;
    const data: any = await r.json();
    const headers: any[] = data?.payload?.headers ?? [];
    const rawId = headerVal(headers, "Message-ID") ?? headerVal(headers, "Message-Id");
    const messageId = rawId
      ? (/^<.+>$/.test(String(rawId).trim()) ? String(rawId).trim() : `<${String(rawId).trim().replace(/^<|>$/g, "")}>`)
      : null;
    const rawSubject = headerVal(headers, "Subject");
    const subject = rawSubject ? String(rawSubject).trim() : null;
    return { messageId, subject };
  } catch {
    return empty;
  }
}

/** メッセージ1件の本体を取得して正規化。 */
export async function fetchMessage(id: string): Promise<{ ok: true; msg: GmailMessage } | { ok: false; error: string }> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "Gmail 認証情報が未設定です" };
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { ok: false, error: `Gmail message HTTP ${r.status}` };
  const data: any = await r.json();
  const headers: any[] = data?.payload?.headers ?? [];
  const subject = headerVal(headers, "Subject");
  const fromRaw = headerVal(headers, "From");
  const { fromName, fromEmail } = parseFromHeader(fromRaw);
  const toEmail = headerVal(headers, "To");
  const dateStr = headerVal(headers, "Date");
  let receivedAt: string | null = null;
  if (dateStr) { const t = new Date(dateStr); if (!isNaN(t.getTime())) receivedAt = t.toISOString(); }
  if (!receivedAt && data?.internalDate) receivedAt = new Date(Number(data.internalDate)).toISOString();

  const parts: { plain: string[]; html: string[]; attachments: GmailAttachmentMeta[] } = { plain: [], html: [], attachments: [] };
  extractParts(data?.payload, parts);
  const bodyHtml = parts.html.join("\n");
  let body = parts.plain.join("\n").trim();
  if (!body && bodyHtml) body = htmlToText(bodyHtml);
  // 本文は16,000文字でカット（DB保存・AI入力コスト節約）
  if (body.length > 16000) body = body.slice(0, 16000) + "\n…(以下省略)";

  return {
    ok: true,
    msg: {
      id: String(data.id), threadId: String(data.threadId ?? ""),
      subject, fromEmail, fromName, toEmail,
      body,
      bodyHtml: bodyHtml.length > 32000 ? bodyHtml.slice(0, 32000) : bodyHtml,
      hasAttachment: parts.attachments.length > 0,
      attachmentNames: parts.attachments.map((a) => a.filename),
      attachments: parts.attachments,
      receivedAt,
    },
  };
}

/** 添付1件の実データ（base64url）を取得する。スキルシートを Storage に保存するために使う。 */
export async function fetchAttachment(messageId: string, attachmentId: string): Promise<{ ok: true; base64url: string; size: number } | { ok: false; error: string }> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "Gmail 認証情報が未設定です" };
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { ok: false, error: `Gmail attachment HTTP ${r.status}` };
  const data: any = await r.json();
  if (!data?.data) return { ok: false, error: "添付データが空です" };
  return { ok: true, base64url: String(data.data), size: Number(data.size ?? 0) };
}
