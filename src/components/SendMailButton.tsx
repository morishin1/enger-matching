"use client";

// メール送信ボタン＋確認モーダル。差出人ドメイン（enger.jp / 8grp.co.jp）を選んで Xserver SMTP で送信。
//   どこからでも使えるよう、宛先・件名・本文を props で受け取る独立部品。
//   送信先（差出人）の選択肢は /api/mail/senders から取得（設定済みのものだけ表示）。
import { useEffect, useState, useTransition, Fragment, type CSSProperties } from "react";
import { sendMailAction } from "@/lib/actions";
import { BUTTON_PLACEHOLDER, NOTICE_TEXT } from "./JobMailBodyCard";

type SenderKey = "enger" | "8grp" | "its";
type Sender = { key: SenderKey; label: string; address: string };

export function SendMailButton({
  to, cc, subject, body, buttonHtml, relatedKind, relatedId, label = "📨 送信", className = "btn brand",
  disabled, onSent,
}: {
  to: string; cc?: string; subject: string; body: string;
  buttonHtml?: string;
  relatedKind?: string; relatedId?: string;
  label?: string; className?: string; disabled?: boolean;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => setOpen(true)}>{label}</button>
      {open && <SendModal to={to} cc={cc} subject={subject} body={body} buttonHtml={buttonHtml} relatedKind={relatedKind} relatedId={relatedId} onClose={() => setOpen(false)} onSent={onSent} />}
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

function SendModal({ to, cc, subject, body, buttonHtml, relatedKind, relatedId, onClose, onSent }: {
  to: string; cc?: string; subject: string; body: string;
  buttonHtml?: string;
  relatedKind?: string; relatedId?: string;
  onClose: () => void; onSent?: () => void;
}) {
  const [pending, start] = useTransition();
  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [me, setMe] = useState<{ name: string | null; email: string | null }>({ name: null, email: null });
  const [sender, setSender] = useState<SenderKey>("its");
  const [eTo, setETo] = useState(to);
  const [eCc, setECc] = useState(cc ?? "");
  const [eSubject, setESubject] = useState(subject);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    fetch("/api/mail/senders").then((r) => r.json()).then((d) => {
      if (d.ok) {
        setSenders(d.senders); if (d.me) setMe(d.me);
        // 既定の差出人は共有Gmail「its（its@gw.8grp.co.jp）」（設定されていれば）
        const list = (d.senders ?? []) as Sender[];
        const preferred = list.find((s) => s.key === "its") ?? list[0];
        if (preferred) setSender(preferred.key);
      }
    }).catch(() => setSenders([]));
  }, []);

  const send = () => {
    setMsg(null);
    if (!eTo.trim()) { setMsg({ ok: false, text: "宛先を入力してください" }); return; }
    start(async () => {
      const cleanText = body.replace(BUTTON_PLACEHOLDER, NOTICE_TEXT);
      const html = buttonHtml ? buildHtmlBody(body, buttonHtml) : null;
      const r = await sendMailAction({ sender, to: eTo, cc: eCc || null, subject: eSubject, text: cleanText, html, relatedKind: relatedKind || null, relatedId: relatedId || null });
      if (!r.ok) { setMsg({ ok: false, text: r.error || "送信に失敗しました" }); return; }
      setDone(true);
      setMsg({ ok: true, text: "✓ 送信しました" });
      onSent?.();
    });
  };

  const inp = { fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%", boxSizing: "border-box" as const };
  const lbl = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 11, color: "var(--color-ink-4)" };
  const noSenders = senders && senders.length === 0;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,36,64,.5)", display: "grid", placeItems: "center", padding: 20, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(640px, 96vw)", maxHeight: "92vh", overflowY: "auto", padding: 0, background: "var(--color-surface)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>メールを送信</div>
          <button type="button" onClick={onClose} className="btn ghost" aria-label="閉じる" style={{ fontSize: 18, lineHeight: 1, padding: "4px 10px" }}>×</button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
          {noSenders ? (
            <div style={{ fontSize: 12.5, color: "#9a7b12", background: "#fff6e0", border: "1px solid #fde9b0", borderRadius: 8, padding: "10px 12px" }}>
              送信元（SMTP）が未設定です。Vercel 環境変数に
              <span className="mono"> SMTP_ITS_USER/PASS</span>（Google Workspace 経由・推奨）か
              <span className="mono"> SMTP_HOST</span> + <span className="mono">SMTP_ENGER_USER/PASS</span>（Xserver 経由）を設定してください。
            </div>
          ) : (
            <>
              <label style={lbl}>差出人
                <select value={sender} onChange={(e) => setSender(e.target.value as SenderKey)} style={inp} disabled={!senders}>
                  {(senders ?? []).map((s) => <option key={s.key} value={s.key}>{s.label} — {s.address}</option>)}
                </select>
              </label>
              {(() => {
                const addr = (senders ?? []).find((s) => s.key === sender)?.address ?? "—";
                return (
                  <div style={{ fontSize: 11.5, color: "var(--color-ink-3)", background: "var(--color-surface-soft)", borderRadius: 8, padding: "8px 11px", lineHeight: 1.7 }}>
                    <div>差出人：<b>{addr}</b></div>
                    <div>差出人表示：<b>{addr}</b></div>
                    <div>返信先：<b>its@gw.8grp.co.jp</b>（共有・全員が対応可）</div>
                    <div>CC：<b>{me.email || "（あなたのメール）"}</b>（自動追加）</div>
                  </div>
                );
              })()}
              <label style={lbl}>宛先（To）<input value={eTo} onChange={(e) => setETo(e.target.value)} placeholder="to@example.com（カンマ区切りで複数可）" style={inp} /></label>
              <label style={lbl}>CC（任意）<input value={eCc} onChange={(e) => setECc(e.target.value)} placeholder="cc@example.com" style={inp} /></label>
              <label style={lbl}>件名<input value={eSubject} onChange={(e) => setESubject(e.target.value)} style={inp} /></label>
              <div style={lbl}>
                <span>本文</span>
                <div style={{ border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface-soft)", padding: "12px 14px", fontSize: 13, lineHeight: 1.75, overflowY: "auto", maxHeight: 340 }}>
                  {(() => {
                    const preStyle: CSSProperties = { margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: 1.75, color: "var(--color-ink-2)" };
                    const parts = body.split(BUTTON_PLACEHOLDER);
                    if (parts.length === 1) return <pre style={preStyle}>{body}</pre>;
                    return parts.map((part, i) => (
                      <Fragment key={i}>
                        <pre style={preStyle}>{i === 0 ? part : part.replace(/^\n/, "")}</pre>
                        {i < parts.length - 1 && (
                          <div dangerouslySetInnerHTML={{ __html: buttonHtml ?? "" }} />
                        )}
                      </Fragment>
                    ));
                  })()}
                </div>
              </div>
            </>
          )}
          {msg && (
            <div style={{ fontSize: 12.5, padding: "9px 12px", borderRadius: 8, background: msg.ok ? "#e7f7ee" : "#fdecef", color: msg.ok ? "#067647" : "var(--color-danger)", border: msg.ok ? "1px solid #bfe3cc" : "1px solid #f7c5cf" }}>{msg.text}</div>
          )}
        </div>

        <div style={{ padding: "12px 22px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" disabled={pending} onClick={onClose}>{done ? "閉じる" : "キャンセル"}</button>
          {!done && <button type="button" className="btn brand" disabled={pending || !!noSenders} onClick={send}>{pending ? "送信中…" : "📨 この内容で送信"}</button>}
        </div>
      </div>
    </div>
  );
}
