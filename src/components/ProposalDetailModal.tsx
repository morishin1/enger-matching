"use client";

// 提案の詳細モーダル（リスト型ビュー用）。
//   - ステージのステッパー（クリックで移動）
//   - 人材情報 / 案件情報
//   - 対応履歴（提案開始・架電・面談）
//   - 編集フィールド（提案者/パートナー/クロージング/架電/面談）と保存・稼働化・見送り
//   既存のサーバアクションを再利用（カンバンの編集パネルと同等の操作を提供）。
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateProposalStage, convertToEngagement, updateProposalFields, deleteProposalMemo, deleteProposal } from "@/lib/actions";
import { gmailMessageUrl } from "@/lib/gmail";
import { NotifyDot, NOTIFY_LABEL, type NotifyStatus } from "./NotifyDot";
import { ProposalMemoModal, memoCategoryTone } from "./ProposalMemoModal";
import { ProposalMeetingModal } from "./ProposalMeetingModal";
import { PROPOSAL_STAGES, CALLER_STATUSES, MEETING_STATUSES, PROPOSERS, CLOSERS, LOST_PHASES, LOST_REASONS } from "@/lib/proposal-constants";

const STAGES = [...PROPOSAL_STAGES];
const STAGE_TONE: Record<string, string> = {
  返信待ち: "#6b7280", 提案中: "#0095D9", 面談調整: "#d98a2b", クロージング中: "#e0567f", 面談合格: "#1aa260",
};
const fmtDateTime = (d: any) => { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`; };

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--color-border)", fontSize: 12.5 }}>
      <span style={{ width: 84, flexShrink: 0, color: "var(--color-ink-4)" }}>{label}</span>
      <span style={{ fontWeight: 600, color: "var(--color-ink)" }}>{value ?? "—"}</span>
    </div>
  );
}

function SelField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: "inherit", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

export function ProposalDetailModal({ p, onClose }: { p: any; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [caller, setCaller] = useState(p.caller_status ?? "");
  const [proposer, setProposer] = useState(p.proposer ?? "");
  const [partner, setPartner] = useState(p.partner ?? "");
  const [closer, setCloser] = useState(p.closer ?? p.company_owner ?? "");
  const [meetingDate, setMeetingDate] = useState(p.meeting_date ?? "");
  const [meetingStatus, setMeetingStatus] = useState(p.meeting_status ?? "");
  const [lostOpen, setLostOpen] = useState(false);
  const [lostPhase, setLostPhase] = useState(p.lost_phase ?? "");
  const [lostReason, setLostReason] = useState(p.lost_reason ?? "");
  const [lostNote, setLostNote] = useState(p.lost_reason_note ?? "");

  const stageIdx = Math.max(0, STAGES.indexOf(p.stage));
  const needsLostNote = lostReason === "E3: その他";
  const lostReady = !!lostReason && (!needsLostNote || lostNote.trim().length > 0);

  // Esc で閉じる
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // ステータス更新ドロップダウン
  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const stageMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!stageMenuOpen) return;
    const h = (e: MouseEvent) => { if (stageMenuRef.current && !stageMenuRef.current.contains(e.target as Node)) setStageMenuOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [stageMenuOpen]);

  // メモ
  type Memo = { id: string; category: string; body: string; created_at: string; created_by_name?: string | null; created_by_email?: string | null };
  const [memos, setMemos] = useState<Memo[]>([]);
  const [memosLoading, setMemosLoading] = useState(false);
  const [memoModalOpen, setMemoModalOpen] = useState(false);
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const loadMemos = () => {
    setMemosLoading(true);
    fetch(`/api/proposals/${p.id}/memos`).then((r) => r.json()).then((d) => {
      if (d.ok) setMemos(d.memos as Memo[]);
    }).catch(() => {}).finally(() => setMemosLoading(false));
  };
  useEffect(() => { loadMemos(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [p.id]);
  const onDeleteMemo = (mid: string) => {
    if (!confirm("このメモを削除しますか？")) return;
    start(async () => { const r = await deleteProposalMemo(mid); if (r.ok) loadMemos(); else alert(r.error || "削除に失敗しました"); });
  };

  const run = (fn: () => Promise<any>) => start(async () => { await fn(); router.refresh(); });
  const moveTo = (stage: string) => { if (stage !== p.stage) run(() => updateProposalStage(p.id, stage)); };
  const saveFields = () => run(() => updateProposalFields(p.id, { caller_status: caller || null, proposer: proposer || null, partner: partner || null, closer: closer || null, meeting_date: meetingDate || null, meeting_status: meetingStatus || null }));
  // ステータス更新ドロップダウンからの選択：フォーム項目もまとめて保存しつつステージ遷移する。
  const pickStage = (stage: string) => {
    setStageMenuOpen(false);
    if (stage === "見送り") { setLostOpen(true); return; }
    run(() => updateProposalFields(p.id, {
      stage,
      caller_status: caller || null, proposer: proposer || null, partner: partner || null, closer: closer || null,
      meeting_date: meetingDate || null, meeting_status: meetingStatus || null,
    }));
  };
  const engage = () => run(() => convertToEngagement(p.id));
  const lose = () => run(() => updateProposalFields(p.id, { stage: "見送り", lost_phase: lostPhase, lost_reason: lostReason, lost_reason_note: lostNote.trim() || null }));
  const removeProposal = () => {
    if (!confirm(`「${p.candidate_name ?? "—"} × ${p.job_title ?? "—"}」の提案を削除しますか？\n（記録ミスの取り消し。元に戻せません）`)) return;
    start(async () => {
      const r = await deleteProposal(p.id);
      if (!r.ok) { alert(("error" in r ? r.error : null) || "削除に失敗しました"); return; }
      router.refresh();
      onClose();
    });
  };

  const matchPct = p.score != null ? Math.round(Number(p.score)) : null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,36,64,.45)", display: "grid", placeItems: "center", padding: 20, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(960px, 96vw)", maxHeight: "92vh", overflowY: "auto", padding: 0, background: "var(--color-surface)" }}>
        {/* ヘッダ */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", padding: "16px 22px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div className="muted" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>提案管理 <span style={{ opacity: .5 }}>›</span> 詳細</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{p.c_init || (p.candidate_name ?? "—")} <span style={{ color: "var(--color-ink-4)", margin: "0 6px" }}>/</span> {p.job_title ?? "—"}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {matchPct != null && (
              <div style={{ textAlign: "center", background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 10, padding: "6px 14px" }}>
                <div className="muted" style={{ fontSize: 10 }}>マッチ度</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--color-brand-700)", lineHeight: 1.1 }}>{matchPct}<span style={{ fontSize: 11 }}>%</span></div>
              </div>
            )}
            <button type="button" onClick={onClose} className="btn ghost" aria-label="閉じる" style={{ fontSize: 18, lineHeight: 1, padding: "6px 10px" }}>×</button>
          </div>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
          {/* ステッパー */}
          <div style={{ background: "var(--color-surface-soft)", borderRadius: 12, padding: "18px 16px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
              {STAGES.map((s, i) => {
                const done = i < stageIdx, current = i === stageIdx;
                const tone = STAGE_TONE[s] ?? "#6b7280";
                return (
                  <div key={s} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, position: "relative" }}>
                    {i > 0 && <div style={{ position: "absolute", top: 13, right: "50%", width: "100%", height: 2, background: i <= stageIdx ? tone : "var(--color-border)" }} />}
                    <button type="button" onClick={() => moveTo(s)} disabled={pending} title={`「${s}」へ移動`}
                      style={{ position: "relative", zIndex: 1, width: 28, height: 28, borderRadius: 99, border: current ? `2px solid ${tone}` : "2px solid transparent",
                        background: current ? tone : done ? tone : "var(--color-surface)", color: current || done ? "#fff" : "var(--color-ink-4)",
                        boxShadow: current ? `0 0 0 4px ${tone}22` : "none", fontWeight: 800, fontSize: 12, cursor: pending ? "wait" : "pointer", fontFamily: "inherit",
                        outline: !current && !done ? "1px solid var(--color-border-strong)" : "none" }}>
                      {done ? "✓" : i + 1}
                    </button>
                    <span style={{ fontSize: 10.5, fontWeight: current ? 800 : 600, color: current ? tone : "var(--color-ink-3)", textAlign: "center", lineHeight: 1.3 }}>{s}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 人材情報 / 案件情報 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 11.5 }}>人材情報</div>
                {(() => { const url = gmailMessageUrl(p.cand_source_mail_url); return (
                  <a href={url ?? undefined} target="_blank" rel="noopener noreferrer" className="btn ghost btn-xs"
                    style={{ textDecoration: "none", opacity: url ? 1 : 0.35, pointerEvents: url ? "auto" : "none", cursor: url ? "pointer" : "not-allowed" }}
                    title={url ? "人材の元メールを開く" : "元メールURLがありません"} aria-disabled={!url}>↗ 元メール</a>
                ); })()}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div className="ava" style={{ width: 38, height: 38, fontSize: 13 }}>{p.c_init || (p.candidate_name ?? "?").slice(0, 2)}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {p.candidate_no != null ? <Link href={`/people/${p.candidate_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{p.candidate_name ?? "—"}</Link> : (p.candidate_name ?? "—")}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{p.source ? `登録元: ${p.source}` : ""}</div>
                </div>
              </div>
              <Info label="想定単価" value={p.rate ?? "—"} />
              <Info label="マッチ度" value={matchPct != null ? `${matchPct}%` : "—"} />
              <Info label="架電進捗" value={p.caller_status ?? "—"} />
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 11.5 }}>案件情報</div>
                {(() => { const url = gmailMessageUrl(p.job_source_mail_url); return (
                  <a href={url ?? undefined} target="_blank" rel="noopener noreferrer" className="btn ghost btn-xs"
                    style={{ textDecoration: "none", opacity: url ? 1 : 0.35, pointerEvents: url ? "auto" : "none", cursor: url ? "pointer" : "not-allowed" }}
                    title={url ? "案件の元メールを開く" : "元メールURLがありません"} aria-disabled={!url}>↗ 元メール</a>
                ); })()}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                {p.job_no != null ? <Link href={`/jobs/${p.job_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{p.job_title ?? "—"}</Link> : (p.job_title ?? "—")}
              </div>
              <Info label="クライアント" value={p.company ?? "—"} />
              <Info label="先方担当" value={p.client_contact ?? "—"} />
              <Info label="企業担当" value={p.company_owner ?? "—"} />
            </div>
          </div>

          {/* 対応履歴 */}
          <div className="card" style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>対応履歴</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-ink-4)" }}>schedule</span>
                <span>提案を開始しました。</span>
                <span className="muted" style={{ marginLeft: "auto", fontSize: 11 }}>{fmtDateTime(p.created_at)}</span>
              </div>
              {(p.meeting_date || p.meeting_status) && (
                <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#b45309" }}>event</span>
                  <span>面談: {[p.meeting_date, p.meeting_status].filter(Boolean).join(" ")}</span>
                </div>
              )}
              {p.lost_reason && (
                <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color: "var(--color-danger)" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>cancel</span>
                  <span>失注: {p.lost_reason}{p.lost_reason_note ? `（${p.lost_reason_note}）` : ""}</span>
                </div>
              )}
            </div>
          </div>

          {/* 面談履歴（現在設定されている面談の詳細） */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div className="muted" style={{ fontSize: 11.5 }}>面談履歴</div>
              <button type="button" className="btn ghost btn-sm" onClick={() => setMeetingModalOpen(true)} title="面談の日時・形式・URL・参加者・備考を設定">
                <span className="material-symbols-outlined" style={{ fontSize: 15, marginRight: 4, verticalAlign: "-2px" }}>event</span>
                面談設定
              </button>
            </div>
            {!p.meeting_date && !p.meeting_status && !p.meeting_format ? (
              <div className="muted" style={{ fontSize: 12 }}>面談の記録はありません</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", rowGap: 6, columnGap: 12, fontSize: 12.5 }}>
                <span style={{ color: "var(--color-ink-4)" }}>日時</span>
                <span style={{ fontWeight: 600 }}>{[p.meeting_date, p.meeting_time].filter(Boolean).join(" ") || "—"}{p.meeting_status ? <span style={{ marginLeft: 8, fontSize: 11, padding: "1px 8px", borderRadius: 99, background: "#fff1e6", color: "#b45309", fontWeight: 700 }}>{p.meeting_status}</span> : null}</span>
                {p.meeting_format && (<><span style={{ color: "var(--color-ink-4)" }}>形式</span><span style={{ fontWeight: 600 }}>{p.meeting_format}</span></>)}
                {p.meeting_url && (<><span style={{ color: "var(--color-ink-4)" }}>URL</span><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}><a href={p.meeting_url} target="_blank" rel="noreferrer" style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{p.meeting_url}</a></span></>)}
                {p.meeting_attendees && (<><span style={{ color: "var(--color-ink-4)" }}>参加者</span><span>{p.meeting_attendees}</span></>)}
                {p.meeting_note && (<><span style={{ color: "var(--color-ink-4)" }}>備考</span><span style={{ whiteSpace: "pre-wrap" }}>{p.meeting_note}</span></>)}
              </div>
            )}
          </div>

          {/* メモ履歴（カテゴリ別の対応ログ） */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div className="muted" style={{ fontSize: 11.5 }}>メモ履歴 {memos.length > 0 && <span style={{ marginLeft: 4 }}>({memos.length})</span>}</div>
              <button type="button" className="btn ghost btn-sm" onClick={() => setMemoModalOpen(true)} title="新しいメモを追加">
                <span className="material-symbols-outlined" style={{ fontSize: 15, marginRight: 4, verticalAlign: "-2px" }}>edit_note</span>
                メモ追加
              </button>
            </div>
            {memosLoading ? (
              <div className="muted" style={{ fontSize: 12 }}>読み込み中…</div>
            ) : memos.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>メモはまだありません。</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {memos.map((m) => {
                  const tone = memoCategoryTone(m.category);
                  const dt = new Date(m.created_at);
                  const dtStr = isNaN(dt.getTime()) ? "—" : `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
                  const author = m.created_by_name || (m.created_by_email ? m.created_by_email.split("@")[0] : "");
                  return (
                    <div key={m.id} style={{ borderLeft: `3px solid ${tone.fg}`, paddingLeft: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: tone.bg, color: tone.fg }}>{m.category}</span>
                        {author && <span className="muted" style={{ fontSize: 11 }}>{author}</span>}
                        <button type="button" onClick={() => onDeleteMemo(m.id)} className="btn ghost btn-xs" title="メモを削除" style={{ marginLeft: "auto", color: "var(--color-danger)" }}>削除</button>
                      </div>
                      <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", color: "var(--color-ink)" }}>{m.body}</div>
                      <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>{dtStr}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 通知ステータス（案件側 / 人材側） — ドットで「やってない / 処理中 / 完了」を示す */}
          <div className="card" style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>通知ステータス</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12.5, color: "var(--color-ink-3)", minWidth: 36 }}>案件</span>
                <NotifyDot status={p.job_notify_status} side="job" proposalId={p.id} size={14} />
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{NOTIFY_LABEL[((p.job_notify_status === "in_progress" || p.job_notify_status === "done") ? p.job_notify_status : "pending") as NotifyStatus]}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12.5, color: "var(--color-ink-3)", minWidth: 36 }}>人材</span>
                <NotifyDot status={p.cand_notify_status} side="cand" proposalId={p.id} size={14} />
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{NOTIFY_LABEL[((p.cand_notify_status === "in_progress" || p.cand_notify_status === "done") ? p.cand_notify_status : "pending") as NotifyStatus]}</span>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>ドットをクリックで <b>未処理 → 処理中 → 完了 → 未処理</b> と切替。未処理は赤く脈動します。</div>
          </div>

          {/* 編集 */}
          <div className="card" style={{ padding: 16 }}>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>担当・進捗を更新</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
              <SelField label="架電進捗" value={caller} options={CALLER_STATUSES} onChange={setCaller} />
              <SelField label="提案者" value={proposer} options={PROPOSERS} onChange={setProposer} />
              <SelField label="パートナー" value={partner} options={PROPOSERS} onChange={setPartner} />
              <SelField label="クロージング" value={closer} options={CLOSERS} onChange={setCloser} />
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" }}>面談予定日
                <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} style={{ fontFamily: "inherit", fontSize: 12.5, padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
              </label>
              <SelField label="面談ステータス" value={meetingStatus} options={MEETING_STATUSES} onChange={setMeetingStatus} />
            </div>
          </div>

          {/* 見送り（折りたたみ） */}
          {lostOpen && (
            <div id="lost-panel" className="card" style={{ padding: 16, borderColor: "var(--color-danger)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-danger)", marginBottom: 10 }}>見送り（失注）にする</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <SelField label="失注フェーズ" value={lostPhase} options={LOST_PHASES} onChange={setLostPhase} />
                <SelField label="失注理由（必須）" value={lostReason} options={LOST_REASONS} onChange={setLostReason} />
              </div>
              {needsLostNote && (
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)", marginTop: 10 }}>理由メモ（必須・E3）
                  <textarea value={lostNote} onChange={(e) => setLostNote(e.target.value)} rows={2} style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 9px", borderRadius: 8, border: `1px solid ${lostNote.trim() ? "var(--color-border-strong)" : "var(--color-danger)"}`, background: "var(--color-surface)", color: "var(--color-ink)", resize: "vertical" }} />
                </label>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" className="btn ghost btn-sm" onClick={() => setLostOpen(false)}>キャンセル</button>
                <button type="button" className="btn btn-sm" style={{ background: "var(--color-danger)", color: "#fff", borderColor: "var(--color-danger)", opacity: lostReady ? 1 : 0.5 }} disabled={pending || !lostReady} onClick={lose}>見送りを確定</button>
              </div>
            </div>
          )}
        </div>

        {/* フッタ（操作） */}
        <div style={{ position: "sticky", bottom: 0, background: "var(--color-surface)", borderTop: "1px solid var(--color-border)", padding: "14px 22px", display: "flex", gap: 10, alignItems: "center" }}>
          {/* ステータス更新ドロップダウン（クリックでステージ選択メニュー） */}
          <div ref={stageMenuRef} style={{ position: "relative" }}>
            <button type="button" className="btn brand" disabled={pending} onClick={() => setStageMenuOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={stageMenuOpen}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>check</span>
              ステータス更新
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginLeft: 4, verticalAlign: "-3px" }}>{stageMenuOpen ? "expand_more" : "expand_less"}</span>
            </button>
            {stageMenuOpen && (
              <div role="listbox" aria-label="ステータス選択" style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, minWidth: 220, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, boxShadow: "0 12px 28px rgba(15,36,64,.18)", zIndex: 3, overflow: "hidden" }}>
                <div className="muted" style={{ fontSize: 11, padding: "10px 14px 6px" }}>新しいステータスを選択</div>
                {STAGES.map((s) => {
                  const tone = STAGE_TONE[s] ?? "#6b7280";
                  const current = s === p.stage;
                  return (
                    <button key={s} type="button" role="option" aria-selected={current} onClick={() => pickStage(s)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", fontFamily: "inherit", fontSize: 13, fontWeight: current ? 700 : 500, color: current ? tone : "var(--color-ink-2)", background: current ? `${tone}10` : "transparent", border: 0, cursor: "pointer", textAlign: "left" }}
                      onMouseEnter={(e) => { if (!current) (e.currentTarget as HTMLElement).style.background = "var(--color-surface-soft)"; }}
                      onMouseLeave={(e) => { if (!current) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                      <span style={{ width: 8, height: 8, borderRadius: 99, background: tone }} />
                      <span style={{ flex: 1 }}>{s}</span>
                      {current && <span className="material-symbols-outlined" style={{ fontSize: 16, color: tone }}>check</span>}
                    </button>
                  );
                })}
                <div style={{ borderTop: "1px solid var(--color-border)" }} />
                <button type="button" role="option" onClick={() => pickStage("見送り")}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: "var(--color-danger)", background: "transparent", border: 0, cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#fdecef"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--color-danger)" }} />
                  <span style={{ flex: 1 }}>見送り</span>
                </button>
              </div>
            )}
          </div>
          <button type="button" className="btn ghost" disabled={pending} onClick={saveFields} title="ステージは変更せず編集内容のみ保存">編集を保存</button>
          {p.stage === "面談合格" && (
            <button type="button" className="btn" style={{ background: "#1aa260", color: "#fff", borderColor: "#1aa260" }} disabled={pending} onClick={engage} title="稼働化すると稼働管理へ移ります">稼働化 →</button>
          )}
          <button type="button" className="btn ghost" disabled={pending}
            onClick={() => { setLostOpen(true); setTimeout(() => document.getElementById("lost-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}
            title="失注理由（A〜E）を選んで見送りにする" style={{ color: "var(--color-danger)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>do_not_disturb_on</span>
            見送りにする
          </button>
          <button type="button" className="btn ghost" disabled={pending} onClick={removeProposal} title="提案を削除（記録ミスの取り消し・元に戻せません）" style={{ marginLeft: "auto", color: "var(--color-danger)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>delete</span>
            削除
          </button>
        </div>
      </div>
      {memoModalOpen && <ProposalMemoModal proposalId={p.id} onClose={() => setMemoModalOpen(false)} onAdded={loadMemos} />}
      {meetingModalOpen && <ProposalMeetingModal p={p} onClose={() => setMeetingModalOpen(false)} onSaved={() => router.refresh()} />}
    </div>
  );
}
