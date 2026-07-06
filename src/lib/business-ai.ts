// ENGER business：AI下書きの共通コア（サーバー専用）。
//   DX の portal サーバーアクションと、enger-lp 向け公開API（/api/public/ai-draft）の両方から
//   同じ関数を呼び、生成ロジック・項目を1本化する（フォーム定義は business-forms.ts が正）。
//   ・会社プロフィール：ホームページURL → 本文要約 ／ 法人番号 → gBizINFO（環境変数 GBIZINFO_TOKEN）
//   ・案件・人材：フリーテキスト（案件票・スキルシート等の貼り付け）→ DXフォーム項目のJSON
import { callLLM, parseJsonLoose } from "@/lib/llm";
import { logUsage } from "@/lib/ai-usage";
import { normalizeSkills } from "@/lib/skills";
import { REMOTE_OPTIONS, CONTRACT_TYPE_OPTIONS, AGE_BAND_OPTIONS, NATIONALITY_OPTIONS } from "@/lib/business-forms";

export type CompanyDraft = { mission?: string; culture?: string; ideal_persona?: string; appeal?: string; industry?: string; website?: string; company_name?: string };
export type JobDraft = {
  title?: string; role_label?: string; skills?: string[]; salary_min?: number | null; salary_max?: number | null;
  remote_type?: string; contract_types?: string[]; work_location?: string; start_date?: string; detail?: string;
};
export type CandidateDraft = {
  initials?: string; title?: string; skills?: string[]; rate?: string; salary_min?: number | null; salary_max?: number | null;
  remote_pref?: string; exp?: string; avail?: string; location?: string; age_band?: string; nationality?: string; note?: string;
};
type DraftResult<T> = { ok: true; draft: T } | { ok: false; error: string };

/** HTMLをテキスト化して上限まで（portal の実装を共通化）。 */
async function fetchSiteText(url: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!/^https?:\/\/.+/i.test(url)) return { ok: false, error: "URL の形式が正しくありません（https://… で入力）" };
  try {
    const res = await fetch(url, { headers: { "User-Agent": "ENGER-bot/1.0" }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { ok: false, error: `サイト取得に失敗しました (HTTP ${res.status})` };
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
    if (text.length < 80) return { ok: false, error: "サイト本文を十分に取得できませんでした。別ページのURLをお試しください。" };
    return { ok: true, text };
  } catch {
    return { ok: false, error: "サイトの取得に失敗しました。URL をご確認ください。" };
  }
}

/** 法人番号 → gBizINFO（経産省）から企業基本情報を取得。GBIZINFO_TOKEN 未設定なら null。 */
async function fetchGbizInfo(corporateNo: string): Promise<{ name?: string; url?: string; summary?: string } | null> {
  const token = process.env.GBIZINFO_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://info.gbiz.go.jp/hojin/v1/hojin/${corporateNo}`, {
      headers: { "X-hojinInfo-api-token": token, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const info = data?.["hojin-infos"]?.[0];
    if (!info) return null;
    const parts = [
      info.name && `会社名: ${info.name}`,
      info.location && `所在地: ${info.location}`,
      info.business_summary && `事業概要: ${info.business_summary}`,
      Array.isArray(info.business_items) && info.business_items.length > 0 && `事業内容: ${info.business_items.join("、")}`,
      info.date_of_establishment && `設立: ${info.date_of_establishment}`,
      info.employee_number != null && `従業員数: ${info.employee_number}`,
      info.capital_stock != null && `資本金: ${info.capital_stock}`,
    ].filter(Boolean).join("\n");
    return { name: info.name ?? undefined, url: info.company_url ?? undefined, summary: parts };
  } catch { return null; }
}

/** 会社プロフィール下書き：website か corporateNo のどちらかを入力。feature は AI 使用量ログの区分。 */
export async function draftCompanyFromSource(
  input: { website?: string | null; corporateNo?: string | null },
  feature = "company",
  account?: string | null,
): Promise<DraftResult<CompanyDraft>> {
  const website = (input.website ?? "").trim();
  const corpNo = (input.corporateNo ?? "").replace(/\D/g, "");

  // 素材集め：法人番号（gBizINFO）→ そのHPも取得 ／ URL直接
  let material = "";
  let resolvedName: string | undefined;
  let resolvedUrl: string | undefined;
  if (corpNo) {
    if (corpNo.length !== 13) return { ok: false, error: "法人番号は13桁の数字で入力してください" };
    const g = await fetchGbizInfo(corpNo);
    if (!g && !website) {
      return process.env.GBIZINFO_TOKEN
        ? { ok: false, error: "法人番号から企業情報を取得できませんでした。番号をご確認いただくか、会社ホームページURLをご利用ください。" }
        : { ok: false, error: "法人番号検索は未設定です（GBIZINFO_TOKEN）。会社ホームページURLで下書きしてください。" };
    }
    if (g) {
      material += `【公的情報（gBizINFO）】\n${g.summary}\n\n`;
      resolvedName = g.name; resolvedUrl = g.url;
    }
  }
  const siteUrl = website || resolvedUrl || "";
  if (siteUrl) {
    const s = await fetchSiteText(siteUrl);
    if (s.ok) material += `【会社サイト本文】\n${s.text}`;
    else if (!material) return { ok: false, error: s.error };
  }
  if (!material) return { ok: false, error: "会社ホームページURLか法人番号を入力してください" };

  const system = "あなたは採用広報の編集者です。与えられた企業情報から、エンジニア採用向けに以下を日本語で簡潔に抽出・要約します。誇張や創作はせず、読み取れる範囲で。JSONのみ出力：{\"mission\":\"事業の目的・ミッション(2-3文)\",\"culture\":\"カルチャー・働き方・価値観(2-3文)\",\"ideal_persona\":\"求める人物像(2-3文)\",\"appeal\":\"自社の魅力・強み(1-2文)\",\"industry\":\"業種(短く)\"}。読み取れない項目は空文字。";
  const res = await callLLM({ system, prompt: material, maxTokens: 700, temperature: 0.4 });
  if (!res.ok) return { ok: false, error: res.error || "AI生成に失敗しました" };
  await logUsage(feature, res.model, res.usage, account ?? null);
  const d = parseJsonLoose<CompanyDraft>(res.text);
  if (!d) return { ok: false, error: "AIの応答を解析できませんでした。再度お試しください。" };
  return {
    ok: true,
    draft: {
      mission: d.mission ?? "", culture: d.culture ?? "", ideal_persona: d.ideal_persona ?? "", appeal: d.appeal ?? "",
      industry: d.industry ?? "", website: siteUrl || undefined, company_name: resolvedName,
    },
  };
}

/** 案件下書き：案件票・依頼メール等のフリーテキスト → DX案件フォーム項目のJSON。 */
export async function draftJobFromText(text: string, feature = "biz_job_draft", account?: string | null): Promise<DraftResult<JobDraft>> {
  const t = (text ?? "").trim();
  if (t.length < 20) return { ok: false, error: "案件の内容（案件票・依頼文など）を20文字以上で貼り付けてください" };
  const system = `あなたはIT人材業界のアシスタントです。案件情報のテキストから以下を抽出し、JSONのみ出力します。読み取れない項目は null か空。
{"title":"案件名(60字以内)","role_label":"募集職種","skills":["技術スキル名の配列（言語/FW/クラウド等。日本語の一般名詞は除く）"],"salary_min":単価下限の数値(万円)またはnull,"salary_max":単価上限の数値(万円)またはnull,"remote_type":"${REMOTE_OPTIONS.join("|")} のいずれかまたは空","contract_types":["${CONTRACT_TYPE_OPTIONS.join("\",\"")}" のうち該当するもの],"work_location":"勤務地","start_date":"開始時期","detail":"業務内容・必須/歓迎要件の要約(400字以内。国籍・年代条件の記載があれば必ず含める)"}`;
  const res = await callLLM({ system, prompt: `案件テキスト：\n${t.slice(0, 6000)}`, maxTokens: 900, temperature: 0.2 });
  if (!res.ok) return { ok: false, error: res.error || "AI生成に失敗しました" };
  await logUsage(feature, res.model, res.usage, account ?? null);
  const d = parseJsonLoose<JobDraft>(res.text);
  if (!d) return { ok: false, error: "AIの応答を解析できませんでした。再度お試しください。" };
  return { ok: true, draft: sanitizeJobDraft(d) };
}

/** 人材下書き：スキルシート概要等のフリーテキスト → DX人材フォーム項目のJSON（匿名前提）。 */
export async function draftCandidateFromText(text: string, feature = "biz_cand_draft", account?: string | null): Promise<DraftResult<CandidateDraft>> {
  const t = (text ?? "").trim();
  if (t.length < 20) return { ok: false, error: "人材の内容（スキルシート概要・経歴など）を20文字以上で貼り付けてください" };
  const system = `あなたはIT人材業界のアシスタントです。人材情報のテキストから以下を抽出し、JSONのみ出力します。氏名はフルネームを出力せず、イニシャル（例 T.Y）に変換します。読み取れない項目は null か空。
{"initials":"イニシャル(例 T.Y)","title":"職種","skills":["技術スキル名の配列"],"rate":"希望単価の表記(例 〜80万)","salary_min":数値(万円)またはnull,"salary_max":数値(万円)またはnull,"remote_pref":"${REMOTE_OPTIONS.join("|")} のいずれかまたは空","exp":"経験年数(数字のみ可)","avail":"稼働開始時期","location":"最寄駅または居住エリア","age_band":"${AGE_BAND_OPTIONS.join("|")} のいずれかまたは空","nationality":"${NATIONALITY_OPTIONS.join("|")} のいずれかまたは空","note":"特記事項の要約(200字以内)"}`;
  const res = await callLLM({ system, prompt: `人材テキスト：\n${t.slice(0, 6000)}`, maxTokens: 800, temperature: 0.2 });
  if (!res.ok) return { ok: false, error: res.error || "AI生成に失敗しました" };
  await logUsage(feature, res.model, res.usage, account ?? null);
  const d = parseJsonLoose<CandidateDraft>(res.text);
  if (!d) return { ok: false, error: "AIの応答を解析できませんでした。再度お試しください。" };
  return { ok: true, draft: sanitizeCandidateDraft(d) };
}

// ---- 入力サニタイズ（AI出力と外部POSTの両方に使う） ---------------------------
const numOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 10000 ? Math.round(n) : null;
};
const pick = (v: unknown, allowed: readonly string[]): string | null => {
  const s = String(v ?? "").trim();
  return allowed.includes(s) ? s : null;
};
const str = (v: unknown, max = 200): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

export function sanitizeJobDraft(d: any): JobDraft {
  return {
    title: str(d?.title, 120) ?? undefined,
    role_label: str(d?.role_label, 60) ?? undefined,
    skills: normalizeSkills(Array.isArray(d?.skills) ? d.skills : []),
    salary_min: numOrNull(d?.salary_min),
    salary_max: numOrNull(d?.salary_max),
    remote_type: pick(d?.remote_type, REMOTE_OPTIONS) ?? undefined,
    contract_types: (Array.isArray(d?.contract_types) ? d.contract_types : []).filter((c: any) => (CONTRACT_TYPE_OPTIONS as readonly string[]).includes(c)),
    work_location: str(d?.work_location, 120) ?? undefined,
    start_date: str(d?.start_date, 60) ?? undefined,
    detail: str(d?.detail, 4000) ?? undefined,
  };
}

export function sanitizeCandidateDraft(d: any): CandidateDraft {
  return {
    initials: str(d?.initials, 8) ?? undefined,
    title: str(d?.title, 60) ?? undefined,
    skills: normalizeSkills(Array.isArray(d?.skills) ? d.skills : []),
    rate: str(d?.rate, 40) ?? undefined,
    salary_min: numOrNull(d?.salary_min),
    salary_max: numOrNull(d?.salary_max),
    remote_pref: pick(d?.remote_pref, REMOTE_OPTIONS) ?? undefined,
    exp: str(d?.exp, 40) ?? undefined,
    avail: str(d?.avail, 60) ?? undefined,
    location: str(d?.location, 60) ?? undefined,
    age_band: pick(d?.age_band, AGE_BAND_OPTIONS) ?? undefined,
    nationality: pick(d?.nationality, NATIONALITY_OPTIONS) ?? undefined,
    note: str(d?.note, 1000) ?? undefined,
  };
}
