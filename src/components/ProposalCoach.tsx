"use client";

// 提案ボードの「AIコーチ」と「コピー」ボタンのペア。
//   - 🧠 AIコーチ : 押すと /api/proposals-coach を呼び、Sonnet が当日の提案を分析した
//     講評（総評/優先/リスク/担当者別/次の一手）をモーダルで表示。1回 約3円。
//   - 📋 コピー   : クリックでクリップボードへプロンプトをコピー。そのまま claude.ai
//     （Opus 等）に貼り付ければ深い分析が得られる。API課金は発生しない。

import { useState } from "react";

type CoachResult = {
  headline: string; summary: string;
  priorities: string[]; risks: string[]; by_proposer: string[]; next_actions: string[];
};

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// Claude（Opus 等）にそのまま貼り付けて分析させるためのプロンプトを組み立てる。
//   提案者・案件名・滞留日数 等を含めるが、氏名はイニシャルなど匿名寄りに留める。
function buildCoachPrompt(proposals: any[], periodLabel: string): string {
  const compact = proposals.slice(0, 80).map((p) => ({
    案件: (p.job_title ?? "").slice(0, 40) || "—",
    企業: (p.company ?? "").slice(0, 24) || "—",
    人材: (p.c_init ?? p.candidate_name ?? "—"),
    ステージ: p.stage ?? "—",
    提案者: p.proposer ?? "未割当",
    CL: p.closer ?? "未割当",
    架電: p.caller_status ?? "—",
    面談: p.meeting_status ?? "—",
    スコア: p.score ?? null,
    単価: p.rate ?? null,
    滞留日数: daysSince(p.stage_updated_at ?? p.created_at),
  }));
  return [
    "あなたはSES/エンジニア人材事業の営業マネージャーです。以下は当社の提案管理ボードの一覧です。",
    `対象期間: ${periodLabel} / 提案 ${compact.length}件。`,
    "次の観点で、現場がすぐ動ける具体的な講評をしてください：",
    "1) 全体の総評（良い点と課題）",
    "2) 🔥 今すぐ着手すべき提案（滞留日数が大きい・未架電・CL未割当・スコアが高いのに動いていない 等を優先）",
    "3) ⚠ 放置リスク・取りこぼし懸念",
    "4) 👤 提案者ごとの傾向と助言",
    "5) ✅ チームの次の一手",
    "案件名・企業名を挙げ、なぜ優先かを一言添えてください。",
    "",
    "── 提案リスト(JSON) ──",
    JSON.stringify(compact, null, 1),
  ].join("\n");
}

/** AIコーチ＋コピーの2ボタンを並べて返すまとまり。ProposalBoardSwitcher から1個だけ呼べばOK。 */
export function ProposalCoach({ proposals, periodLabel = "本日" }: { proposals: any[]; periodLabel?: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <ProposalCoachAiButton proposals={proposals} periodLabel={periodLabel} />
      <ProposalCoachCopyButton proposals={proposals} periodLabel={periodLabel} />
    </span>
  );
}

/** 🧠 AIコーチボタン：まず機能説明モーダル → OKでAPI（Sonnet）分析しモーダル表示。 */
function ProposalCoachAiButton({ proposals, periodLabel }: { proposals: any[]; periodLabel: string }) {
  const [confirmOpen, setConfirmOpen] = useState(false); // 機能説明（実行前の確認）
  const [open, setOpen] = useState(false);               // 分析結果モーダル
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CoachResult | null>(null);
  const [meta, setMeta] = useState<{ analyzed: number; costJpy: number } | null>(null);
  const disabled = proposals.length === 0;

  const run = async () => {
    setConfirmOpen(false);
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
      <button type="button" onClick={() => setConfirmOpen(true)} disabled={loading || disabled}
        title={disabled ? "分析対象の提案がありません" : "AIが提案リストを分析して講評します（押すと説明が表示されます）"}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8,
          border: "1px solid #7c5cff", background: "linear-gradient(135deg,#7c5cff,#5b8cff)", color: "#fff", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>neurology</span>
        {loading ? "分析中…" : "AIコーチ"}
      </button>

      {/* 機能説明モーダル（実行前の確認）。OKで初めてAIが分析を開始する。 */}
      {confirmOpen && (
        <div onClick={() => setConfirmOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 330, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 24, color: "#7c5cff" }}>neurology</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>AIコーチで分析しますか？</h3>
            </div>
            <div style={{ background: "linear-gradient(135deg,#f3f0ff,#eef3ff)", border: "1px solid #ddd6fe", borderRadius: 12, padding: "12px 14px", fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.8 }}>
              いま表示中（<b>{periodLabel}</b>・<b>{proposals.length}件</b>）の提案を AI が分析し、以下を講評します：
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
                <li>🔥 今すぐ着手すべき提案（滞留・未架電・高スコア等）</li>
                <li>⚠ 放置リスク・取りこぼし懸念</li>
                <li>👤 担当者ごとの傾向とアドバイス</li>
                <li>✅ チームの次の一手</li>
              </ul>
            </div>
            <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
              ※ 生成AI（Sonnet）を使用します。1回あたり概算 <b>約3円</b>のコストが発生します。<br />
              ※ 課金なしで使いたい場合は、隣の「コピー」から claude.ai 等に貼り付けて分析できます。
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost" onClick={() => setConfirmOpen(false)}>キャンセル</button>
              <button type="button" onClick={run}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 13, fontWeight: 700, padding: "8px 18px", borderRadius: 8, border: "1px solid #7c5cff", background: "linear-gradient(135deg,#7c5cff,#5b8cff)", color: "#fff", cursor: "pointer" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 17, lineHeight: 1 }}>auto_awesome</span>
                OK・分析する
              </button>
            </div>
          </div>
        </div>
      )}

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

/** 📋 コピー：プロンプトをクリップボードへ。そのまま claude.ai 等に貼り付け可。 */
function ProposalCoachCopyButton({ proposals, periodLabel }: { proposals: any[]; periodLabel: string }) {
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const disabled = proposals.length === 0;

  const onClick = async () => {
    setErr(null);
    try {
      await navigator.clipboard.writeText(buildCoachPrompt(proposals, periodLabel));
      setCopied(true); setTimeout(() => setCopied(false), 2500);
    } catch {
      setErr("コピーに失敗しました（ブラウザの権限を確認してください）");
    }
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button type="button" onClick={onClick} disabled={disabled}
        title={disabled ? "コピー対象の提案がありません" : "そのまま claude.ai（Opus 等）に貼り付けて分析できるプロンプトをコピーします"}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8,
          border: "1px solid " + (copied ? "#bfe3cc" : "var(--color-border-strong)"),
          background: copied ? "#eef8f1" : "var(--color-surface)",
          color: copied ? "#067647" : "var(--color-ink-2)",
          cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>{copied ? "check" : "content_copy"}</span>
        {copied ? "コピー済" : "コピー"}
      </button>
      {err && <span style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, fontSize: 11, color: "var(--color-danger)", whiteSpace: "nowrap" }}>{err}</span>}
    </span>
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
