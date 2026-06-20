"use client";

// 提案前 多重チェック（L2: AI ファイナル監査）パネル。
//   ・MailComposeWizard 確認画面（step 2）の送信ボタン直前に表示
//   ・①必須スキル ②尚可スキル ③経験業務カテゴリ を各スキル毎に根拠引用付きで監査
//   ・根拠ゼロの必須スキルがある場合は overall="block" を返し、UI で赤バナーを出す
//   ・ペア単位で API 側キャッシュ済み（再表示は無課金）
//   ・onResult(overall) を親へ通知し、送信ボタンの抑止可否を制御させる

import { useEffect, useRef, useState } from "react";

type Finding = { skill: string; found: boolean; evidence: string };
type Result = {
  overall: "ok" | "warn" | "block";
  required: Finding[];
  preferred: Finding[];
  category: { match: boolean; reason: string };
  summary: string;
};

export type PrecheckOverall = Result["overall"];

export function MatchPrecheckPanel({ job, cand, onResult }: {
  job: any;
  cand: any;
  onResult?: (overall: PrecheckOverall | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [cached, setCached] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  // 同じ案件×人材で重複起動しないため、起動キーを ref で覚える。
  const startedKeyRef = useRef<string | null>(null);

  const run = async () => {
    const key = `${job?.job_no ?? ""}#${cand?.candidate_no ?? ""}`;
    if (startedKeyRef.current === key) return;
    startedKeyRef.current = key;
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/match-precheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job: {
            job_no: job?.job_no, title: job?.title, role_label: job?.role_label,
            skills: job?.skills, salary_label: undefined,
            detail: job?.detail,
          },
          cand: {
            candidate_no: cand?.candidate_no, name: cand?.name, title: cand?.title,
            company: cand?.company, skills: cand?.skills, rate: cand?.rate,
            exp: cand?.exp, note: cand?.note, skill_sheet_summary: cand?.skill_sheet_summary,
          },
        }),
      });
      const data = await res.json();
      if (!data.ok) { setErr(data.error || "監査に失敗しました"); onResult?.(null); return; }
      setResult(data.result); setCached(!!data.cached);
      if (typeof data.remaining === "number") setRemaining(data.remaining);
      onResult?.(data.result?.overall ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "監査に失敗しました");
      onResult?.(null);
    } finally { setLoading(false); }
  };

  // step=2 表示と同時に起動（同ペアの再表示はキャッシュで無課金）
  useEffect(() => { void run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [job?.job_no, cand?.candidate_no]);

  const tone = result?.overall === "block" ? { fg: "#b42318", bg: "#fdecef", bd: "#f7c5cf", label: "🚫 送信前に要確認" }
    : result?.overall === "warn" ? { fg: "#b45309", bg: "#fff6e0", bd: "#fde9b0", label: "🟡 注意点あり" }
    : result?.overall === "ok" ? { fg: "#067647", bg: "#e7f7ee", bd: "#bfe3cc", label: "✅ 3軸とも問題なし" }
    : { fg: "var(--color-ink-3)", bg: "var(--color-surface-soft)", bd: "var(--color-border)", label: "監査中…" };

  const Item = ({ f }: { f: Finding }) => (
    <li style={{ fontSize: 12, padding: "4px 0", display: "flex", gap: 6, alignItems: "flex-start" }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: f.found ? "#067647" : "#b42318", minWidth: 18 }}>{f.found ? "✓" : "✕"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "var(--color-ink)" }}>{f.skill}</div>
        {f.evidence && <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>「{f.evidence}」</div>}
        {!f.found && !f.evidence && <div className="muted" style={{ fontSize: 11 }}>根拠が見つかりません</div>}
      </div>
    </li>
  );

  return (
    <div className="card" style={{ padding: 14, background: tone.bg, borderColor: tone.bd }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: result ? 10 : 0 }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: tone.fg }}>verified</span>
        <b style={{ fontSize: 13, color: tone.fg }}>提案前 多重チェック（AI監査）</b>
        <span style={{ fontSize: 12, fontWeight: 700, color: tone.fg }}>{tone.label}</span>
        {result?.summary && <span className="muted" style={{ fontSize: 11.5 }}>— {result.summary}</span>}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
          {cached && <span className="muted" style={{ fontSize: 11 }}>キャッシュ表示・回数消費なし</span>}
          {typeof remaining === "number" && !cached && <span className="muted" style={{ fontSize: 11 }}>本日残り {remaining} 回</span>}
          {loading && <span className="muted" style={{ fontSize: 11 }}>AI 監査中…</span>}
        </span>
      </div>
      {err && <div style={{ fontSize: 12, color: "var(--color-danger)" }}>{err}</div>}
      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-ink-2)", marginBottom: 4 }}>
              ① 必須スキル {result.required.filter((x) => x.found).length}/{result.required.length}
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {result.required.length === 0 ? <li className="muted" style={{ fontSize: 12 }}>（案件側に必須スキル抽出なし）</li> : result.required.map((f, i) => <Item key={`r${i}`} f={f} />)}
            </ul>
          </div>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-ink-2)", marginBottom: 4 }}>
              ② 尚可スキル {result.preferred.filter((x) => x.found).length}/{result.preferred.length || 0}
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {result.preferred.length === 0 ? <li className="muted" style={{ fontSize: 12 }}>（尚可セクションなし／該当なし）</li> : result.preferred.map((f, i) => <Item key={`p${i}`} f={f} />)}
            </ul>
            <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, color: "var(--color-ink-2)" }}>③ 経験業務カテゴリ</div>
            <div style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "flex-start" }}>
              <span style={{ fontWeight: 800, color: result.category.match ? "#067647" : "#b45309" }}>{result.category.match ? "✓ 一致" : "△ 要確認"}</span>
              <span className="muted" style={{ flex: 1 }}>{result.category.reason || "—"}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
