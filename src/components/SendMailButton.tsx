"use client";

// メール送信ボタン＋確認モーダル。差出人ドメイン（enger.jp / 8grp.co.jp）を選んで Xserver SMTP で送信。
//   どこからでも使えるよう、宛先・件名・本文を props で受け取る独立部品。
//   送信先（差出人）の選択肢は /api/mail/senders から取得（設定済みのものだけ表示）。
import { useEffect, useState, useTransition } from "react";
import { sendMailAction } from "@/lib/actions";

type Sender = { key: "enger" | "8grp"; label: string; address: string };

export function SendMailButton({
  to, cc, subject, body, relatedKind, relatedId, label = "📨 送信", className = "btn brand",
  disabled, onSent,
}: {
  to: string; cc?: string; subject: string; body: string;
  relatedKind?: string; relatedId?: string;
  label?: string; className?: string; disabled?: boolean;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => setOpen(true)}>{label}</button>
      {open && <SendModal to={to} cc={cc} subject={subject} body={body} relatedKind={relatedKind} relatedId={relatedId} onClose={() => setOpen(false)} onSent={onSent} />}
    </>
  );
}

function SendModal({ to, cc, subject, body, relatedKind, relatedId, onClose, onSent }: {
  to: string; cc?: string; subject: string; body: string;
  relatedKind?: string; relatedId?: string;
  onClose: () => void; onSent?: () => void;
}) {
  const [pending, start] = useTransition();
  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [me, setMe] = useState<{ name: string | null; email: string | null }>({ name: null, email: null });
  const [sender, setSender] = useState<"enger" | "8grp">("enger");
  const [eTo, setETo] = useState(to);
  const [eCc, setECc] = useState(cc ?? "");
  const [eSubject, setESubject] = useState(subject);
  const [eBody, setEBody] = useState(body);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    fetch("/api/mail/senders").then((r) => r.json()).then((d) => {
      if (d.ok) { setSenders(d.senders); if (d.me) setMe(d.me); if (d.senders?.[0]) setSender(d.senders[0].key); }
    }).catch(() => setSenders([]));
  }, []);

  const send = () => {
    setMsg(null);
    if (!eTo.trim()) { setMsg({ ok: false, text: "宛先を入力してください" }); return; }
    start(async () => {
      const r = await sendMailAction({ sender, to: eTo, cc: eCc || null, subject: eSubject, text: eBody, relatedKind: relatedKind || null, relatedId: relatedId || null });
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
              送信元（SMTP）が未設定です。Vercel 環境変数に <span className="mono">SMTP_HOST</span> と
              <span className="mono"> SMTP_ENGER_USER/PASS</span>（または <span className="mono">SMTP_8GRP_USER/PASS</span>）を設定してください。
            </div>
          ) : (
            <>
              <label style={lbl}>差出人（ドメイン）
                <select value={sender} onChange={(e) => setSender(e.target.value as any)} style={inp} disabled={!senders}>
                  {(senders ?? []).map((s) => <option key={s.key} value={s.key}>{s.label} — {s.address}</option>)}
                </select>
              </label>
              {/* 実際にどう送られるかのプレビュー：表示名=ログイン者 / 返信先=ログイン者のメール */}
              <div style={{ fontSize: 11.5, color: "var(--color-ink-3)", background: "var(--color-surface-soft)", borderRadius: 8, padding: "8px 11px", lineHeight: 1.7 }}>
                <div>差出人表示：<b>{me.name || "（あなたの名前）"}</b> &lt;{(senders ?? []).find((s) => s.key === sender)?.address ?? "—"}&gt;</div>
                <div>返信先：<b>{me.email || "（あなたのメール）"}</b>（相手が返信するとあなたに届きます）</div>
                <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>※ 配信のため送信元アドレスは共有箱のままです。名前と返信先がログイン中のあなたになります。</div>
              </div>
              <label style={lbl}>宛先（To）<input value={eTo} onChange={(e) => setETo(e.target.value)} placeholder="to@example.com（カンマ区切りで複数可）" style={inp} /></label>
              <label style={lbl}>CC（任意）<input value={eCc} onChange={(e) => setECc(e.target.value)} placeholder="cc@example.com" style={inp} /></label>
              <label style={lbl}>件名<input value={eSubject} onChange={(e) => setESubject(e.target.value)} style={inp} /></label>
              <label style={lbl}>本文<textarea value={eBody} onChange={(e) => setEBody(e.target.value)} rows={12} style={{ ...inp, resize: "vertical", minHeight: 220, lineHeight: 1.7 }} /></label>
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
