// Google Drive サービスアカウント認証＋ファイル取得ヘルパ（サーバ専用）。
//   Vercel 環境変数 GOOGLE_SERVICE_ACCOUNT_JSON にサービスアカウント鍵(JSON文字列)を設定。
//   そのSAメール(client_email)にスキルシートのDriveファイル/フォルダを共有しておくこと。
//   未設定なら driveConfigured() = false。呼び出し側で fail-soft（解析スキップ）する想定。
import { createSign } from "node:crypto";

export function driveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

type SA = { client_email: string; private_key: string };
let cachedToken: { token: string; exp: number } | null = null;

function loadSA(): SA | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) return null;
    // PEM 改行が \n 文字列で入っているケースを復元
    parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n");
    return parsed as SA;
  } catch { return null; }
}

/** サービスアカウントの JWT で OAuth トークンを取得（モジュール内キャッシュ・3500秒）。 */
async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.exp > Date.now() / 1000 + 30) return cachedToken.token;
  const sa = loadSA(); if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${b64(header)}.${b64(payload)}`;
  const signer = createSign("RSA-SHA256"); signer.update(data);
  const sig = signer.sign(sa.private_key, "base64url");
  const assertion = `${data}.${sig}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!r.ok) return null;
  const data2: any = await r.json();
  if (!data2?.access_token) return null;
  cachedToken = { token: data2.access_token, exp: now + Math.min(3500, Number(data2.expires_in ?? 3500)) };
  return cachedToken.token;
}

/** Drive URL / 'd/{id}/view' / 'open?id=...' / 単なるID から fileId を抽出。 */
export function extractDriveFileId(urlOrId?: string | null): string | null {
  if (!urlOrId) return null;
  const v = String(urlOrId).trim();
  if (/^[\w-]{20,}$/.test(v)) return v;
  const m1 = v.match(/\/d\/([\w-]{20,})/);
  const m2 = v.match(/[?&]id=([\w-]{20,})/);
  return m1?.[1] ?? m2?.[1] ?? null;
}

export type DriveFile = { ok: true; bytes: Buffer; mimeType: string; name: string } | { ok: false; error: string };

/** Drive ファイルを取得。Google Docs/Sheets は txt/csv にエクスポートして返す。 */
export async function fetchDriveFile(urlOrId: string): Promise<DriveFile> {
  if (!driveConfigured()) return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON 未設定（解析スキップ）" };
  const fileId = extractDriveFileId(urlOrId);
  if (!fileId) return { ok: false, error: "Drive ファイルID を抽出できません" };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "サービスアカウントのトークン取得に失敗（鍵JSONの形式を確認）" };

  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name,size`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!meta.ok) {
    if (meta.status === 404) return { ok: false, error: "ファイルが見つからない/権限なし（サービスアカウントに共有していますか？）" };
    return { ok: false, error: `Drive metadata HTTP ${meta.status}` };
  }
  const metaData: any = await meta.json();
  const sourceMime = String(metaData.mimeType ?? "");
  const name = String(metaData.name ?? fileId);

  let url: string; let outMime: string;
  if (sourceMime === "application/vnd.google-apps.document") {
    outMime = "text/plain";
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
  } else if (sourceMime === "application/vnd.google-apps.spreadsheet") {
    outMime = "text/csv";
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`;
  } else if (sourceMime === "application/vnd.google-apps.presentation") {
    outMime = "application/pdf";
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
  } else {
    outMime = sourceMime || "application/octet-stream";
    url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  }

  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { ok: false, error: `Drive download HTTP ${r.status}` };
  const buf = Buffer.from(await r.arrayBuffer());
  // Vercel 関数の上限とLLM入力上限を考慮し、20MB 超は安全側で拒否
  if (buf.byteLength > 20 * 1024 * 1024) return { ok: false, error: `ファイルサイズが大きすぎます（${Math.round(buf.byteLength / 1024 / 1024)}MB > 20MB）` };
  return { ok: true, bytes: buf, mimeType: outMime, name };
}
