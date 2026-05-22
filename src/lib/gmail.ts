// Gmail 作成画面(返信形式)を開くための URL ヘルパ。
//   相手は「返信メール」に反応してアクションを取りやすいので、
//   件名は Re: 始まり、本文は引用ブロック付きの返信体裁で生成する。

export function gmailComposeUrl(opts: { to?: string | null; subject: string; body: string; cc?: string | null }) {
  const p = new URLSearchParams();
  p.set("view", "cm");
  p.set("fs", "1");
  if (opts.to) p.set("to", opts.to);
  if (opts.cc) p.set("cc", opts.cc);
  p.set("su", opts.subject);
  p.set("body", opts.body);
  return `https://mail.google.com/mail/?${p.toString()}`;
}

export const reSubject = (s: string) => (/^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);

const salary = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `${lo}万円` : `${lo}〜${hi}万円`) : hi ? `〜${hi}万円` : lo ? `${lo}万円〜` : "スキル見合い";

const quote = (lines: string[]) => lines.filter(Boolean).map((l) => `> ${l}`).join("\n");

/** 人材へ「案件のご紹介」を返信する本文（人材所属/本人宛て） */
export function candidateProposalMail(opts: {
  candidateName: string;
  contactName?: string | null;
  job: { title: string; client_name?: string | null; role_label?: string | null; skills?: string[] | null; salary_min?: number | null; salary_max?: number | null };
  matchedSkills?: string[];
  score?: number;
}) {
  const { candidateName, job } = opts;
  const subject = reSubject(`【ご案件のご紹介】${job.title}`);
  const body = [
    `${opts.contactName ?? candidateName} 様`,
    ``,
    `お世話になっております。ENGER でございます。`,
    `${candidateName} 様にマッチ度の高い案件（マッチ度 ${opts.score ?? "—"}%）がございましたのでご返信差し上げます。`,
    ``,
    `── ご案件 ──────────────`,
    `案件名：${job.title}`,
    `クライアント：${job.client_name ?? "（非公開）"}`,
    job.role_label ? `職種：${job.role_label}` : "",
    `単価：${salary(job.salary_min, job.salary_max)}`,
    `必要スキル：${(job.skills ?? []).join(" / ") || "—"}`,
    opts.matchedSkills?.length ? `→ ${candidateName}様の合致スキル：${opts.matchedSkills.join(" / ")}` : "",
    `────────────────────`,
    ``,
    `ご経歴とマッチしておりましたので、ご状況・ご希望をお聞かせいただけますと幸いです。`,
    `ご面談やスキルシートのご送付など、進め方はご都合に合わせて調整いたします。`,
    ``,
    `何卒よろしくお願いいたします。`,
  ].filter((l) => l !== "").join("\n");
  return { subject, body };
}

/** クライアントへ「人材のご提案」を返信する本文（案件窓口宛て） */
export function jobProposalMail(opts: {
  jobTitle: string;
  clientName?: string | null;
  contactName?: string | null;
  candidate: { name: string; title?: string | null; skills?: string[] | null; rate?: string | null; affiliation?: string | null; exp?: string | null };
  matchedSkills?: string[];
  score?: number;
}) {
  const { jobTitle, candidate } = opts;
  const subject = reSubject(`【人材のご提案】${jobTitle}`);
  const body = [
    `${opts.contactName ?? opts.clientName ?? "ご担当者"} 様`,
    ``,
    `お世話になっております。ENGER でございます。`,
    `「${jobTitle}」にマッチ度の高い人材（マッチ度 ${opts.score ?? "—"}%）をご提案申し上げます。`,
    ``,
    `── ご提案人材 ────────────`,
    `氏名：${candidate.name}`,
    candidate.title ? `職種：${candidate.title}` : "",
    candidate.affiliation ? `所属：${candidate.affiliation}` : "",
    candidate.exp ? `経験：${candidate.exp}` : "",
    `希望単価：${candidate.rate ?? "応相談"}`,
    `スキル：${(candidate.skills ?? []).join(" / ") || "—"}`,
    opts.matchedSkills?.length ? `→ 案件要件との合致スキル：${opts.matchedSkills.join(" / ")}` : "",
    `────────────────────`,
    ``,
    `ご面談の可否やスキルシートのご要望など、ご返信いただけますと幸いです。`,
    `詳細資料はすぐにご送付いたします。`,
    ``,
    `何卒よろしくお願いいたします。`,
  ].filter((l) => l !== "").join("\n");
  return { subject, body };
}

export { salary as mailSalaryLabel, quote };
