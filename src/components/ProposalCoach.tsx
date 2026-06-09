"use client";

// 提案ボードの「AIコーチ」。リスト/カンバン切替の隣に置くボタン。
//   押すと当日（=現在ボードに出ている）提案リストを /api/proposals-coach に送り、
//   Haiku が「総評 / 優先対応 / リスク / 担当者別助言 / 次の一手」を返す。
//   毎日20件規模でもコストは1回約1円。

import { useState } from "react";

type CoachResult = {
  headline: string; summary: string;
  priorities: string[]; risks: string[]; by_proposer: string[]; next_actions: string[];
};

export function ProposalCoach({ proposals, periodLabel = "本日" }: { proposals: any[]; periodLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CoachResult | null>(null);
  const [meta, setMeta] = useState<{ analyzed: number; costJpy: number } | null>(null);

  const run = async () => {
    setOpen(true); setLoading(true); setErr(null); setResult(null);
    try {
      const res = await fetch("/api/proposals-coach", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposals, periodLabel }),
      });
      const data = await res.json();
      if (!data.ok) { setErr(data.error || "分析に失敗しました"); return; }
      setResult(data.result); setMeta(data.meta ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "通信に失敗しました");
    } finally { setLoading(false); }
  };

  return (
    <>
      <button type="button" onClick={run} disabled={loading || proposals.length === 0}
        title={proposals.length === 0 ? "分析対象の提案がありません" : "AIが当日の提案リストを分析して講評します"}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8,
          border: "1px solid #7c5cff", background: "linear-gradient(135deg,#7c5cff,#5b8cff)", color: "#fff", cursor: proposals.length === 0 ? "not-allowed" : "pointer", opacity: proposals.length === 0 ? 0.5 : 1 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>neurology</span>
        {loading ? "分析中…" : "AIコーチ"}
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 320, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 640, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 22, color: "#7c5cff" }}>neurology</span>
                AIコーチ <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>（{periodLabel}の提案分析）</span>
              </h3>
              <button className="btn ghost btn-xs" onClick={() => setOpen(false)}>閉じる</button>
            </div>

            {loading && (
              <div style={{ padding: "30px 0", textAlign: "center", color: "var(--color-ink-3)", fontSize: 13 }}>
                <span style={{ display: "inline-block", width: 18, height: 18, border: "3px solid var(--color-border)", borderTopColor: "#7c5cff", borderRadius: "50%", animation: "spin .8s linear infinite", marginRight: 8, verticalAlign: "-3px" }} />
                AIが提案リストを分析しています…
              </div>
            )}

            {err && <div style={{ color: "var(--color-danger)", fontSize: 12.5 }}>{err}</div>}

            {result && (
              <>
                <div style={{ background: "linear-gradient(135deg,#f3f0ff,#eef3ff)", border: "1px solid #ddd6fe", borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#5b21b6" }}>{result.headline || "講評"}</div>
                  {result.summary && <div style={{ fontSize: 12.5, color: "var(--color-ink-2)", marginTop: 6, lineHeight: 1.7 }}>{result.summary}</div>}
                </div>

                <Section title="🔥 今すぐ着手すべき" items={result.priorities} tone="#b42318" />
                <Section title="⚠ 放置リスク" items={result.risks} tone="#9a5b1a" />
                <Section title="👤 担当者へのアドバイス" items={result.by_proposer} tone="#0b5cab" />
                <Section title="✅ チームの次の一手" items={result.next_actions} tone="#067647" />

                {meta && (
                  <div className="muted" style={{ fontSize: 10.5, textAlign: "right" }}>
                    {meta.analyzed}件を分析 ・ 概算コスト 約{meta.costJpy}円
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn ghost btn-sm" onClick={run} disabled={loading}>再分析</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: tone, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((s, i) => <li key={i} style={{ fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.6 }}>{s}</li>)}
      </ul>
    </div>
  );
}
