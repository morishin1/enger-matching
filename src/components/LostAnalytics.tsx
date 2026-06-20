"use client";

// 見送り/失注の分析パネル。
//   - 集計期間フィルタ（直近30日/90日/6ヶ月/1年/今年/全期間/カスタム）
//   - 失注フェーズ分布
//   - 連絡継続判断スコア（重点フォロー / 様子見 / 保留候補）
//   - 会社別 失注件数ランキング（勝率併記）
//   - 会社 × 失注理由 ヒートマップ
//   - 担当者別 失注理由
// 「そもそも連絡する意味あるのか？」を score = 勝率×0.7 + 接触の新しさ×0.3 で判定。

import { useMemo, useState } from "react";
import Link from "next/link";

type HItem = {
  id: string;
  company?: string | null;
  job_title?: string | null;
  candidate_name?: string | null;
  stage?: string | null;
  lost_reason?: string | null;
  lost_reason_note?: string | null;
  lost_phase?: string | null;
  proposer?: string | null;
  closer?: string | null;
  client_contact?: string | null;   // 先方担当者（勝率分析の軸）
  created_at?: string | null;
  updated_at?: string | null;
  stage_updated_at?: string | null;
  // 提案画面（マッチング）へ戻すための識別子
  job_no?: number | null;
  candidate_no?: number | null;
};

const LOST_STAGES = new Set(["見送り", "失注"]);
const WON_STAGES = new Set(["稼働", "稼働決定"]);

const PERIOD_PRESETS = [
  { key: "30d",   label: "直近30日" },
  { key: "90d",   label: "直近90日" },
  { key: "180d",  label: "直近6ヶ月" },
  { key: "365d",  label: "直近1年" },
  { key: "tm",    label: "今月" },
  { key: "lm",    label: "先月" },
  { key: "ytd",   label: "今年" },
  { key: "ly",    label: "昨年" },
  { key: "all",   label: "全期間" },
] as const;
type PeriodKey = typeof PERIOD_PRESETS[number]["key"];

const SPAN_OPTIONS = [
  { key: "",   label: "（期間指定）" },
  { key: "1w", label: "から1週間" },
  { key: "2w", label: "から2週間" },
  { key: "1m", label: "から1ヶ月" },
  { key: "3m", label: "から3ヶ月" },
  { key: "6m", label: "から6ヶ月" },
  { key: "1y", label: "から1年" },
] as const;
type SpanKey = typeof SPAN_OPTIONS[number]["key"];

function addSpan(t: number, span: SpanKey): number {
  const d = new Date(t);
  switch (span) {
    case "1w": d.setDate(d.getDate() + 7); break;
    case "2w": d.setDate(d.getDate() + 14); break;
    case "1m": d.setMonth(d.getMonth() + 1); break;
    case "3m": d.setMonth(d.getMonth() + 3); break;
    case "6m": d.setMonth(d.getMonth() + 6); break;
    case "1y": d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.getTime() - 1;
}

function periodRange(period: PeriodKey, fromStr: string, toStr: string, span: SpanKey, year: string): { from: number; to: number; label: string } {
  const now = Date.now();
  // 年指定（例: 2020年）
  if (year) {
    const y = Number(year);
    const from = new Date(y, 0, 1).getTime();
    const to = new Date(y + 1, 0, 1).getTime() - 1;
    return { from, to, label: `${y}年` };
  }
  // カスタム範囲 / 開始日 + スパン
  if (fromStr || toStr) {
    const from = fromStr ? new Date(fromStr).getTime() : 0;
    if (fromStr && span) {
      const to = addSpan(from, span);
      return { from, to, label: `${fromStr} から${SPAN_OPTIONS.find((s) => s.key === span)?.label.replace("から", "") ?? ""}間` };
    }
    const to = toStr ? new Date(toStr).getTime() + 86400000 - 1 : now;
    return { from, to, label: `${fromStr || "—"} 〜 ${toStr || "今日"}` };
  }
  const today = new Date();
  switch (period) {
    case "30d":  return { from: now - 30 * 86400000,  to: now, label: "直近30日" };
    case "90d":  return { from: now - 90 * 86400000,  to: now, label: "直近90日" };
    case "180d": return { from: now - 180 * 86400000, to: now, label: "直近6ヶ月" };
    case "365d": return { from: now - 365 * 86400000, to: now, label: "直近1年" };
    case "tm": {
      const from = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
      const to = new Date(today.getFullYear(), today.getMonth() + 1, 1).getTime() - 1;
      return { from, to, label: "今月" };
    }
    case "lm": {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime();
      const to = new Date(today.getFullYear(), today.getMonth(), 1).getTime() - 1;
      return { from, to, label: "先月" };
    }
    case "ytd":  return { from: new Date(today.getFullYear(), 0, 1).getTime(), to: now, label: "今年" };
    case "ly": {
      const y = today.getFullYear() - 1;
      return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() - 1, label: "昨年" };
    }
    case "all":  return { from: 0, to: now, label: "全期間" };
  }
}

type Aggregated = {
  totals: { lost: number; won: number; winRate: number };
  phases: Record<string, number>;
  reasons: Record<string, number>;
  topReasons: string[];
  topPhase: string;
  companies: Array<{
    name: string;
    won: number; lost: number; total: number;
    winRate: number;
    daysSinceLastContact: number | null;
    score: number;
    category: "重点" | "様子見" | "保留";
    reasons: Record<string, number>;
    phases: Record<string, number>;
  }>;
  byProposer: Array<{ name: string; won: number; lost: number; reasons: Record<string, number>; lagDays: number[] }>;
  byCloser: Array<{ name: string; won: number; lost: number; reasons: Record<string, number>; lagDays: number[] }>;
  // 先方担当者（クライアント窓口）別の勝率・失注理由。誰に当たると決まりやすい/落ちやすいかを見る。
  byClientContact: Array<{ name: string; won: number; lost: number; reasons: Record<string, number>; lagDays: number[] }>;
  // 提案→失注 までのタイムラグ（日）。スピード改善のための分布・上位の遅い案件を保持。
  lagBuckets: Array<{ label: string; range: [number, number]; n: number }>;
  lagStats: { avg: number | null; median: number | null; p90: number | null; total: number };
  // 失注ログ（担当者・理由・日数・コメント）。テーブル表示用。
  lostRows: Array<{ id: string; company: string; job_title: string; candidate_name: string; proposer: string; closer: string; reason: string; phase: string; note: string | null; created_at: number; lost_at: number; lagDays: number | null; job_no: number | null; candidate_no: number | null }>;
};

function analyze(items: HItem[]): Aggregated {
  const phases: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  const companies: Record<string, any> = {};
  const byProposer: Record<string, any> = {};
  const byCloser: Record<string, any> = {};
  const byClientContact: Record<string, any> = {};
  const lostRowsRaw: Aggregated["lostRows"] = [];
  let lost = 0, won = 0;

  for (const p of items) {
    const isLost = LOST_STAGES.has(p.stage ?? "");
    const isWon = WON_STAGES.has(p.stage ?? "");
    if (!isLost && !isWon) continue;
    if (isLost) lost++;
    if (isWon) won++;

    const company = (p.company ?? "（未入力）").trim() || "（未入力）";
    if (!companies[company]) companies[company] = { name: company, won: 0, lost: 0, reasons: {}, phases: {}, lastContactAt: 0 };
    if (isLost) {
      companies[company].lost++;
      const r = p.lost_reason || "（理由未入力）";
      companies[company].reasons[r] = (companies[company].reasons[r] || 0) + 1;
      reasons[r] = (reasons[r] || 0) + 1;
      const ph = p.lost_phase || "（フェーズ未入力）";
      companies[company].phases[ph] = (companies[company].phases[ph] || 0) + 1;
      phases[ph] = (phases[ph] || 0) + 1;
    } else {
      companies[company].won++;
    }
    const t = new Date(p.updated_at || p.created_at || 0).getTime();
    if (t > companies[company].lastContactAt) companies[company].lastContactAt = t;

    const proposer = (p.proposer ?? "（未割当）").trim() || "（未割当）";
    if (!byProposer[proposer]) byProposer[proposer] = { name: proposer, won: 0, lost: 0, reasons: {}, lagDays: [] };
    if (isLost) {
      byProposer[proposer].lost++;
      const r = p.lost_reason || "（理由未入力）";
      byProposer[proposer].reasons[r] = (byProposer[proposer].reasons[r] || 0) + 1;
      // 提案→失注のタイムラグ。created_at(提案開始) と stage_updated_at(ステージ更新=失注確定) の差分。
      // stage_updated_at が無い古いレコードは updated_at にフォールバック。
      const createdT = new Date(p.created_at || 0).getTime();
      const lostT = new Date(p.stage_updated_at || p.updated_at || 0).getTime();
      if (createdT && lostT && lostT >= createdT) {
        const days = Math.max(0, Math.round((lostT - createdT) / 86400000));
        byProposer[proposer].lagDays.push(days);
        lostRowsRaw.push({
          id: p.id, company, job_title: (p.job_title ?? "—") || "—", candidate_name: (p.candidate_name ?? "—") || "—",
          proposer, closer: (p.closer ?? "—") || "—", reason: r, phase: p.lost_phase || "（未入力）",
          note: p.lost_reason_note ?? null, created_at: createdT, lost_at: lostT, lagDays: days,
          job_no: p.job_no ?? null, candidate_no: p.candidate_no ?? null,
        });
      } else {
        lostRowsRaw.push({
          id: p.id, company, job_title: (p.job_title ?? "—") || "—", candidate_name: (p.candidate_name ?? "—") || "—",
          proposer, closer: (p.closer ?? "—") || "—", reason: r, phase: p.lost_phase || "（未入力）",
          note: p.lost_reason_note ?? null, created_at: createdT, lost_at: lostT, lagDays: null,
          job_no: p.job_no ?? null, candidate_no: p.candidate_no ?? null,
        });
      }
    } else {
      byProposer[proposer].won++;
    }

    // クロージング担当別の集計（提案者と別に責務を見るため）。
    //   失注は「契約クロージング段階の判断・交渉」に強く効くため、CL担当別の理由分布も併記する。
    const closer = (p.closer ?? "").trim() || "（未割当）";
    if (!byCloser[closer]) byCloser[closer] = { name: closer, won: 0, lost: 0, reasons: {}, lagDays: [] };
    if (isLost) {
      byCloser[closer].lost++;
      const r = p.lost_reason || "（理由未入力）";
      byCloser[closer].reasons[r] = (byCloser[closer].reasons[r] || 0) + 1;
      const createdT = new Date(p.created_at || 0).getTime();
      const lostT = new Date(p.stage_updated_at || p.updated_at || 0).getTime();
      if (createdT && lostT && lostT >= createdT) {
        const days = Math.max(0, Math.round((lostT - createdT) / 86400000));
        byCloser[closer].lagDays.push(days);
      }
    } else {
      byCloser[closer].won++;
    }

    // 先方担当者（クライアント窓口）別の集計。誰に当たると決まりやすい/落ちやすいかを可視化。
    const contact = (p.client_contact ?? "").trim() || "（未入力）";
    if (!byClientContact[contact]) byClientContact[contact] = { name: contact, won: 0, lost: 0, reasons: {}, lagDays: [] };
    if (isLost) {
      byClientContact[contact].lost++;
      const r = p.lost_reason || "（理由未入力）";
      byClientContact[contact].reasons[r] = (byClientContact[contact].reasons[r] || 0) + 1;
      const createdT = new Date(p.created_at || 0).getTime();
      const lostT = new Date(p.stage_updated_at || p.updated_at || 0).getTime();
      if (createdT && lostT && lostT >= createdT) {
        byClientContact[contact].lagDays.push(Math.max(0, Math.round((lostT - createdT) / 86400000)));
      }
    } else {
      byClientContact[contact].won++;
    }
  }

  const now = Date.now();
  const companyList = Object.values(companies).map((c: any) => {
    const total = c.won + c.lost;
    const winRate = total === 0 ? 0 : c.won / total;
    const daysSince = c.lastContactAt ? Math.max(0, Math.floor((now - c.lastContactAt) / 86400000)) : null;
    const recency = daysSince == null ? 0 : 1 - Math.min(daysSince / 180, 1); // 180日で 0
    const score = winRate * 0.7 + recency * 0.3;
    const category: "重点" | "様子見" | "保留" = score >= 0.5 ? "重点" : score >= 0.2 ? "様子見" : "保留";
    return { name: c.name, won: c.won, lost: c.lost, total, winRate, daysSinceLastContact: daysSince, score, category, reasons: c.reasons, phases: c.phases };
  });

  const topReasons = Object.entries(reasons).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 8).map(([r]) => r);
  const topPhase = Object.entries(phases).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0] ?? "—";
  const total = lost + won;
  const winRate = total === 0 ? 0 : Math.round((won / total) * 100);

  // 全体のラグ統計（提案→失注 日数）。スピード改善の起点。
  const allLags = lostRowsRaw.map((r) => r.lagDays).filter((d): d is number => d != null).sort((a, b) => a - b);
  const lagStats = (() => {
    if (allLags.length === 0) return { avg: null, median: null, p90: null, total: 0 };
    const avg = Math.round(allLags.reduce((a, b) => a + b, 0) / allLags.length);
    const median = allLags[Math.floor(allLags.length / 2)];
    const p90 = allLags[Math.min(allLags.length - 1, Math.floor(allLags.length * 0.9))];
    return { avg, median, p90, total: allLags.length };
  })();
  // ラグ分布（決定の速さの典型）。1日内/1-3/4-7/8-14/15-30/31日以上 のバケツ。
  const lagBuckets: Aggregated["lagBuckets"] = [
    { label: "1日以内", range: [0, 1], n: 0 },
    { label: "2-3日",  range: [2, 3], n: 0 },
    { label: "4-7日",  range: [4, 7], n: 0 },
    { label: "8-14日", range: [8, 14], n: 0 },
    { label: "15-30日", range: [15, 30], n: 0 },
    { label: "31日以上", range: [31, Infinity], n: 0 },
  ];
  for (const d of allLags) {
    const b = lagBuckets.find((x) => d >= x.range[0] && d <= x.range[1]);
    if (b) b.n++;
  }

  return {
    totals: { lost, won, winRate },
    phases, reasons, topReasons, topPhase,
    companies: companyList,
    byProposer: Object.values(byProposer).map((p: any) => p) as Aggregated["byProposer"],
    byCloser: Object.values(byCloser).map((c: any) => c) as Aggregated["byCloser"],
    byClientContact: Object.values(byClientContact).map((c: any) => c) as Aggregated["byClientContact"],
    lagBuckets, lagStats,
    lostRows: lostRowsRaw.sort((a, b) => (b.lost_at || 0) - (a.lost_at || 0)),
  };
}

const CAT_TONE: Record<"重点" | "様子見" | "保留", { fg: string; bg: string; bd: string; emoji: string; subtitle: string }> = {
  重点:   { fg: "#067647", bg: "#e7f7ee", bd: "#bfe3cc", emoji: "✓", subtitle: "勝率が高く接触も新しい → 連絡継続" },
  様子見: { fg: "#b45309", bg: "#fff6e0", bd: "#fde9b0", emoji: "△", subtitle: "勝率は中。失注理由次第で見極め" },
  保留:   { fg: "#b42318", bg: "#fdecef", bd: "#f7c5cf", emoji: "⚠", subtitle: "勝率が低い／長期接触なし → 他社に時間を回す" },
};

export function LostAnalytics({ history }: { history: HItem[] }) {
  const [period, setPeriod] = useState<PeriodKey>("90d");
  const [fromStr, setFromStr] = useState("");
  const [toStr, setToStr] = useState("");
  const [span, setSpan] = useState<SpanKey>("");
  const [year, setYear] = useState("");

  const { from, to, label } = periodRange(period, fromStr, toStr, span, year);

  const filtered = useMemo(() => history.filter((p) => {
    const t = new Date(p.updated_at || p.created_at || 0).getTime();
    return t >= from && t <= to;
  }), [history, from, to]);

  const data = useMemo(() => analyze(filtered), [filtered]);

  // 履歴から登場する年を抽出（降順）
  const availableYears = useMemo(() => {
    const ys = new Set<number>();
    for (const p of history) {
      const t = p.updated_at || p.created_at;
      if (t) ys.add(new Date(t).getFullYear());
    }
    const arr = Array.from(ys).sort((a, b) => b - a);
    // 現在年が無くても選べるようにフォールバック
    const cy = new Date().getFullYear();
    if (!arr.includes(cy)) arr.unshift(cy);
    return arr;
  }, [history]);

  const clearAll = () => { setFromStr(""); setToStr(""); setSpan(""); setYear(""); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 期間フィルタ */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 14px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-ink-3)" }}>📅 集計期間</span>
          <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99, flexWrap: "wrap" }}>
            {PERIOD_PRESETS.map((p) => {
              const active = period === p.key && !fromStr && !toStr && !year;
              return (
                <button key={p.key} type="button"
                  onClick={() => { setPeriod(p.key); setFromStr(""); setToStr(""); setSpan(""); setYear(""); }}
                  style={{ padding: "5px 12px", borderRadius: 99, border: 0, fontSize: 11.5, fontWeight: 600, cursor: "pointer", background: active ? "var(--color-surface)" : "transparent", color: active ? "var(--color-ink)" : "var(--color-ink-3)", boxShadow: active ? "0 1px 2px rgba(15,23,42,.08)" : "none", fontFamily: "inherit" }}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <span className="muted" style={{ marginLeft: "auto", fontSize: 11 }}>表示期間：{label}</span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 11, color: "var(--color-ink-3)" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontWeight: 600 }}>年指定</span>
            <select value={year} onChange={(e) => { setYear(e.target.value); setFromStr(""); setToStr(""); setSpan(""); }}
              style={{ fontSize: 11.5, padding: "3px 6px", border: "1px solid var(--color-border-strong)", borderRadius: 6, fontFamily: "inherit" }}>
              <option value="">—</option>
              {availableYears.map((y) => <option key={y} value={String(y)}>{y}年</option>)}
            </select>
          </label>
          <span style={{ color: "var(--color-ink-5)" }}>|</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontWeight: 600 }}>カスタム</span>
            <input type="date" value={fromStr} onChange={(e) => { setFromStr(e.target.value); setYear(""); }} style={{ fontSize: 11.5, padding: "3px 6px", border: "1px solid var(--color-border-strong)", borderRadius: 6 }} />
            <span>〜</span>
            <input type="date" value={toStr} onChange={(e) => { setToStr(e.target.value); setYear(""); setSpan(""); }} disabled={!!span}
              style={{ fontSize: 11.5, padding: "3px 6px", border: "1px solid var(--color-border-strong)", borderRadius: 6, opacity: span ? 0.45 : 1 }} />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontWeight: 600 }}>または開始日</span>
            <select value={span} onChange={(e) => { setSpan(e.target.value as SpanKey); if (e.target.value) setToStr(""); }} disabled={!fromStr}
              style={{ fontSize: 11.5, padding: "3px 6px", border: "1px solid var(--color-border-strong)", borderRadius: 6, fontFamily: "inherit", opacity: fromStr ? 1 : 0.45 }}>
              {SPAN_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          {(fromStr || toStr || year || span) && (
            <button type="button" className="btn ghost btn-xs" onClick={clearAll}>クリア</button>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, padding: 14 }}>
        <KPI label="失注合計" value={data.totals.lost} unit="件" tone="#b42318" />
        <KPI label="成約合計（稼働）" value={data.totals.won} unit="件" tone="#067647" />
        <KPI label="勝率" value={`${data.totals.winRate}%`} tone="#0b5cab" />
        <KPI label="主要失注フェーズ" value={data.topPhase} tone="#b45309" small />
      </div>

      {/* 失注フェーズ分布 */}
      {Object.keys(data.phases).length > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <Header title="🎯 失注フェーズ分布" hint="提案後・面談後失注が多い → クロージング力 / 接触前失注が多い → 提案の質を見直し" />
          <BarList items={Object.entries(data.phases).sort((a, b) => (b[1] as number) - (a[1] as number))} total={data.totals.lost} tone="#b42318" />
        </div>
      )}

      {/* 担当者別 失注傾向＋スピード（提案者 / クロージング をタブで切替）。失注フェーズ分布の直下に配置。 */}
      {(data.byProposer.length > 0 || data.byCloser.length > 0 || data.byClientContact.length > 0) && (
        <OwnerLostBreakdown byProposer={data.byProposer} byCloser={data.byCloser} byClientContact={data.byClientContact} />
      )}

      {/* 時間帯分析：提案／クロージングの時間帯分布と反応率（仮説検証用）。 */}
      {filtered.length > 0 && (
        <TimeAnalysisCard items={filtered} />
      )}

      {/* 連絡継続判断 */}
      {data.companies.length > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <Header title="🏢 会社別 - 連絡継続判断" hint="勝率×0.7 + 接触の新しさ×0.3 で算出。「保留」は連絡頻度を落とし、他社に時間を回す候補。" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
            {(["重点", "様子見", "保留"] as const).map((cat) => {
              const tone = CAT_TONE[cat];
              const list = data.companies.filter((c) => c.category === cat).sort((a, b) => b.lost - a.lost);
              return (
                <div key={cat} style={{ background: tone.bg, border: `1px solid ${tone.bd}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: tone.fg }}>{tone.emoji} {cat}フォロー</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: tone.fg, fontWeight: 700 }}>{list.length}社</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: tone.fg, marginBottom: 8, opacity: .85 }}>{tone.subtitle}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 220, overflowY: "auto" }}>
                    {list.length === 0 ? <span className="muted" style={{ fontSize: 11 }}>該当なし</span> : list.slice(0, 12).map((c) => (
                      <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, padding: "4px 6px", borderRadius: 6, background: "var(--color-surface)" }}>
                        <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                        <span className="muted" style={{ fontSize: 10 }}>勝率{Math.round(c.winRate * 100)}%</span>
                        <span style={{ fontSize: 10, color: tone.fg, fontWeight: 700 }}>{c.lost}失注</span>
                        {c.daysSinceLastContact != null && <span className="muted" style={{ fontSize: 10 }}>{c.daysSinceLastContact}日前</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 会社ランキング */}
      {data.companies.length > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <Header title="📉 会社別 失注件数ランキング（上位）" hint="勝率と最終接触日もあわせて表示" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...data.companies].sort((a, b) => b.lost - a.lost).slice(0, 10).map((c) => {
              const max = Math.max(...data.companies.map((x) => x.lost));
              const w = max === 0 ? 0 : (c.lost / max) * 100;
              return (
                <div key={c.name} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr 220px", gap: 10, alignItems: "center", fontSize: 11.5 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{c.name}</span>
                  <div style={{ height: 12, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden", position: "relative" }}>
                    <div style={{ width: `${w}%`, height: "100%", background: "#b42318", borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 6, color: "#fff", fontSize: 10.5, fontWeight: 700 }}>{c.lost}</div>
                  </div>
                  <span className="muted" style={{ fontSize: 11 }}>成約 {c.won} ／ 勝率 {Math.round(c.winRate * 100)}% ／ {c.daysSinceLastContact != null ? `${c.daysSinceLastContact}日前` : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 会社×失注理由ヒートマップ */}
      {data.companies.length > 0 && data.topReasons.length > 0 && (() => {
        const top = [...data.companies].sort((a, b) => b.lost - a.lost).slice(0, 10);
        const max = Math.max(1, ...top.flatMap((c) => data.topReasons.map((r) => c.reasons[r] ?? 0)));
        return (
          <div className="card" style={{ padding: 14, overflowX: "auto" }}>
            <Header title="🔍 会社 × 失注理由 ヒートマップ（上位）" hint="同じ会社で同じ失注理由が続くなら、その問題を回避する提案戦略に切替" />
            <table style={{ borderCollapse: "collapse", fontSize: 11.5, minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "4px 8px", borderBottom: "1px solid var(--color-border)", position: "sticky", left: 0, background: "var(--color-surface)" }}>会社</th>
                  {data.topReasons.map((r) => (
                    <th key={r} style={{ padding: "4px 8px", borderBottom: "1px solid var(--color-border)", textAlign: "center", fontWeight: 600, color: "var(--color-ink-3)" }} title={r}>{r.length > 16 ? r.slice(0, 16) + "…" : r}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {top.map((c) => (
                  <tr key={c.name}>
                    <td style={{ padding: "4px 8px", borderBottom: "1px dashed var(--color-border)", fontWeight: 600, position: "sticky", left: 0, background: "var(--color-surface)", whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }} title={c.name}>{c.name}</td>
                    {data.topReasons.map((r) => {
                      const n = c.reasons[r] ?? 0;
                      const alpha = n === 0 ? 0 : 0.15 + 0.75 * (n / max);
                      return (
                        <td key={r} style={{ padding: "4px 8px", textAlign: "center", borderBottom: "1px dashed var(--color-border)", background: n === 0 ? "transparent" : `rgba(180, 35, 24, ${alpha})`, color: n === 0 ? "var(--color-ink-5)" : alpha > 0.5 ? "#fff" : "#b42318", fontWeight: 700 }}>{n || "—"}</td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* ⏱ 提案 → 失注 タイムラグ（スピード分析） */}
      {data.lagStats.total > 0 && (
        <div className="card" style={{ padding: 14 }}>
          <Header title="⏱ 提案 → 失注 タイムラグ（決定の速さ）" hint="提案開始(created_at)から失注確定(stage_updated_at)までの日数。早期決定が多いほど機会損失が少なく、長期化はフォローや訴求の改善余地あり。" />
          {/* 上段：平均/中央値/P90 のサマリ */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: 12 }}>
            <KPI label="平均ラグ" value={data.lagStats.avg ?? "—"} unit="日" tone="#b45309" />
            <KPI label="中央値" value={data.lagStats.median ?? "—"} unit="日" tone="#0b5cab" />
            <KPI label="P90（遅い90%ライン）" value={data.lagStats.p90 ?? "—"} unit="日" tone="#b42318" small />
            <KPI label="ラグ算出対象" value={data.lagStats.total} unit="件" tone="var(--color-ink-3)" small />
          </div>
          {/* 中段：分布バー */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(() => {
              const max = Math.max(1, ...data.lagBuckets.map((b) => b.n));
              return data.lagBuckets.map((b) => {
                const pct = data.lagStats.total === 0 ? 0 : Math.round((b.n / data.lagStats.total) * 100);
                const isSlow = b.range[0] >= 15;
                const tone = isSlow ? "#b42318" : b.range[0] >= 4 ? "#b45309" : "#067647";
                return (
                  <div key={b.label} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 110px) 1fr 84px", gap: 10, alignItems: "center", fontSize: 11.5 }}>
                    <span style={{ color: tone, fontWeight: 700 }}>{b.label}</span>
                    <div style={{ height: 10, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${(b.n / max) * 100}%`, height: "100%", background: tone, borderRadius: 99 }} />
                    </div>
                    <span className="mono" style={{ fontSize: 11, textAlign: "right", color: "var(--color-ink-3)" }}>{b.n}件 ({pct}%)</span>
                  </div>
                );
              });
            })()}
          </div>
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>※ 15日以上で長期化＝先方の関心が冷める前にクロージング/フォローしましょう。31日以上が多いと「いつまでも返事を待っている」状態の可能性。</div>
        </div>
      )}

      {/* 担当者別 失注（提案者 / クロージング をタブ切替） — 失注フェーズ分布の直下は下に移動済 */}

      {/* 失注ログ（担当者・理由・スピード一覧） */}
      {data.lostRows.length > 0 && (
        <LostRowsTable rows={data.lostRows} />
      )}

      {/* 推奨：今後とるべき情報 */}
      <div className="card" style={{ padding: 14, background: "var(--color-surface-soft)" }}>
        <Header title="💡 さらに精度を上げるには（取得を検討すべき情報）" hint="" />
        <ul style={{ fontSize: 12, color: "var(--color-ink-2)", lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
          <li><b>失注時の単価</b>（案件 vs 人材希望）— 単価ギャップが原因の失注を切り分け</li>
          <li><b>業界</b>（companies.industry）— 業界別の失注傾向で営業戦略を最適化</li>
          <li><b>提案からの接触回数</b>（caller_status の履歴）— フォロー不足を可視化</li>
          <li><b>再アプローチ可能性</b>のフラグ（即時/3ヶ月後/案件再オープン時 など）</li>
          <li><b>競合企業名</b>（B1 系の失注理由で詳細）— 他社負けの構造を把握</li>
          <li><b>失注時の感触</b>（手応えタグ）— 「条件あえば即」「完全NG」など強弱</li>
        </ul>
      </div>
    </div>
  );
}

// 担当者別 失注傾向＋スピード。提案者 / クロージング担当 をタブで切り替えて表示。
type OwnerStat = { name: string; won: number; lost: number; reasons: Record<string, number>; lagDays: number[] };
function OwnerLostBreakdown({ byProposer, byCloser, byClientContact }: { byProposer: OwnerStat[]; byCloser: OwnerStat[]; byClientContact: OwnerStat[] }) {
  type View = "proposer" | "closer" | "client";
  // 既定は提案者。提案者が空ならクロージング → 先方担当 の順で初期表示。
  const [view, setView] = useState<View>(byProposer.length > 0 ? "proposer" : byCloser.length > 0 ? "closer" : "client");
  const rows = view === "proposer" ? byProposer : view === "closer" ? byCloser : byClientContact;
  const palette = ["#b42318", "#b45309", "#7c5cff", "#0b5cab", "#9aa7b4"];
  const hint = view === "proposer"
    ? "提案を起票した人（提案者）でグルーピング。スキル/単価系が多い → マッチング精度の見直し。"
    : view === "closer"
      ? "クロージング（決定段階の交渉）を担当した人でグルーピング。フォロー/連絡系・条件交渉系が多い → クロージング動きの見直し。"
      : "先方担当者（クライアント窓口）でグルーピング。勝率が低い窓口・刺さらない理由が分かる → 当て方/担当替え/フォロー強化の判断に。";

  const TabBtn = ({ k, label, n }: { k: View; label: string; n: number }) => {
    const active = view === k;
    return (
      <button type="button" onClick={() => setView(k)}
        style={{
          fontFamily: "inherit", fontSize: 12.5, fontWeight: active ? 800 : 600, cursor: "pointer",
          padding: "6px 14px", borderRadius: 99, border: `1px solid ${active ? "var(--color-brand-600)" : "var(--color-border)"}`,
          background: active ? "var(--color-brand-600)" : "#fff", color: active ? "#fff" : "var(--color-ink-2)",
        }}>
        {label}<span style={{ marginLeft: 6, opacity: 0.85, fontWeight: 700 }}>{n}</span>
      </button>
    );
  };

  return (
    <div className="card" style={{ padding: 14 }}>
      <Header title="👤 担当者別 失注傾向＋スピード" hint={hint} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <TabBtn k="proposer" label="📝 提案者" n={byProposer.length} />
        <TabBtn k="closer" label="🎯 クロージング" n={byCloser.length} />
        <TabBtn k="client" label="🏢 先方担当者" n={byClientContact.length} />
      </div>
      {rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>対象の担当者がいません。</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[...rows].sort((a, b) => b.lost - a.lost).map((p) => {
            const total = p.lost;
            const top = Object.entries(p.reasons).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 5);
            const lagArr = [...p.lagDays].sort((a, b) => a - b);
            const lagAvg = lagArr.length ? Math.round(lagArr.reduce((a, b) => a + b, 0) / lagArr.length) : null;
            const lagMed = lagArr.length ? lagArr[Math.floor(lagArr.length / 2)] : null;
            const slow = lagArr.filter((d) => d >= 15).length;
            return (
              <div key={p.name} style={{ borderTop: "1px dashed var(--color-border)", paddingTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</span>
                  <span className="muted" style={{ fontSize: 11 }}>失注 {p.lost} ／ 成約 {p.won} ／ 勝率 {p.won + p.lost === 0 ? 0 : Math.round((p.won / (p.won + p.lost)) * 100)}%</span>
                  {lagAvg != null && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                      background: lagAvg >= 15 ? "#fdecef" : lagAvg >= 7 ? "#fff6e0" : "#e7f7ee",
                      color:      lagAvg >= 15 ? "#b42318" : lagAvg >= 7 ? "#9a7b12" : "#067647",
                    }} title={`平均 ${lagAvg}日 / 中央値 ${lagMed}日 / 15日以上 ${slow}件`}>
                      ⏱ 平均{lagAvg}日（中央値 {lagMed}日）{slow > 0 ? ` ・ 長期化${slow}件` : ""}
                    </span>
                  )}
                </div>
                {total > 0 ? (
                  <>
                    <div style={{ display: "flex", height: 10, borderRadius: 99, overflow: "hidden", background: "var(--color-surface-inset)" }}>
                      {top.map(([r, n], i) => (
                        <div key={r} title={`${r}: ${n}`} style={{ width: `${(n as number / total) * 100}%`, background: palette[i % palette.length] }} />
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4, fontSize: 10.5, color: "var(--color-ink-3)" }}>
                      {top.map(([r, n], i) => (
                        <span key={r} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 99, background: palette[i % palette.length] }} />
                          {r}（{n}）
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <span className="muted" style={{ fontSize: 11 }}>失注なし</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 時間帯バケット（6区分）。SES営業の活動リズム（営業時間・昼休み・終了前駆け込み・残業）を捉える。
const TIME_BUCKETS = [
  { key: "morning", label: "朝 6-9時",     color: "#fbbf24" },
  { key: "am",      label: "午前 9-12時",   color: "#10b981" },
  { key: "noon",    label: "昼 12-14時",    color: "#0ea5e9" },
  { key: "pm",      label: "午後 14-17時",  color: "#6366f1" },
  { key: "evening", label: "夕方 17-19時",  color: "#a855f7" },
  { key: "night",   label: "夜 19-翌6時",   color: "#64748b" },
] as const;
type BucketKey = typeof TIME_BUCKETS[number]["key"];

function hourBucket(d: Date): BucketKey {
  const h = d.getHours(); // JST 表示はブラウザのローカル時刻に依存（社内利用前提）
  if (h >= 6 && h < 9)  return "morning";
  if (h >= 9 && h < 12) return "am";
  if (h >= 12 && h < 14) return "noon";
  if (h >= 14 && h < 17) return "pm";
  if (h >= 17 && h < 19) return "evening";
  return "night";
}

// 時間帯分析用：「成約系（合格含む）／失注系」の判定。ファイル上部の WON_STAGES は稼働限定のため別途定義。
const TIME_WON_STAGES = new Set(["合格", "面談合格", "稼働", "稼働決定"]);
const TIME_LOST_STAGES = new Set(["見送り", "失注"]);
function isTimeWon(p: any): boolean { return TIME_WON_STAGES.has(String(p?.stage ?? "")); }
function isTimeLost(p: any): boolean { return TIME_LOST_STAGES.has(String(p?.stage ?? "")); }

// SVG ドーナツ円グラフ（凡例なし版・本体のみ）。
function Donut({ data, size = 180 }: { data: { label: string; value: number; color: string }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="muted" style={{ fontSize: 11, textAlign: "center", padding: 20 }}>データなし</div>;
  const r = size / 2 - 6;
  const cx = size / 2, cy = size / 2;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="時間帯分布円グラフ">
      {data.filter((d) => d.value > 0).map((d, i) => {
        const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2; acc += d.value;
        const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2;
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        const large = a1 - a0 > Math.PI ? 1 : 0;
        // 単一スライス（=100%）のときは full circle を描く
        if (data.filter((x) => x.value > 0).length === 1) {
          return <circle key={i} cx={cx} cy={cy} r={r} fill={d.color}><title>{`${d.label}: ${d.value}件`}</title></circle>;
        }
        return (
          <path key={i} d={`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`} fill={d.color} stroke="#fff" strokeWidth={1.5}>
            <title>{`${d.label}: ${d.value}件（${Math.round((d.value / total) * 100)}%）`}</title>
          </path>
        );
      })}
      <circle cx={cx} cy={cy} r={r * 0.55} fill="#fff" />
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">合計</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={18} fontWeight={800} fill="var(--color-ink)">{total}</text>
    </svg>
  );
}

function TimeAnalysisCard({ items }: { items: any[] }) {
  const [view, setView] = useState<"proposal" | "closing">("proposal");

  // 提案時間帯：created_at の時間（全提案）
  // クロージング時間帯：stage_updated_at の時間（終了系＝成約/失注のみ）
  const buckets = useMemo(() => {
    type B = { total: number; won: number; lost: number; byPerson: Record<string, number> };
    const init = (): Record<BucketKey, B> => Object.fromEntries(TIME_BUCKETS.map((b) => [b.key, { total: 0, won: 0, lost: 0, byPerson: {} }])) as any;
    const propB = init();
    const closeB = init();
    for (const p of items) {
      // 提案時間帯：全提案を対象に、created_at で集計。勝率も合わせて算出。
      const ct = p.created_at ? new Date(p.created_at) : null;
      if (ct && !isNaN(ct.getTime())) {
        const k = hourBucket(ct);
        propB[k].total++;
        if (isTimeWon(p)) propB[k].won++;
        else if (isTimeLost(p)) propB[k].lost++;
        const who = (p.proposer ?? "").trim() || "（未割当）";
        propB[k].byPerson[who] = (propB[k].byPerson[who] || 0) + 1;
      }
      // クロージング時間帯：終了系のみ、stage_updated_at（無ければ updated_at）で集計。
      if (isTimeWon(p) || isTimeLost(p)) {
        const t = p.stage_updated_at || p.updated_at;
        const ct2 = t ? new Date(t) : null;
        if (ct2 && !isNaN(ct2.getTime())) {
          const k = hourBucket(ct2);
          closeB[k].total++;
          if (isTimeWon(p)) closeB[k].won++;
          if (isTimeLost(p)) closeB[k].lost++;
          const who = (p.closer ?? "").trim() || "（未割当）";
          closeB[k].byPerson[who] = (closeB[k].byPerson[who] || 0) + 1;
        }
      }
    }
    return { proposal: propB, closing: closeB };
  }, [items]);

  const cur = view === "proposal" ? buckets.proposal : buckets.closing;
  const donutData = TIME_BUCKETS.map((b) => ({ label: b.label, value: cur[b.key].total, color: b.color }));
  const grandTotal = donutData.reduce((s, d) => s + d.value, 0);

  // 担当者×時間帯のクロス表。誰がどの時間に動いているか。
  const people = useMemo(() => {
    const s = new Set<string>();
    for (const b of TIME_BUCKETS) for (const k of Object.keys(cur[b.key].byPerson)) s.add(k);
    return [...s].sort((a, b) => {
      const ta = TIME_BUCKETS.reduce((n, x) => n + (cur[x.key].byPerson[a] || 0), 0);
      const tb = TIME_BUCKETS.reduce((n, x) => n + (cur[x.key].byPerson[b] || 0), 0);
      return tb - ta;
    }).slice(0, 8);
  }, [cur]);

  const TabBtn = ({ k, label, n }: { k: "proposal" | "closing"; label: string; n: number }) => {
    const active = view === k;
    return (
      <button type="button" onClick={() => setView(k)}
        style={{
          fontFamily: "inherit", fontSize: 12.5, fontWeight: active ? 800 : 600, cursor: "pointer",
          padding: "6px 14px", borderRadius: 99, border: `1px solid ${active ? "var(--color-brand-600)" : "var(--color-border)"}`,
          background: active ? "var(--color-brand-600)" : "#fff", color: active ? "#fff" : "var(--color-ink-2)",
        }}>
        {label}<span style={{ marginLeft: 6, opacity: 0.85, fontWeight: 700 }}>{n}</span>
      </button>
    );
  };

  const propTotal = Object.values(buckets.proposal).reduce((s, b) => s + b.total, 0);
  const closeTotal = Object.values(buckets.closing).reduce((s, b) => s + b.total, 0);

  return (
    <div className="card" style={{ padding: 14 }}>
      <Header title="🕐 時間帯分析（提案／クロージング）" hint="どの時間帯に動いている案件が反応が良いか／誰がどの時間に動いているかを可視化。仮説の検証用。" />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <TabBtn k="proposal" label="📝 提案時間帯（created_at）" n={propTotal} />
        <TabBtn k="closing"  label="🎯 クロージング時間帯（決着時刻）" n={closeTotal} />
      </div>

      {grandTotal === 0 ? (
        <div className="muted" style={{ fontSize: 12, padding: 16 }}>
          {view === "proposal" ? "この期間に提案がありません。" : "この期間にクロージング（決着）した案件がありません。"}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 220px) 1fr", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
          {/* 円グラフ */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <Donut data={donutData} size={200} />
          </div>

          {/* 反応率テーブル（時間帯別 勝率） */}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--color-ink-3)", marginBottom: 6 }}>
              時間帯別 反応率（勝率＝成約 ÷（成約＋失注））
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border)", color: "var(--color-ink-3)", fontSize: 11 }}>
                    <th style={{ textAlign: "left", padding: "5px 8px" }}>時間帯</th>
                    <th style={{ textAlign: "right", padding: "5px 8px" }}>件数</th>
                    <th style={{ textAlign: "right", padding: "5px 8px" }}>成約</th>
                    <th style={{ textAlign: "right", padding: "5px 8px" }}>失注</th>
                    <th style={{ textAlign: "right", padding: "5px 8px" }}>勝率</th>
                  </tr>
                </thead>
                <tbody>
                  {TIME_BUCKETS.map((b) => {
                    const v = cur[b.key];
                    const decided = v.won + v.lost;
                    const wr = decided > 0 ? Math.round((v.won / decided) * 100) : null;
                    const wrColor = wr == null ? "var(--color-ink-4)" : wr >= 50 ? "#067647" : wr >= 30 ? "#9a7b12" : "#b42318";
                    return (
                      <tr key={b.key} style={{ borderBottom: "1px dashed var(--color-border)" }}>
                        <td style={{ padding: "5px 8px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 3, background: b.color }} />
                            {b.label}
                          </span>
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}>{v.total}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", color: "#067647" }}>{v.won || "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", color: "#b42318" }}>{v.lost || "—"}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 800, color: wrColor }}>
                          {wr == null ? "—" : `${wr}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 担当者×時間帯のクロス表（誰がいつ動いてる） */}
          {people.length > 0 && (
            <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--color-ink-3)", marginBottom: 6 }}>
                {view === "proposal" ? "提案者" : "クロージング担当"} × 時間帯（件数）
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--color-border)", color: "var(--color-ink-3)", fontSize: 10.5 }}>
                      <th style={{ textAlign: "left", padding: "4px 8px" }}>担当</th>
                      {TIME_BUCKETS.map((b) => (
                        <th key={b.key} style={{ textAlign: "center", padding: "4px 6px" }}>{b.label.replace(/\s.*/, "")}</th>
                      ))}
                      <th style={{ textAlign: "right", padding: "4px 8px" }}>合計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((name) => {
                      const sum = TIME_BUCKETS.reduce((n, b) => n + (cur[b.key].byPerson[name] || 0), 0);
                      return (
                        <tr key={name} style={{ borderBottom: "1px dashed var(--color-border)" }}>
                          <td style={{ padding: "4px 8px", fontWeight: 700 }}>{name}</td>
                          {TIME_BUCKETS.map((b) => {
                            const v = cur[b.key].byPerson[name] || 0;
                            const pct = sum > 0 ? v / sum : 0;
                            const tone = pct >= 0.4 ? "#0b5cab" : pct >= 0.2 ? "#5a9bd4" : pct > 0 ? "#9ec2e7" : "transparent";
                            return (
                              <td key={b.key} style={{ padding: "4px 6px", textAlign: "center", background: tone, color: pct >= 0.4 ? "#fff" : "var(--color-ink-2)", fontWeight: 700 }}>
                                {v || ""}
                              </td>
                            );
                          })}
                          <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 800 }}>{sum}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>
                ※ 上位8名まで表示。セルの色が濃いほど、その人にとって主要な時間帯。
              </div>
            </div>
          )}
        </div>
      )}

      <div className="muted" style={{ fontSize: 10.5, marginTop: 10, lineHeight: 1.7 }}>
        ⏰ 時間帯は提案＝<b>created_at</b>、クロージング＝<b>stage_updated_at</b>（最終ステージ遷移時刻）で判定。クロージングは成約/失注になった案件のみが対象。
        勝率が高い時間帯に提案を集中させる／低い時間帯の動き方を見直す等の仮説に活用してください。
      </div>
    </div>
  );
}

function KPI({ label, value, unit, tone, small }: { label: string; value: string | number; unit?: string; tone: string; small?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
        <span style={{ fontSize: small ? 16 : 26, fontWeight: 800, lineHeight: 1, color: tone, fontFamily: "var(--font-display)" }}>{value}</span>
        {unit && <span style={{ fontSize: 11.5, color: "var(--color-ink-3)", fontWeight: 600 }}>{unit}</span>}
      </div>
    </div>
  );
}

function Header({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>{title}</h3>
      {hint && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function BarList({ items, total, tone }: { items: [string, number][]; total: number; tone: string }) {
  const max = Math.max(0, ...items.map((x) => x[1]));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map(([k, n]) => {
        const w = max === 0 ? 0 : (n / max) * 100;
        const pct = total === 0 ? 0 : Math.round((n / total) * 100);
        return (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 200px) 1fr 56px", gap: 10, alignItems: "center", fontSize: 11.5 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
            <div style={{ height: 10, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: `${w}%`, height: "100%", background: tone, borderRadius: 99 }} />
            </div>
            <span className="mono tnum" style={{ fontSize: 11, textAlign: "right", color: "var(--color-ink-3)" }}>{n}（{pct}%）</span>
          </div>
        );
      })}
    </div>
  );
}

// 失注ログテーブル：担当者・理由・タイムラグを一覧。担当者/期間で絞り込み可能。
function LostRowsTable({ rows }: { rows: Aggregated["lostRows"] }) {
  const [proposerFilter, setProposerFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [order, setOrder] = useState<"recent" | "slow" | "fast">("recent");
  const proposers = useMemo(() => Array.from(new Set(rows.map((r) => r.proposer))).sort(), [rows]);
  const reasons = useMemo(() => Array.from(new Set(rows.map((r) => r.reason))).sort(), [rows]);

  const filtered = useMemo(() => {
    let r = rows;
    if (proposerFilter) r = r.filter((x) => x.proposer === proposerFilter);
    if (reasonFilter) r = r.filter((x) => x.reason === reasonFilter);
    if (order === "slow") r = [...r].sort((a, b) => (b.lagDays ?? -1) - (a.lagDays ?? -1));
    else if (order === "fast") r = [...r].sort((a, b) => (a.lagDays ?? 1e9) - (b.lagDays ?? 1e9));
    else r = [...r].sort((a, b) => (b.lost_at || 0) - (a.lost_at || 0));
    return r.slice(0, 200);
  }, [rows, proposerFilter, reasonFilter, order]);

  const fmtD = (ms: number) => { if (!ms) return "—"; const d = new Date(ms); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`; };
  const lagTone = (d: number | null) => d == null ? "var(--color-ink-4)" : d >= 15 ? "#b42318" : d >= 7 ? "#9a7b12" : "#067647";

  const sel: React.CSSProperties = { fontFamily: "inherit", fontSize: 12, padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" };
  const td: React.CSSProperties = { padding: "6px 10px", borderTop: "1px solid var(--color-border)", verticalAlign: "top" };
  const th: React.CSSProperties = { padding: "6px 10px", textAlign: "left", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, background: "var(--color-surface-soft)", whiteSpace: "nowrap" };

  return (
    <div className="card" style={{ padding: 14 }}>
      <Header title="📋 失注ログ（担当者・理由・スピード一覧）" hint="提案日／失注日／タイムラグ／担当者／理由 を1行で確認。長期化(赤)の上位を優先的に振り返り、スピードを上げる打ち手を考える。" />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--color-ink-3)" }}>
          担当者
          <select value={proposerFilter} onChange={(e) => setProposerFilter(e.target.value)} style={sel}>
            <option value="">すべて</option>
            {proposers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--color-ink-3)" }}>
          理由
          <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} style={sel}>
            <option value="">すべて</option>
            {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--color-ink-3)" }}>
          並び順
          <select value={order} onChange={(e) => setOrder(e.target.value as any)} style={sel}>
            <option value="recent">新しい順</option>
            <option value="slow">ラグが大きい順（要振り返り）</option>
            <option value="fast">ラグが小さい順（即決）</option>
          </select>
        </label>
        <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>{filtered.length}件 / 全{rows.length}件（最大200件表示）</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, minWidth: 980 }}>
          <thead>
            <tr>
              <th style={th}>提案日</th><th style={th}>失注日</th>
              <th style={{ ...th, textAlign: "right" }}>タイムラグ</th>
              <th style={th}>担当者</th>
              <th style={th}>会社 / 案件</th>
              <th style={th}>人材</th>
              <th style={th}>失注フェーズ</th>
              <th style={th}>失注理由</th>
              <th style={{ ...th, textAlign: "right" }}>再提案</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td style={td} className="mono">{fmtD(r.created_at)}</td>
                <td style={td} className="mono">{fmtD(r.lost_at)}</td>
                <td style={{ ...td, textAlign: "right", color: lagTone(r.lagDays), fontWeight: 800 }} className="mono">{r.lagDays != null ? `${r.lagDays}日` : "—"}</td>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>{r.proposer}</div>
                  {r.closer && r.closer !== r.proposer && r.closer !== "—" && <div className="muted" style={{ fontSize: 10.5 }}>CL: {r.closer}</div>}
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{r.company}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{r.job_title}</div>
                </td>
                <td style={td}>{r.candidate_name}</td>
                <td style={{ ...td, color: "var(--color-ink-3)", fontSize: 11 }}>{r.phase}</td>
                <td style={td}>
                  <div>{r.reason}</div>
                  {r.note && <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", marginTop: 2, whiteSpace: "pre-wrap" }}>「{r.note}」</div>}
                </td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                  {/* 上位/下位企業から再提案・再エントリーがあったとき、提案画面（マッチング）へ直行 */}
                  {r.job_no != null ? (
                    <Link href={`/matching?job=${r.job_no}${r.candidate_no != null ? `&cand=${r.candidate_no}` : ""}`}
                      className="btn ghost btn-xs" style={{ textDecoration: "none" }}
                      title="この案件×人材で提案画面（マッチング）を開く">→ 提案画面</Link>
                  ) : <span className="muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
