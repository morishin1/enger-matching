// SMTP メール送信（サーバ専用）。差出人プロファイルごとに SMTP ホスト/認証を切り替え可能。
//
// 差出人プロファイル（key と env プレフィクスを揃える）:
//   enger  … enger.jp（Xserver 想定。グローバル SMTP_HOST/PORT にフォールバック）
//   8grp   … 8grp.co.jp（同上）
//   its    … its@gw.8grp.co.jp（Google Workspace。smtp.gmail.com:587 + アプリパスワード）
//            ※「its」は ENGER 共有メールボックス。送ると Gmail の「送信済み」に自動保存される。
//
// 環境変数（Vercel）:
//   グローバル（enger/8grp の既定値として使う）:
//     SMTP_HOST           例) sv1426.xserver.jp
//     SMTP_PORT           例) 465（SSL）/ 587（STARTTLS）
//     SMTP_HELO           任意。EHLO で名乗るホスト名（既定は送信ドメイン）
//   sender 別（<KEY> = ENGER | 8GRP | ITS）:
//     SMTP_<KEY>_HOST     任意。未指定なら SMTP_HOST。ITS の既定は smtp.gmail.com
//     SMTP_<KEY>_PORT     任意。未指定なら SMTP_PORT。ITS の既定は 587
//     SMTP_<KEY>_USER     送信元アドレス（例 its@gw.8grp.co.jp）
//     SMTP_<KEY>_PASS     パスワード／アプリパスワード（コードに書かず Vercel で設定）
//     SMTP_<KEY>_FROM_NAME 差出人表示名（任意・既定はアドレス自身）

import nodemailer from "nodemailer";

export type SenderKey = "enger" | "8grp" | "its";

export type SenderProfile = { key: SenderKey; label: string; address: string; fromName: string };

type SenderConfig = { user: string; pass: string; fromName: string; host: string; port: number };

const LABELS: Record<SenderKey, string> = {
  enger: "ENGER（enger.jp）",
  "8grp": "株式会社エイト（8grp.co.jp）",
  its: "ENGER共有（its@gw.8grp.co.jp）",
};

/** sender ごとの SMTP 設定を環境変数から取得。未設定なら null。 */
function configFor(sender: SenderKey): SenderConfig | null {
  const prefix = sender === "enger" ? "ENGER" : sender === "8grp" ? "8GRP" : "ITS";
  const user = process.env[`SMTP_${prefix}_USER`];
  const pass = process.env[`SMTP_${prefix}_PASS`];
  if (!user || !pass) return null;
  // ITS の既定は Google Workspace（smtp.gmail.com:587）。他はグローバル SMTP_HOST/PORT。
  const defaultHost = sender === "its" ? "smtp.gmail.com" : process.env.SMTP_HOST;
  const defaultPort = sender === "its" ? 587 : Number(process.env.SMTP_PORT || 465);
  const host = process.env[`SMTP_${prefix}_HOST`] || defaultHost;
  const port = Number(process.env[`SMTP_${prefix}_PORT`] || defaultPort);
  if (!host) return null;
  const fromName = process.env[`SMTP_${prefix}_FROM_NAME`] || user;
  return { user, pass, fromName, host, port };
}

/** 設定済みの差出人プロファイル一覧（env が揃っているものだけ返す）。SMTP_FAKE=true なら dev 用ダミー。 */
export function availableSenders(): SenderProfile[] {
  const list: SenderProfile[] = [];
  for (const key of ["enger", "8grp", "its"] as const) {
    const cfg = configFor(key);
    if (cfg) list.push({ key, label: LABELS[key], address: cfg.user, fromName: cfg.fromName });
  }
  if (list.length === 0 && process.env.SMTP_FAKE === "true") {
    list.push({ key: "its", label: "ENGER共有（its@gw.8grp.co.jp）[DEV]", address: "its@gw.8grp.co.jp", fromName: "its@gw.8grp.co.jp" });
  }
  return list;
}

export function smtpConfigured(): boolean {
  return availableSenders().length > 0;
}

export type SendInput = {
  sender: SenderKey;            // どの差出人プロファイルで送るか
  to: string;                   // 宛先（カンマ区切り可）
  subject: string;
  text: string;                 // プレーン本文
  html?: string | null;         // HTML本文（ボタン付きメールなど）
  cc?: string | null;
  bcc?: string | null;
  replyTo?: string | null;      // 返信先（既定は SMTP の送信元アドレス）
  fromNameOverride?: string | null; // 差出人表示名の上書き（未指定なら env 既定 or アドレス）
};

export type SendResult =
  | { ok: true; messageId: string; from: string; response?: string | null; accepted?: string[]; rejected?: string[] }
  | { ok: false; error: string };

/** 送信元アドレスからドメインを取り出す（EHLO名に使う）。 */
function domainOf(addr: string): string {
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1) : addr;
}

/** transporter を生成。EHLO名(name)を送信ドメインに設定し、AWS汎用ホスト名での拒否を回避。 */
function makeTransport(cfg: SenderConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465, // 465=SSL, 587=STARTTLS
    auth: { user: cfg.user, pass: cfg.pass },
    // EHLO で名乗るホスト名。既定だとサーバの実ホスト名(AWS EC2)になり Xserver 等で
    // 「Client host rejected」になることがある。送信ドメインを名乗って回避する。
    name: process.env.SMTP_HELO || domainOf(cfg.user),
  });
}

/** 1通送信。SMTP は接続コストがあるので呼び出しごとに transporter を生成（低頻度運用のため十分）。 */
export async function sendMail(input: SendInput): Promise<SendResult> {
  if (process.env.SMTP_FAKE === "true") {
    console.log("[SMTP_FAKE] mail skipped:", { to: input.to, subject: input.subject });
    return { ok: true, messageId: `fake-${Date.now()}`, from: "dev@enger.jp" };
  }
  const cfg = configFor(input.sender);
  if (!cfg) return { ok: false, error: `差出人「${input.sender}」の SMTP 設定が未設定です（SMTP_${input.sender.toUpperCase()}_USER/PASS）` };
  if (!input.to?.trim()) return { ok: false, error: "宛先がありません" };
  if (!input.subject?.trim()) return { ok: false, error: "件名がありません" };

  const transporter = makeTransport(cfg);

  // 表示名は override → env(SMTP_*_FROM_NAME) → アドレス自身、の優先順。
  const displayName = (input.fromNameOverride?.trim()) || cfg.fromName;
  const from = `${displayName} <${cfg.user}>`;
  try {
    const info: any = await transporter.sendMail({
      from,
      to: input.to.trim(),
      cc: input.cc?.trim() || undefined,
      bcc: input.bcc?.trim() || undefined,
      replyTo: input.replyTo?.trim() || cfg.user,
      subject: input.subject,
      text: input.text,
      html: input.html || undefined,
    });
    // 診断ログ：nodemailer の SMTP 応答（response / accepted / rejected）を残す。
    //   「アプリ上は送信成功だが受信者に届かない」事象（Gmail Workspace 側の post-SMTP
    //   silent drop 等）を追跡できるよう、per-recipient の状態を必ず記録。
    const accepted = Array.isArray(info?.accepted) ? info.accepted.map((a: any) => String(a)) : [];
    const rejected = Array.isArray(info?.rejected) ? info.rejected.map((a: any) => String(a)) : [];
    const response: string | null = typeof info?.response === "string" ? info.response : null;
    try {
      console.log(`[mailer] sent sender=${input.sender} to=${input.to} cc=${input.cc ?? ""} bcc=${input.bcc ?? ""} messageId=${info?.messageId ?? ""} accepted=${accepted.join(",")} rejected=${rejected.join(",")} response=${response ?? ""}`);
    } catch { /* logging失敗で送信成功を覆さない */ }
    return { ok: true, messageId: info?.messageId, from, response, accepted, rejected };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { console.warn(`[mailer] send failed sender=${input.sender} to=${input.to} error=${msg}`); } catch { /* noop */ }
    return { ok: false, error: msg };
  }
}

/** 接続テスト（資格情報・ポートが正しいか確認）。本文は送らない。 */
export async function verifySmtp(sender: SenderKey): Promise<SendResult> {
  const cfg = configFor(sender);
  if (!cfg) return { ok: false, error: `差出人「${sender}」の SMTP 設定が未設定です` };
  const transporter = makeTransport(cfg);
  try {
    await transporter.verify();
    return { ok: true, messageId: "verify-ok", from: cfg.user };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
