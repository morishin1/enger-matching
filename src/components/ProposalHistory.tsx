"use client";

// 提案履歴：マッチングから提案した全件を時系列で表示。
//   ・「いつ・誰が・誰に・どの案件を・どの結果」が1画面で分かる
//   ・進行中（提案済/返信待ち/面談調整 等）と終了（見送り/失注/稼働）を1つの履歴に混ぜる
//   ・終了した行はワンクリックでボードに戻せる
//   ・ステージ・期間で絞り込み可能

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { restoreProposal } from "@/lib/actions";
import { normalizeStage } from "@/lib/proposal-constants";

const STAGE_TONE: Record<string, { bg: string; fg: string }> = {
  所属確認:  { bg: "var(--color-surface-inset)", fg: "var(--color-ink-2)" },
  提案中:    { bg: "#eaf6fd", fg: "#0a6ea0" },
  面談:      { bg: "#fff5e6", fg: "#9a5b1a" },
  合格:      { bg: "#e7f7ee", fg: "#067647" },
  稼働:      { bg: "#e7f7ee", fg: "#067647" },
  稼働決定:  { bg: "#e7f7ee", fg: "#067647" },
  見送り:    { bg: "#fdecef", fg: "#b42318" },
  失注:      { bg: "#fdecef", fg: "#b42318" },
};
const TERMINAL = new Set(["見送り", "失注", "稼働", "稼働決定"]);

function fmtDateTime(d: any): string {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "—";
  const y = t.getFullYear(), mo = t.getMonth() + 1, da = t.getDate();
  const hh = String(t.getHours()).padStart(2, "0"), mm = String(t.getMinutes()).padStart(2, "0");
  return `${y}/${String(mo).padStart(2, "0")}/${String(da).padStart(2, "0")} ${hh}:${mm}`;
}
function fmtDate(d: any): string {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "—";
  return `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")}`;
}
// 終了行（見送り/失注）の失注日。stage_updated_at が無い旧データは updated_at にフォールバック。
function lostDateOf(p: any): number {
  const v = p?.stage_updated_at ?? p?.updated_at ?? null;
  const t = v ? new Date(v).getTime() : 0;
  return isNaN(t) ? 0 : t;
}
function relTime(d: any): string {
  if (!d) return "";
  const t = new Date(d).getTime();
  if (isNaN(t)) return "";
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60); if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60); if (h < 24) return `${h}時間前`;
  const day = Math.floor(h / 24); if (day < 7) return `${day}日前`;
  if (day < 30) return `${Math.floor(day / 7)}週間前`;
  if (day < 365) return `${Math.floor(day / 30)}か月前`;
  return `${Math.floor(day / 365)}年前`;
}

export function ProposalHistory({ items }: { items: any[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | "active" | "terminal">("all");
  const [period, setPeriod] = useState<"all" | "today" | "week" | "month">("all");
  // 失注日での絞り込み（from/to・yyyy-mm-dd）。どちらか入っていれば終了行(失注/見送り)のみに限定して検索する。
  const [lostFrom, setLostFrom] = useState("");
  const [lostTo, setLostTo] = useState("");
  const lostDateActive = !!(lostFrom || lostTo);

  const restore = (id: string, label: string) => {
    if (!confirm(`「${label}」をボードに戻しますか？（ステージ=所属確認に戻ります。稼働化済みの場合は稼働も取り消されます）`)) return;
    start(async () => { await restoreProposal(id); router.refresh(); });
  };

  // ステージ・期間・キーワード・失注日で絞り込み（時系列・新しい順）
  const filtered = useMemo(() => {
    const now = Date.now();
    const day = 86400000;
    const periodMs = period === "today" ? day : period === "week" ? 7 * day : period === "month" ? 30 * day : null;
    // 失注日レンジ（to は当日 23:59:59 まで含める）
    const fromMs = lostFrom ? new Date(lostFrom + "T00:00:00").getTime() : null;
    const toMs = lostTo ? new Date(lostTo + "T23:59:59").getTime() : null;
    return items
      .filter((p) => {
        const isTerm = TERMINAL.has(p.stage);
        if (q.trim() && !(p.candidate_name ?? "").includes(q.trim())
          && !(p.company ?? "").includes(q.trim())
          && !(p.job_title ?? "").includes(q.trim())
          && !(p.proposer ?? "").includes(q.trim())
          && !(p.closer ?? "").includes(q.trim())
          && !(isTerm ? fmtDate(lostDateOf(p)) : "").includes(q.trim())) return false;
        // 失注日フィルタが有効なときは終了行(失注/見送り)のみを対象にし、失注日でレンジ判定
        if (lostDateActive) {
          if (!isTerm) return false;
          const ld = lostDateOf(p);
          if (!ld) return false;
          if (fromMs != null && ld < fromMs) return false;
          if (toMs != null && ld > toMs) return false;
        }
        if (stageFilter === "active" && isTerm) return false;
        if (stageFilter === "terminal" && !isTerm) return false;
        if (periodMs) {
          const t = new Date(p.created_at ?? p.updated_at ?? 0).getTime();
          if (isNaN(t) || now - t > periodMs) return false;
        }
        return true;
      })
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  }, [items, q, stageFilter, period, lostFrom, lostTo, lostDateActive]);

  const stageDisplay = (raw: string | null | undefined): { label: string; tone: { bg: string; fg: string } } => {
    if (raw && TERMINAL.has(raw)) return { label: raw, tone: STAGE_TONE[raw] ?? STAGE_TONE.提案中 };
    const norm = normalizeStage(raw);
    return { label: norm, tone: STAGE_TONE[norm] ?? STAGE_TONE.提案中 };
  };

  const td = { padding: "8px 10px", borderTop: "1px solid var(--color-border)", verticalAlign: "top" } as const;
  const chip = (on: boolean) => ({
    padding: "5px 10px", borderRadius: 99, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
    background: on ? "var(--color-brand-600)" : "var(--color-surface)",
    color: on ? "#fff" : "var(--color-ink-3)",
    border: `1px solid ${on ? "var(--color-brand-600)" : "var(--color-border)"}`,
  });

  return (
    <div className="card flush">
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, borderBottom: "1px solid var(--color-border)" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>🕘 提案履歴</h3>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>マッチングから提案した全件。誰がいつ提案し、いま何ステージか時系列で確認。</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={chip(stageFilter === "all")} onClick={() => setStageFilter("all")}>すべて</button>
          <button type="button" style={chip(stageFilter === "active")} onClick={() => setStageFilter("active")}>進行中</button>
          <button type="button" style={chip(stageFilter === "terminal")} onClick={() => setStageFilter("terminal")}>終了済</button>
          <span style={{ width: 8 }} />
          <button type="button" style={chip(period === "all")} onClick={() => setPeriod("all")}>全期間</button>
          <button type="button" style={chip(period === "today")} onClick={() => setPeriod("today")}>今日</button>
          <button type="button" style={chip(period === "week")} onClick={() => setPeriod("week")}>1週間</button>
          <button type="button" style={chip(period === "month")} onClick={() => setPeriod("month")}>1ヶ月</button>
        </div>
      </div>

      <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input placeholder="人材・企業・案件・提案者・失注日で検索…" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ fontFamily: "inherit", fontSize: 12.5, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", minWidth: 240, flex: 1, maxWidth: 360 }} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--color-ink-3)" }}>
          失注日
          <input type="date" value={lostFrom} onChange={(e) => setLostFrom(e.target.value)} title="失注日（開始）"
            style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 8px", borderRadius: 8, border: `1px solid ${lostDateActive ? "var(--color-brand-600)" : "var(--color-border-strong)"}`, background: "var(--color-surface)" }} />
          <span className="muted">〜</span>
          <input type="date" value={lostTo} onChange={(e) => setLostTo(e.target.value)} title="失注日（終了）"
            style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 8px", borderRadius: 8, border: `1px solid ${lostDateActive ? "var(--color-brand-600)" : "var(--color-border-strong)"}`, background: "var(--color-surface)" }} />
          {lostDateActive && <button type="button" className="btn ghost btn-xs" onClick={() => { setLostFrom(""); setLostTo(""); }} title="失注日フィルタを解除">解除</button>}
        </label>
        <span className="muted" style={{ fontSize: 11.5 }}>{filtered.length} 件 / 全 {items.length} 件</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--color-ink-4)", fontSize: 13 }}>
          条件に合う提案がありません。マッチングから提案するとここに時系列で記録されます。
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 1010 }}>
            <thead>
              <tr style={{ color: "var(--color-ink-4)", fontSize: 11, background: "var(--color-surface-soft)" }}>
                <th style={{ padding: "8px 10px", textAlign: "left", width: 168 }}>提案日時</th>
                <th style={{ padding: "8px 10px", textAlign: "left", width: 120 }}>提案者 / CL</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>人材</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>企業 / 案件</th>
                <th style={{ padding: "8px 10px", textAlign: "left", width: 110 }}>現在ステージ</th>
                <th style={{ padding: "8px 10px", textAlign: "left", width: 96 }}>失注日</th>
                <th style={{ padding: "8px 10px", textAlign: "left", width: 200 }}>備考</th>
                <th style={{ padding: "8px 10px", textAlign: "right", width: 132 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 400).map((p) => {
                const stg = stageDisplay(p.stage);
                const isTerm = TERMINAL.has(p.stage);
                return (
                  <tr key={p.id}>
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>{fmtDateTime(p.created_at)}</div>
                      <div className="muted" style={{ fontSize: 10.5 }}>{relTime(p.created_at)}</div>
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{p.proposer || "—"}</div>
                      {p.closer && p.closer !== p.proposer && (
                        <div className="muted" style={{ fontSize: 10.5 }}>CL: {p.closer}</div>
                      )}
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>{p.candidate_name ?? "—"}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{p.company ?? "—"}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{p.job_title ?? ""}</div>
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: stg.tone.bg, color: stg.tone.fg }}>{stg.label}</span>
                      {p.stage_updated_at && (
                        <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>更新 {relTime(p.stage_updated_at)}</div>
                      )}
                    </td>
                    <td style={td}>
                      {isTerm ? (
                        <>
                          <div className="mono" style={{ fontWeight: 700, color: "#b42318" }}>{fmtDate(lostDateOf(p))}</div>
                          <div className="muted" style={{ fontSize: 10 }}>{relTime(lostDateOf(p))}</div>
                        </>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td style={{ ...td, color: "var(--color-ink-3)" }}>
                      {isTerm && p.lost_reason ? (
                        <>
                          <div>{p.lost_reason}</div>
                          {p.lost_reason_note && <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", marginTop: 2, whiteSpace: "pre-wrap" }}>「{p.lost_reason_note}」</div>}
                        </>
                      ) : p.rate ? <span className="mono">{p.rate}</span> : <span className="muted">—</span>}
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      {/* 失注後に上位/下位企業から再提案・再エントリーがあったとき、ワンクリックで提案画面へ */}
                      {isTerm && p.job_no != null && (
                        <Link href={`/matching?job=${p.job_no}${p.candidate_no != null ? `&cand=${p.candidate_no}` : ""}`}
                          className="btn ghost btn-xs" style={{ textDecoration: "none", marginRight: 4 }}
                          title="この案件×人材の組み合わせで提案画面（マッチング）を開く">→ 提案画面</Link>
                      )}
                      {isTerm && (
                        <button className="btn ghost btn-xs" disabled={pending} onClick={() => restore(p.id, `${p.candidate_name ?? ""} × ${p.job_title ?? ""}`)}>↩ 戻す</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > 400 && (
            <div style={{ padding: 10, textAlign: "center", fontSize: 11, color: "var(--color-ink-4)" }}>※ 直近400件まで表示しています。期間で絞り込んでください。</div>
          )}
        </div>
      )}
    </div>
  );
}
