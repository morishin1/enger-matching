"use client";

// 提案管理のリスト型ビュー（過去に作った見やすい型を再現）。
//   - 上部に ステージ別 KPI カード（クリックで絞り込み）
//   - 人材/案件/クライアントの検索
//   - ステージ・担当者での絞り込み
//   - テーブル（行クリックで詳細モーダル）
// カンバン(ProposalBoard)と同じ proposals データを使う。切替は ProposalBoardSwitcher が担う。
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProposalDetailModal } from "./ProposalDetailModal";
import { NotifyChip } from "./NotifyDot";
import { deleteProposal } from "@/lib/actions";
import { PROPOSAL_STAGES } from "@/lib/proposal-constants";

const STAGES = [...PROPOSAL_STAGES];
const STAGE_TONE: Record<string, string> = {
  返信待ち: "#6b7280", 提案中: "#0095D9", 面談調整: "#d98a2b", クロージング中: "#e0567f", 面談合格: "#1aa260",
};
const normStage = (s: string | null | undefined) => (s && (STAGES as readonly string[]).includes(s) ? s : "返信待ち");
const fmtDate = (d: any) => { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")}`; };

function StageBadge({ stage }: { stage: string }) {
  const tone = STAGE_TONE[stage] ?? "#6b7280";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: `${tone}14`, color: tone }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: tone }} />{stage}
    </span>
  );
}

export function ProposalListView({ proposals }: { proposals: any[]; members?: string[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("");
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [active, setActive] = useState<any | null>(null);
  const isPending = (v: any) => v == null || v === "pending";

  const handleDelete = (p: any) => {
    if (!confirm(`「${p.candidate_name ?? "—"} × ${p.job_title ?? "—"}」の提案を削除しますか？\n（記録ミスの取り消し。元に戻せません）`)) return;
    setBusyId(p.id);
    start(async () => {
      const r = await deleteProposal(p.id);
      setBusyId(null);
      if (!r.ok) { alert(("error" in r ? r.error : null) || "削除に失敗しました"); return; }
      router.refresh();
    });
  };
  const pendingCount = useMemo(() => proposals.filter((p) => isPending(p.job_notify_status) || isPending(p.cand_notify_status)).length, [proposals]);

  // ステージ別件数（KPI）
  const counts = useMemo(() => {
    const m: Record<string, number> = Object.fromEntries(STAGES.map((s) => [s, 0]));
    for (const p of proposals) m[normStage(p.stage)] = (m[normStage(p.stage)] ?? 0) + 1;
    return m;
  }, [proposals]);

  // 担当者の選択肢（提案者・パートナー・クロージングをまとめて）
  const owners = useMemo(() => {
    const set = new Set<string>();
    for (const p of proposals) { for (const k of [p.proposer, p.partner, p.closer, p.company_owner]) if (k) set.add(k); }
    return [...set].sort();
  }, [proposals]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return proposals
      .filter((p) => !stageFilter || normStage(p.stage) === stageFilter)
      .filter((p) => !ownerFilter || [p.proposer, p.partner, p.closer, p.company_owner].includes(ownerFilter))
      .filter((p) => !pendingOnly || isPending(p.job_notify_status) || isPending(p.cand_notify_status))
      .filter((p) => {
        if (!needle) return true;
        return [p.candidate_name, p.c_init, p.job_title, p.company, p.client_contact].some((v) => String(v ?? "").toLowerCase().includes(needle));
      })
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  }, [proposals, q, stageFilter, ownerFilter, pendingOnly]);

  const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px 12px", fontSize: 12.5, verticalAlign: "middle" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* KPI カード（ステージ別・クリックで絞り込み） */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(140px, 1fr))`, gap: 10, overflowX: "auto" }}>
        {STAGES.map((s) => {
          const tone = STAGE_TONE[s] ?? "#6b7280";
          const on = stageFilter === s;
          return (
            <button key={s} type="button" onClick={() => setStageFilter(on ? "" : s)} title={on ? "絞り込み解除" : `「${s}」で絞り込み`}
              className="card" style={{ textAlign: "left", padding: 14, cursor: "pointer", border: on ? `2px solid ${tone}` : "1px solid var(--color-border)", background: on ? `${tone}0d` : "var(--color-surface)", fontFamily: "inherit" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: tone }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: tone }} />{s}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 6 }}>
                <span className="tnum" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{counts[s] ?? 0}</span>
                <span className="muted" style={{ fontSize: 11 }}>件</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* 検索 + フィルタ */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 320px", minWidth: 240 }}>
          <span className="material-symbols-outlined" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 18, color: "var(--color-ink-4)" }}>search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="人材名・案件名・クライアントで検索…"
            style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "10px 12px 10px 38px", borderRadius: 10, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-ink-3)" }}>
          ステータス
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} style={{ fontFamily: "inherit", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            <option value="">すべて</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-ink-3)" }}>
          担当者
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} style={{ fontFamily: "inherit", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            <option value="">すべて</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setPendingOnly((v) => !v)} aria-pressed={pendingOnly}
          title="未処理（赤ドット）の提案だけを表示"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 8,
            border: "1px solid " + (pendingOnly ? "#dc2626" : "var(--color-border-strong)"),
            background: pendingOnly ? "#dc2626" : "var(--color-surface)", color: pendingOnly ? "#fff" : "var(--color-ink-2)", cursor: "pointer" }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: pendingOnly ? "#fff" : "#dc2626" }} />
          未処理のみ <span style={{ opacity: 0.85 }}>({pendingCount})</span>
        </button>
      </div>

      {/* テーブル */}
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <th style={th}>提案日</th>
              <th style={th}>人材</th>
              <th style={th}>案件</th>
              <th style={th}>担当者</th>
              <th style={th}>更新日</th>
              <th style={th}>ステータス</th>
              <th style={th}>通知</th>
              <th style={{ ...th, textAlign: "center" }}>詳細</th>
              <th style={{ ...th, textAlign: "center" }}>削除</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: "var(--color-ink-4)", padding: 36 }}>該当する提案がありません。</td></tr>
            )}
            {rows.map((p) => (
              <tr key={p.id} onClick={() => setActive(p)} style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer", opacity: busyId === p.id ? 0.5 : 1 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-soft)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <td style={{ ...td, whiteSpace: "nowrap", color: "var(--color-ink-3)" }}>{fmtDate(p.created_at)}</td>
                <td style={td}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="ava" style={{ width: 30, height: 30, fontSize: 11, flexShrink: 0 }}>{p.c_init || (p.candidate_name ?? "?").slice(0, 2)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{p.candidate_name ?? "—"}</div>
                    </div>
                  </div>
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{p.job_title ?? "—"}</div>
                  <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{p.company ?? ""}</div>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{p.proposer ?? p.company_owner ?? "—"}</td>
                <td style={{ ...td, whiteSpace: "nowrap", color: "var(--color-ink-3)" }}>{fmtDate(p.updated_at ?? p.stage_updated_at ?? p.created_at)}</td>
                <td style={td}><StageBadge stage={normStage(p.stage)} /></td>
                <td style={td}>
                  <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                    <NotifyChip status={p.job_notify_status}  side="job"  proposalId={p.id} />
                    <NotifyChip status={p.cand_notify_status} side="cand" proposalId={p.id} />
                  </div>
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setActive(p); }} className="btn ghost btn-xs" aria-label="詳細を開く" title="詳細を開く">
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-brand-700)" }}>mail</span>
                  </button>
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(p); }} className="btn ghost btn-xs" aria-label="提案を削除" title="提案を削除（元に戻せません）" disabled={busy && busyId === p.id}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-danger)" }}>delete</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ fontSize: 11.5 }}>{rows.length} 件を表示中{stageFilter || ownerFilter || q ? "（絞り込み適用中）" : ""}</div>

      {active && <ProposalDetailModal p={active} onClose={() => setActive(null)} />}
    </div>
  );
}
