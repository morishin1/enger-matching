// 育成戦略タブ。
//   仮置きの市場単価 × トレンド係数を「参考」として置き、自社の保有案件・人材の
//   スキル分布を当てはめて『どこに張り、どこを育てるか』を可視化する。
//
//   ・狙う領域：高単価×拡大トレンド ＆ 案件は多いが自社人材が薄い → 採用/教育を強化
//   ・育てる領域：自社の主力スキル × 隣接の伸長スキル          → リスキル/学習で延伸
//   ・撤退領域：単価が低く縮小トレンド × 自社人材が偏っている    → 新規育成は避ける
//
//   集計は決定論（AI不使用）。仮置き値の更新は src/lib/market-rate.ts を直接編集。

import { MARKET_RATES, trackStats, lookupMarket, trackLabel as tLabel, demandLabel as dLabel, type MarketRate } from "@/lib/market-rate";

type Job = { skills?: string[] | null; salary_min?: number | null; salary_max?: number | null };
type Cand = { skills?: string[] | null };

export function GrowthStrategy({ jobs, candidates }: { jobs: Job[]; candidates: Cand[] }) {
  // ===== スキル単位の集計（自社の案件件数 / 人材件数 / 市場参考） =====
  const jobBySkill = new Map<string, number>();
  for (const j of jobs) for (const s of (j.skills ?? [])) jobBySkill.set(s, (jobBySkill.get(s) ?? 0) + 1);
  const candBySkill = new Map<string, number>();
  for (const c of candidates) for (const s of (c.skills ?? [])) candBySkill.set(s, (candBySkill.get(s) ?? 0) + 1);

  type Row = {
    skill: string;
    market: MarketRate | null;
    jobs: number;
    cands: number;
    gap: number;          // 案件件数 - 人材件数（>0=人材が薄い、<0=人材余り）
    opportunity: number;  // 戦略スコア（高いほど『狙う領域』）
  };
  const all: Row[] = MARKET_RATES.map((m) => {
    const jobs = jobBySkill.get(m.skill) ?? 0;
    const cands = candBySkill.get(m.skill) ?? 0;
    const gap = jobs - cands;
    // 機会スコア：高単価×拡大×案件あり×人材が薄い ほど高い
    const trendBoost = (m.trend - 1) * 50; // ±0.3 → ±15
    const demandBoost = m.demand === "high" ? 12 : m.demand === "med" ? 6 : 0;
    const gapBoost = Math.max(0, Math.min(15, gap * 1.5));
    const rateBoost = Math.max(0, (m.median - 70) * 0.4); // 70万を基準
    const opportunity = Math.round(trendBoost + demandBoost + gapBoost + rateBoost);
    return { skill: m.skill, market: m, jobs, cands, gap, opportunity };
  });

  // 自社にあるが市場辞書に無いスキル → 「未分類」プールとして件数だけ示す
  const unknownSkills = new Set<string>();
  for (const s of jobBySkill.keys()) if (!lookupMarket(s)) unknownSkills.add(s);
  for (const s of candBySkill.keys()) if (!lookupMarket(s)) unknownSkills.add(s);

  // 「狙うべき領域」：機会スコア上位
  const targets = [...all].sort((a, b) => b.opportunity - a.opportunity).slice(0, 8);
  // 「育てる領域」：自社人材が多いスキル × 隣接の伸長スキル（同じ track で trend>=1.1 かつ自社人材が薄い）
  const cultivate: { from: Row; to: Row[] }[] = [];
  const ownedStrong = [...all].filter((r) => r.cands >= 3).sort((a, b) => b.cands - a.cands).slice(0, 6);
  for (const base of ownedStrong) {
    if (!base.market) continue;
    const peers = all.filter((r) => r.market && r.market.track === base.market!.track && r.skill !== base.skill && r.market.trend >= 1.1 && r.cands < base.cands).sort((a, b) => (b.market!.trend - a.market!.trend)).slice(0, 3);
    if (peers.length > 0) cultivate.push({ from: base, to: peers });
  }
  // 「撤退領域」：縮小×自社人材が偏ってる
  const retreat = all.filter((r) => r.market && r.market.trend < 0.95 && r.cands > 0).sort((a, b) => a.market!.trend - b.market!.trend).slice(0, 5);

  // 市場参考とのレート比較（自社の今の案件 単価レンジが市場と乖離していないか）
  const rateGapRows = all.filter((r) => r.market && r.jobs >= 1).map((r) => {
    const jobsForSkill = jobs.filter((j) => (j.skills ?? []).includes(r.skill));
    const lows = jobsForSkill.map((j) => Number(j.salary_min) || 0).filter((n) => n > 0);
    const highs = jobsForSkill.map((j) => Number(j.salary_max) || 0).filter((n) => n > 0);
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((s, n) => s + n, 0) / arr.length) : null;
    const lo = avg(lows), hi = avg(highs);
    const mid = lo != null && hi != null ? Math.round((lo + hi) / 2) : (hi ?? lo);
    const diff = mid != null && r.market ? mid - r.market.median : null;
    return { skill: r.skill, market: r.market!, lo, hi, mid, diff, jobs: r.jobs };
  }).filter((x) => x.mid != null).sort((a, b) => Math.abs((b.diff ?? 0)) - Math.abs((a.diff ?? 0))).slice(0, 8);

  const tracks = trackStats();

  const Tone = (n: number) => n >= 20 ? "#067647" : n >= 10 ? "#b45309" : "#475569";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", padding: 12, fontSize: 12, lineHeight: 1.7 }}>
        <b style={{ fontSize: 13 }}>📌 育成戦略（参考）</b>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          市場単価 × トレンド係数は<b>仮置きの参考値</b>です（SES市場・東京中心の感覚値、四半期で見直し）。
          自社の案件・人材の分布と突き合わせて、<b>狙う領域 / 育てる領域 / 撤退領域</b>を提示します。
          仮置き値は <span className="mono">src/lib/market-rate.ts</span> を編集して更新できます。
        </div>
      </div>

      {/* トラック別の俯瞰：単価×トレンド */}
      <div className="card">
        <h3 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 800 }}>📈 トラック別の市場（中央値 × トレンド）</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl tbl-compact" style={{ minWidth: 560 }}>
            <thead><tr><th>トラック</th><th className="num">スキル数</th><th className="num">中央値 平均</th><th className="num">トレンド 平均</th><th>姿勢</th></tr></thead>
            <tbody>
              {tracks.map((t) => {
                const stance = t.trendAvg >= 1.15 ? { l: "🚀 攻める", c: "#067647" } : t.trendAvg >= 1.0 ? { l: "→ 維持", c: "#475569" } : { l: "⛔ 縮小", c: "#b42318" };
                return (
                  <tr key={t.track}>
                    <td style={{ fontWeight: 700 }}>{t.label}</td>
                    <td className="num">{t.count}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{t.medianAvg}<span className="muted" style={{ fontSize: 10, marginLeft: 2 }}>万</span></td>
                    <td className="num" style={{ fontWeight: 700, color: t.trendAvg >= 1.1 ? "#067647" : t.trendAvg < 0.95 ? "#b42318" : "#b45309" }}>×{t.trendAvg}</td>
                    <td style={{ color: stance.c, fontWeight: 700 }}>{stance.l}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 狙うべき領域（採用/教育の最優先） */}
      <div className="card">
        <h3 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 800 }}>🎯 狙うべき領域 Top 8（市場機会スコア）</h3>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>スコア = トレンド + 引き合い + 案件超過 + 単価。<b>自社人材が薄く案件は多いスキル</b>ほど高くなります。</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl tbl-compact" style={{ minWidth: 700 }}>
            <thead><tr><th>スキル</th><th>トラック</th><th className="num" title="市場中央値（万円）">市場単価</th><th className="num" title="トレンド係数">トレンド</th><th className="num" title="引き合い">需要</th><th className="num">自社案件</th><th className="num">自社人材</th><th className="num">機会スコア</th></tr></thead>
            <tbody>
              {targets.map((r) => (
                <tr key={r.skill}>
                  <td style={{ fontWeight: 700 }}>{r.skill}</td>
                  <td className="muted" style={{ fontSize: 11 }}>{r.market ? tLabel(r.market.track) : "—"}</td>
                  <td className="num">{r.market?.median ?? "—"}<span className="muted" style={{ fontSize: 10, marginLeft: 1 }}>万</span></td>
                  <td className="num" style={{ color: (r.market?.trend ?? 1) >= 1.1 ? "#067647" : "#475569", fontWeight: 700 }}>×{r.market?.trend ?? "—"}</td>
                  <td className="num">{r.market ? dLabel(r.market.demand) : "—"}</td>
                  <td className="num">{r.jobs}</td>
                  <td className="num" style={{ color: r.gap > 3 ? "#b42318" : "var(--color-ink-3)" }}>{r.cands}</td>
                  <td className="num" style={{ fontWeight: 800, color: Tone(r.opportunity) }}>{r.opportunity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 育てる領域（既存の強みから隣接の伸長スキルへ） */}
      <div className="card">
        <h3 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 800 }}>🌱 育てる領域（自社の強み × 隣接の伸長スキル）</h3>
        {cultivate.length === 0 ? (
          <div className="muted" style={{ fontSize: 12.5 }}>育成パスを抽出できる強みスキルがまだありません（自社人材が3名以上いるスキルが基準）。</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {cultivate.map((c) => (
              <div key={c.from.skill} className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11, color: "var(--color-ink-4)", marginBottom: 4 }}>強み（自社人材 {c.from.cands}名）</div>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>{c.from.skill} <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>{c.from.market ? tLabel(c.from.market.track) : ""}</span></div>
                <div style={{ fontSize: 11, color: "var(--color-ink-4)", margin: "4px 0" }}>→ 隣接の伸長スキル（学習対象）</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {c.to.map((t) => (
                    <div key={t.skill} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t.skill}</span>
                      <span className="muted" style={{ fontSize: 10.5, fontFamily: "var(--font-mono)" }}>
                        ×{t.market?.trend} ・ {t.market?.median}万 ・ 人材{t.cands}名
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }} className="duo-grid">
        {/* 撤退領域 */}
        <div className="card">
          <h3 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 800 }}>⛔ 撤退/育成しない領域</h3>
          {retreat.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>該当なし。良い。</div>
          ) : (
            <table className="tbl tbl-compact">
              <thead><tr><th>スキル</th><th className="num">市場単価</th><th className="num">トレンド</th><th className="num">自社人材</th></tr></thead>
              <tbody>
                {retreat.map((r) => (
                  <tr key={r.skill}>
                    <td style={{ fontWeight: 700 }}>{r.skill}<div className="muted" style={{ fontSize: 10 }}>{r.market?.note ?? ""}</div></td>
                    <td className="num">{r.market?.median}<span className="muted" style={{ fontSize: 10, marginLeft: 1 }}>万</span></td>
                    <td className="num" style={{ color: "#b42318", fontWeight: 700 }}>×{r.market?.trend}</td>
                    <td className="num">{r.cands}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>※ 縮小×自社にも人材がいる領域。<b>新規育成は避け、既存契約の継続と保守的運用</b>に。</div>
        </div>

        {/* 単価ギャップ：自社の案件単価 vs 市場参考 */}
        <div className="card">
          <h3 style={{ margin: "0 0 10px", fontSize: 13.5, fontWeight: 800 }}>💴 自社案件単価 vs 市場参考（乖離Top 8）</h3>
          {rateGapRows.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>案件の単価データが不足しています。salary_min/max を入れてください。</div>
          ) : (
            <table className="tbl tbl-compact">
              <thead><tr><th>スキル</th><th className="num">自社平均</th><th className="num">市場参考</th><th className="num">差分</th></tr></thead>
              <tbody>
                {rateGapRows.map((r) => {
                  const tone = (r.diff ?? 0) > 5 ? "#067647" : (r.diff ?? 0) < -5 ? "#b42318" : "#475569";
                  return (
                    <tr key={r.skill}>
                      <td style={{ fontWeight: 700 }}>{r.skill}<div className="muted" style={{ fontSize: 10 }}>案件 {r.jobs} 件</div></td>
                      <td className="num">{r.mid}<span className="muted" style={{ fontSize: 10, marginLeft: 1 }}>万</span></td>
                      <td className="num">{r.market.median}<span className="muted" style={{ fontSize: 10, marginLeft: 1 }}>万</span></td>
                      <td className="num" style={{ color: tone, fontWeight: 800 }}>{(r.diff ?? 0) >= 0 ? "+" : ""}{r.diff}<span className="muted" style={{ fontSize: 10, marginLeft: 1 }}>万</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>※ <b style={{ color: "#b42318" }}>マイナス</b>＝市場より低単価で受けている。値上げ交渉や商流見直しの候補。</div>
        </div>
      </div>

      {unknownSkills.size > 0 && (
        <div className="muted" style={{ fontSize: 10.5 }}>
          ※ 市場辞書に無い自社スキル {unknownSkills.size} 件は集計外（{[...unknownSkills].slice(0, 6).join("、")}{unknownSkills.size > 6 ? "…" : ""}）。<span className="mono">src/lib/market-rate.ts</span> に追記すると育成戦略に反映されます。
        </div>
      )}
    </div>
  );
}
