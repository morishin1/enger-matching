"use client";

// 提案前チェック（確認ポイント）パネル。
//   match.ts の決定論的 notes（🔴要確認 / 🟡注意 / 🟢OK）を、提案フォームの直前に常時表示する。
//   さらに「💡 AIアドバイス」で、提案前に確認すべき点・推し材料を Claude Haiku が要点化（任意・キャッシュ）。
//   ・赤/黄＝確認が必要な点を最優先で見せ、緑（適合）は件数バッジ＋折りたたみ。
//   ・営業の「マッチングの根拠と注意点」の理解と、提案前の手戻り防止を支援する。

import { useState } from "react";

export type Note = { level: "red" | "yellow" | "green"; text: string };

type AdviceJob = { title?: string | null; skills?: string[] | null; salary_label?: string | null; remote_type?: string | null; flow_note?: string | null };
type AdviceCand = { title?: string | null; skills?: string[] | null; rate?: string | null; nationality?: string | null; age_band?: string | null; avail?: string | null; remote_pref?: string | null };

const DOT: Record<Note["level"], { icon: string; bg: string; fg: string; bd: string }> = {
  red:    { icon: "🔴", bg: "#fdecef", fg: "#b42318", bd: "#f7c5cf" },
  yellow: { icon: "🟡", bg: "#fff6e0", fg: "#9a7b12", bd: "#fde9b0" },
  green:  { icon: "🟢", bg: "#e7f7ee", fg: "#067647", bd: "#bfe3cc" },
};

export function MatchChecklist({
  notes, jobNo, candNo, job, cand, score, verdict,
}: {
  notes: Note[];
  jobNo: number | string | null;
  candNo: number | string | null;
  job: AdviceJob;
  cand: AdviceCand;
  score?: number | null;
  verdict?: string | null;
}) {
  const reds = notes.filter((n) => n.level === "red");
  const yellows = notes.filter((n) => n.level === "yellow");
  const greens = notes.filter((n) => n.level === "green");

  const [showGreen, setShowGreen] = useState(false);
  const [advLoading, setAdvLoading] = useState(false);
  const [advErr, setAdvErr] = useState<string | null>(null);
  const [advice, setAdvice] = useState<{ confirm: string[]; strength: string[] } | null>(null);

  const fetchAdvice = async () => {
    setAdvLoading(true); setAdvErr(null);
    try {
      const res = await fetch("/api/match-advice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobNo, candNo, job, cand, notes, score, verdict }),
      });
      const data = await res.json();
      if (!data.ok) { setAdvErr(data.error || "AIアドバイスの取得に失敗しました"); return; }
      setAdvice({ confirm: data.confirm ?? [], strength: data.strength ?? [] });
    } catch (e) {
      setAdvErr(e instanceof Error ? e.message : "AIアドバイスの取得に失敗しました");
    } finally { setAdvLoading(false); }
  };

  const Item = ({ n }: { n: Note }) => {
    const t = DOT[n.level];
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.5, padding: "5px 0" }}>
        <span style={{ flex: "0 0 auto", fontSize: 11 }}>{t.icon}</span>
        <span style={{ color: n.level === "green" ? "var(--color-ink-3)" : t.fg, fontWeight: n.level === "green" ? 400 : 600 }}>{n.text}</span>
      </div>
    );
  };

  return (
    <div style={{ marginBottom: 14, border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--color-surface-soft)", borderBottom: "1px solid var(--color-border)", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>💡 提案前チェック</span>
        {reds.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: DOT.red.bg, color: DOT.red.fg }}>要確認 {reds.length}</span>}
        {yellows.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: DOT.yellow.bg, color: DOT.yellow.fg }}>注意 {yellows.length}</span>}
        {reds.length === 0 && yellows.length === 0 && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: DOT.green.bg, color: DOT.green.fg }}>確認事項なし ✓</span>}
        <button type="button" onClick={fetchAdvice} disabled={advLoading}
          style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 8, border: "1px solid var(--color-brand-200, #cfe1f7)", background: "var(--color-brand-25, #f0f6ff)", color: "var(--color-brand-700, #0b5cab)", cursor: advLoading ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>auto_awesome</span>
          {advLoading ? "生成中…" : advice ? "AIアドバイス再取得" : "AIアドバイス"}
        </button>
      </div>

      <div style={{ padding: "8px 14px" }}>
        {/* 要確認（赤・黄）を最優先で常時表示 */}
        {[...reds, ...yellows].map((n, i) => <Item key={`rw-${i}`} n={n} />)}
        {reds.length === 0 && yellows.length === 0 && (
          <div className="muted" style={{ fontSize: 12, padding: "4px 0" }}>確認が必要な注意点はありません。適合項目は下で確認できます。</div>
        )}

        {/* 適合（緑）は件数のみ→展開 */}
        {greens.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed var(--color-border)" }}>
            <button type="button" onClick={() => setShowGreen((v) => !v)}
              style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-ink-3)", background: "transparent", border: 0, cursor: "pointer", padding: 0 }}>
              🟢 適合項目 {greens.length} 件 {showGreen ? "を隠す ▲" : "を表示 ▼"}
            </button>
            {showGreen && <div style={{ marginTop: 4 }}>{greens.map((n, i) => <Item key={`g-${i}`} n={n} />)}</div>}
          </div>
        )}

        {/* AIアドバイス */}
        {advErr && <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--color-danger)" }}>{advErr}</div>}
        {advice && (
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ border: `1px solid ${DOT.yellow.bd}`, background: DOT.yellow.bg, borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: DOT.yellow.fg, marginBottom: 4 }}>⚠ 提案前に確認</div>
              {advice.confirm.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: "var(--color-ink-2)", lineHeight: 1.7 }}>
                  {advice.confirm.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              ) : <div className="muted" style={{ fontSize: 11.5 }}>特になし</div>}
            </div>
            <div style={{ border: `1px solid ${DOT.green.bd}`, background: DOT.green.bg, borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: DOT.green.fg, marginBottom: 4 }}>✅ 推しポイント</div>
              {advice.strength.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: "var(--color-ink-2)", lineHeight: 1.7 }}>
                  {advice.strength.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              ) : <div className="muted" style={{ fontSize: 11.5 }}>特になし</div>}
            </div>
          </div>
        )}
        {advice && <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>※ AI生成の参考情報です。最終判断は担当者が行ってください。</div>}
      </div>
    </div>
  );
}
