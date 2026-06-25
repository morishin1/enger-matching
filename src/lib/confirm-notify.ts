// 「確認中」フォルダ滞留通知。
//   確認中フォルダに入ってから3日以上 何も記録の変更がない提案を、翌日にクロージング担当者へ
//   メールで通知する。失注/見送りになったもの・削除されたものは対象外（確認中のみを対象にする）。
//   多重送信防止のため proposals.confirm_notified_at を更新し、updated_at がそれより新しく
//   なった（=再度動きがあった後にまた3日放置）場合のみ再通知する。
//   実行は /api/cron/confirm-stale（GitHub Actions の日次トリガー）から。

import { engerAdmin } from "@/lib/supabase";
import { ownerMatches } from "@/lib/owner-match";
import { sendMail } from "@/lib/mailer";

const STALE_DAYS = 3;
const DAY_MS = 86400000;

export type ConfirmNotifyResult = {
  ok: boolean;
  error?: string;
  checked: number;     // 確認中で滞留していた件数
  notified: number;    // 実際に通知できた件数
  skipped: number;     // 宛先（CL担当のメール）が引けず通知できなかった件数
  recipients: number;  // 送信したメール通数（CL担当ごとに1通）
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 確認中フォルダで3日以上動きのない提案を CL担当へ通知。dryRun=true で送信せず対象だけ返す。 */
export async function notifyStaleConfirming(opts?: { dryRun?: boolean; now?: number }): Promise<ConfirmNotifyResult> {
  const now = opts?.now ?? Date.now();
  const threshold = now - STALE_DAYS * DAY_MS;
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定", checked: 0, notified: 0, skipped: 0, recipients: 0 }; }

  // 確認中の提案を取得。confirm_notified_at が無い環境（未マイグレ）は多重送信を防ぐため中止。
  const cols = "id, job_title, company, candidate_name, closer, stage, updated_at, stage_updated_at, confirm_notified_at";
  const r: any = await admin.from("proposals").select(cols).eq("stage", "確認中").limit(5000);
  if (r.error) {
    if (/confirm_notified_at|column/i.test(r.error.message ?? "")) {
      return { ok: false, error: "confirm_notified_at 未作成です。supabase/proposal-confirm-notify.sql を実行してください。", checked: 0, notified: 0, skipped: 0, recipients: 0 };
    }
    return { ok: false, error: r.error.message, checked: 0, notified: 0, skipped: 0, recipients: 0 };
  }
  const rows = (r.data ?? []) as any[];

  // 3日以上 動きがない & 未通知（前回通知後に動きがあって再度滞留したものは再通知）。
  const stale = rows.filter((p) => {
    const last = new Date(p.updated_at ?? p.stage_updated_at ?? 0).getTime();
    if (!last || last > threshold) return false;                 // 直近に動きあり → 対象外
    const notifiedAt = p.confirm_notified_at ? new Date(p.confirm_notified_at).getTime() : 0;
    return notifiedAt < last;                                    // 未通知 or 前回通知後にまた動いて滞留
  });
  if (stale.length === 0) return { ok: true, checked: 0, notified: 0, skipped: 0, recipients: 0 };

  // CL担当名 → メール（staff マスタ）。寛容突合（略称↔フルネーム）。
  const staffR: any = await admin.from("staff").select("name, email").not("email", "is", null);
  const staff = ((staffR.data ?? []) as any[]).filter((s) => s.email);
  const emailOf = (closer: string | null): string | null => {
    const c = (closer ?? "").trim();
    if (!c || c === "未割当") return null;
    const hit = staff.find((s) => ownerMatches(String(s.name ?? ""), c));
    return hit?.email ?? null;
  };

  // CL担当ごとにまとめて1通（滞留が多くてもメールは担当ごと1通）。
  const byCloser = new Map<string, { email: string; items: any[] }>();
  let skipped = 0;
  for (const p of stale) {
    const email = emailOf(p.closer);
    if (!email) { skipped++; continue; }
    const key = email.toLowerCase();
    if (!byCloser.has(key)) byCloser.set(key, { email, items: [] });
    byCloser.get(key)!.items.push(p);
  }

  let notified = 0, recipients = 0;
  const notifiedIds: string[] = [];
  for (const { email, items } of byCloser.values()) {
    const lines = items.map((p) => {
      const who = [p.company || "—", [p.job_title, p.candidate_name].filter(Boolean).join(" × ")].filter(Boolean).join(" / ");
      return `・${who}（最終更新 ${fmtDate(p.updated_at ?? p.stage_updated_at)}）`;
    });
    const subject = `【ENGER】確認中の提案が${STALE_DAYS}日以上 動いていません（${items.length}件）`;
    const text =
      `確認中フォルダに入ってから${STALE_DAYS}日以上、記録の変更がない提案があります。\n` +
      `状況を確認し、面談化／フォロー／必要なら見送り処理を進めてください。\n\n` +
      `${lines.join("\n")}\n\n` +
      `提案管理（提案ボード→確認中）から各案件を開いて対応してください。\n` +
      `https://dx.enger.jp/proposals`;
    if (opts?.dryRun) {
      recipients++; notified += items.length; for (const p of items) notifiedIds.push(p.id);
      continue;
    }
    const res = await sendMail({ sender: "its", to: email, subject, text });
    if (res.ok) {
      recipients++; notified += items.length;
      for (const p of items) notifiedIds.push(p.id);
    }
  }

  // 通知できたものは confirm_notified_at を更新（多重送信防止）。dryRun では更新しない。
  if (!opts?.dryRun && notifiedIds.length > 0) {
    const iso = new Date(now).toISOString();
    await admin.from("proposals").update({ confirm_notified_at: iso }).in("id", notifiedIds);
  }

  return { ok: true, checked: stale.length, notified, skipped, recipients };
}
