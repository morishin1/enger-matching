"use client";

import { useState } from "react";
import { Icons } from "@/components/icons";
import { MOCK } from "@/lib/mock";

function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const inner = size - 14;
  const color = score >= 90 ? "var(--color-brand-700)" : score >= 80 ? "var(--color-brand-500)" : score >= 70 ? "var(--color-brand-400)" : "var(--color-ink-4)";
  return (
    <div style={{ width: size, height: size, borderRadius: 99, flex: `0 0 ${size}px`, background: `conic-gradient(${color} ${score}%, var(--color-brand-50) 0)`, display: "grid", placeItems: "center" }}>
      <div style={{ width: inner, height: inner, borderRadius: 99, background: "var(--color-surface)", display: "grid", placeItems: "center", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: size > 40 ? 16 : 13, fontVariantNumeric: "tabular-nums", color: "var(--color-ink)" }}>{score}</div>
    </div>
  );
}

function JobCard() {
  const j = MOCK.job;
  return (
    <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-200)", borderLeftWidth: 3, borderLeftColor: "var(--color-brand-700)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-3)" }}>{j.id}</span>
            <span style={{ color: "var(--color-ink-5)" }}>·</span>
            <span className="pill open">募集中</span>
            <span style={{ color: "var(--color-ink-5)" }}>·</span>
            <span style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>掲載 {j.posted}</span>
          </div>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--color-ink)" }}>{j.title}</h2>
          <div style={{ display: "flex", gap: 18, marginTop: 8, color: "var(--color-ink-3)", fontSize: 12.5, flexWrap: "wrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icons.building />{j.company}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icons.loc />{j.location}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icons.yen />{j.rate}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icons.cal />{j.period}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icons.user />{j.seats} 名</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button className="btn ghost" style={{ padding: "7px 10px" }}><Icons.starF /></button>
          <button className="btn">編集</button>
          <button className="btn primary">提案を作成</button>
        </div>
      </div>
      <div style={{ marginTop: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {j.skills.map((s) => <span key={s} className="tag brand">{s}</span>)}
        {j.nice.map((s) => <span key={s} className="tag" style={{ background: "transparent", border: "1px dashed var(--color-border-strong)" }}>歓迎: {s}</span>)}
      </div>
    </div>
  );
}

function FilterBar({ count, sortBy, setSortBy, view, setView }: any) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {["すべて", "提案可", "提案中", "保存済"].map((t, i) => (
          <button key={t} className="btn" style={{ padding: "6px 12px", fontSize: 12, background: i === 0 ? "var(--color-brand-800)" : "var(--color-surface)", color: i === 0 ? "#f4f7f4" : "var(--color-ink-2)", borderColor: i === 0 ? "var(--color-brand-800)" : "var(--color-border)" }}>{t}</button>
        ))}
      </div>
      <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{count} 名の候補</span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-ink-3)" }}>
          並び順:
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ fontFamily: "inherit", fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            <option value="score">マッチ度</option>
            <option value="rate">単価</option>
            <option value="avail">稼働開始</option>
            <option value="exp">経験年数</option>
          </select>
        </div>
        <div style={{ display: "flex", padding: 2, background: "var(--color-surface-inset)", borderRadius: 7 }}>
          {[
            { id: "split", label: "リスト", ico: "M2 3h12M2 7h12M2 11h12" },
            { id: "card", label: "カード", ico: "M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" },
            { id: "table", label: "表", ico: "M2 3h12v3H2zM2 6h12v3H2zM2 9h12v3H2zM2 12h12v3H2z" },
          ].map((v) => (
            <button key={v.id} onClick={() => setView(v.id)} style={{ border: 0, padding: "5px 10px", borderRadius: 5, background: view === v.id ? "var(--color-surface)" : "transparent", color: view === v.id ? "var(--color-ink)" : "var(--color-ink-3)", fontSize: 11.5, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5, boxShadow: view === v.id ? "0 1px 2px rgba(0,0,0,0.06)" : "none", cursor: "pointer" }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}><path d={v.ico} /></svg>
              {v.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WhyMatch({ items }: { items: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {items.map((w, i) => {
        const isGood = w.endsWith("✓");
        const isBad = w.endsWith("✗");
        const isMid = w.endsWith("△");
        const c = isGood ? "var(--color-success)" : isBad ? "var(--color-danger)" : isMid ? "var(--color-warn)" : "var(--color-ink-3)";
        return (
          <div key={i} style={{ fontSize: 11.5, display: "flex", gap: 6, alignItems: "flex-start", lineHeight: 1.5 }}>
            <span style={{ color: c, fontWeight: 600, flex: "0 0 12px", marginTop: 1 }}>{isGood ? "+" : isBad ? "−" : "·"}</span>
            <span style={{ color: "var(--color-ink-2)" }}>{w.replace(/[✓✗△]$/, "")}</span>
          </div>
        );
      })}
    </div>
  );
}

function CandidateRow({ c, selected, onSelect }: any) {
  return (
    <div onClick={() => onSelect(c.id)} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, padding: 14, background: selected ? "var(--color-brand-25)" : "var(--color-surface)", border: "1px solid", borderColor: selected ? "var(--color-brand-200)" : "var(--color-border)", borderLeftWidth: selected ? 3 : 1, borderLeftColor: selected ? "var(--color-brand-700)" : "var(--color-border)", borderRadius: 10, cursor: "pointer", transition: "background .15s, border-color .15s" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <ScoreRing score={c.score} size={48} />
        <div className="ava lg" style={{ background: "var(--color-brand-50)" }}>{c.initials}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15, color: "var(--color-ink)" }}>{c.name}</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>{c.id}</span>
          {c.saved && <span style={{ color: "var(--color-warn)" }} title="保存済"><Icons.starF /></span>}
          <span className="pill" style={{ marginLeft: "auto" }}>{c.status}</span>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{c.title} · {c.company}</div>
        <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11.5, color: "var(--color-ink-3)" }}>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}><Icons.yen />{c.rate}</span>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}><Icons.clock />{c.avail}</span>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}><Icons.loc />{c.location}</span>
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}><Icons.user />{c.exp}</span>
        </div>
        <div style={{ display: "flex", gap: 5, marginTop: 10, flexWrap: "wrap" }}>
          {c.skills.map((s: string) => <span key={s} className="tag">{s}</span>)}
        </div>
      </div>
      <div style={{ width: 240, borderLeft: "1px solid var(--color-border)", paddingLeft: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 500 }}>マッチ要因</div>
        <WhyMatch items={c.why.slice(0, 3)} />
      </div>
    </div>
  );
}

function CandidateCard({ c, selected, onSelect }: any) {
  return (
    <div onClick={() => onSelect(c.id)} style={{ background: selected ? "var(--color-brand-25)" : "var(--color-surface)", border: "1px solid", borderColor: selected ? "var(--color-brand-500)" : "var(--color-border)", borderRadius: 12, padding: 16, cursor: "pointer", display: "flex", flexDirection: "column", gap: 12, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: selected ? "var(--color-brand-700)" : "transparent" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="ava lg" style={{ background: "var(--color-brand-100)" }}>{c.initials}</div>
        <ScoreRing score={c.score} size={44} />
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14.5, color: "var(--color-ink)" }}>{c.name}</div>
          {c.saved && <span style={{ color: "var(--color-warn)" }}><Icons.starF /></span>}
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{c.title}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11, color: "var(--color-ink-3)" }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}><Icons.yen /><span className="tnum">{c.rate}</span></div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}><Icons.clock /><span>{c.avail}</span></div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}><Icons.loc /><span>{c.location}</span></div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}><Icons.user /><span>{c.exp}</span></div>
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {c.skills.slice(0, 4).map((s: string) => <span key={s} className="tag" style={{ fontSize: 10.5 }}>{s}</span>)}
      </div>
      <div style={{ padding: "10px 0 0", borderTop: "1px dashed var(--color-border)" }}>
        <WhyMatch items={c.why.slice(0, 2)} />
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
        <button className="btn primary" style={{ flex: 1, justifyContent: "center", padding: "7px 8px", fontSize: 12 }}>提案</button>
        <button className="btn" style={{ padding: "7px 10px" }}><Icons.msg /></button>
      </div>
    </div>
  );
}

function CandidateTable({ items, selected, onSelect }: any) {
  return (
    <div className="card flush">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 40 }}></th><th style={{ width: 56 }}>スコア</th><th>候補者</th><th>スキル</th>
            <th style={{ width: 90 }}>単価</th><th style={{ width: 100 }}>稼働開始</th><th style={{ width: 90 }}>状態</th><th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((c: any) => (
            <tr key={c.id} onClick={() => onSelect(c.id)} style={{ background: selected === c.id ? "var(--color-brand-25)" : "transparent", cursor: "pointer" }}>
              <td><input type="checkbox" defaultChecked={c.saved} /></td>
              <td><ScoreRing score={c.score} size={36} /></td>
              <td>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div className="ava">{c.initials}</div>
                  <div>
                    <div className="pri">{c.name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{c.title} · {c.company}</div>
                  </div>
                </div>
              </td>
              <td>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {c.skills.slice(0, 4).map((s: string) => <span key={s} className="tag" style={{ fontSize: 10.5 }}>{s}</span>)}
                </div>
              </td>
              <td className="num">{c.rate}</td>
              <td className="num muted">{c.avail}</td>
              <td><span className="pill open">{c.status}</span></td>
              <td><button className="btn" style={{ padding: "5px 10px", fontSize: 11.5 }}>提案</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CandidateDetail({ c }: any) {
  if (!c) return null;
  return (
    <div className="card" style={{ position: "sticky", top: 80, maxHeight: "calc(100vh - 100px)", overflowY: "auto" }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <ScoreRing score={c.score} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>{c.id}</span>
            <span className="pill open">{c.status}</span>
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18 }}>{c.name}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>{c.title}</div>
        </div>
      </div>
      <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: "linear-gradient(135deg, var(--color-brand-25), var(--color-surface))", border: "1px solid var(--color-brand-100)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{ color: "var(--color-brand-700)", display: "grid", placeItems: "center" }}><Icons.ai /></span>
          <div style={{ fontWeight: 600, fontSize: 12 }}>AI による マッチング分析</div>
        </div>
        <WhyMatch items={c.why} />
      </div>
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[["希望単価", c.rate], ["稼働開始", c.avail], ["経験", c.exp], ["所属", c.company]].map(([k, v]) => (
          <div key={k as string}>
            <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)" }}>{k}</div>
            <div className="display tnum" style={{ fontSize: 17, fontWeight: 600, marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>
      <hr className="hr" style={{ margin: "16px 0" }} />
      <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", marginBottom: 8 }}>スキル一致</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {[
          { k: "Java 17", p: 100, m: "8年" }, { k: "Spring Boot", p: 100, m: "6年" }, { k: "Kafka", p: 85, m: "3年" }, { k: "AWS", p: 90, m: "5年" }, { k: "金融基盤", p: 100, m: "8年" },
        ].map((s) => (
          <div key={s.k} style={{ display: "grid", gridTemplateColumns: "90px 1fr 36px", gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "var(--color-ink-2)" }}>{s.k}</div>
            <div style={{ height: 4, background: "var(--color-surface-inset)", borderRadius: 99 }}>
              <div style={{ width: `${s.p}%`, height: "100%", background: s.p >= 100 ? "var(--color-brand-700)" : "var(--color-brand-400)", borderRadius: 99 }} />
            </div>
            <div className="mono tnum muted" style={{ fontSize: 11, textAlign: "right" }}>{s.m}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button className="btn"><Icons.msg />メッセージ</button>
        <button className="btn primary" style={{ justifyContent: "center" }}>提案を作成</button>
      </div>
    </div>
  );
}

export default function MatchingPage() {
  const [sortBy, setSortBy] = useState("score");
  const [view, setView] = useState("split");
  const [selected, setSelected] = useState(MOCK.candidates[0].id);
  const sel = MOCK.candidates.find((c) => c.id === selected);

  const sorted = [...MOCK.candidates].sort((a, b) => {
    if (sortBy === "rate") return parseInt(b.rate.replace(/[^\d]/g, "")) - parseInt(a.rate.replace(/[^\d]/g, ""));
    if (sortBy === "exp") return parseInt(b.exp) - parseInt(a.exp);
    if (sortBy === "avail") return a.avail.localeCompare(b.avail);
    return b.score - a.score;
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="meta">Matching · 案件 M-2841</div>
          <h1>マッチング</h1>
          <div className="sub">AIが <b style={{ color: "var(--color-ink)" }}>{MOCK.candidates.length} 名</b> の候補者を抽出しました。スコア 90+ は <b style={{ color: "var(--color-brand-700)" }}>2 名</b>。</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost"><Icons.bolt /><span>AIで再マッチ</span></button>
          <button className="btn"><Icons.plus /><span>候補を追加</span></button>
          <button className="btn primary">一括提案</button>
        </div>
      </div>

      <JobCard />
      <FilterBar count={sorted.length} sortBy={sortBy} setSortBy={setSortBy} view={view} setView={setView} />

      {view === "split" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "var(--gap, 18px)", minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            {sorted.map((c) => <CandidateRow key={c.id} c={c} selected={selected === c.id} onSelect={setSelected} />)}
          </div>
          <CandidateDetail c={sel} />
        </div>
      )}
      {view === "card" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "var(--gap, 18px)" }}>
          {sorted.map((c) => <CandidateCard key={c.id} c={c} selected={selected === c.id} onSelect={setSelected} />)}
        </div>
      )}
      {view === "table" && <CandidateTable items={sorted} selected={selected} onSelect={setSelected} />}
    </div>
  );
}
