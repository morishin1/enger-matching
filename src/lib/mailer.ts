// SMTP メール送信（サーバ専用）。Xserver 等の SMTP からドメイン別に送り分ける。
//   差出人プロファイルを「enger」「8grp」の2系統用意し、UI で選択 → ここで切り替える。
//
// 環境変数（Vercel）:
//   共通:
//     SMTP_HOST            例) sv1426.xserver.jp
//     SMTP_PORT            例) 465（SSL）/ 587（STARTTLS）
//   enger.jp 用:
//     SMTP_ENGER_USER      送信元アドレス（例 info@enger.jp）
//     SMTP_ENGER_PASS      そのアカウントのパスワード
//     SMTP_ENGER_FROM_NAME 差出人表示名（任意・既定 "ENGER"）
//   8grp.co.jp 用:
//     SMTP_8GRP_USER       送信元アドレス（例 its@8grp.co.jp）
//     SMTP_8GRP_PASS       パスワード
//     SMTP_8GRP_FROM_NAME  差出人表示名（任意・既定 "株式会社エイト"）
//
// ※ パスワードはコードに書かず必ず Vercel 環境変数に設定すること。

import nodemailer from "nodemailer";

export type SenderKey = "enger" | "8grp";

export type SenderProfile = { key: SenderKey; label: string; address: string; fromName: string };

/** 設定済みの差出人プロファイル一覧（env が揃っているものだけ返す）。 */
export function availableSenders(): SenderProfile[] {
  const list: SenderProfile[] = [];
  if (process.env.SMTP_ENGER_USER) {
    list.push({ key: "enger", label: "ENGER（enger.jp）", address: process.env.SMTP_ENGER_USER, fromName: process.env.SMTP_ENGER_FROM_NAME || "ENGER" });
  }
  if (process.env.SMTP_8GRP_USER) {
    list.push({ key: "8grp", label: "株式会社エイト（8grp.co.jp）", address: process.env.SMTP_8GRP_USER, fromName: process.env.SMTP_8GRP_FROM_NAME || "株式会社エイト" });
  }
  return list;
}

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && (process.env.SMTP_ENGER_USER || process.env.SMTP_8GRP_USER));
}

function credsFor(sender: SenderKey): { user: string; pass: string; fromName: string } | null {
  if (sender === "enger") {
    const user = process.env.SMTP_ENGER_USER, pass = process.env.SMTP_ENGER_PASS;
    if (!user || !pass) return null;
    return { user, pass, fromName: process.env.SMTP_ENGER_FROM_NAME || "ENGER" };
  }
  const user = process.env.SMTP_8GRP_USER, pass = process.env.SMTP_8GRP_PASS;
  if (!user || !pass) return null;
  return { user, pass, fromName: process.env.SMTP_8GRP_FROM_NAME || "株式会社エイト" };
}

export type SendInput = {
  sender: SenderKey;            // どの差出人ドメインの箱で送るか
  to: string;                   // 宛先（カンマ区切り可）
  subject: string;
  text: string;                 // プレーン本文
  cc?: string | null;
  bcc?: string | null;
  replyTo?: string | null;      // 返信先（ログイン者のメールを入れると返信が本人に届く）
  fromNameOverride?: string | null; // 差出人表示名の上書き（ログイン者の名前など）
};

export type SendResult = { ok: true; messageId: string; from: string } | { ok: false; error: string };

/** 1通送信。SMTP は接続コストがあるので呼び出しごとに transporter を生成（低頻度運用のため十分）。 */
export async function sendMail(input: SendInput): Promise<SendResult> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  if (!host) return { ok: false, error: "SMTP_HOST が未設定です（Vercel 環境変数）" };
  const creds = credsFor(input.sender);
  if (!creds) return { ok: false, error: `差出人「${input.sender}」の SMTP 認証情報が未設定です` };
  if (!input.to?.trim()) return { ok: false, error: "宛先がありません" };
  if (!input.subject?.trim()) return { ok: false, error: "件名がありません" };

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465=SSL, 587=STARTTLS
    auth: { user: creds.user, pass: creds.pass },
  });

  // 差出人の「表示名」だけログイン者の名前に差し替え可能（アドレスは配信のため箱のまま）。
  //   例) "森田 太郎 <info@enger.jp>"。fromNameOverride 未指定ならドメイン既定名。
  const displayName = (input.fromNameOverride?.trim()) || creds.fromName;
  const from = `${displayName} <${creds.user}>`;
  try {
    const info = await transporter.sendMail({
      from,
      to: input.to.trim(),
      cc: input.cc?.trim() || undefined,
      bcc: input.bcc?.trim() || undefined,
      replyTo: input.replyTo?.trim() || creds.user,
      subject: input.subject,
      text: input.text,
    });
    return { ok: true, messageId: info.messageId, from };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 接続テスト（資格情報・ポートが正しいか確認）。本文は送らない。 */
export async function verifySmtp(sender: SenderKey): Promise<SendResult> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  if (!host) return { ok: false, error: "SMTP_HOST が未設定です" };
  const creds = credsFor(sender);
  if (!creds) return { ok: false, error: `差出人「${sender}」の認証情報が未設定です` };
  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: creds.user, pass: creds.pass } });
  try {
    await transporter.verify();
    return { ok: true, messageId: "verify-ok", from: creds.user };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
