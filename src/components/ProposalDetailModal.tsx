"use client";

// 提案の詳細モーダル（リスト型ビュー用）。
//   - ステージのステッパー（クリックで移動）
//   - 人材情報 / 案件情報
//   - 対応履歴（提案開始・架電・面談）
//   - 編集フィールド（提案者/パートナー/クロージング/架電/面談）と保存・稼働化・見送り
//   既存のサーバアクションを再利用（カンバンの編集パネルと同等の操作を提供）。
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "@/components/AppLink";
import { useRouter } from "next/navigation";
import { updateProposalStage, convertToEngagement, updateProposalFields, deleteProposalMemo, deleteProposal, addProposalMemo } from "@/lib/actions";
import { gmailMessageUrl } from "@/lib/gmail";
import { ClosedBadge } from "./ClosedBadge";
import { NotifyDot, NOTIFY_LABEL, type NotifyStatus } from "./NotifyDot";
import { ProposalMemoModal, memoCategoryTone } from "./ProposalMemoModal";
import { ApproveAndSendButton } from "./ApproveAndSendButton";
import { ProposalMeetingModal } from "./ProposalMeetingModal";
import { PROPOSAL_STAGES, CALLER_STATUSES, MEETING_STATUSES, PROPOSERS, CLOSERS, LOST_PHASES, LOST_REASONS, normalizeStage, CONTACT_CHANNELS, type ContactChannel } from "@/lib/proposal-constants";

const STAGES = [...PROPOSAL_STAGES];
const STAGE_TONE: Record<string, string> = {
  返信待ち: "#6b7280", 提案中: "#0095D9", 面談調整: "#d98a2b", クロージング中: "#e0567f", 面談合格: "#1aa260",
};
const fmtDateTime = (d: any) => { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`; };

// 案件情報 / 人材情報の編集可能な行（ラベル＋テキスト入力）。
function EditInfo({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--color-border)", fontSize: 12.5, alignItems: "center" }}>
      <span style={{ width: 84, flexShrink: 0, color: "var(--color-ink-4)" }}>{label}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, minWidth: 0, fontFamily: "inherit", fontSize: 12.5, padding: "5px 8px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
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

// 元メール本文の整形（プレーンテキストを軽く整える）
function cleanMailBody(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 元メール本文の1カラム（案件 or 人材）。本文をスクロール表示し、Gmail原本リンクも置く。 */
function MailColumn({ title, side, body, url, accent }: { title: string; side: "job" | "cand"; body: string | null | undefined; url: string | null; accent: string }) {
  const text = cleanMailBody(body);
  const open = gmailMessageUrl(url);
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden", background: "var(--color-surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--color-border)", background: `${accent}0d` }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: accent, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: accent }}>{title}</span>
        <a href={open ?? undefined} target="_blank" rel="noopener noreferrer" className="btn ghost btn-xs"
          style={{ marginLeft: "auto", textDecoration: "none", opacity: open ? 1 : 0.35, pointerEvents: open ? "auto" : "none", cursor: open ? "pointer" : "not-allowed" }}
          title={open ? "Gmailで原本を開く" : "元メールURLがありません"} aria-disabled={!open}>↗ 原本</a>
      </div>
      <div style={{ padding: "10px 12px", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--color-ink-2)", maxHeight: 280, overflowY: "auto", fontFamily: "inherit" }}>
        {text || <span className="muted" style={{ fontSize: 11.5 }}>本文の取り込みがありません（「↗ 原本」からGmailで確認できます）。</span>}
      </div>
    </div>
  );
}

// ── コンタクト履歴（連絡手段＋連絡日時＋本文）の保存/表示 ──
//   既存の proposal_memos テーブル（category="連絡記録"）を再利用し、本文の先頭に
//   構造化プレフィクスを入れて 手段／連絡日時 を保持する。新規テーブル不要。
//   形式: "[電話 / 2026-06-22 13:48] メモ本文"
//   ※ 既存の「連絡記録」メモ（プレフィクス無し）も自然に表示できる（手段=その他、日時=created_at に fallback）。
const CONTACT_PREFIX_RE = /^\[(電話|メール|LINE|対面|その他(?:：[^\]]+)?)\s*\/\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\]\s*/;
function parseContactBody(body: string): { channel: string; channelOther: string | null; at: Date | null; text: string } {
  const m = body.match(CONTACT_PREFIX_RE);
  if (!m) return { channel: "その他", channelOther: null, at: null, text: body };
  const raw = m[1];
  let channel = raw;
  let channelOther: string | null = null;
  if (raw.startsWith("その他")) {
    channel = "その他";
    const idx = raw.indexOf("：");
    channelOther = idx >= 0 ? raw.slice(idx + 1).trim() : null;
  }
  const at = new Date(m[2].replace(" ", "T"));
  return { channel, channelOther, at: isNaN(at.getTime()) ? null : at, text: body.slice(m[0].length) };
}
function formatContactPrefix(channel: ContactChannel, channelOther: string | null, at: Date): string {
  const ch = channel === "その他" && (channelOther ?? "").trim() ? `その他：${(channelOther ?? "").trim()}` : channel;
  const yyyy = at.getFullYear();
  const MM = String(at.getMonth() + 1).padStart(2, "0");
  const dd = String(at.getDate()).padStart(2, "0");
  const HH = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return `[${ch} / ${yyyy}-${MM}-${dd} ${HH}:${mm}]`;
}
// datetime-local 入力（"YYYY-MM-DDTHH:mm"）⇄ Date の相互変換。タイムゾーン誤差を出さないようローカル時刻でフォーマット。
function dtLocalNow(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd}T${HH}:${mm}`;
}
const CONTACT_CHANNEL_TONE: Record<string, { fg: string; bg: string; icon: string }> = {
  "電話":  { fg: "#0095D9", bg: "#e0f2fe", icon: "call" },
  "メール": { fg: "#9a3457", bg: "#fdebf2", icon: "mail" },
  "LINE":  { fg: "#067647", bg: "#e7f7ee", icon: "chat" },
  "対面":  { fg: "#b45309", bg: "#fff1e6", icon: "groups" },
  "その他": { fg: "#6b7280", bg: "#f3f4f6", icon: "more_horiz" },
};

export function ProposalDetailModal({ p, onClose, proposers, closers }: { p: any; onClose: () => void; proposers?: string[]; closers?: string[] }) {
  // 選択肢の優先順位：props → 既定の定数。"パートナー"は廃止。
  const proposerOpts = (proposers && proposers.length > 0) ? proposers : PROPOSERS;
  const closerOpts = (closers && closers.length > 0) ? closers : CLOSERS;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [caller, setCaller] = useState(p.caller_status ?? "");
  const [proposer, setProposer] = useState(p.proposer ?? "");
  // パートナー機能は廃止（互換のため保存は null で上書き）。
  const [closer, setCloser] = useState(p.closer ?? p.company_owner ?? "");
  const [meetingDate, setMeetingDate] = useState(p.meeting_date ?? "");
  const [meetingStatus, setMeetingStatus] = useState(p.meeting_status ?? "");
  const [lostOpen, setLostOpen] = useState(false);
  const [lostPhase, setLostPhase] = useState(p.lost_phase ?? "");
  const [lostReason, setLostReason] = useState(p.lost_reason ?? "");
  const [lostNote, setLostNote] = useState(p.lost_reason_note ?? "");
  // 失注時に「どの会社の誰が担当か」を確実に記録するため、会社名・先方担当者も編集可能にする。
  const [lostCompany, setLostCompany] = useState(p.company ?? "");
  const [lostClientContact, setLostClientContact] = useState(p.client_contact ?? "");
  // 先方担当者の選択モード：3択（案件側 / 人材側 / その他=手入力）。
  //   既定は既存の client_contact があれば「その他」（手入力既存値を保持）、無ければ「案件側」。
  //   「その他」を選んだときだけ入力欄を表示し、案件側/人材側は読み取りで分かりやすく見せる。
  const [lostContactMode, setLostContactMode] = useState<"job" | "cand" | "other">(
    (p.client_contact ?? "").trim() ? "other" : "job",
  );

  // 案件情報 / 人材情報（会社名・企業担当=窓口担当者・先方担当）。
  //   自動表示される値（クライアント名・所属会社・企業マスタの窓口担当者）も初期値に入れつつ、
  //   いずれも手動で編集・保存できるようにする（保存は「会社名・担当を保存」＝saveFields）。
  const [jobCompany, setJobCompany] = useState(p.company ?? "");
  const [jobCompanyContact, setJobCompanyContact] = useState(p.company_contact ?? "");
  const [jobClientContact, setJobClientContact] = useState(p.client_contact ?? "");
  const [candCompany, setCandCompany] = useState(p.cand_company ?? "");
  const [candCompanyContact, setCandCompanyContact] = useState(p.cand_company_contact ?? "");
  const [candContact, setCandContact] = useState(p.cand_contact ?? "");

  // DB stage（旧名混在）を新ステージに正規化してステッパー位置を決める
  const stageIdx = Math.max(0, STAGES.indexOf(normalizeStage(p.stage)));
  // 失注理由メモは全失注で必須化（原因の明確化・分析精度向上）。
  const lostReady = !!lostReason && lostNote.trim().length > 0;
  // 「どの会社の誰が担当か」が空なら入力を促す（勝率分析に直結。保存は阻害しない）。
  const lostContactMissing = !lostCompany.trim() || !lostClientContact.trim();

  // 右ドロワーのスライドイン（マウント直後に true へ）
  const [shown, setShown] = useState(false);
  // Esc で閉じる
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 0);
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => { clearTimeout(t); window.removeEventListener("keydown", h); };
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

  // コンタクト履歴（連絡手段＋連絡日時＋メモ）。proposal_memos(category="連絡記録") を再利用。
  const [contactChannel, setContactChannel] = useState<ContactChannel>("電話");
  const [contactChannelOther, setContactChannelOther] = useState("");
  const [contactAt, setContactAt] = useState<string>(""); // datetime-local の文字列。空のとき入力欄プレースホルダ。
  const [contactBody, setContactBody] = useState("");
  const [contactErr, setContactErr] = useState<string | null>(null);
  // 連絡日時欄をフォーカス/クリックしたタイミングで未入力なら現在時刻を埋める（要望：クリックで現在時刻が出る）。
  const setContactAtNow = () => setContactAt(dtLocalNow());
  const submitContact = () => {
    setContactErr(null);
    const dtStr = contactAt || dtLocalNow();
    const at = new Date(dtStr);
    if (isNaN(at.getTime())) { setContactErr("連絡日時の形式が不正です"); return; }
    if (contactChannel === "その他" && !contactChannelOther.trim()) { setContactErr("「その他」の手段を入力してください"); return; }
    const prefix = formatContactPrefix(contactChannel, contactChannelOther || null, at);
    const body = `${prefix}${contactBody.trim() ? " " + contactBody.trim() : ""}`;
    start(async () => {
      const r = await addProposalMemo(p.id, "連絡記録", body);
      if (!r.ok) { setContactErr(r.error || "保存に失敗しました"); return; }
      setContactChannel("電話"); setContactChannelOther(""); setContactAt(""); setContactBody("");
      loadMemos();
    });
  };
  const contactMemos = memos.filter((m) => m.category === "連絡記録");

  const run = (fn: () => Promise<any>) => start(async () => { await fn(); router.refresh(); });
  const moveTo = (stage: string) => { if (stage !== p.stage) run(() => updateProposalStage(p.id, stage)); };
  // 案件情報 / 人材情報（会社名・企業担当・先方担当）も含めて保存する共通ペイロード。
  const contactFields = () => ({
    company: jobCompany.trim() || null,
    company_contact: jobCompanyContact.trim() || null,
    client_contact: jobClientContact.trim() || null,
    cand_company: candCompany.trim() || null,
    cand_company_contact: candCompanyContact.trim() || null,
    cand_contact: candContact.trim() || null,
  });
  const saveFields = () => run(() => updateProposalFields(p.id, { caller_status: caller || null, proposer: proposer || null, partner: null, closer: closer || null, meeting_date: meetingDate || null, meeting_status: meetingStatus || null, ...contactFields() }));
  // ステータス更新ドロップダウンからの選択：フォーム項目もまとめて保存しつつステージ遷移する。
  const pickStage = (stage: string) => {
    setStageMenuOpen(false);
    if (stage === "見送り") { setLostOpen(true); return; }
    run(() => updateProposalFields(p.id, {
      stage,
      caller_status: caller || null, proposer: proposer || null, partner: null, closer: closer || null,
      meeting_date: meetingDate || null, meeting_status: meetingStatus || null,
    }));
  };
  const engage = () => run(() => convertToEngagement(p.id));
  const lose = () => run(() => updateProposalFields(p.id, {
    // 案件情報/人材情報の編集内容も保存しつつ、失注時の会社名・先方担当（選択/手入力）で上書き。
    ...contactFields(),
    stage: "見送り", lost_phase: lostPhase, lost_reason: lostReason, lost_reason_note: lostNote.trim() || null,
    // どの会社の誰が担当か（会社名・先方担当者・提案者・クロージング担当）も失注記録に残す。
    company: lostCompany.trim() || null, client_contact: lostClientContact.trim() || null,
    proposer: proposer || null, closer: closer || null,
  }));
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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: shown ? "rgba(15,36,64,.4)" : "transparent", transition: "background .18s ease-out" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "min(880px, 96vw)", maxHeight: "100vh", overflowY: "auto", padding: 0, background: "var(--color-surface)", borderRadius: 0, boxShadow: "-14px 0 34px rgba(15,23,42,.2)", transform: shown ? "translateX(0)" : "translateX(100%)", transition: "transform .24s cubic-bezier(.2,.7,.2,1)" }} role="dialog" aria-modal="true">
        {/* ヘッダ */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", padding: "16px 22px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div className="muted" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>提案管理 <span style={{ opacity: .5 }}>›</span> 詳細</div>
            {/* タイトルをクリックでマッチング結果画面へ（カンバンのカードと同じ挙動）。 */}
            {p.job_no != null ? (
              <Link
                prefetch={false}
                href={`/matching?job=${p.job_no}${p.candidate_no != null ? `&cand=${p.candidate_no}` : ""}`}
                title="この案件×人材のマッチング結果画面を開く"
                style={{ fontSize: 18, fontWeight: 800, marginTop: 4, display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-brand-700)", textDecoration: "none" }}>
                {p.c_init || (p.candidate_name ?? "—")} <span style={{ color: "var(--color-ink-4)", margin: "0 6px" }}>/</span> {p.job_title ?? "—"}
                <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>open_in_new</span>
              </Link>
            ) : (
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{p.c_init || (p.candidate_name ?? "—")} <span style={{ color: "var(--color-ink-4)", margin: "0 6px" }}>/</span> {p.job_title ?? "—"}</div>
            )}
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

          {/* 元メール比較（案件 × 人材を横並びで突き合わせ） */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 17, color: "var(--color-ink-3)" }}>compare_arrows</span>
              <div className="muted" style={{ fontSize: 11.5 }}>元メール比較（案件 × 人材）</div>
              <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto" }}>Gmailを開かずその場で突き合わせ</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <MailColumn title="案件の元メール" side="job" body={p.job_detail} url={p.job_source_mail_url} accent="#0095D9" />
              <MailColumn title="人材の元メール" side="cand" body={p.cand_detail} url={p.cand_source_mail_url} accent="#067647" />
            </div>
          </div>

          {/* 案件情報 / 人材情報（上の元メール並びと一致させて縦に揃える） */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 11.5 }}>案件情報</div>
                {(() => { const url = gmailMessageUrl(p.job_source_mail_url); return (
                  <a href={url ?? undefined} target="_blank" rel="noopener noreferrer" className="btn ghost btn-xs"
                    style={{ textDecoration: "none", opacity: url ? 1 : 0.35, pointerEvents: url ? "auto" : "none", cursor: url ? "pointer" : "not-allowed" }}
                    title={url ? "案件の元メールを開く" : "元メールURLがありません"} aria-disabled={!url}>↗ 元メール</a>
                ); })()}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {p.job_no != null ? <Link prefetch={false} href={`/jobs/${p.job_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{p.job_title ?? "—"}</Link> : (p.job_title ?? "—")}
                {p.job_closed && <ClosedBadge size="xs" />}
              </div>
              {/* クライアント名（自動）／企業担当（窓口担当者・自動）／先方担当（任意）。いずれも編集可。 */}
              <EditInfo label="クライアント名" value={jobCompany} onChange={setJobCompany} placeholder="クライアント会社名" />
              <EditInfo label="企業担当" value={jobCompanyContact} onChange={setJobCompanyContact} placeholder="企業記録の窓口担当者（自動表示）" />
              <EditInfo label="先方担当" value={jobClientContact} onChange={setJobClientContact} placeholder="（任意）" />
            </div>
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
                  <div style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {p.candidate_no != null ? <Link prefetch={false} href={`/people/${p.candidate_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{p.candidate_name ?? "—"}</Link> : (p.candidate_name ?? "—")}
                    {p.cand_closed && <ClosedBadge size="xs" />}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{p.source ? `登録元: ${p.source}` : ""}</div>
                </div>
              </div>
              {/* 会社名（人材の所属会社・自動）／企業担当（窓口担当者・自動）／先方担当（任意）。いずれも編集可。 */}
              <EditInfo label="会社名" value={candCompany} onChange={setCandCompany} placeholder="人材の所属会社（自動表示）" />
              <EditInfo label="企業担当" value={candCompanyContact} onChange={setCandCompanyContact} placeholder="企業記録の窓口担当者（自動表示）" />
              <EditInfo label="先方担当" value={candContact} onChange={setCandContact} placeholder="（任意）" />
            </div>
          </div>

          {/* 会社名・担当の保存（自動表示された値もそのまま保存できる） */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -8 }}>
            <button type="button" className="btn ghost btn-sm" disabled={pending} onClick={saveFields} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {pending && <span style={{ width: 12, height: 12, border: "2px solid rgba(0,0,0,.15)", borderTopColor: "var(--color-ink-2)", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />}
              <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: "-3px" }}>save</span>
              会社名・担当を保存
            </button>
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

          {/* コンタクト履歴：連絡手段＋連絡日時を構造化して残す。proposal_memos(category="連絡記録")を再利用。
              既存の「メモ追加」モーダルとは別の専用入口（要望：いつどんな手段で連絡したかの履歴）。 */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>contact_phone</span>
              <div style={{ fontSize: 13, fontWeight: 800 }}>コンタクト履歴</div>
              {contactMemos.length > 0 && <span className="muted" style={{ fontSize: 11.5 }}>({contactMemos.length})</span>}
            </div>

            {/* 追加フォーム：手段 / 連絡日時（クリックで現在時刻が入る・手動編集可）/ 任意メモ */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 160px) minmax(180px, 240px) 1fr auto", gap: 8, alignItems: "end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" }}>連絡手段
                <select value={contactChannel} onChange={(e) => setContactChannel(e.target.value as ContactChannel)}
                  style={{ fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
                  {CONTACT_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" }}>連絡日時
                <input type="datetime-local" value={contactAt}
                  onFocus={() => { if (!contactAt) setContactAtNow(); }}
                  onClick={() => { if (!contactAt) setContactAtNow(); }}
                  onChange={(e) => setContactAt(e.target.value)}
                  title="クリックすると現在の日時が入ります。手動で編集も可能です。"
                  style={{ fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" }}>{contactChannel === "その他" ? "手段（手入力）＋メモ" : "メモ（任意）"}
                {contactChannel === "その他" ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input type="text" placeholder="例: FAX / Slack / Teams …" value={contactChannelOther} onChange={(e) => setContactChannelOther(e.target.value)}
                      style={{ flex: "0 0 160px", fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
                    <input type="text" placeholder="メモ（任意）" value={contactBody} onChange={(e) => setContactBody(e.target.value)}
                      style={{ flex: 1, fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
                  </div>
                ) : (
                  <input type="text" placeholder="例: 不通 / 折り返し希望 / 面談OK" value={contactBody} onChange={(e) => setContactBody(e.target.value)}
                    style={{ fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
                )}
              </label>
              <button type="button" className="btn brand btn-sm" disabled={pending} onClick={submitContact} style={{ whiteSpace: "nowrap" }}>
                <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 15, marginRight: 4, verticalAlign: "-2px" }}>add</span>
                追加
              </button>
            </div>
            {contactErr && <div style={{ fontSize: 12, color: "var(--color-danger)", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "8px 11px", marginTop: 8 }}>{contactErr}</div>}

            {/* 履歴リスト */}
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {memosLoading ? (
                <div className="muted" style={{ fontSize: 12 }}>読み込み中…</div>
              ) : contactMemos.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>コンタクト履歴はまだありません。上のフォームから記録できます。</div>
              ) : (
                contactMemos.map((m) => {
                  const parsed = parseContactBody(m.body);
                  const tone = CONTACT_CHANNEL_TONE[parsed.channel] ?? CONTACT_CHANNEL_TONE["その他"];
                  // 表示する連絡日時：プレフィクス由来があればそれ、無ければ created_at にフォールバック。
                  const at = parsed.at ?? new Date(m.created_at);
                  const atStr = isNaN(at.getTime()) ? "—" : `${at.getFullYear()}/${String(at.getMonth() + 1).padStart(2, "0")}/${String(at.getDate()).padStart(2, "0")} ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
                  const author = m.created_by_name || (m.created_by_email ? m.created_by_email.split("@")[0] : "");
                  const channelLabel = parsed.channel === "その他" && parsed.channelOther ? `その他（${parsed.channelOther}）` : parsed.channel;
                  return (
                    <div key={m.id} style={{ borderLeft: `3px solid ${tone.fg}`, paddingLeft: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: tone.bg, color: tone.fg }}>
                          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>{tone.icon}</span>
                          {channelLabel}
                        </span>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-ink-2)" }}>{atStr}</span>
                        {author && <span className="muted" style={{ fontSize: 11 }}>{author}</span>}
                        <button type="button" onClick={() => onDeleteMemo(m.id)} className="btn ghost btn-xs" title="このコンタクト履歴を削除" style={{ marginLeft: "auto", color: "var(--color-danger)" }}>削除</button>
                      </div>
                      {parsed.text && <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", color: "var(--color-ink)" }}>{parsed.text}</div>}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* メモ履歴（カテゴリ別の対応ログ）。連絡記録は上の「コンタクト履歴」で扱うのでここでは除外。 */}
          {(() => { const otherMemos = memos.filter((m) => m.category !== "連絡記録"); return (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div className="muted" style={{ fontSize: 11.5 }}>メモ履歴 {otherMemos.length > 0 && <span style={{ marginLeft: 4 }}>({otherMemos.length})</span>}</div>
              <button type="button" className="btn ghost btn-sm" onClick={() => setMemoModalOpen(true)} title="新しいメモを追加">
                <span className="material-symbols-outlined" style={{ fontSize: 15, marginRight: 4, verticalAlign: "-2px" }}>edit_note</span>
                メモ追加
              </button>
            </div>
            {memosLoading ? (
              <div className="muted" style={{ fontSize: 12 }}>読み込み中…</div>
            ) : otherMemos.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>メモはまだありません。</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {otherMemos.map((m) => {
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
          ); })()}

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
              <SelField label="提案者" value={proposer} options={proposerOpts} onChange={setProposer} />
              <SelField label="クロージング" value={closer} options={closerOpts} onChange={setCloser} />
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
              {/* 理由メモは全失注で必須（原因の明確化・分析のため） */}
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)", marginTop: 10 }}>理由メモ（必須）
                <textarea value={lostNote} onChange={(e) => setLostNote(e.target.value)} rows={2} placeholder="具体的な事情を簡潔に（例: 他社が単価5万安く先に提示 / 担当変更で立ち消え 等）" style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 9px", borderRadius: 8, border: `1px solid ${lostNote.trim() ? "var(--color-border-strong)" : "var(--color-danger)"}`, background: "var(--color-surface)", color: "var(--color-ink)", resize: "vertical" }} />
                {!lostNote.trim() && <span style={{ color: "var(--color-danger)", fontSize: 10.5 }}>※ 失注理由メモは必須です。</span>}
              </label>
              {/* どの会社の誰が担当か（勝率分析に直結）。失注記録に確実に残す。
                  会社名・先方担当者は案件情報／人材情報（①）から選んで自動入力でき、手入力もできる。 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" }}>会社名
                  <select value="" onChange={(e) => { const v = e.target.value; if (v === "job") setLostCompany(jobCompany); else if (v === "cand") setLostCompany(candCompany); }}
                    style={{ fontFamily: "inherit", fontSize: 11.5, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
                    <option value="">案件側／人材側から選択…</option>
                    <option value="job">案件側：{jobCompany || "（空欄）"}</option>
                    <option value="cand">人材側：{candCompany || "（空欄）"}</option>
                  </select>
                  <input type="text" value={lostCompany} onChange={(e) => setLostCompany(e.target.value)} placeholder="会社名（手入力も可）" style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" }}>先方担当者
                  {/* 3択：案件側 / 人材側 / その他（手入力）。
                      「その他」のときだけ入力欄を表示し、画面をすっきりさせる（常時手入力欄を出していた旧UI改善）。 */}
                  <select value={lostContactMode} onChange={(e) => {
                      const m = e.target.value as "job" | "cand" | "other";
                      setLostContactMode(m);
                      if (m === "job") setLostClientContact(jobClientContact);
                      else if (m === "cand") setLostClientContact(candContact);
                      else setLostClientContact("");
                    }}
                    style={{ fontFamily: "inherit", fontSize: 11.5, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
                    <option value="job">案件側：{jobClientContact || "（空欄）"}</option>
                    <option value="cand">人材側：{candContact || "（空欄）"}</option>
                    <option value="other">その他（手入力）</option>
                  </select>
                  {lostContactMode === "other" ? (
                    <input type="text" value={lostClientContact} onChange={(e) => setLostClientContact(e.target.value)} placeholder="担当者名を入力" style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
                  ) : (
                    <div style={{ fontSize: 12, padding: "6px 9px", borderRadius: 8, border: "1px dashed var(--color-border-strong)", background: "var(--color-surface-soft)", color: "var(--color-ink-2)", minHeight: 32, display: "flex", alignItems: "center" }}>
                      {lostClientContact || <span className="muted">（{lostContactMode === "job" ? "案件側" : "人材側"}の値が空欄です）</span>}
                    </div>
                  )}
                </label>
              </div>
              {lostContactMissing && (
                <div style={{ fontSize: 10.5, color: "#b45309", background: "#fff6e0", border: "1px solid #fde9b0", borderRadius: 6, padding: "6px 9px", marginTop: 6 }}>
                  ⚠ 勝率分析のため、<b>会社名・先方担当者</b>を入力してから確定してください（誰が・どの会社かを失注記録に残します）。
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                <button type="button" className="btn ghost btn-sm" onClick={() => setLostOpen(false)} disabled={pending}>キャンセル</button>
                <button type="button" className="btn btn-sm" style={{ background: "var(--color-danger)", color: "#fff", borderColor: "var(--color-danger)", opacity: lostReady ? 1 : 0.5, display: "inline-flex", alignItems: "center", gap: 6 }} disabled={pending || !lostReady} onClick={lose}>
                  {pending && <span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />}
                  {pending ? "保存中…" : "見送りを確定"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 承認チェックバー：承認待ちの提案だけ表示。承認者本人 or admin だけが操作可。 */}
        {((p as any).approval_status === "pending" || (p as any).approval_status === "rejected" || p.stage === "承認待ち") && (
          <div style={{ borderTop: "1px solid var(--color-border)", padding: "12px 22px", background: (p as any).approval_status === "rejected" ? "#fdecef" : "#fff6e0", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: (p as any).approval_status === "rejected" ? "#b42318" : "#9a7b12" }}>
              {(p as any).approval_status === "rejected" ? "🔴 差戻し" : "⏳ 承認待ち"}
            </span>
            <span style={{ fontSize: 12, color: "var(--color-ink-2)" }}>
              提案者：<b>{p.proposer ?? "未設定"}</b> ／ 承認者：<b>{(p as any).approver ?? "未設定"}</b>
            </span>
            {(p as any).reject_reason && <span style={{ fontSize: 12, color: "#b42318" }}>理由：{(p as any).reject_reason}</span>}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {/* 推奨：メール内容を確認してから送信＝承認。下書きが無いときは内部でエラー表示。 */}
              <ApproveAndSendButton proposalId={p.id} jobNo={p.job_no ?? null} candNo={p.candidate_no ?? null} />
              {/* メール送信を伴わない承認（下書きが無い旧データ・手動入力分の救済用） */}
              <button type="button" className="btn ghost btn-sm" disabled={pending}
                title="メール下書きが無い場合のみ使用（既に他経路で送信済みの提案を承認）"
                onClick={async () => {
                  if (!confirm("メール下書きを使わずに承認だけしますか？（通常は『メール内容を確認して送信』をお使いください）")) return;
                  const { approveProposal } = await import("@/lib/actions");
                  start(async () => {
                    const r = await approveProposal(p.id);
                    if (!r.ok) alert(r.error); else router.refresh();
                  });
                }}>承認のみ</button>
              <button type="button" className="btn btn-sm" disabled={pending}
                style={{ color: "#b42318", borderColor: "#f7c5cf" }}
                onClick={async () => {
                  const reason = window.prompt("差戻し理由を入力してください（提案者に表示されます）");
                  if (reason == null) return;
                  const { rejectProposal } = await import("@/lib/actions");
                  start(async () => {
                    const r = await rejectProposal(p.id, reason);
                    if (!r.ok) alert(r.error); else router.refresh();
                  });
                }}>差戻し</button>
            </div>
          </div>
        )}

        {/* フッタ（操作） */}
        <div style={{ position: "sticky", bottom: 0, background: "var(--color-surface)", borderTop: "1px solid var(--color-border)", padding: "14px 22px", display: "flex", gap: 10, alignItems: "center" }}>
          {/* ステータス更新ドロップダウン（クリックでステージ選択メニュー） */}
          <div ref={stageMenuRef} style={{ position: "relative" }}>
            <button type="button" className="btn brand" disabled={pending} onClick={() => setStageMenuOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={stageMenuOpen} style={{ display: "inline-flex", alignItems: "center" }}>
              {pending ? (
                <>
                  <span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", marginRight: 6, animation: "spin .8s linear infinite" }} />
                  保存中…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>check</span>
                  ステータス更新
                  <span className="material-symbols-outlined" style={{ fontSize: 16, marginLeft: 4, verticalAlign: "-3px" }}>{stageMenuOpen ? "expand_more" : "expand_less"}</span>
                </>
              )}
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
          <button type="button" className="btn ghost" disabled={pending} onClick={saveFields} title="ステージは変更せず編集内容のみ保存" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {pending && <span style={{ width: 12, height: 12, border: "2px solid rgba(0,0,0,.15)", borderTopColor: "var(--color-ink-2)", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />}
            {pending ? "保存中…" : "編集を保存"}
          </button>
          {normalizeStage(p.stage) === "合格" && (
            <button type="button" className="btn" style={{ background: "#1aa260", color: "#fff", borderColor: "#1aa260" }} disabled={pending} onClick={engage} title="稼働化すると稼働管理へ移ります">稼働化 →</button>
          )}
          <button type="button" className="btn ghost" disabled={pending}
            onClick={() => { setLostOpen(true); setTimeout(() => document.getElementById("lost-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}
            title="失注理由（A〜E）を選んで見送りにする" style={{ color: "var(--color-danger)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>do_not_disturb_on</span>
            見送り内容を記入する
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
