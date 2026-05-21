"use client";

import { useState } from "react";
import { Icons } from "@/components/icons";
import { MOCK } from "@/lib/mock";

const STAGES = [
  { id: "新規提案", color: "#0095D9", soft: "#e6f4fb", text: "#007DB3" },
  { id: "提案中", color: "#3d7fa8", soft: "#e9f0f5", text: "#2c5572" },
  { id: "面談調整", color: "#5a9b6a", soft: "#e7f1ea", text: "#356444" },
  { id: "条件交渉", color: "#d97a3a", soft: "#fef3e2", text: "#a35f15" },
  { id: "成約間近", color: "#7a5cc4", soft: "#efeaf9", text: "#5a3fa0" },
];

function ProgressCard({ p }: any) {
  const stage = STAGES.find((s) => s.id === p.stage)!;
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10, transition: "border-color .12s, box-shadow .12s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <span className="mono" style={{ fontSize: 10, color: "var(--color-ink-4)" }}>{p.id}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {p.ai && <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 99, background: "var(--color-brand-50)", color: "var(--color-brand-700)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>AI</span>}
          <span className="mono" style={{ fontSize: 10, color: "var(--color-ink-4)" }}>{p.daysIn}d</span>
        </div>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-ink)", lineHeight: 1.4 }}>{p.job}</div>
      <div style={{ fontSize: 11.5, color: "var(--color-ink-3)", marginTop: -4 }}>{p.company}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--color-surface-soft)", borderRadius: 8 }}>
        <div className="ava" style={{ width: 26, height: 26, fontSize: 10 }}>{p.cInit}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink)" }}>{p.candidate}</div>
          <div className="mono" style={{ fontSize: 10, color: "var(--color-ink-4)" }}>マッチ {p.score}</div>
        </div>
        <div className="display tnum" style={{ fontSize: 13, fontWeight: 700, color: "var(--color-brand-700)" }}>{p.rate}</div>
      </div>
      <div style={{ padding: "6px 0", borderTop: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: stage.color, flex: "0 0 6px" }} />
        <div style={{ fontSize: 11, color: "var(--color-ink-2)", flex: 1, lineHeight: 1.4 }}>{p.next}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="ava" style={{ width: 22, height: 22, fontSize: 9.5, background: "var(--color-surface-inset)", color: "var(--color-ink-3)" }}>{p.oInit}</div>
        <span className="mono" style={{ fontSize: 10.5, fontWeight: 600, color: p.dueT === "danger" ? "var(--color-danger)" : p.dueT === "warn" ? "var(--color-warn)" : "var(--color-ink-4)" }}>{p.due}</span>
      </div>
    </div>
  );
}

function ProgressColumn({ stage, items }: any) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 12, background: stage.soft, border: `1px solid ${stage.color}22` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: stage.color }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: stage.text }}>{stage.id}</span>
          <span className="mono tnum" style={{ fontSize: 11, color: stage.text, opacity: 0.7, fontWeight: 600 }}>{items.length}</span>
        </div>
        <button style={{ border: 0, background: "transparent", color: stage.text, opacity: 0.7, width: 22, height: 22, borderRadius: 6, cursor: "pointer", display: "grid", placeItems: "center", fontFamily: "inherit" }}><Icons.plus /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((p: any) => <ProgressCard key={p.id} p={p} />)}
        {items.length === 0 && <div style={{ border: "1px dashed var(--color-border-strong)", borderRadius: 10, padding: "20px 12px", textAlign: "center", color: "var(--color-ink-4)", fontSize: 11, fontFamily: "var(--font-mono)" }}>空</div>}
      </div>
    </div>
  );
}

export default function ProgressPage() {
  const [owner, setOwner] = useState("ALL");
  const [view, setView] = useState("board");
  const allItems = MOCK.progressItems;
  const owners = ["ALL", ...Array.from(new Set(allItems.map((i) => i.owner)))];
  const filtered = allItems.filter((i) => owner === "ALL" || i.owner === owner);
  const byStage = STAGES.map((s) => ({ ...s, items: filtered.filter((i) => i.stage === s.id) }));
  const dueToday = filtered.filter((i) => i.due.includes("今日") || i.dueT === "danger").length;
  const dueWarn = filtered.filter((i) => i.dueT === "warn").length;
  const aiPromoted = filtered.filter((i) => i.ai).length;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Progress · 進捗ボード</div>
          <h1>進捗管理</h1>
          <div className="sub">進行中 <b style={{ color: "var(--color-ink)" }}>{allItems.length} 件</b> · 期限切迫 <b style={{ color: "var(--color-danger)" }}>{dueToday + dueWarn} 件</b>。ステータスが <b style={{ color: "var(--color-ink)" }}>5 日以上停滞</b> している案件には自動でアラートが出ます。</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          <button className="btn"><Icons.bolt /><span>自動振り分け</span></button>
          <button className="btn brand"><Icons.plus /><span>進捗を追加</span></button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi brand">
          <div className="top"><div className="ico-box"><Icons.pipeline /></div><div className="chip">+3</div></div>
          <div><div className="val tnum">{allItems.length}<span className="unit">件</span></div><div className="label">進行中の進捗</div><div className="note">5 ステージで管理</div></div>
        </div>
        <div className="kpi danger">
          <div className="top"><div className="ico-box"><Icons.clock /></div><div className="chip dn">+2</div></div>
          <div><div className="val tnum">{dueToday + dueWarn}<span className="unit">件</span></div><div className="label">期限切迫</div><div className="note">本日 {dueToday} · 24h {dueWarn}</div></div>
        </div>
        <div className="kpi accent">
          <div className="top"><div className="ico-box"><Icons.ai /></div><div className="chip">NEW</div></div>
          <div><div className="val tnum">{aiPromoted}<span className="unit">件</span></div><div className="label">AI 自動 通知</div><div className="note">返信→トリアージ 完了</div></div>
        </div>
        <div className="kpi warn">
          <div className="top"><div className="ico-box"><Icons.bolt /></div><div className="chip dn">-1pt</div></div>
          <div><div className="val tnum">3.2<span className="unit">日</span></div><div className="label">平均滞在日数</div><div className="note">ステージあたり</div></div>
        </div>
      </div>

      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99 }}>
          {owners.map((o) => (
            <button key={o} onClick={() => setOwner(o)} style={{ padding: "6px 14px", borderRadius: 99, border: 0, background: owner === o ? "var(--color-surface)" : "transparent", color: owner === o ? "var(--color-ink)" : "var(--color-ink-3)", fontSize: 12, fontWeight: 600, fontFamily: "inherit", boxShadow: owner === o ? "0 1px 2px rgba(15,23,42,0.06)" : "none", cursor: "pointer" }}>{o === "ALL" ? "全担当" : o}</button>
          ))}
        </div>
        <div className="search" style={{ marginLeft: 0, width: 260 }}>
          <span style={{ display: "grid", placeItems: "center" }}><Icons.search /></span>
          <input placeholder="案件・人材で検索…" />
        </div>
        <div style={{ marginLeft: "auto", display: "flex", padding: 2, background: "var(--color-surface-inset)", borderRadius: 8 }}>
          {[{ id: "board", label: "ボード" }, { id: "list", label: "リスト" }].map((v) => (
            <button key={v.id} onClick={() => setView(v.id)} style={{ border: 0, padding: "6px 14px", borderRadius: 6, background: view === v.id ? "var(--color-surface)" : "transparent", color: view === v.id ? "var(--color-ink)" : "var(--color-ink-3)", fontSize: 11.5, fontFamily: "inherit", fontWeight: 600, boxShadow: view === v.id ? "0 1px 2px rgba(0,0,0,0.06)" : "none", cursor: "pointer" }}>{v.label}</button>
          ))}
        </div>
      </div>

      {view === "board" && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(220px, 1fr))`, gap: 14, alignItems: "flex-start" }}>
          {byStage.map((s) => <ProgressColumn key={s.id} stage={s} items={s.items} />)}
        </div>
      )}

      {view === "list" && (
        <div className="card flush">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 80 }}>ID</th><th>案件</th><th>候補者</th><th style={{ width: 100 }}>単価</th>
                <th style={{ width: 110 }}>ステージ</th><th style={{ width: 90 }}>担当</th><th style={{ width: 100 }}>期日</th><th>次のアクション</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const stage = STAGES.find((s) => s.id === p.stage)!;
                return (
                  <tr key={p.id}>
                    <td><span className="mono" style={{ color: "var(--color-ink-4)", fontSize: 11 }}>{p.id}</span></td>
                    <td><div className="pri">{p.job}</div><div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{p.company}</div></td>
                    <td>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <div className="ava" style={{ width: 26, height: 26, fontSize: 10 }}>{p.cInit}</div>
                        <div><div className="pri">{p.candidate}</div><div className="muted" style={{ fontSize: 10.5, fontFamily: "var(--font-mono)" }}>{p.score}</div></div>
                      </div>
                    </td>
                    <td className="num">{p.rate}</td>
                    <td><span style={{ padding: "3px 9px", borderRadius: 99, background: stage.soft, color: stage.text, fontSize: 11, fontWeight: 600, border: `1px solid ${stage.color}22` }}>{p.stage}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <div className="ava" style={{ width: 22, height: 22, fontSize: 9 }}>{p.oInit}</div>
                        <span style={{ fontSize: 11.5 }}>{p.owner}</span>
                      </div>
                    </td>
                    <td><span className="mono" style={{ fontSize: 11, fontWeight: 600, color: p.dueT === "danger" ? "var(--color-danger)" : p.dueT === "warn" ? "var(--color-warn)" : "var(--color-ink-3)" }}>{p.due}</span></td>
                    <td style={{ fontSize: 11.5, color: "var(--color-ink-2)" }}>{p.next}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
