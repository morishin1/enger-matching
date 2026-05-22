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

/** Gmail を検索クエリで開く（元メールに飛ぶ用途）。クライアント名/氏名などで該当メールを表示。 */
export function gmailSearchUrl(query: string) {
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
}

const salary = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `${lo}万円` : `${lo}〜${hi}万円`) : hi ? `〜${hi}万円` : lo ? `${lo}万円〜` : "スキル見合い";

const quote = (lines: string[]) => lines.filter(Boolean).map((l) => `> ${l}`).join("\n");

/** 差出人の名乗り（担当者名があれば「ENGER の 〇〇」） */
const senderLabel = (sender?: string | null) => (sender && sender.trim() ? `ENGER の ${sender.trim()}` : "ENGER");

/** 人材へ「案件のご紹介」を返信する本文（人材所属/本人宛て） */
export function candidateProposalMail(opts: {
  candidateName: string;
  contactName?: string | null;
  sender?: string | null;
  job: { title: string; client_name?: string | null; role_label?: string | null; skills?: string[] | null; salary_min?: number | null; salary_max?: number | null };
  matchedSkills?: string[];
  score?: number;
}) {
  const { candidateName, job } = opts;
  const subject = reSubject(`【ご案件のご紹介】${job.title}`);
  const body = [
    `${opts.contactName ?? candidateName} 様`,
    ``,
    `お世話になっております。${senderLabel(opts.sender)} でございます。`,
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
  sender?: string | null;
  candidate: { name: string; title?: string | null; skills?: string[] | null; rate?: string | null; affiliation?: string | null; exp?: string | null };
  matchedSkills?: string[];
  score?: number;
}) {
  const { jobTitle, candidate } = opts;
  const subject = reSubject(`【人材のご提案】${jobTitle}`);
  const body = [
    `${opts.contactName ?? opts.clientName ?? "ご担当者"} 様`,
    ``,
    `お世話になっております。${senderLabel(opts.sender)} でございます。`,
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

// ---- LLM 用プロンプト（コピペ方式 / API どちらでも使う単一ソース）----
export function buildProposalPrompt(opts: {
  target: "client" | "cand";
  job: { title: string; client_name?: string | null; role_label?: string | null; skills?: string[] | null; salary_min?: number | null; salary_max?: number | null; flow_note?: string | null };
  cand: { name: string; title?: string | null; skills?: string[] | null; rate?: string | null; affiliation?: string | null; exp?: string | null };
  matchedSkills?: string[];
  missingSkills?: string[];
  score?: number;
  sender?: string | null;
}): string {
  const { target, job, cand } = opts;
  const facts = [
    `【案件】${job.title}`,
    `クライアント：${job.client_name ?? "（非公開）"}`,
    job.role_label ? `職種：${job.role_label}` : "",
    `単価：${salary(job.salary_min, job.salary_max)}`,
    job.flow_note && job.flow_note !== "不明" ? `商流：${job.flow_note}` : "",
    `必要スキル：${(job.skills ?? []).join(" / ") || "—"}`,
    ``,
    `【人材】${cand.name}`,
    cand.title ? `職種：${cand.title}` : "",
    cand.affiliation ? `所属：${cand.affiliation}` : "",
    cand.exp ? `経験：${cand.exp}` : "",
    `希望単価：${cand.rate ?? "応相談"}`,
    `保有スキル：${(cand.skills ?? []).join(" / ") || "—"}`,
    ``,
    `【マッチ度】${opts.score ?? "—"}%`,
    opts.matchedSkills?.length ? `合致スキル：${opts.matchedSkills.join(" / ")}` : "",
    opts.missingSkills?.length ? `不足スキル：${opts.missingSkills.join(" / ")}` : "",
  ].filter((l) => l !== "").join("\n");

  const dir = target === "client"
    ? "あなたはSES営業です。下記の人材を、案件のクライアント窓口へ提案する『返信メール』の本文を書いてください。"
    : "あなたはSES営業です。下記の案件を、人材本人（または所属窓口）へ紹介する『返信メール』の本文を書いてください。";

  return [
    dir,
    `差出人の名乗りは「${senderLabel(opts.sender)} でございます。」とすること。`,
    "条件: 日本語の丁寧なビジネスメール / 返信体裁(冒頭は宛名、結びは「何卒よろしくお願いいたします。」) / 200〜350字程度 / 誇張せず事実ベース / 相手が返信したくなる一文を入れる。",
    "出力は本文のみ（件名や説明は不要）。",
    "",
    "─── 情報 ───",
    facts,
  ].join("\n");
}
