import { unstable_cache } from "next/cache";
import { engerClient, dbConfigured } from "./supabase";

/** 企業ID表示ラベル（例: C-00001）。companies.company_no（identity列・自動採番）から生成する。
 *  #293：提案管理の「自社担当」自動表示を、会社名の表記ゆれに強い形で連携するための識別子。 */
export function companyIdLabel(no: number | null | undefined): string | null {
  if (no == null) return null;
  return `C-${String(no).padStart(5, "0")}`;
}

export type CompanyRow = {
  name: string;
  job_count: number;
  active_jobs: number;
  focus_jobs: number;
  last_job_at: string | null;
  avg_rate: number | null;
  tier: "A" | "B" | "C";
  status: string;
  proposals_total: number;
  won: number;
  lost: number;
  last_sentiment: string | null;
  last_relation: string | null;
  last_meeting_at: string | null;
  meeting_count: number;
};

/** 攻め先スコアの外部シグナル（企業マスタ・企業評価由来。CompanyRow に無い情報を注入する）。
 *  ・caution：取引注意フラグ（明確な減点）。
 *  ・want/mismatch：企業ポータルの「会いたい/ミスマッチ」評価の件数（決まりやすさに寄与）。 */
export type TargetOpts = { caution?: boolean | null; want?: number; mismatch?: number };

/**
 * 企業ごとの「決まりやすさ係数」(0..1、実績が少ないときは中立0.5に寄る)。
 *   ・成約率＝稼働 /(稼働+失注) を Laplace 平滑化（n=0 で 0.5 になり、スコアを歪めない）。
 *   ・企業評価（会いたい want / ミスマッチ mismatch）を混ぜて、担当の肌感を数値に取り込む。
 * ※ 失注理由の内訳（自社起因/競合負け等）まで見た精緻化は company_overview RPC 拡張が前提のため、
 *   ここでは既に CompanyRow にある won/lost と、注入された企業評価だけで“回る”係数を返す。
 */
export function closability(c: CompanyRow, opts?: TargetOpts): { coef: number; reason?: string } {
  const won = c.won ?? 0;
  const lost = c.lost ?? 0;
  const n = won + lost;
  // Laplace 平滑化：実績ゼロなら 0.5（中立）。少数でも極端な 0/1 にならない。
  let coef = (won + 1) / (n + 2);
  const want = opts?.want ?? 0;
  const mismatch = opts?.mismatch ?? 0;
  const fbN = want + mismatch;
  if (fbN > 0) coef = coef * 0.7 + (want / fbN) * 0.3; // 企業評価を3割ブレンド
  coef = Math.max(0, Math.min(1, coef));
  // ラベルは「材料が十分」なときだけ出す（n<3 かつ FB<2 の推測は黙る）。
  let reason: string | undefined;
  if (n >= 3 || fbN >= 2) {
    const pct = Math.round(coef * 100);
    if (coef >= 0.6) reason = `決まりやすい(${pct}%)`;
    else if (coef <= 0.35) reason = `決まりにくい(${pct}%)`;
  }
  return { coef, reason };
}

/**
 * 「どの企業を狙うべきか」のスコア(0-100)。
 * 案件供給力 + 注力 + 稼働実績 + 打合せ温度感 + 関係性 + 鮮度 − 失注 ± 決まりやすさ − 取引注意。
 * opts で企業マスタ/企業評価由来のシグナル（取引注意・会いたい/ミスマッチ件数）を注入できる。
 */
export function targetScore(c: CompanyRow, opts?: TargetOpts): { score: number; reasons: string[] } {
  let s = 0;
  const reasons: string[] = [];
  s += Math.min(c.active_jobs ?? 0, 10) * 4;
  if ((c.active_jobs ?? 0) >= 5) reasons.push(`募集中${c.active_jobs}件`);
  s += Math.min(c.focus_jobs ?? 0, 5) * 2;
  s += Math.min(c.won ?? 0, 5) * 4;
  if ((c.won ?? 0) > 0) reasons.push(`稼働実績${c.won}件`);

  const sent = c.last_sentiment ?? "";
  if (sent.includes("ポジ")) { s += 15; reasons.push("反応ポジティブ"); }
  else if (sent.includes("競合")) { s += 5; reasons.push("競合検討中"); }
  else if (sent.includes("ネガ")) { s -= 10; reasons.push("反応ネガティブ"); }

  const rel = c.last_relation ?? "";
  if (rel.includes("継続") || rel.includes("再構築")) { s += 10; reasons.push("関係構築中"); }
  else if (rel.includes("新規")) { s += 5; }
  else if (rel.includes("休眠")) { s -= 10; }

  const days = c.last_job_at ? (Date.now() - new Date(c.last_job_at).getTime()) / 86400000 : 999;
  if (days <= 30) { s += 10; reasons.push("直近で案件あり"); }
  else if (days <= 90) { s += 5; }
  else { s -= 5; reasons.push("案件が停滞"); }

  s -= Math.min(c.lost ?? 0, 5) * 2;
  if ((c.lost ?? 0) >= 3) reasons.push(`失注${c.lost}件`);

  // 決まりやすさ係数：中立(0.5)からの差分を ±12 点まで反映（n=0 は 0.5＝無影響）。
  const clos = closability(c, opts);
  s += Math.round((clos.coef - 0.5) * 24);
  if (clos.reason) reasons.push(clos.reason);

  // 取引注意（属人知＝「電話つながらない/合わない」等）は明確な減点として全員に効かせる。
  if (opts?.caution) { s -= 15; reasons.unshift("⚠取引注意"); }

  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons: reasons.slice(0, 3) };
}

export type ProspectAction = { key: "hot" | "reapproach" | "new" | "recover"; label: string; tone: string } | null;

/** エンド開拓の「次アクション」分類。アウトサイドが今アプローチすべき種別。 */
export function prospectAction(c: CompanyRow): ProspectAction {
  const days = c.last_job_at ? (Date.now() - new Date(c.last_job_at).getTime()) / 86400000 : 999;
  const sent = c.last_sentiment ?? "";
  const status = c.status ?? "";
  const rel = c.last_relation ?? "";
  // 優先度順
  if (sent.includes("ポジ") && (c.active_jobs ?? 0) === 0) return { key: "hot", label: "ポジ→深掘り", tone: "#1aa260" };
  if ((status === "休眠" || days > 90) && (c.job_count ?? 0) > 0) return { key: "reapproach", label: "再アプローチ", tone: "#d98a2b" };
  if (status === "新規" || rel.includes("新規")) return { key: "new", label: "新規フォロー", tone: "#7a5cc4" };
  if ((c.lost ?? 0) > 0 && (c.active_jobs ?? 0) === 0) return { key: "recover", label: "失注リカバリ", tone: "#d23f57" };
  return null;
}

async function fetchCompanies(): Promise<CompanyRow[] | null> {
  if (!dbConfigured) return null;
  try {
    const sb = engerClient();
    const { data, error } = await sb.rpc("company_overview");
    if (error || !data) return null;
    return data as CompanyRow[];
  } catch {
    return null;
  }
}

// 案件集計は重いので 5 分キャッシュ
export const getCompanyOverview = unstable_cache(fetchCompanies, ["company-overview"], { revalidate: 300 });

// ===== 取引構造（エンド/SI＝案件元 × パートナーSES＝人材元）=====

export type CompanyMatrixRow = { name: string; jobs: number; cands: number; type: "エンド/SI" | "パートナー" | "両取引" };
export type CompanyMatrix = {
  endCount: number; partnerCount: number; bothCount: number; totalJobs: number; totalCands: number;
  rows: CompanyMatrixRow[];
  reco: { text: string; tone: string };
};

/** 企業名の名寄せキー（株式会社等の法人格・空白・記号を除去）。 */
const compKey = (s: string) => String(s || "").toLowerCase()
  .replace(/(株式会社|有限会社|合同会社|合資会社|\(株\)|（株）|㈱|inc\.?|co\.?,?\s*ltd\.?|ltd\.?|corp\.?|corporation)/g, "")
  .replace(/[\s　()（）・,，、。.\-－_/／]/g, "");

async function fetchCompanyMatrix(): Promise<CompanyMatrix | null> {
  if (!dbConfigured) return null;
  try {
    const sb = engerClient();
    const page = async (table: string, cols: string, filter?: (q: any) => any) => {
      let all: any[] = []; for (let from = 0; ; from += 1000) { let q = sb.from(table).select(cols).range(from, from + 999); if (filter) q = filter(q); const { data, error } = await q; if (error || !data) break; all = all.concat(data); if (data.length < 1000) break; } return all;
    };
    const jobsRows = await page("jobs", "client_name", (q) => q.eq("is_published", true));
    const candRows = await page("candidates", "company, source_company");

    const jobMap = new Map<string, { name: string; n: number }>();
    const candMap = new Map<string, { name: string; n: number }>();
    for (const r of jobsRows) { const nm = String(r.client_name || "").trim(); if (!nm) continue; const k = compKey(nm); const e = jobMap.get(k) ?? { name: nm, n: 0 }; e.n++; jobMap.set(k, e); }
    for (const r of candRows) { const nm = String(r.company || r.source_company || "").trim(); if (!nm) continue; const k = compKey(nm); const e = candMap.get(k) ?? { name: nm, n: 0 }; e.n++; candMap.set(k, e); }

    const keys = new Set([...jobMap.keys(), ...candMap.keys()]);
    const rows: CompanyMatrixRow[] = [...keys].map((k) => {
      const jobs = jobMap.get(k)?.n ?? 0, cands = candMap.get(k)?.n ?? 0;
      const name = jobMap.get(k)?.name || candMap.get(k)?.name || k;
      const type: CompanyMatrixRow["type"] = jobs > 0 && cands > 0 ? "両取引" : jobs > 0 ? "エンド/SI" : "パートナー";
      return { name, jobs, cands, type };
    }).sort((a, b) => (b.jobs + b.cands) - (a.jobs + a.cands));

    const totalJobs = rows.reduce((a, r) => a + r.jobs, 0);
    const totalCands = rows.reduce((a, r) => a + r.cands, 0);
    const endCount = rows.filter((r) => r.jobs > 0).length;
    const partnerCount = rows.filter((r) => r.cands > 0).length;
    const bothCount = rows.filter((r) => r.jobs > 0 && r.cands > 0).length;

    let reco = { text: "案件（エンド/SI）と人材（パートナー）のバランスは良好です。", tone: "#1aa260" };
    if (totalJobs < totalCands * 0.7) reco = { text: `案件が不足気味（案件 ${totalJobs} ＜ 人材 ${totalCands}）。直案件を持つ エンド/SI企業の開拓 を強化しましょう。`, tone: "#d23f57" };
    else if (totalCands < totalJobs * 0.7) reco = { text: `人材が不足気味（人材 ${totalCands} ＜ 案件 ${totalJobs}）。人材を送ってくる パートナー(SES)企業の開拓 を強化しましょう。`, tone: "#d98a2b" };

    return { endCount, partnerCount, bothCount, totalJobs, totalCands, rows: rows.slice(0, 100), reco };
  } catch { return null; }
}

export const getCompanyMatrix = unstable_cache(fetchCompanyMatrix, ["company-matrix"], { revalidate: 300 });
