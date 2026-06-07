// 狙うべき企業ダッシュボード（提案管理の結果 × 市場トレンド × 自社人材）。
//   どの企業に・どんな案件/人材で・なぜ攻めるべきかを根拠データ付きで提示。
//   - 取引拡大候補：稼働化率と単価が高い × 直近活動あり
//   - 関係構築候補：面談化は高いが稼働化に至っていない（クロージング改善）
//   - 攻めの再開候補：過去稼働あり × 直近活動が薄い
//   - 撤退検討：失注が多い、または市場トレンド低
//   各カードに「根拠（提案N件・面談化X%・稼働Y件・平均ZZ万・主な失注理由）」と
//   その企業の主力スキルが市場で攻める/維持/縮小かを表示。

import { lookupMarket } from "@/lib/market-rate";
import type { CompanyRow } from "@/lib/companies";
import type { CompanyFunnel } from "@/lib/company-funnel";

type Quadrant = "expand" | "rebuild" | "reignite" | "retreat" | "unknown";

const QUAD_TONE: Record<Exclude<Quadrant, "unknown">, { label: string; bg: string; fg: string; bd: string; icon: string; hint: string }> = {
  expand:   { label: "🚀 取引拡大候補",   bg: "#e7f7ee", fg: "#067647", bd: "#bfe3cc", icon: "rocket_launch", hint: "稼働化率・単価とも高く、直近活動あり。提案数を増やす。" },
  rebuild:  { label: "🤝 関係構築候補",   bg: "#eaf6fd", fg: "#0b5cab", bd: "#cfe7f8", icon: "handshake",     hint: "面談化は高いが稼働化に至らず。クロージング/単価訴求を見直す。" },
  reignite: { label: "🔥 再アプローチ候補", bg: "#fff6e0", fg: "#92400e", bd: "#fde9b0", icon: "local_fire_department", hint: "過去稼働あり × 直近活動薄。リアクト時の温度感を見て再開。" },
  retreat:  { label: "⛔ 撤退検討",        bg: "#fdecef", fg: "#b42318", bd: "#f7c5cf", icon: "block",        hint: "失注が積み重なる/市場縮小トレンド。新規育成は避け既存契約のみ維持。" },
};

function fmtDays(d: string | null | undefined): { days: number; label: string } {
  if (!d) return { days: 9999, label: "未接触" };
  const days = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
  return { days, label: `${days}日前` };
}

function classify(c: CompanyRow, f: CompanyFunnel | undefined): { quad: Quadrant; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const lastDays = fmtDays(f?.lastProposedAt ?? c.last_job_at).days;
  const winRate = f?.winRate ?? 0;
  const meetRate = f?.meetRate ?? 0;
  const proposals = f?.proposals ?? 0;
  const won = f?.won ?? c.won ?? 0;
  const lost = f?.lost ?? c.lost ?? 0;
  const avg = f?.avgRate ?? c.avg_rate ?? 0;

  // 充足な活動量がある＆稼働化率/単価が高い → 拡大
  if (proposals >= 3 && winRate >= 25 && lastDays <= 60) {
    reasons.push(`稼働化率 ${winRate}%（提案${proposals}件中${won}件）`);
    if (avg >= 75) reasons.push(`平均単価 ${avg}万円`);
    if (lastDays <= 30) reasons.push("直近活動あり");
    return { quad: "expand", reasons, warnings };
  }
  // 面談まで行くが決まらない → クロージング改善で稼ぐ
  if (proposals >= 3 && meetRate >= 40 && winRate < 25) {
    reasons.push(`面談化 ${meetRate}% 高 vs 稼働化 ${winRate}% 低`);
    if (f?.topReasons.length) reasons.push(`失注主因: ${f.topReasons.slice(0, 2).map((x) => x.reason).join(" / ")}`);
    return { quad: "rebuild", reasons, warnings };
  }
  // 過去稼働あり × 直近活動が薄い → 再アプローチ
  if (won >= 1 && lastDays > 60) {
    reasons.push(`過去稼働 ${won}件あり`);
    reasons.push(`最終提案から${lastDays > 365 ? Math.floor(lastDays / 365) + "年超" : lastDays + "日"}経過`);
    return { quad: "reignite", reasons, warnings };
  }
  // 失注比率が高い、未稼働 → 撤退検討
  if (proposals >= 3 && winRate === 0 && lost >= 2) {
    reasons.push(`提案${proposals}件で稼働化0、失注${lost}件`);
    if (f?.topReasons.length) reasons.push(`主因: ${f.topReasons.slice(0, 2).map((x) => x.reason).join(" / ")}`);
    return { quad: "retreat", reasons, warnings };
  }
  return { quad: "unknown", reasons, warnings };
}

export function CompanyTargetingBoard({ companies, funnels, topSkillsByCompany }: { companies: CompanyRow[]; funnels: Map<string, CompanyFunnel>; topSkillsByCompany: Map<string, { skill: string; n: number }[]> }) {
  type Item = {
    c: CompanyRow; f: CompanyFunnel | undefined; quad: Quadrant; reasons: string[];
    marketStance: { stance: "攻める" | "維持" | "縮小" | null; medianAvg: number | null; trendAvg: number | null; topSkills: { skill: string; n: number; market: ReturnType<typeof lookupMarket> }[] };
    days: number;
  };
  const items: Item[] = companies.map((c) => {
    const f = funnels.get(c.name);
    const { quad, reasons } = classify(c, f);
    const tops = (topSkillsByCompany.get(c.name) ?? []).map((s) => ({ ...s, market: lookupMarket(s.skill) }));
    // 主力スキルの市場姿勢平均
    const withMkt = tops.filter((s) => s.market);
    let stance: "攻める" | "維持" | "縮小" | null = null;
    let medianAvg: number | null = null;
    let trendAvg: number | null = null;
    if (withMkt.length > 0) {
      medianAvg = Math.round(withMkt.reduce((a, s) => a + s.market!.median, 0) / withMkt.length);
      trendAvg = +(withMkt.reduce((a, s) => a + s.market!.trend, 0) / withMkt.length).toFixed(2);
      stance = trendAvg >= 1.1 ? "攻める" : trendAvg < 0.95 ? "縮小" : "維持";
    }
    return { c, f, quad, reasons, marketStance: { stance, medianAvg, trendAvg, topSkills: tops }, days: fmtDays(f?.lastProposedAt ?? c.last_job_at).days };
  });

  const groups: Record<Exclude<Quadrant, "unknown">, Item[]> = { expand: [], rebuild: [], reignite: [], retreat: [] };
  for (const it of items) if (it.quad !== "unknown") groups[it.quad].push(it);
  // 優先度ソート：稼働数/勝率/直近活動
  groups.expand.sort((a, b) => (b.f?.winRate ?? 0) - (a.f?.winRate ?? 0) || (b.f?.won ?? 0) - (a.f?.won ?? 0));
  groups.rebuild.sort((a, b) => (b.f?.meetRate ?? 0) - (a.f?.meetRate ?? 0));
  groups.reignite.sort((a, b) => (b.f?.won ?? 0) - (a.f?.won ?? 0) || a.days - b.days);
  groups.retreat.sort((a, b) => (b.f?.lost ?? 0) - (a.f?.lost ?? 0));

  const Stance = ({ s }: { s: Item["marketStance"] }) => {
    if (!s.stance) return null;
    const col = s.stance === "攻める" ? "#067647" : s.stance === "縮小" ? "#b42318" : "#475569";
    return (
      <span title={`主力スキルの市場姿勢：${s.stance}（中央値 ${s.medianAvg}万・トレンド×${s.trendAvg}）`}
        style={{ fontSize: 10, fontWeight: 800, color: col, background: "#fff", border: `1px solid ${col}33`, padding: "1px 7px", borderRadius: 99 }}>
        {s.stance === "攻める" ? "🚀" : s.stance === "縮小" ? "⛔" : "→"} 市場{s.stance}
      </span>
    );
  };

  const renderGroup = (key: Exclude<Quadrant, "unknown">) => {
    const t = QUAD_TONE[key];
    const list = groups[key].slice(0, 6);
    if (list.length === 0) return null;
    return (
      <div key={key} className="card" style={{ padding: 14, background: t.bg, border: `1px solid ${t.bd}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: t.fg }}>{t.label}</span>
          <span className="muted" style={{ fontSize: 11.5, color: t.fg }}>{list.length}/{groups[key].length}社</span>
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto", color: t.fg }}>{t.hint}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
          {list.map((it) => (
            <div key={it.c.name} style={{ padding: 12, borderRadius: 10, background: "#fff", border: `1px solid ${t.bd}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.c.name}</span>
                <Stance s={it.marketStance} />
              </div>
              {/* 根拠 */}
              <ul style={{ margin: "4px 0 6px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
                {it.reasons.map((r, i) => (
                  <li key={i} style={{ fontSize: 11.5, color: t.fg }}>• {r}</li>
                ))}
              </ul>
              {/* 主力スキル */}
              {it.marketStance.topSkills.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                  {it.marketStance.topSkills.map((s) => {
                    const mt = s.market;
                    const col = !mt ? "var(--color-ink-4)" : mt.trend >= 1.1 ? "#067647" : mt.trend < 0.95 ? "#b42318" : "#475569";
                    return (
                      <span key={s.skill} title={mt ? `市場 ${mt.median}万 / ×${mt.trend}` : "市場辞書外"}
                        style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, border: "1px solid var(--color-border)", color: col, background: "var(--color-surface-soft)", fontWeight: 600 }}>
                        {s.skill}<span className="muted" style={{ marginLeft: 3, fontWeight: 400 }}>×{s.n}</span>
                      </span>
                    );
                  })}
                </div>
              )}
              {/* 数値サマリ */}
              <div className="muted" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.6 }}>
                提案 <b style={{ color: "var(--color-ink-2)" }}>{it.f?.proposals ?? 0}</b> ・ 面談化 <b style={{ color: "var(--color-ink-2)" }}>{it.f?.meetRate ?? 0}%</b> ・ 稼働化 <b style={{ color: "var(--color-ink-2)" }}>{it.f?.winRate ?? 0}%</b>
                {it.f?.avgRate != null && <> ・ 平均 <b style={{ color: "var(--color-ink-2)" }}>{it.f.avgRate}万</b></>}
                {it.f?.avgCloseDays != null && <> ・ 平均クロージング <b style={{ color: "var(--color-ink-2)" }}>{it.f.avgCloseDays}日</b></>}
                {it.f?.lastProposedAt && <> ・ 最終提案 <b style={{ color: "var(--color-ink-2)" }}>{it.days}日前</b></>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", padding: 12, fontSize: 12, lineHeight: 1.7 }}>
        <b style={{ fontSize: 13 }}>🎯 狙うべき企業（提案管理 × 市場トレンドの根拠つき）</b>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          直近12ヶ月の提案ファネル（提案/面談化/稼働化/失注理由/平均単価/クロージング日数）と、その企業の主力スキルの市場姿勢から、
          <b>取引拡大／関係構築／再アプローチ／撤退検討</b> を自動分類して提示します。
        </div>
      </div>
      {renderGroup("expand")}
      {renderGroup("rebuild")}
      {renderGroup("reignite")}
      {renderGroup("retreat")}
    </div>
  );
}
