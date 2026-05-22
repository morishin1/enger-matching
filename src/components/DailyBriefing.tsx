"use client";

import { useState, useEffect } from "react";

export type BriefMetrics = {
  meetings: number; renewSoon: number; callPending: number; closingStalled: number;
  focusUntouched: number; staleJobs: number; newJobs: number; hot: number; endingSoon: number;
  pipelineMan: number; confirmedMan: number; fJobs: number; fProposed: number; fMet: number; fActive: number;
};

export function DailyBriefing({ metrics }: { metrics: BriefMetrics }) {
  const day = new Date().toISOString().slice(0, 10);
  const lsKey = "enger.brief." + day;
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 当日キャッシュ（再課金回避）
  useEffect(() => {
    try { const v = localStorage.getItem(lsKey); if (v) setText(v); } catch {}
  }, [lsKey]);

  const generate = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/daily-brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metrics }) });
      const data = await res.json();
      if (data.ok) { setText(data.text); try { localStorage.setItem(lsKey, data.text); } catch {} }
      else setErr(data.error || "生成に失敗しました");
    } catch { setErr("通信に失敗しました"); }
    finally { setLoading(false); }
  };

  const lines = (text ?? "").split(/\n+/).map((l) => l.replace(/^[・\-*\s]+/, "").trim()).filter(Boolean);

  return (
    <div className="card" style={{ background: "linear-gradient(135deg, var(--color-brand-25), var(--color-surface) 70%)", border: "1px solid var(--color-brand-100)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>今日のAIブリーフィング</h3>
          <span className="muted" style={{ fontSize: 10.5 }}>{day}</span>
        </div>
        <button onClick={generate} disabled={loading} className="btn brand btn-xs" style={{ textDecoration: "none" }}>
          {loading ? "生成中…" : text ? "再生成" : "今日の指示をもらう"}
        </button>
      </div>

      {err && <div style={{ fontSize: 12, color: "#b42318", marginTop: 8 }}>{err}</div>}

      {!text && !err && !loading && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>ボタンを押すと、現在の状況からAIが「今日やるべきこと」を優先度順にまとめます（1日1回キャッシュ）。</div>
      )}

      {text && (
        <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
          {lines.map((l, i) => (
            <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.55, color: "var(--color-ink-2)" }}>
              <span style={{ color: "var(--color-brand-600)", flexShrink: 0, fontWeight: 700 }}>{i + 1}.</span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
