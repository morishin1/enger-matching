"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateProposalStage, convertToEngagement, updateProposalFields, deleteProposal } from "@/lib/actions";

const dvDate = (d: any) => { if (!d) return ""; const t = new Date(d); return isNaN(t.getTime()) ? "" : `${t.getMonth() + 1}/${t.getDate()}`; };
const dvDateTime = (d: any) => {
  if (!d) return "";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "";
  return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};
const daysSince = (d: any) => {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};
// 各ステージの目標滞留日数(SLA)。これを超えると警告/危険トーンで強調する。
const STAGE_SLA_DAYS: Record<string, number> = {
  返信待ち: 3,
  提案中: 5,
  面談調整: 3,
  クロージング中: 5,
  面談合格: 7,
};
function ageTone(days: number | null, sla: number) {
  if (days == null) return { fg: "var(--color-ink-4)", bg: "transparent", bd: "var(--color-border)", level: "ok" as const };
  if (days <= sla)       return { fg: "#067647", bg: "#e7f7ee", bd: "#bfe3cc", level: "ok" as const };
  if (days <= sla * 2)   return { fg: "#b45309", bg: "#fff6e0", bd: "#fde9b0", level: "warn" as const };
  return                   { fg: "#b42318", bg: "#fdecef", bd: "#f7c5cf", level: "danger" as const };
}

// 提案者名を見分けやすくする安定色（同じ名前は同じ色）。
const PROPOSER_PALETTE = ["#0b5cab", "#7c3aed", "#1aa260", "#d97706", "#dc2626", "#0891b2", "#db2777", "#65a30d", "#475569", "#ea580c", "#4338ca", "#0d9488"];
function hashColor(name?: string | null): string {
  if (!name) return "#9aa7b4";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PROPOSER_PALETTE[h % PROPOSER_PALETTE.length];
}
import { PROPOSAL_STAGES, CALLER_STATUSES, MEETING_STATUSES, PROPOSERS, LOST_PHASES, LOST_REASONS } from "@/lib/proposal-constants";

const STAGES = [...PROPOSAL_STAGES];
const STAGE_TONE: Record<string, string> = {
  返信待ち: "#6b7280", 提案中: "#0095D9", 面談調整: "#d98a2b", クロージング中: "#e0567f", 面談合格: "#1aa260",
};
const CALLER_TONE: Record<string, string> = {
  返信あり: "#1aa260", 電話済み: "#0095D9", "電話(不在)": "#d98a2b", LINE確認中: "#7c5cff", メール確認中: "#7c5cff", 未架電: "#9aa7b4",
};

// 登録元（流入経路）。一目で分かるよう固有のアイコン・色を割り当て、ステージが進んでも色は変えない。
type SourceKey = "line" | "enger" | "mail";
const SOURCE_META: Record<SourceKey, { label: string; color: string; icon: string }> = {
  line:  { label: "LINE",     color: "#06C755", icon: "💬" },   // LINEブランドグリーン
  enger: { label: "エンジャー", color: "#0095D9", icon: "✦" },   // エンジャーブルー（従来通り）
  mail:  { label: "メール",    color: "#e0567f", icon: "✉" },   // メールはピンク
};
const SOURCE_OPTIONS: { value: SourceKey; label: string }[] = [
  { value: "line", label: "💬 LINE登録" },
  { value: "enger", label: "✦ エンジャー登録" },
  { value: "mail", label: "✉ メール登録" },
];
const sourceMeta = (s?: string | null) => (s && (s in SOURCE_META) ? SOURCE_META[s as SourceKey] : null);

function Field({ label, value, options, onChange, placeholder }: { label: string; value: string; options: string[]; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, color: "var(--color-ink-4)" }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: "inherit", fontSize: 11.5, padding: "5px 7px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
        <option value="">{placeholder ?? "—"}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Card({ p, stageIdx, onMove, onLose, onEngage, onSave, onDelete, busy, members, onDragStart, onDragEnd, isDragging }: any) {
  const [open, setOpen] = useState(false);
  const [caller, setCaller] = useState(p.caller_status ?? "");
  const [proposer, setProposer] = useState(p.proposer ?? "");
  const [partner, setPartner] = useState(p.partner ?? "");
  // クロージング担当の既定 = 企業担当（案件の担当者）。未設定なら企業担当を初期表示。
  const [closer, setCloser] = useState(p.closer ?? p.company_owner ?? "");
  const [lostPhase, setLostPhase] = useState(p.lost_phase ?? "");
  const [lostReason, setLostReason] = useState(p.lost_reason ?? "");
  const [meetingDate, setMeetingDate] = useState(p.meeting_date ?? "");
  const [meetingStatus, setMeetingStatus] = useState(p.meeting_status ?? "");
  const [company, setCompany] = useState(p.company ?? "");
  const [clientContact, setClientContact] = useState(p.client_contact ?? "");
  const [source, setSource] = useState(p.source ?? "");
  const tone = STAGE_TONE[p.stage] ?? "#6b7280";
  const src = sourceMeta(p.source);
  // 左ボーダーは「登録元」の色（固定）。登録元未設定の時のみステージ色にフォールバック。
  const edgeColor = src?.color ?? tone;
  // 滞留時間（ステージ内 / 提案開始からの全期間）と目標日数(SLA)
  const stageDays = daysSince(p.stage_updated_at ?? p.updated_at ?? p.created_at);
  const totalDays = daysSince(p.created_at);
  const sla = STAGE_SLA_DAYS[p.stage] ?? 5;
  const at = ageTone(stageDays, sla);
  // 提案日時と目標日時（現ステージ滞留時間の SLA から逆算）
  const proposedAt = p.created_at ? new Date(p.created_at) : null;
  const stageStartAt = p.stage_updated_at ? new Date(p.stage_updated_at) : (p.updated_at ? new Date(p.updated_at) : proposedAt);
  const targetAt = stageStartAt ? new Date(stageStartAt.getTime() + sla * 86400000) : null;
  const overdueDays = targetAt ? Math.max(0, Math.floor((Date.now() - targetAt.getTime()) / 86400000)) : 0;
  const fmtMD = (d: Date | null) => d ? `${d.getMonth() + 1}/${d.getDate()}` : "—";
  const fmtMDt = (d: Date | null) => d ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "—";

  return (
    <div
      className="card"
      draggable={!busy}
      onDragStart={(e) => { if (busy) { e.preventDefault(); return; } e.dataTransfer.setData("text/proposal-id", p.id); e.dataTransfer.effectAllowed = "move"; onDragStart?.(p.id); }}
      onDragEnd={() => onDragEnd?.()}
      onClick={(e) => {
        // カードのどこをクリックしても編集パネルを開く（リンク/ボタン/入力は除外、ドラッグ時は発火しない）
        if (busy) return;
        if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return;
        setOpen(true);
      }}
      title="クリックで編集"
      style={{
        padding: 12,
        opacity: busy ? 0.5 : isDragging ? 0.35 : 1,
        borderLeft: `4px solid ${edgeColor}`,
        // 滞留が警告/危険な場合は右端にもアクセント
        boxShadow: at.level === "danger" ? `inset -3px 0 0 ${at.fg}` : at.level === "warn" ? `inset -3px 0 0 ${at.fg}` : "none",
        cursor: busy ? "default" : "pointer",
        userSelect: "none",
        transition: "opacity .12s ease",
      }}
    >
      {/* 登録元バッジ（固定色・アイコン） */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        {src ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: `${src.color}1a`, color: src.color, border: `1px solid ${src.color}55` }}>
            <span>{src.icon}</span>{src.label}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: "var(--color-ink-4)" }}>登録元 未設定</span>
        )}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.4, marginBottom: 3 }}>
        {p.job_no != null
          ? <Link
              href={p.candidate_no != null ? `/matching?job=${p.job_no}&cand=${p.candidate_no}` : `/matching?job=${p.job_no}`}
              title="この案件×人材のマッチング結果画面へ"
              style={{ color: "var(--color-brand-700)", textDecoration: "none" }}
            >{p.job_title ?? "—"}</Link>
          : (p.job_title ?? "—")}
      </div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 8, display: "flex", justifyContent: "space-between", gap: 6 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.company ?? ""}{p.client_contact ? ` / ${p.client_contact}` : ""}</span>
        {(proposedAt || targetAt) && (
          <span style={{ flexShrink: 0, display: "inline-flex", gap: 4, alignItems: "center", fontSize: 10.5 }}>
            <span title={`提案開始：${fmtMDt(proposedAt)}（経過 ${totalDays ?? 0}日）`}
              style={{ color: "var(--color-ink-3)", fontWeight: 600 }}>
              提案 {fmtMD(proposedAt)}
            </span>
            <span style={{ color: "var(--color-ink-5)" }}>→</span>
            <span title={`目標：${fmtMDt(targetAt)}（現ステージ「${p.stage}」滞留 ${stageDays ?? 0}日 / SLA ${sla}日）${at.level === "warn" ? "\n⚠ 目標超過" : at.level === "danger" ? "\n🚨 大幅超過" : ""}`}
              style={{ padding: "1px 6px", borderRadius: 99, background: at.bg, color: at.fg, border: `1px solid ${at.bd}`, fontWeight: 700 }}>
              目標 {fmtMD(targetAt)}{at.level === "warn" ? " ⚠" : at.level === "danger" ? ` 🚨 +${overdueDays}d` : ""}
            </span>
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div className="ava" style={{ width: 26, height: 26, fontSize: 10 }}>{p.c_init || (p.candidate_name ?? "?").slice(0, 2)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.candidate_name ?? "—"}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>{p.rate ?? ""}{p.score != null ? ` · マッチ${p.score}%` : ""}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
        {p.caller_status && <span className="pill" style={{ fontSize: 10, borderColor: "transparent", background: `${CALLER_TONE[p.caller_status] ?? "#9aa7b4"}1a`, color: CALLER_TONE[p.caller_status] ?? "var(--color-ink-3)" }}>☎ {p.caller_status}</span>}
        {(p.meeting_date || p.meeting_status) && <span className="pill" style={{ fontSize: 10, borderColor: "transparent", background: "#fff1e6", color: "#b45309" }}>📅 {[p.meeting_date, p.meeting_status].filter(Boolean).join(" ")}</span>}
        {p.company_owner && <span className="tag" style={{ fontSize: 10, background: "#eef5fd", color: "#0b5cab" }}>企業担当 {p.company_owner}</span>}
        {p.proposer && (() => { const col = hashColor(p.proposer); return (
          <span className="tag" style={{ fontSize: 10, background: `${col}1a`, color: col, border: `1px solid ${col}55`, fontWeight: 700 }}>提案 {p.proposer}</span>
        ); })()}
        {p.partner && (() => { const col = hashColor(p.partner); return (
          <span className="tag" style={{ fontSize: 10, background: `${col}1a`, color: col, border: `1px solid ${col}55` }}>組 {p.partner}</span>
        ); })()}
        {p.proposer && !p.partner && <span className="tag" style={{ fontSize: 10, color: "#b45309", background: "#fff1e6" }}>パートナー未定</span>}
        {(p.closer ?? p.company_owner) && (p.closer ?? p.company_owner) !== "未割当" && (() => { const closer = p.closer ?? p.company_owner; const col = hashColor(closer); return (
          <span className="tag" style={{ fontSize: 10, background: `${col}1a`, color: col, border: `1px solid ${col}55`, fontWeight: 700 }}>CL {closer}</span>
        ); })()}
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn ghost btn-xs" disabled={stageIdx <= 0 || busy} onClick={() => onMove(p.id, STAGES[stageIdx - 1])} title="前へ">←</button>
        <button type="button" className="btn ghost btn-xs" disabled={stageIdx >= STAGES.length - 1 || busy} onClick={() => onMove(p.id, STAGES[stageIdx + 1])} title="次へ">→</button>
        {p.stage === "面談合格" && <button type="button" className="btn brand btn-xs" disabled={busy} onClick={() => onEngage(p.id)} title="稼働化すると稼働管理へ移り、この一覧から消えます">稼働化 →</button>}
        <button type="button" className="btn ghost btn-xs" onClick={() => setOpen((v) => !v)} style={{ marginLeft: "auto" }}>{open ? "閉じる" : "編集"}</button>
        <button type="button" className="btn ghost btn-xs" style={{ color: "var(--color-danger)" }} disabled={busy} title="この提案を削除（記録ミスの取り消し）" onClick={() => { if (confirm(`「${p.candidate_name ?? "この人材"} × ${p.job_title ?? "案件"}」の提案を削除しますか？\n（記録ミスの取り消し。元に戻せません）`)) onDelete(p.id); }}>🗑</button>
      </div>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--color-border)", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* 登録元（流入経路）。設定するとカードの色・アイコンが固定される */}
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, color: "var(--color-ink-4)" }}>登録元（LINE / エンジャー / メール）
            <select value={source} onChange={(e) => setSource(e.target.value)} style={{ fontFamily: "inherit", fontSize: 11.5, padding: "5px 7px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
              <option value="">未設定</option>
              {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {/* 会社名・先方担当者（企業マスタへも紐づけ保存される） */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, color: "var(--color-ink-4)" }}>会社名
              <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="クライアント会社名" style={{ fontFamily: "inherit", fontSize: 11.5, padding: "5px 7px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, color: "var(--color-ink-4)" }}>先方担当者
              <input type="text" value={clientContact} onChange={(e) => setClientContact(e.target.value)} placeholder="窓口の担当者名" style={{ fontFamily: "inherit", fontSize: 11.5, padding: "5px 7px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
            </label>
          </div>
          <Field label="架電進捗" value={caller} options={CALLER_STATUSES} onChange={setCaller} />
          {/* 2人1組（提案者＋パートナー）。区分に関係なく全員が担当できる */}
          <div style={{ fontSize: 10.5, color: "#0b5cab", fontWeight: 600 }}>👥 2人1組</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <Field label="提案者" value={proposer} options={members ?? PROPOSERS} onChange={setProposer} />
            <Field label="パートナー" value={partner} options={members ?? PROPOSERS} onChange={setPartner} placeholder="相手を選ぶ" />
          </div>
          {/* クロージング担当：企業担当者がデフォルト。提案者・パートナー・他メンバーからも選べる */}
          <Field
            label="クロージング担当"
            value={closer}
            options={Array.from(new Set([p.company_owner, proposer, partner, ...(members ?? PROPOSERS)].filter((x) => x && x !== "")))}
            onChange={setCloser}
            placeholder="未定（あとで決める）"
          />
          <div style={{ fontSize: 10, color: "var(--color-ink-4)" }}>
            {p.company_owner ? <>※ 既定は企業担当の <b>{p.company_owner}</b> さん。ペアで相談して変更できます。</> : <>※ 企業担当が未設定です。案件管理で企業担当を設定すると既定になります。</>}
            <br />※ 会社名・先方担当者は<b>企業管理</b>にも紐づけ保存されます。
          </div>
          <button type="button" className="btn brand btn-xs" disabled={busy} onClick={() => onSave(p.id, { caller_status: caller, proposer, partner, closer, company: company.trim() || null, client_contact: clientContact.trim() || null, source: source || null })}>保存</button>

          {/* 面談（これから捌く予定）— ファネルの面談到達率の素 */}
          <div style={{ paddingTop: 8, borderTop: "1px dashed var(--color-border)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 10.5, color: "#b45309", fontWeight: 600 }}>📅 面談・商談</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, color: "var(--color-ink-4)" }}>予定日
                <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} style={{ fontFamily: "inherit", fontSize: 11.5, padding: "5px 7px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
              </label>
              <Field label="面談ステータス" value={meetingStatus} options={MEETING_STATUSES} onChange={setMeetingStatus} />
            </div>
            <button type="button" className="btn ghost btn-xs" disabled={busy} onClick={() => onSave(p.id, { meeting_date: meetingDate || null, meeting_status: meetingStatus || null })}>面談情報を保存</button>
          </div>

          <div style={{ paddingTop: 8, borderTop: "1px dashed var(--color-border)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 10.5, color: "var(--color-danger)", fontWeight: 600 }}>見送り（失注）</div>
            <Field label="失注フェーズ" value={lostPhase} options={LOST_PHASES} onChange={setLostPhase} />
            <Field label="失注理由（主要因・必須）" value={lostReason} options={LOST_REASONS} onChange={setLostReason} />
            {!lostReason && <div style={{ fontSize: 10, color: "var(--color-danger)" }}>※ 失注理由は分析の必須項目です。選択してください。</div>}
            <button type="button" className="btn ghost btn-xs" style={{ color: "var(--color-danger)", opacity: lostReason ? 1 : 0.5 }} disabled={busy || !lostReason} onClick={() => onLose(p.id, lostPhase, lostReason)}>見送りにする</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProposalBoard({ proposals, members }: { proposals: any[]; members?: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const run = (id: string, fn: () => Promise<any>) => { setBusyId(id); start(async () => { await fn(); router.refresh(); setBusyId(null); }); };
  const onMove = (id: string, stage: string) => run(id, () => updateProposalStage(id, stage));
  const onEngage = (id: string) => run(id, () => convertToEngagement(id));
  const onSave = (id: string, fields: any) => run(id, () => updateProposalFields(id, fields));
  const onLose = (id: string, lost_phase: string, lost_reason: string) => run(id, () => updateProposalFields(id, { stage: "見送り", lost_phase, lost_reason }));
  const onDelete = (id: string) => run(id, () => deleteProposal(id));

  const byStage = (s: string) => proposals.filter((p) => (p.stage ?? "返信待ち") === s);
  // ステージ目標日数を超過 / 大幅超過の件数を集計
  const stalled = proposals.reduce((acc, p) => {
    const s = p.stage ?? "返信待ち";
    if (!STAGES.includes(s)) return acc;
    const d = daysSince(p.stage_updated_at ?? p.updated_at ?? p.created_at);
    if (d == null) return acc;
    const sla = STAGE_SLA_DAYS[s] ?? 5;
    if (d > sla * 2) acc.danger += 1;
    else if (d > sla) acc.warn += 1;
    return acc;
  }, { warn: 0, danger: 0 });
  const oldestStageDays = Math.max(0, ...proposals.map((p) => daysSince(p.stage_updated_at ?? p.updated_at ?? p.created_at) ?? 0));
  const avgClosingDays = (() => {
    const closed = proposals.filter((p) => p.stage === "面談合格");
    if (closed.length === 0) return null;
    const sum = closed.reduce((s, p) => s + (daysSince(p.created_at) ?? 0), 0);
    return Math.round(sum / closed.length);
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 滞留アラート＋平均クロージング日数（時間が一目で分かるバナー） */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {(stalled.warn + stalled.danger) > 0 ? (
          <div style={{ display: "inline-flex", gap: 14, alignItems: "center", padding: "8px 14px", borderRadius: 10, background: stalled.danger > 0 ? "#fdecef" : "#fff6e0", border: `1px solid ${stalled.danger > 0 ? "#f7c5cf" : "#fde9b0"}`, fontSize: 12.5, color: stalled.danger > 0 ? "#b42318" : "#9a7b12", fontWeight: 700 }}>
            <span>{stalled.danger > 0 ? "🚨" : "⚠"} ステージ目標日数を超過</span>
            {stalled.danger > 0 && <span>大幅超過 <b style={{ fontSize: 14 }}>{stalled.danger}</b>件</span>}
            {stalled.warn > 0 && <span style={{ color: "#9a7b12" }}>目標超過 <b style={{ fontSize: 14 }}>{stalled.warn}</b>件</span>}
            <span style={{ fontWeight: 500, fontSize: 11.5, opacity: .85 }}>最長滞留 {oldestStageDays}日</span>
          </div>
        ) : (
          <div style={{ display: "inline-flex", gap: 10, alignItems: "center", padding: "8px 14px", borderRadius: 10, background: "#e7f7ee", border: "1px solid #bfe3cc", fontSize: 12.5, color: "#067647", fontWeight: 700 }}>
            <span>✓ 全カード目標日数内</span>
            {oldestStageDays > 0 && <span style={{ fontWeight: 500, fontSize: 11.5, opacity: .85 }}>最長滞留 {oldestStageDays}日</span>}
          </div>
        )}
        {avgClosingDays != null && (
          <div title="面談合格に到達した提案の、提案開始からの平均日数" style={{ display: "inline-flex", gap: 8, alignItems: "center", padding: "8px 14px", borderRadius: 10, background: "var(--color-surface)", border: "1px solid var(--color-border)", fontSize: 12.5, color: "var(--color-ink-2)" }}>
            <span style={{ fontWeight: 700 }}>📈 平均クロージング</span>
            <span><b style={{ fontSize: 14 }}>{avgClosingDays}</b> 日</span>
          </div>
        )}
        <div style={{ marginLeft: "auto", display: "inline-flex", gap: 8, fontSize: 10.5, color: "var(--color-ink-4)" }}>
          <span>SLA 目安：</span>
          {Object.entries(STAGE_SLA_DAYS).map(([s, d]) => (
            <span key={s} style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: STAGE_TONE[s] ?? "#6b7280" }} />{s} {d}d
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(230px, 1fr))`, gap: 12, overflowX: "auto", paddingBottom: 8 }}>
      {STAGES.map((stage) => {
        const items = byStage(stage);
        const tone = STAGE_TONE[stage] ?? "#6b7280";
        const isOver = overStage === stage && draggingId != null;
        const draggedStage = draggingId ? proposals.find((x) => x.id === draggingId)?.stage : null;
        const isTargetCandidate = draggingId != null && draggedStage !== stage;
        return (
          <div key={stage}
            onDragEnter={(e) => { if (draggingId) { e.preventDefault(); setOverStage(stage); } }}
            onDragOver={(e) => { if (draggingId) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overStage !== stage) setOverStage(stage); } }}
            onDragLeave={(e) => {
              // 子要素間移動でちらつかないよう、要素外に出たときだけクリア
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage((s) => (s === stage ? null : s));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/proposal-id") || draggingId;
              setOverStage(null); setDraggingId(null);
              if (id && draggedStage !== stage) onMove(id, stage);
            }}
            style={{
              background: isOver ? "#fffbeb" : "var(--color-surface-soft)",
              border: isOver ? `2px dashed ${tone}` : isTargetCandidate ? "2px dashed var(--color-border)" : "2px solid transparent",
              borderRadius: 12, padding: 10, minWidth: 230, display: "flex", flexDirection: "column", gap: 8,
              transition: "background .12s ease, border-color .12s ease",
            }}
          >
            {/* カラムヘッダ：ステージ名と件数を大きく表示 */}
            <div style={{ padding: "6px 6px 10px", display: "flex", flexDirection: "column", gap: 4, borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: tone }}>
                <span style={{ width: 10, height: 10, borderRadius: 99, background: tone }} />
                {stage}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: items.length > 0 ? "var(--color-ink)" : "var(--color-ink-4)", fontFamily: "var(--font-display)" }}>{items.length}</span>
                <span style={{ fontSize: 12, color: "var(--color-ink-3)", fontWeight: 600 }}>件</span>
              </div>
            </div>
            {items.length === 0 && <div style={{ fontSize: 11, color: isOver ? tone : "var(--color-ink-4)", textAlign: "center", padding: "16px 0", fontWeight: isOver ? 700 : 400 }}>{isOver ? "ここにドロップ" : "—"}</div>}
            {items.map((p) => (
              <Card key={p.id} p={p} stageIdx={STAGES.indexOf(stage)} busy={busyId === p.id && pending} members={members}
                isDragging={draggingId === p.id}
                onDragStart={(id: string) => setDraggingId(id)}
                onDragEnd={() => { setDraggingId(null); setOverStage(null); }}
                onMove={onMove} onLose={onLose} onEngage={onEngage} onSave={onSave} onDelete={onDelete} />
            ))}
          </div>
        );
      })}
      </div>
    </div>
  );
}
