"use client";

import { useState, useTransition } from "react";
import { submitClientFeedback } from "@/app/portal/actions";
import type { Verdict } from "@/lib/client-feedback";

export type RecoCandidate = {
  proposalId: string;
  init: string;
  title: string | null;
  jobTitle: string | null;
  stage: string | null;
  rate: string | null;
  score: number;
  matchedSkills: string[];
  otherSkills: string[];
  verdict: Verdict | null;
  reason: string | null;
};

const VERDICTS: { v: Verdict; label: string; emoji: string; tone: { bg: string; fg: string; bd: string } }[] = [
  { v: "want", label: "会いたい", emoji: "👍", tone: { bg: "#e7f7ee", fg: "#067647", bd: "#067647" } },
  { v: "maybe", label: "検討中", emoji: "🤔", tone: { bg: "#fff5e6", fg: "#b45309", bd: "#b45309" } },
  { v: "mismatch", label: "ミスマッチ", emoji: "👎", tone: { bg: "#fdecef", fg: "#b42318", bd: "#b42318" } },
];

function matchLabel(score: number) {
  if (score >= 80) return { t: "高マッチ", c: "#067647", bg: "#e7f7ee" };
  if (score >= 60) return { t: "中マッチ", c: "#0b5cab", bg: "#eaf4fd" };
  return { t: "要検討", c: "#6b7280", bg: "#eef0f3" };
}

function Card({ c }: { c: RecoCandidate }) {
  const [verdict, setVerdict] = useState<Verdict | null>(c.verdict);
  const [reason, setReason] = useState(c.reason ?? "");
  const [showReason, setShowReason] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ml = matchLabel(c.score);

  const choose = (v: Verdict) => {
    setVerdict(v);
    setErr(null);
    setSaved(false);
    if (v === "mismatch") { setShowReason(true); return; } // 理由を促す
    save(v, reason);
  };
  const save = (v: Verdict, r: string) => start(async () => {
    const res = await submitClientFeedback(c.proposalId, v, r);
    if (res.ok) { setSaved(true); setShowReason(false); } else setErr(res.error ?? "保存に失敗しました");
  });

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{c.init}{c.title ? <span className="muted" style={{ fontSize: 12, fontWeight: 400, marginLeft: 6 }}>{c.title}</span> : null}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{[c.jobTitle, c.rate].filter(Boolean).join(" · ")}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, padding: "3px 10px", borderRadius: 999, background: ml.bg, color: ml.c }}>{ml.t}</span>
          {c.score > 0 && <div className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", marginTop: 3 }}>マッチ度 {Math.round(c.score)}</div>}
        </div>
      </div>

      {(c.matchedSkills.length > 0 || c.otherSkills.length > 0) && (
        <div>
          {c.matchedSkills.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span className="muted" style={{ fontSize: 10.5, marginRight: 6 }}>案件要件と一致</span>
              {c.matchedSkills.map((s) => (
                <span key={s} style={{ display: "inline-block", fontSize: 10.5, padding: "2px 8px", borderRadius: 999, background: "#e7f7ee", color: "#067647", margin: "2px 4px 2px 0", fontWeight: 700 }}>✓ {s}</span>
              ))}
            </div>
          )}
          {c.otherSkills.length > 0 && (
            <div>
              <span className="muted" style={{ fontSize: 10.5, marginRight: 6 }}>その他スキル</span>
              {c.otherSkills.map((s) => (
                <span key={s} style={{ display: "inline-block", fontSize: 10.5, padding: "2px 8px", borderRadius: 999, background: "var(--color-brand-25)", color: "var(--color-ink-3)", margin: "2px 4px 2px 0" }}>{s}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {VERDICTS.map((b) => {
            const active = verdict === b.v;
            return (
              <button key={b.v} onClick={() => choose(b.v)} disabled={pending}
                style={{ flex: "1 1 0", minWidth: 92, padding: "8px 6px", borderRadius: 9, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                  border: active ? `1.5px solid ${b.tone.bd}` : "1px solid var(--color-border)",
                  background: active ? b.tone.bg : "#fff", color: active ? b.tone.fg : "#6b7280" }}>
                {b.emoji} {b.label}
              </button>
            );
          })}
        </div>

        {(showReason || (verdict === "mismatch")) && (
          <div style={{ marginTop: 8 }}>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="どこがミスマッチでしたか？（例：スキルは合うが単価が高い / リモート不可がNG など）次回提案の精度向上に使います"
              style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }} />
            <button onClick={() => save("mismatch", reason)} disabled={pending}
              style={{ marginTop: 6, padding: "7px 14px", borderRadius: 8, border: 0, background: "#b42318", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              ミスマッチとして送信
            </button>
          </div>
        )}

        {saved && <div style={{ fontSize: 11.5, color: "#067647", marginTop: 6 }}>✓ 評価を保存しました。ありがとうございます。</div>}
        {err && <div style={{ fontSize: 11.5, color: "#b42318", marginTop: 6 }}>{err}</div>}
      </div>
    </div>
  );
}

export function CandidateRecommendations({ items }: { items: RecoCandidate[] }) {
  if (items.length === 0) {
    return <div className="card" style={{ fontSize: 13 }}>現在ご提案中の人材はありません。担当エージェントが案件に合う人材をお探しします。</div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
      {items.map((c) => <Card key={c.proposalId} c={c} />)}
    </div>
  );
}
