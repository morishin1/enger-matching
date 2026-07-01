// LINE（LINE WORKS）共有用のメッセージ雛形（純粋関数・クライアントからも import 可）。
//   送信前に LineShareButton のモーダルで内容を確認・編集してから送る前提の「たたき台」。
//   ・案件：クライアント名は既定で含めない（商流保護。必要なら送信前に手で追記）。
//   ・人材：匿名規約（イニシャル＋スキル＋単価。氏名/連絡先は担当が仲介）に従い、所属会社名は含めない。
const BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://dx.enger.jp").replace(/\/$/, "");

const salaryLabel = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `${lo}万` : `${lo}〜${hi}万`) : hi ? `〜${hi}万` : lo ? `${lo}万〜` : "スキル見合い";
const remoteLabel = (r?: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "");

// 空行を詰めて整形（値が無い行は出さない）。
const joinLines = (lines: (string | null | false | undefined)[]) => lines.filter(Boolean).join("\n");

/** 案件情報のLINE共有雛形。 */
export function jobLineTemplate(j: any): string {
  const skills = (j?.skills ?? []).slice(0, 8).join(" / ");
  return joinLines([
    `【案件】${j?.title ?? ""}`,
    j?.role_label && `■職種：${j.role_label}`,
    `■単価：${salaryLabel(j?.salary_min, j?.salary_max)}`,
    remoteLabel(j?.remote_type) && `■勤務：${remoteLabel(j?.remote_type)}${j?.work_location ? `（${j.work_location}）` : ""}`,
    !remoteLabel(j?.remote_type) && j?.work_location && `■勤務地：${j.work_location}`,
    j?.start_date && `■開始：${String(j.start_date).slice(0, 10)}`,
    skills && `■スキル：${skills}`,
    "",
    "ご提案可能な方がいらっしゃいましたらご連絡ください。",
    j?.job_no != null && `▼ENGERで詳細（No.${String(j.job_no).padStart(5, "0")}）`,
    j?.job_no != null && `${BASE}/matching?job=${j.job_no}`,
  ]);
}

/** 人材情報のLINE共有雛形（匿名：イニシャル＋スキル＋単価）。 */
export function candidateLineTemplate(c: any): string {
  const skills = (c?.skills ?? []).slice(0, 8).join(" / ");
  return joinLines([
    `【人材】${c?.name ?? ""}${c?.title ? `（${c.title}）` : ""}`,
    c?.affiliation && `■区分：${c.affiliation}`,
    c?.age_band && `■年齢層：${c.age_band}`,
    `■単価：${c?.rate ?? salaryLabel(c?.salary_min, c?.salary_max)}`,
    c?.remote_pref && `■リモート：${c.remote_pref}`,
    c?.avail && `■稼働：${c.avail}`,
    skills && `■スキル：${skills}`,
    "",
    "マッチしそうな案件がありましたらご連絡ください。",
    c?.candidate_no != null && `▼ENGERで詳細（P-${String(c.candidate_no).padStart(5, "0")}）`,
    c?.candidate_no != null && `${BASE}/matching?person=${c.candidate_no}`,
  ]);
}

/** マッチ結果（人材 × 案件）のLINE共有雛形。 */
export function matchLineTemplate(input: { job: any; cand: any; score?: number | null; matchedSkills?: string[] }): string {
  const { job: j, cand: c } = input;
  const skills = (input.matchedSkills ?? []).slice(0, 6).join(" / ");
  const link = `${BASE}/matching?` + [
    j?.job_no != null ? `job=${j.job_no}` : "",
    c?.candidate_no != null ? `cand=${c.candidate_no}` : "",
  ].filter(Boolean).join("&");
  return joinLines([
    `【マッチ共有】${c?.name ?? "人材"} × ${j?.title ?? "案件"}`,
    input.score != null && `■マッチ度：${input.score}%`,
    `■単価：人材 ${c?.rate ?? salaryLabel(c?.salary_min, c?.salary_max)} ／ 案件 ${salaryLabel(j?.salary_min, j?.salary_max)}`,
    skills && `■一致スキル：${skills}`,
    "",
    "ご確認のうえ、提案可否・所属確認のご返信をお願いします。",
    (j?.job_no != null || c?.candidate_no != null) && "▼ENGERでこのマッチを開く",
    (j?.job_no != null || c?.candidate_no != null) && link,
  ]);
}
