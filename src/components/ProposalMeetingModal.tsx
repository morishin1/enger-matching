"use client";

// 面談設定モーダル。日付・時間・形式（オンライン/対面/電話/その他）、
// ミーティングURL、参加者、備考をまとめて保存し、面談ステータスを「日程確定」に更新する。
import { useEffect, useState, useTransition } from "react";
import { updateProposalFields } from "@/lib/actions";

export const MEETING_FORMATS = ["オンライン(Zoom)", "オンライン(Teams)", "オンライン(Google Meet)", "対面", "電話", "その他"] as const;

export function ProposalMeetingModal({ p, onClose, onSaved }: { p: any; onClose: () => void; onSaved?: () => void }) {
  const [date, setDate] = useState<string>(p.meeting_date ?? "");
  const [time, setTime] = useState<string>(p.meeting_time ?? "");
  const [format, setFormat] = useState<string>(p.meeting_format ?? MEETING_FORMATS[0]);
  const [url, setUrl] = useState<string>(p.meeting_url ?? "");
  const [attendees, setAttendees] = useState<string>(p.meeting_attendees ?? "");
  const [note, setNote] = useState<string>(p.meeting_note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const submit = () => {
    setError(null);
    if (!date) { setError("日付を入力してください"); return; }
    start(async () => {
      const r = await updateProposalFields(p.id, {
        meeting_date: date || null,
        meeting_time: time || null,
        meeting_format: format || null,
        meeting_url: url.trim() || null,
        meeting_attendees: attendees.trim() || null,
        meeting_note: note.trim() || null,
        // 日程が決まったら面談ステータスを「日程確定」へ自動更新（既存値が "実施済" など以外の場合）
        meeting_status: ["実施済", "リスケ", "キャンセル"].includes(p.meeting_status) ? p.meeting_status : "日程確定",
      });
      if (!r.ok) { setError(r.error || "保存に失敗しました"); return; }
      onSaved?.();
      onClose();
    });
  };

  const labelTone = { display: "flex", flexDirection: "column" as const, gap: 5, fontSize: 11.5, color: "var(--color-ink-4)" };
  const inputTone = { fontFamily: "inherit", fontSize: 13, padding: "9px 11px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,36,64,.55)", display: "grid", placeItems: "center", padding: 20, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(560px, 96vw)", padding: 0, background: "var(--color-surface)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>面談設定</div>
          <button type="button" onClick={onClose} className="btn ghost" aria-label="閉じる" style={{ fontSize: 18, lineHeight: 1, padding: "4px 10px" }}>×</button>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={labelTone}>対象者
            <div style={{ ...inputTone, background: "var(--color-surface-soft)", color: "var(--color-ink-2)" }}>{[p.c_init || p.candidate_name, p.job_title].filter(Boolean).join(" × ")}</div>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={labelTone}>日付
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputTone} />
            </label>
            <label style={labelTone}>時間
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputTone} />
            </label>
          </div>
          <label style={labelTone}>形式
            <select value={format} onChange={(e) => setFormat(e.target.value)} style={inputTone}>
              {MEETING_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label style={labelTone}>ミーティングURL
            <textarea value={url} onChange={(e) => setUrl(e.target.value)} rows={2} placeholder="例: https://zoom.us/j/..." style={{ ...inputTone, resize: "vertical" }} />
          </label>
          <label style={labelTone}>参加者
            <input type="text" value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="例: 田中、クライアント山田様" style={inputTone} />
          </label>
          <label style={labelTone}>備考
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="面談の目的、質問事項など…" style={{ ...inputTone, resize: "vertical" }} />
          </label>
          {error && <div style={{ fontSize: 12, color: "var(--color-danger)", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "8px 11px" }}>{error}</div>}
        </div>
        <div style={{ padding: "12px 22px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" disabled={pending} onClick={onClose}>キャンセル</button>
          <button type="button" className="btn brand" disabled={pending} onClick={submit}>{pending ? "保存中…" : "面談を設定"}</button>
        </div>
      </div>
    </div>
  );
}
