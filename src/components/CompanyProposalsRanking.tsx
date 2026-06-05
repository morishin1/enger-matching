// 企業別の提案件数ランキング（横棒グラフ）。
//   - 提案数の多い順に上位N社を表示し、won（成約）・lost（失注）の内訳を色分け
//   - 各バーは「提案=灰／成約=緑／失注=赤」の積み上げではなく、提案数を基準に成約・失注を比率で重ねる
//   - クリックで該当企業の絞り込み（将来拡張用）はせず、まずは可視化のみ

"use client";

import { useMemo, useState } from "react";
import type { CompanyRow } from "@/lib/companies";

type Range = "all" | "active";

export function CompanyProposalsRanking({ companies }: { companies: CompanyRow[] }) {
  const [range, setRange] = useState<Range>("all");
  const [topN, setTopN] = useState(10);

  const rows = useMemo(() => {
    let list = companies.filter((c) => (c.proposals_total ?? 0) > 0);
    if (range === "active") list = list.filter((c) => (c.active_jobs ?? 0) > 0);
    list.sort((a, b) => (b.proposals_total ?? 0) - (a.proposals_total ?? 0));
    return list.slice(0, topN);
  }, [companies, range, topN]);

  const max = rows.reduce((m, r) => Math.max(m, r.proposals_total ?? 0), 0) || 1;
  const totalProposals = companies.reduce((a, c) => a + (c.proposals_total ?? 0), 0);
  const totalWon = companies.reduce((a, c) => a + (c.won ?? 0), 0);
  const totalLost = companies.reduce((a, c) => a + (c.lost ?? 0), 0);

  if (rows.length === 0) {
    return (
      <div className="card" style={{ marginTop: 12, padding: 16, fontSize: 12.5, color: "var(--color-ink-3)" }}>
        提案実績のある企業がまだありません。
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>
            📊 提案件数の多い企業 TOP{topN}
          </h3>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            全社合計 提案 <b style={{ color: "var(--color-ink)" }}>{totalProposals.toLocaleString()}</b> 件 ／ 成約 <b style={{ color: "#1aa260" }}>{totalWon.toLocaleString()}</b> ／ 失注 <b style={{ color: "#d23f57" }}>{totalLost.toLocaleString()}</b>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {([
            { k: "all", label: "全期間" },
            { k: "active", label: "進行中案件あり" },
          ] as { k: Range; label: string }[]).map((t) => {
            const on = range === t.k;
            return (
              <button key={t.k} type="button" onClick={() => setRange(t.k)}
                style={{
                  fontFamily: "inherit", fontSize: 12, padding: "5px 12px", borderRadius: 99,
                  border: `1px solid ${on ? "var(--color-brand-600)" : "var(--color-border)"}`,
                  background: on ? "var(--color-brand-600)" : "var(--color-surface)",
                  color: on ? "#fff" : "var(--color-ink-2)", fontWeight: on ? 700 : 600, cursor: "pointer",
                }}>
                {t.label}
              </button>
            );
          })}
          <select value={topN} onChange={(e) => setTopN(Number(e.target.value))}
            style={{ fontFamily: "inherit", fontSize: 12, padding: "5px 10px", borderRadius: 99, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink-2)" }}>
            {[5, 10, 20, 30].map((n) => <option key={n} value={n}>上位{n}社</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((c, i) => {
          const total = c.proposals_total ?? 0;
          const won = c.won ?? 0;
          const lost = c.lost ?? 0;
          const open = Math.max(0, total - won - lost);
          const widthPct = (total / max) * 100;
          const wonPct = total > 0 ? (won / total) * 100 : 0;
          const lostPct = total > 0 ? (lost / total) * 100 : 0;
          const openPct = total > 0 ? (open / total) * 100 : 0;
          const winRate = total > 0 ? Math.round((won / total) * 100) : 0;
          return (
            <div key={c.name} style={{ display: "grid", gridTemplateColumns: "26px minmax(120px, 200px) 1fr 86px", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, textAlign: "right" }}>{i + 1}.</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>
                {c.name}
              </span>
              <div style={{ position: "relative", height: 22, background: "var(--color-surface-soft)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ display: "flex", height: "100%", width: `${widthPct}%`, minWidth: 2, transition: "width .25s" }}>
                  <div title={`成約 ${won} 件`} style={{ width: `${wonPct}%`, background: "#1aa260" }} />
                  <div title={`進行中 ${open} 件`} style={{ width: `${openPct}%`, background: "#0095D9" }} />
                  <div title={`失注 ${lost} 件`} style={{ width: `${lostPct}%`, background: "#d23f57" }} />
                </div>
                <span className="mono" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, fontWeight: 700, color: "var(--color-ink-2)" }}>
                  {total}
                </span>
              </div>
              <span style={{ fontSize: 11, color: "var(--color-ink-3)", textAlign: "right" }}>
                成約率 <b className="mono" style={{ color: winRate >= 30 ? "#1aa260" : winRate >= 15 ? "#0095D9" : "var(--color-ink-3)" }}>{winRate}%</b>
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 12, fontSize: 11, color: "var(--color-ink-3)", flexWrap: "wrap" }}>
        <Legend color="#1aa260" label="成約（won）" />
        <Legend color="#0095D9" label="進行中" />
        <Legend color="#d23f57" label="失注（lost）" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}
