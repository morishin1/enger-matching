"use client";

// 提案の詳細モーダル（リスト型ビュー用）。
//   - ステージのステッパー（クリックで移動）
//   - 人材情報 / 案件情報
//   - 対応履歴（提案開始・架電・面談）
//   - 編集フィールド（提案者/パートナー/クロージング/架電/面談）と保存・稼働化・見送り
//   既存のサーバアクションを再利用（カンバンの編集パネルと同等の操作を提供）。
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateProposalStage, convertToEngagement, updateProposalFields } from "@/lib/actions";
import { NotifyDot, NOTIFY_LABEL, type NotifyStatus } from "./NotifyDot";
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

  const run = (fn: () => Promise<any>) => start(async () => { await fn(); router.refresh(); });
  const moveTo = (stage: string) => { if (stage !== p.stage) run(() => updateProposalStage(p.id, stage)); };
  const saveFields = () => run(() => updateProposalFields(p.id, { caller_status: caller || null, proposer: proposer || null, partner: partner || null, closer: closer || null, meeting_date: meetingDate || null, meeting_status: meetingStatus || null }));
  const engage = () => run(() => convertToEngagement(p.id));
  const lose = () => run(() => updateProposalFields(p.id, { stage: "見送り", lost_phase: lostPhase, lost_reason: lostReason, lost_reason_note: lostNote.trim() || null }));

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
              <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>人材情報</div>
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
              <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>案件情報</div>
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
            <div className="card" style={{ padding: 16, borderColor: "var(--color-danger)" }}>
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
          <button type="button" className="btn brand" disabled={pending} onClick={saveFields}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>check</span>
            ステータス更新
          </button>
          {p.stage === "面談合格" && (
            <button type="button" className="btn" style={{ background: "#1aa260", color: "#fff", borderColor: "#1aa260" }} disabled={pending} onClick={engage} title="稼働化すると稼働管理へ移ります">稼働化 →</button>
          )}
          {!lostOpen && <button type="button" className="btn ghost" style={{ color: "var(--color-danger)", marginLeft: "auto" }} disabled={pending} onClick={() => setLostOpen(true)}>見送りにする</button>}
        </div>
      </div>
    </div>
  );
}
