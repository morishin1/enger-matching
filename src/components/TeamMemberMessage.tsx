"use client";

// 部下行のメッセージ送信ボタン＋モーダル。
//   ボタン押下でモーダル展開 → 本文を入力 → 「送信」で notifications に追加。
//   よく使う定型文（フォロー/称賛/日報リマインド）はクイック挿入できる。

import { useState, useTransition } from "react";
import { sendMemberMessage } from "@/app/team/actions";

const TEMPLATES: { label: string; body: string }[] = [
  { label: "📞 フォロー依頼", body: "提案先のフォロー状況を共有してください。次の一手を一緒に考えましょう。" },
  { label: "👏 称賛",         body: "今週のがんばり、素晴らしいです。引き続きよろしくお願いします！" },
  { label: "📓 日報リマインド", body: "今日の日報、忘れずに提出をお願いします。1日の振り返りで次の一手が見えます。" },
  { label: "🎯 KGI再確認",     body: "今月のKGI進捗を確認しましょう。困っていることがあれば1on1で相談してください。" },
];

export function TeamMemberMessage({ recipient, hint }: { recipient: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const send = () => {
    if (!text.trim()) { setMsg({ ok: false, text: "メッセージを入力してください" }); return; }
    setMsg(null);
    start(async () => {
      const r = await sendMemberMessage(recipient, text.trim());
      if (r.ok) { setMsg({ ok: true, text: "送信しました" }); setText(""); setTimeout(() => { setOpen(false); setMsg(null); }, 1200); }
      else setMsg({ ok: false, text: r.error ?? "送信に失敗しました" });
    });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={`${recipient} にメッセージを送る`}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-brand-700)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>send</span>
        メッセージ
      </button>

      {open && (
        <div onClick={() => !pending && setOpen(false)} role="dialog" aria-modal="true"
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "center", zIndex: 600, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 520, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
                <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, verticalAlign: "-3px", marginRight: 4, color: "var(--color-brand-700)" }}>forward_to_inbox</span>
                {recipient} さんへメッセージ
              </h3>
              <button type="button" onClick={() => setOpen(false)} className="btn ghost btn-xs" disabled={pending}>✕</button>
            </div>
            {hint && <div className="muted" style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>{hint}</div>}

            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {TEMPLATES.map((t) => (
                <button key={t.label} type="button" onClick={() => setText((s) => (s ? s + "\n" : "") + t.body)} disabled={pending}
                  style={{ fontSize: 10.5, padding: "4px 10px", borderRadius: 99, border: "1px solid var(--color-border)", background: "var(--color-surface-soft)", cursor: "pointer", color: "var(--color-ink-2)", fontFamily: "inherit" }}>
                  {t.label}
                </button>
              ))}
            </div>

            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="メッセージを入力（本人のお知らせに届きます）"
              rows={6} disabled={pending} maxLength={2000}
              style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: 10, borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", resize: "vertical" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {msg && <span style={{ fontSize: 12, color: msg.ok ? "#067647" : "var(--color-danger)" }}>{msg.text}</span>}
              <span style={{ flex: 1 }} />
              <span className="muted" style={{ fontSize: 10.5 }}>{text.length} / 2000</span>
              <button type="button" onClick={send} disabled={pending || !text.trim()}
                className="btn brand btn-xs"
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>send</span>
                {pending ? "送信中…" : "送信する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
