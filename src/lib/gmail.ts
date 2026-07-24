// Gmail 作成画面(返信形式)を開くための URL ヘルパ。
//   相手は「返信メール」に反応してアクションを取りやすいので、
//   件名は Re: 始まり、本文は引用ブロック付きの返信体裁で生成する。

// メールが入っているアカウント（受信専用）。これで開くことでアカウント違いの「見れない」を防ぐ。
//   Vercel等で NEXT_PUBLIC_SOURCE_MAILBOX を設定すれば上書き可能。
const SOURCE_MAILBOX = process.env.NEXT_PUBLIC_SOURCE_MAILBOX || "its@gw.8grp.co.jp";
const authParam = () => (SOURCE_MAILBOX ? `authuser=${encodeURIComponent(SOURCE_MAILBOX)}` : "");

export function gmailComposeUrl(opts: { to?: string | null; subject: string; body: string; cc?: string | null }) {
  const p = new URLSearchParams();
  p.set("view", "cm");
  p.set("fs", "1");
  if (opts.to) p.set("to", opts.to);
  if (opts.cc) p.set("cc", opts.cc);
  p.set("su", opts.subject);
  p.set("body", opts.body);
  if (SOURCE_MAILBOX) p.set("authuser", SOURCE_MAILBOX);
  return `https://mail.google.com/mail/?${p.toString()}`;
}

export const reSubject = (s: string) => (/^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);

/**
 * 件名が「返信」「転送」を示す接頭辞で始まるか判定する。
 *   例: "Re:", "RE:", "Re: Re:", "Fwd:", "Fw:", "FW:", 全角コロン「：」も許容。
 *   これらは取り込み・ダウンロード対象から除外するために使う（m_fujimoto バグ報告）。
 *   注: "Review:" や "Regarding" のようにコロンが直後に続かない語は誤除外しない。
 */
export function isReplyOrForwardSubject(subject?: string | null): boolean {
  if (!subject) return false;
  return /^\s*(re|fwd?|fw)\s*[:：]/i.test(String(subject));
}

/** Gmail を検索クエリで開く（元メールに飛ぶ用途）。受信アカウント(authuser)で開く。 */
export function gmailSearchUrl(query: string) {
  const a = authParam();
  return `https://mail.google.com/mail/${a ? "?" + a : "u/0/"}#search/${encodeURIComponent(query)}`;
}

/**
 * 元メールへ直接飛ぶ URL を作る。受信アカウント(authuser)で開く。
 *  - 既にURL（http/https）ならそのまま返す
 *  - Gmail メッセージ ID（16進; GASの id 列。前後の引用符は許容）なら #all/<id> へ
 *  - それ以外は null（呼び出し側で検索などにフォールバック）
 */
export function gmailMessageUrl(idOrUrl?: string | null): string | null {
  if (!idOrUrl) return null;
  const v = String(idOrUrl).trim().replace(/^["']+|["']+$/g, "");
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (!/^[0-9a-f]{8,}$/i.test(v)) return null;
  const a = authParam();
  return `https://mail.google.com/mail/${a ? "?" + a : "u/0/"}#all/${encodeURIComponent(v)}`;
}

const salary = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `${lo}万円` : `${lo}〜${hi}万円`) : hi ? `〜${hi}万円` : lo ? `${lo}万円〜` : "スキル見合い";

const quote = (lines: string[]) => lines.filter(Boolean).map((l) => `> ${l}`).join("\n");

const remoteText = (r?: string | null) => {
  if (!r) return "";
  if (/full|フル/i.test(r)) return "フルリモート";
  if (/onsite|出社|常駐/i.test(r)) return "出社必須";
  return "一部リモート";
};

/** 共通の社署名（旧enger 実機メールに合わせる） */
const SIGNATURE = [
  `∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞`,
  `株式会社エイト　`,
  `ITS事業部`,
  `野澤：080-4191-4175`,
  ` Mail：support_eigyo@8grp.co.jp`,
  `エンジニア・PM・DX人材の即戦力マッチング：https://enger.jp/`,
  `インキュベーションスペース：https://8sp.jp/`,
  ` 自社サイト：https://8grp.co.jp/`,
  `〒150-0001 東京都渋谷区神宮前6-33-14-エイトカフェ2F`,
  `∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞∞`,
].join("\n");

const HR = "────────────────────────────────────";

/**
 * 人材所属(SES)宛て：案件を紹介する本文（旧enger実機メールに合わせた定型）。
 *  - 件名：【案件のご紹介】希望条件に合致する案件のお知らせ
 *  - 冒頭挨拶：エンジャー事務局
 */
export function candidateProposalMail(opts: {
  candidateName: string;
  candidateCompany?: string | null;     // 人材所属(SES)企業名
  contactName?: string | null;           // SES担当者名
  ageBand?: string | null;               // 30代後半 等
  sender?: string | null;
  job: {
    title: string;
    client_name?: string | null;
    role_label?: string | null;
    skills?: string[] | null;
    salary_min?: number | null;
    salary_max?: number | null;
    detail?: string | null;              // 案件内容（メール本文相当）
    work_location?: string | null;       // 勤務地
    flow_note?: string | null;           // 商流
    start_date?: string | null;          // 開始時期
    remote_type?: string | null;         // リモート可否
  };
  matchedSkills?: string[];
  score?: number;
}) {
  const { candidateName, job } = opts;
  const subject = `【案件のご紹介】希望条件に合致する案件のお知らせ`;
  // Gmail の compose URL は実用上 ~2000 文字の上限がある。job.detail（元メール本文）が長いと
  // URL が長すぎて Gmail が 400 Bad Request を返すため、本文では先頭 600 字に抑え、
  // 続きは「元メールを開く」ボタンから参照する運用にする。
  const detailMax = 600;
  const detailTrunc = job.detail && job.detail.length > detailMax
    ? `${job.detail.slice(0, detailMax)}…\n（※ 続きは案件の元メールをご確認ください）`
    : job.detail;
  // 旧enger実機: 「{会社名}\n{担当者名}様」。担当者名が無いときは「ご担当者 様」、会社名も無いときは候補者名にフォールバック。
  const greeting = opts.contactName
    ? `${opts.contactName} 様`
    : (opts.candidateCompany ? `ご担当者 様` : `${candidateName} 様`);
  const body = [
    opts.candidateCompany ?? "",
    greeting,
    ``,
    `いつも大変お世話になっております。`,
    `エンジャー事務局でございます。`,
    `この度は要員様をご紹介いただき、誠にありがとうございます。`,
    `下記の案件をぜひご紹介させていただきたくご連絡いたしました。`,
    `ご確認のほど何卒よろしくお願い申し上げます。`,
    ``,
    HR,
    `◆ご紹介していただいた要員`,
    `${candidateName}${opts.ageBand ? ` ${opts.ageBand}` : ""}`,
    HR,
    `◆ご紹介する案件`,
    `【案件】${job.title}`,
    detailTrunc ? `【内容】\n${detailTrunc}` : "",
    ``,
    `【スキル】`,
    (job.skills ?? []).length ? (job.skills ?? []).join("、") : "—",
    opts.matchedSkills?.length ? `\n※ ${candidateName}様の合致スキル：${opts.matchedSkills.join("、")}` : "",
    ``,
    job.work_location ? `【場所】${job.work_location}` : "",
    remoteText(job.remote_type) ? `　　　　※${remoteText(job.remote_type)}` : "",
    job.start_date ? `【期間】${job.start_date}〜` : "",
    `【単金】${salary(job.salary_min, job.salary_max)}`,
    job.flow_note ? `【商流】${job.flow_note}` : "",
    ``,
    HR,
    `■エントリー時のお願い`,
    `エントリーをご希望の際は、本メール内の`,
    `「エントリーする」ボタンよりご回答くださいますようお願いいたします。`,
    `何卒よろしくお願い申し上げます。`,
    SIGNATURE,
  ].filter((l) => l !== "").join("\n");
  return { subject, body };
}

/**
 * クライアント案件窓口宛て：人材を提案する本文（旧enger実機メールに合わせた定型）。
 *  - 件名：Re: {案件名}（元の案件メールへの返信形式）
 *  - 冒頭挨拶：エンジャー事務局
 */
export function jobProposalMail(opts: {
  jobTitle: string;
  clientName?: string | null;
  contactName?: string | null;
  sender?: string | null;
  candidate: {
    name: string;
    title?: string | null;
    skills?: string[] | null;
    rate?: string | null;
    affiliation?: string | null;
    exp?: string | null;
    skillSheetUrl?: string | null;
    ageBand?: string | null;
    avail?: string | null;
    location?: string | null;     // 希望勤務地(=最寄駅の代替)
  };
  matchedSkills?: string[];
  score?: number;
  originalBody?: string | null;
  originalMailUrl?: string | null;
}) {
  const { jobTitle, candidate } = opts;
  const subject = reSubject(jobTitle);
  const body = [
    opts.clientName ?? "",
    `${opts.contactName ? `${opts.contactName} 様` : `ご担当者 様`}`,
    ``,
    `いつも大変お世話になっております。`,
    `エンジャー事務局でございます。`,
    `ぜひご紹介したい要員がおりますので、ご提案いたします。`,
    `※要員にエントリー可否並行確認中です。`,
    HR,
    `◆ご紹介していただいた案件`,
    `【案件名】：　${jobTitle}`,
    HR,
    `◆ご紹介する要員`,
    `【 名　前 】${candidate.name}${candidate.ageBand ? `　(${candidate.ageBand})` : ""}`,
    candidate.location ? `【最 寄 駅】${candidate.location}` : "",
    candidate.avail ? `【稼 動 日】${candidate.avail}` : "",
    candidate.affiliation ? `【所　 属】${candidate.affiliation}` : "",
    `【単　 価】${candidate.rate ?? "応相談"}`,
    `【ス キ ル】`,
    (candidate.skills ?? []).length ? (candidate.skills ?? []).join("、") : "—",
    opts.matchedSkills?.length ? `\n※ 案件要件との合致スキル：${opts.matchedSkills.join("、")}` : "",
    ``,
    candidate.exp ? `【 実　績 】\n${candidate.exp}` : "",
    candidate.skillSheetUrl ? `\nスキルシート：\n${candidate.skillSheetUrl}` : "",
    ``,
    HR,
    `■オファー時のお願い`,
    `オファーをご希望の際は、本メール内の`,
    `「オファーする」ボタンよりご回答くださいますようお願いいたします。`,
    `なお、ご不明点やご相談事項がございましたら、まずはオファーいただいた上で、`,
    `後ほどお電話にて詳細をご相談させていただければと存じます。`,
    `その他ご質問等ございましたら、お気軽にご連絡ください。`,
    `何卒よろしくお願い申し上げます。`,
    SIGNATURE,
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
    `差出人の名乗りは「エンジャー事務局${opts.sender?.trim() ? ` ${opts.sender.trim()}` : ""}でございます。」とすること。`,
    "条件: 日本語の丁寧なビジネスメール / 返信体裁(冒頭は宛名、結びは「何卒よろしくお願いいたします。」) / 200〜350字程度 / 誇張せず事実ベース / 相手が返信したくなる一文を入れる。",
    "出力は本文のみ（件名や説明は不要）。",
    "",
    "─── 情報 ───",
    facts,
  ].join("\n");
}
