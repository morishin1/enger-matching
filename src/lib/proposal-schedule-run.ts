// 提案の予約配信：実行コア（/api/cron/proposal-schedules から呼ばれる）。
//   scheduled_at を過ぎた予約を取り出し、ペアごとに
//     ① recordProposal で提案ボードへ記録（冪等・提案者=予約者）
//     ② 案件側・人材側の提案メールを組み立てて SMTP 送信
//        （メール送信画面と同じ本文テンプレート＋「話を進める／見送り」ボタン）
//   を行う。結果はペア単位で proposal_schedules.result に逐次保存するため、
//   タイムアウトや再起動があっても次回バッチが未処理ペアだけ続きから実行する。
//
//   安全設計：
//     ・既に提案済みのペア（existed）はメールを送らない（二重送信防止）
//     ・SMTP 未設定環境では提案の記録のみ行い、メールはスキップとして結果に残す
//     ・案件がクローズ/削除済みになっていた場合はスキップ

import { engerAdmin } from "./supabase";
import { recordProposal } from "./actions";
import { smtpConfigured, sendMail, availableSenders, type SenderKey } from "./mailer";
import { SHARED_MAILBOX } from "./proposal-constants";
import { jobOpenness, type Job } from "./match";
import {
  buildJobMailSubject, buildJobMailContent,
  buildCandMailSubject, buildCandDeliveryMailContent,
  buildButtonHtml, buildHtmlBody, extractReplyEmail,
  BUTTON_PLACEHOLDER, NOTICE_TEXT, resolveSiteUrl,
} from "./proposal-mail";
import { classifyJobAge, classifyJobNationality, JOB_NAT_LABEL } from "./nationality";

type PairResult = {
  ok: boolean;
  proposalId?: string | null;
  existed?: boolean;
  skipped?: string;        // スキップ理由（クローズ・提案済み等）
  mailJob?: string;        // "sent" / "skipped: <理由>" / "error: <内容>"
  mailCand?: string;
  error?: string;
};

export type RunSummary = {
  ok: boolean;
  schedules: number;       // 処理対象になった予約数
  pairsDone: number;       // 今回処理したペア数
  mailsSent: number;       // 送信できたメール通数
  errors: string[];
};

const MAX_SCHEDULES_PER_RUN = 3;
const SOFT_DEADLINE_MS = 45_000;   // Vercel 60秒制限に収める（残りは次バッチが継続）
const STALE_PROCESSING_MIN = 5;    // processing のまま更新が止まった予約の再取得しきい値

const pairKey = (p: { job_no: number; candidate_no: number }) => `${p.job_no}-${p.candidate_no}`;

async function fetchRow(admin: ReturnType<typeof engerAdmin>, table: string, noCol: string, no: number): Promise<any | null> {
  const { data, error } = await admin.from(table).select("*").eq(noCol, no).limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0];
}

/** 1ペアの配信（提案記録＋両側メール送信）。 */
async function deliverPair(
  admin: ReturnType<typeof engerAdmin>,
  pair: { job_no: number; candidate_no: number; score?: number | null },
  createdBy: string,
  createdByEmail: string | null,
  sender: SenderKey | null,
): Promise<PairResult> {
  const job = await fetchRow(admin, "jobs", "job_no", pair.job_no);
  const cand = await fetchRow(admin, "candidates", "candidate_no", pair.candidate_no);
  if (!job || !cand) return { ok: false, error: "案件または人材が見つかりません" };

  // 予約後にクローズ/削除された対象はスキップ（古い・決まった案件への提案は致命的）
  if (job.deleted_at || cand.deleted_at) return { ok: false, skipped: "案件または人材が削除済み" };
  if (job.is_closed || cand.is_closed) return { ok: false, skipped: "案件または人材がクローズ済み" };
  const open = jobOpenness(job as Job);
  if (open.closed) return { ok: false, skipped: `案件が提案不可：${open.closedReason ?? "充足/終了"}` };

  // ① 提案ボードへ記録（冪等）。提案者＝予約者。
  const rec = await recordProposal(pair.job_no, pair.candidate_no, pair.score ?? undefined, createdBy);
  if (!rec.ok) return { ok: false, error: `提案記録に失敗：${(rec as any).error ?? "不明なエラー"}` };
  const proposalId = (rec as any).id ?? null;
  const existed = !!(rec as any).existed;
  if (existed) {
    // 既に提案済み → メールは送らない（過去に手動送信済みの可能性があるため二重送信を防ぐ）
    return { ok: true, proposalId, existed, mailJob: "skipped: 提案済みのため送信なし", mailCand: "skipped: 提案済みのため送信なし" };
  }

  if (!smtpConfigured() || !sender) {
    return { ok: true, proposalId, existed, mailJob: "skipped: SMTP未設定", mailCand: "skipped: SMTP未設定" };
  }

  const siteUrl = resolveSiteUrl();
  const jobToken = (rec as any).job_action_token ?? null;
  const candToken = (rec as any).cand_action_token ?? null;

  // 送信ヘルパ：メール送信画面（SendBothMailsButton）と同じ規約で送る。
  //   ・replyTo は共有メールボックス（担当不在でも他メンバーが対応できる）
  //   ・CC に予約者本人（配信結果を本人が確認できる）
  //   ・BCC に共有メールボックス（送信元が共有箱そのものの場合は二重保存になるため省略）
  const senderAddr = (availableSenders().find((s) => s.key === sender)?.address ?? "").toLowerCase();
  const sendSide = async (to: string, subject: string, body: string, token: string | null, relatedId: string | null): Promise<string> => {
    const buttonHtml = token ? buildButtonHtml(siteUrl, token) : "";
    const text = body.replace(BUTTON_PLACEHOLDER, NOTICE_TEXT);
    const html = buttonHtml ? buildHtmlBody(body, buttonHtml) : null;
    const bcc = senderAddr === SHARED_MAILBOX.toLowerCase() ? null : SHARED_MAILBOX;
    const res = await sendMail({
      sender, to, subject, text, html,
      cc: createdByEmail, bcc, replyTo: SHARED_MAILBOX,
    });
    if (!res.ok) return `error: ${res.error}`;
    // 送信ログ（sendMailAction と同じ mail_sent へ。列未整備でも送信自体は成功扱い）
    try {
      const baseRow: Record<string, any> = {
        sender_key: sender, from_address: (res as any).from ?? null, to_address: to,
        cc_address: createdByEmail || null, bcc_address: bcc,
        subject, body: text, message_id: (res as any).messageId ?? null,
        sent_by_email: createdByEmail, sent_by_name: `${createdBy}（予約配信）`,
        related_kind: "proposal", related_id: relatedId,
      };
      await admin.from("mail_sent").insert(baseRow);
    } catch { /* ログ失敗は無視 */ }
    return "sent";
  };

  // ② 案件側（クライアント窓口）
  let mailJob = "skipped: 宛先なし";
  const jobTo = (job.contact_email ?? "").toString().trim() || extractReplyEmail(job.detail ?? job.description) || "";
  if (jobTo) {
    try {
      mailJob = await sendSide(jobTo, buildJobMailSubject(job), buildJobMailContent(job, cand), jobToken, proposalId);
    } catch (e) { mailJob = `error: ${e instanceof Error ? e.message : String(e)}`; }
  }

  // ③ 人材側（SES窓口）。定義書準拠テンプレ（単価は案件上限−7万・原文本文は貼らない）。
  let mailCand = "skipped: 宛先なし";
  const candTo = (cand.email ?? "").toString().trim() || (cand.contact_email ?? "").toString().trim() || extractReplyEmail(cand.note ?? cand.exp) || "";
  if (candTo) {
    try {
      const age = classifyJobAge(job.detail, job.title);
      const nat = classifyJobNationality(job.detail, job.title);
      const body = buildCandDeliveryMailContent(job, cand, {
        ageLabel: age.cat === "limited" ? age.label : age.cat === "open" ? "制限なし" : null,
        natLabel: nat === "unknown" ? null : JOB_NAT_LABEL[nat],
      });
      mailCand = await sendSide(candTo, buildCandMailSubject(cand), body, candToken, proposalId);
    } catch (e) { mailCand = `error: ${e instanceof Error ? e.message : String(e)}`; }
  }

  // 送信できた場合は提案側にも送信済みを記録（手動送信の markProposalMailSentAndApprove と同じ列。
  //   ステージは recordProposal が設定した「所属確認」のまま＝手動フローと同じ進行）。
  if (proposalId && (mailJob === "sent" || mailCand === "sent")) {
    const upd: Record<string, any> = {
      mail_sent_at: new Date().toISOString(),
      mail_sent_by: createdByEmail || createdBy,
      updated_at: new Date().toISOString(),
    };
    let r: any = await admin.from("proposals").update(upd).eq("id", proposalId);
    if (r.error && /mail_sent|column/i.test(r.error.message ?? "")) {
      const { mail_sent_at: _a, mail_sent_by: _b, ...rest } = upd;
      await admin.from("proposals").update(rest).eq("id", proposalId);
    }
  }

  return { ok: true, proposalId, existed, mailJob, mailCand };
}

/** 期限が来た予約を実行する（cron エントリポイント）。 */
export async function runDueProposalSchedules(): Promise<RunSummary> {
  const t0 = Date.now();
  const summary: RunSummary = { ok: true, schedules: 0, pairsDone: 0, mailsSent: 0, errors: [] };

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ...summary, ok: false, errors: ["SUPABASE_SERVICE_ROLE_KEY 未設定"] }; }

  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - STALE_PROCESSING_MIN * 60_000).toISOString();

  // 期限到来の pending ＋ 更新が止まった processing（前回タイムアウト分）を取得。
  //   ※ .or() は値の書式に脆いため使わず（#329の教訓）、2クエリに分けてマージする。
  const cols = "id, scheduled_at, status, pairs, created_by, created_by_email, result, updated_at";
  const [pendRes, staleRes] = await Promise.all([
    admin.from("proposal_schedules").select(cols)
      .eq("status", "pending").lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true }).limit(MAX_SCHEDULES_PER_RUN),
    admin.from("proposal_schedules").select(cols)
      .eq("status", "processing").lt("updated_at", staleIso)
      .order("scheduled_at", { ascending: true }).limit(MAX_SCHEDULES_PER_RUN),
  ]);
  const error = pendRes.error ?? staleRes.error ?? null;
  if (error) {
    if (/relation .*proposal_schedules.* does not exist|schema cache/i.test(error.message)) {
      return { ...summary, errors: ["proposal_schedules テーブル未作成（supabase/proposal-schedules.sql を実行してください）"] };
    }
    return { ...summary, ok: false, errors: [error.message] };
  }
  const due = [...(pendRes.data ?? []), ...(staleRes.data ?? [])]
    .sort((a: any, b: any) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))
    .slice(0, MAX_SCHEDULES_PER_RUN);

  // 送信者：共有メールボックス(its)優先。SMTP 未設定なら null（記録のみ）。
  const senders = smtpConfigured() ? availableSenders() : [];
  const sender: SenderKey | null = senders.length ? ((senders.find((s) => s.key === "its") ?? senders[0]).key) : null;

  for (const sched of (due ?? []) as any[]) {
    // 楽観ロック：pending → processing（他バッチとの二重実行を防ぐ。stale processing はそのまま続行）
    if (sched.status === "pending") {
      const { data: claimed } = await admin.from("proposal_schedules")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", sched.id).eq("status", "pending").select("id");
      if (!claimed || claimed.length === 0) continue; // 他のバッチが先に取得
    }
    summary.schedules++;

    const pairs: { job_no: number; candidate_no: number; score?: number | null }[] = Array.isArray(sched.pairs) ? sched.pairs : [];
    const result: Record<string, PairResult> = (sched.result && typeof sched.result === "object") ? { ...sched.result } : {};
    let timedOut = false;

    for (const pair of pairs) {
      const key = pairKey(pair);
      if (result[key]) continue; // 前回バッチで処理済み（続きから）
      if (Date.now() - t0 > SOFT_DEADLINE_MS) { timedOut = true; break; }
      let r: PairResult;
      try {
        r = await deliverPair(admin, pair, sched.created_by ?? "予約配信", sched.created_by_email ?? null, sender);
      } catch (e) {
        r = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      result[key] = r;
      summary.pairsDone++;
      if (r.mailJob === "sent") summary.mailsSent++;
      if (r.mailCand === "sent") summary.mailsSent++;
      if (r.error) summary.errors.push(`${key}: ${r.error}`);
      // ペア毎に結果を保存（タイムアウト・再起動に強くする）
      await admin.from("proposal_schedules").update({ result, updated_at: new Date().toISOString() }).eq("id", sched.id);
    }

    if (!timedOut) {
      const allFailed = pairs.length > 0 && pairs.every((p) => result[pairKey(p)] && !result[pairKey(p)].ok);
      await admin.from("proposal_schedules").update({
        status: allFailed ? "error" : "done",
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        result,
      }).eq("id", sched.id);
    }
    // timedOut の場合は processing のまま残す → 次バッチが stale 再取得で続きを処理

    if (Date.now() - t0 > SOFT_DEADLINE_MS) break;
  }

  return summary;
}
