"use client";

// 案件側・人材側の2通を1つのモーダルにまとめて送信するボタン。
//   1つの「送信」ボタンで両フォームを検証し、まとめて2通を Xserver SMTP で送信する。
//   送信元（差出人ドメイン）の選択肢は /api/mail/senders から取得（設定済みのものだけ表示）。
import { useEffect, useState, useTransition, Fragment, type CSSProperties } from "react";
import { sendMailAction } from "@/lib/actions";
import { BUTTON_PLACEHOLDER, NOTICE_TEXT } from "./JobMailBodyCard";
import { SHARED_MAILBOX } from "@/lib/proposal-constants";

type Sender = { key: "enger" | "8grp"; label: string; address: string };

export type MailSide = {
  /** ラベル（例: 案件側 / 人材側） */
  label: string;
  /** ヘッダーのドット色 */
  dotColor: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  buttonHtml?: string;
  relatedKind?: string;
  relatedId?: string;
};

export function SendBothMailsButton({
  jobSide, candSide, label = "📨 メールを送信", className = "btn brand", disabled, onSent, autoOpen, onAutoOpened, hideButton,
}: {
  jobSide: MailSide;
  candSide: MailSide;
  label?: string;
  className?: string;
  disabled?: boolean;
  onSent?: () => void;
  /** 親から「今すぐ開いて」と命令する用。保存→自動で送信モーダルを開くフローに使う。 */
  autoOpen?: boolean;
  onAutoOpened?: () => void;
  /** ボタン非表示にしてモーダルだけ親制御で表示するモード（autoOpen と併用）。 */
  hideButton?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (autoOpen) { setOpen(true); onAutoOpened?.(); } }, [autoOpen, onAutoOpened]);
  return (
    <>
      {!hideButton && <button type="button" className={className} disabled={disabled} onClick={() => setOpen(true)}>{label}</button>}
      {open && <SendBothModal jobSide={jobSide} candSide={candSide} onClose={() => setOpen(false)} onSent={onSent} />}
    </>
  );
}

function buildHtmlBody(text: string, buttonHtml: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const wrapStyle = `white-space:pre-wrap;font-family:sans-serif;font-size:14px;color:#1e293b`;
  const parts = text.split(BUTTON_PLACEHOLDER);
  if (parts.length === 1) {
    return `<div style="${wrapStyle}">${escape(text)}</div>\n${buttonHtml}`;
  }
  return parts.map((part, i) => {
    const div = `<div style="${wrapStyle}">${escape(part)}</div>`;
    return i < parts.length - 1 ? `${div}\n${buttonHtml}` : div;
  }).join("\n");
}

type SideState = {
  sender: "enger" | "8grp";
  to: string;
  cc: string;
  subject: string;
};

type SideResult = { ok: boolean; text: string } | null;

function SendBothModal({ jobSide, candSide, onClose, onSent }: {
  jobSide: MailSide; candSide: MailSide;
  onClose: () => void; onSent?: () => void;
}) {
  const [pending, start] = useTransition();
  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [me, setMe] = useState<{ name: string | null; email: string | null }>({ name: null, email: null });

  const [job, setJob] = useState<SideState>({ sender: "enger", to: jobSide.to, cc: jobSide.cc ?? "", subject: jobSide.subject });
  const [cand, setCand] = useState<SideState>({ sender: "enger", to: candSide.to, cc: candSide.cc ?? "", subject: candSide.subject });

  const [jobErr, setJobErr] = useState<string | null>(null);
  const [candErr, setCandErr] = useState<string | null>(null);

  // 送信結果（各側ごと）。両方成功で完了状態に。
  const [jobRes, setJobRes] = useState<SideResult>(null);
  const [candRes, setCandRes] = useState<SideResult>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    fetch("/api/mail/senders").then((r) => r.json()).then((d) => {
      if (d.ok) {
        setSenders(d.senders);
        if (d.me) setMe(d.me);
        // 既定の送信元は共有Gmail寄りの「8grp」（その箱が設定されていれば）。なければ先頭。
        const list: Sender[] = d.senders ?? [];
        const preferred = list.find((s) => s.key === "8grp") ?? list[0];
        if (preferred) {
          setJob((p) => ({ ...p, sender: preferred.key }));
          setCand((p) => ({ ...p, sender: preferred.key }));
        }
      }
    }).catch(() => setSenders([]));
  }, []);

  const sendOne = async (side: MailSide, st: SideState): Promise<{ ok: boolean; error?: string }> => {
    const cleanText = side.body.replace(BUTTON_PLACEHOLDER, NOTICE_TEXT);
    const html = side.buttonHtml ? buildHtmlBody(side.body, side.buttonHtml) : null;
    return sendMailAction({
      sender: st.sender, to: st.to, cc: st.cc || null, subject: st.subject,
      text: cleanText, html,
      relatedKind: side.relatedKind || null, relatedId: side.relatedId || null,
    });
  };

  const send = () => {
    setJobErr(null); setCandErr(null);
    // 両フォームを検証（宛先必須）
    const jobMissing = !job.to.trim();
    const candMissing = !cand.to.trim();
    if (jobMissing) setJobErr("宛先を入力してください");
    if (candMissing) setCandErr("宛先を入力してください");
    if (jobMissing || candMissing) return;

    start(async () => {
      // 既に成功済みの側は再送しない（部分失敗からの再試行に対応）
      const [jr, cr] = await Promise.all([
        jobRes?.ok ? Promise.resolve({ ok: true } as { ok: boolean; error?: string }) : sendOne(jobSide, job),
        candRes?.ok ? Promise.resolve({ ok: true } as { ok: boolean; error?: string }) : sendOne(candSide, cand),
      ]);
      setJobRes(jr.ok ? { ok: true, text: "✓ 送信しました" } : { ok: false, text: jr.error || "送信に失敗しました" });
      setCandRes(cr.ok ? { ok: true, text: "✓ 送信しました" } : { ok: false, text: cr.error || "送信に失敗しました" });
      if (jr.ok && cr.ok) {
        setDone(true);
        onSent?.();
      }
    });
  };

  const inp: CSSProperties = { fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%", boxSizing: "border-box" };
  const lbl: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" };
  const noSenders = senders && senders.length === 0;
  const senderAddr = (key: "enger" | "8grp") => (senders ?? []).find((s) => s.key === key)?.address ?? "—";

  const renderSide = (
    side: MailSide,
    st: SideState,
    setSt: (u: (p: SideState) => SideState) => void,
    err: string | null,
    setErr: (e: string | null) => void,
    res: SideResult,
  ) => (
    <div style={{ flex: 1, minWidth: 0, border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-soft)" }}>
        <div style={{ width: 11, height: 11, borderRadius: "50%", background: side.dotColor, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>{side.label}</span>
        {res?.ok && <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#067647", fontWeight: 700 }}>✓ 送信済み</span>}
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={lbl}>差出人（ドメイン）
          <select value={st.sender} onChange={(e) => setSt((p) => ({ ...p, sender: e.target.value as "enger" | "8grp" }))} style={inp} disabled={!senders || res?.ok}>
            {(senders ?? []).map((s) => <option key={s.key} value={s.key}>{s.label} — {s.address}</option>)}
          </select>
        </label>
        <div style={{ fontSize: 11, color: "var(--color-ink-3)", background: "var(--color-surface-soft)", borderRadius: 8, padding: "7px 10px", lineHeight: 1.6 }}>
          <div>差出人表示：<b>{me.name || "（あなたの名前）"}</b> &lt;{senderAddr(st.sender)}&gt;</div>
          <div>返信先：<b>{me.email || "（あなたのメール）"}</b></div>
        </div>
        <label style={lbl}>宛先（To）
          <input value={st.to} onChange={(e) => { setSt((p) => ({ ...p, to: e.target.value })); setErr(null); }} placeholder="to@example.com（カンマ区切りで複数可）" style={{ ...inp, ...(err ? { borderColor: "var(--color-danger)" } : null) }} disabled={res?.ok} />
          {err && <span style={{ color: "var(--color-danger)", fontSize: 11 }}>{err}</span>}
        </label>
        <label style={lbl}>CC（任意）<input value={st.cc} onChange={(e) => setSt((p) => ({ ...p, cc: e.target.value }))} placeholder="cc@example.com" style={inp} disabled={res?.ok} /></label>
        <label style={lbl}>件名<input value={st.subject} onChange={(e) => setSt((p) => ({ ...p, subject: e.target.value }))} style={inp} disabled={res?.ok} /></label>
        <div style={lbl}>
          <span>本文</span>
          <div style={{ border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface-soft)", padding: "10px 12px", fontSize: 12.5, lineHeight: 1.7, overflowY: "auto", maxHeight: 240 }}>
            {(() => {
              const preStyle: CSSProperties = { margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.7, color: "var(--color-ink-2)" };
              const parts = side.body.split(BUTTON_PLACEHOLDER);
              if (parts.length === 1) return <pre style={preStyle}>{side.body}</pre>;
              return parts.map((part, i) => (
                <Fragment key={i}>
                  <pre style={preStyle}>{i === 0 ? part : part.replace(/^\n/, "")}</pre>
                  {i < parts.length - 1 && (
                    <div dangerouslySetInnerHTML={{ __html: side.buttonHtml ?? "" }} />
                  )}
                </Fragment>
              ));
            })()}
          </div>
        </div>
        {res && !res.ok && (
          <div style={{ fontSize: 12, padding: "8px 11px", borderRadius: 8, background: "#fdecef", color: "var(--color-danger)", border: "1px solid #f7c5cf" }}>{res.text}</div>
        )}
      </div>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,36,64,.5)", display: "grid", placeItems: "center", padding: 20, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(1040px, 96vw)", maxHeight: "92vh", overflowY: "auto", padding: 0, background: "var(--color-surface)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>メールを送信（案件側・人材側）</div>
          <button type="button" onClick={onClose} className="btn ghost" aria-label="閉じる" style={{ fontSize: 18, lineHeight: 1, padding: "4px 10px" }}>×</button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          {noSenders ? (
            <div style={{ fontSize: 12.5, color: "#9a7b12", background: "#fff6e0", border: "1px solid #fde9b0", borderRadius: 8, padding: "10px 12px" }}>
              送信元（SMTP）が未設定です。Vercel 環境変数に <span className="mono">SMTP_HOST</span> と
              <span className="mono"> SMTP_ENGER_USER/PASS</span>（または <span className="mono">SMTP_8GRP_USER/PASS</span>）を設定してください。
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>
                ※ 「この内容で2通送信」を押すと、案件側・人材側の両方へ同時に送信します。名前と返信先はログイン中のあなたになります。
              </div>
              <div style={{ fontSize: 11.5, color: "#067647", background: "#e7f7ee", border: "1px solid #bfe3cc", borderRadius: 8, padding: "8px 11px", display: "flex", alignItems: "center", gap: 6 }}>
                <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 16 }}>forward_to_inbox</span>
                送信メールは共有Gmail <b style={{ margin: "0 2px" }}>{SHARED_MAILBOX}</b> にBCCで自動コピーされます（全員がGmailで送信内容を確認可能）。
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
                {renderSide(jobSide, job, setJob, jobErr, setJobErr, jobRes)}
                {renderSide(candSide, cand, setCand, candErr, setCandErr, candRes)}
              </div>
              {done && (
                <div style={{ fontSize: 12.5, padding: "9px 12px", borderRadius: 8, background: "#e7f7ee", color: "#067647", border: "1px solid #bfe3cc" }}>✓ 両方のメールを送信しました</div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: "12px 22px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" disabled={pending} onClick={onClose}>{done ? "閉じる" : "キャンセル"}</button>
          {!done && (
            <button type="button" className="btn brand" disabled={pending || !!noSenders} onClick={send}>
              {pending ? "送信中…" : (jobRes?.ok || candRes?.ok) ? "📨 未送信を再試行" : "📨 この内容で2通送信"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
