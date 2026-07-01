"use client";

// LINE（LINE WORKS）共有ボタン：雛形メッセージを確認・編集してから送信／コピーできる。
//   ・雛形（案件/人材/マッチ）を textarea で自由に編集（文章確認）
//   ・「コピー」… 通常の LINE などへ貼り付けてシェアする用
//   ・「LINE WORKSに送信」… 記憶済みトーク（lineworks_targets）を選んで Bot から送信
import { useState } from "react";
import { Icons } from "@/components/icons";
import type { LineworksTarget } from "@/lib/lineworks-targets";
import { sendLineworksText } from "@/lib/lineworks-share-actions";

const fmtSeen = (s: string) => {
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const targetLabel = (t: LineworksTarget) =>
  t.name?.trim() || (t.last_text ? `「${t.last_text.slice(0, 18)}…」` : `${t.kind === "channel" ? "グループ" : "1:1"} ${t.target_id.slice(-6)}`);

export function LineShareButton({ targets, text, label = "LINEに送る", compact = false, buttonTitle }: {
  targets: LineworksTarget[];
  text: string;            // 雛形（開いた時点の初期本文）
  label?: string;
  compact?: boolean;
  buttonTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(text);
  const [sel, setSel] = useState<string | null>(null); // 選択中 target.id
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const openModal = () => { setBody(text); setSel(targets[0]?.id ?? null); setMsg(null); setOpen(true); };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setMsg({ ok: true, text: "✓ コピーしました（LINE等に貼り付けてシェアできます）" });
    } catch {
      setMsg({ ok: false, text: "コピーに失敗しました（手動で選択してコピーしてください）" });
    }
  };

  const send = () => {
    const t = targets.find((x) => x.id === sel);
    if (!t || busy) return;
    setBusy(true); setMsg(null);
    sendLineworksText({ kind: t.kind, targetId: t.target_id, text: body }).then((res) => {
      setBusy(false);
      if (res.ok) setMsg({ ok: true, text: `✓ ${targetLabel(t)} に送信しました` });
      else setMsg({ ok: false, text: res.error || "送信に失敗しました" });
    });
  };

  return (
    <>
      <button type="button" className={"btn ghost" + (compact ? " btn-xs" : "")} onClick={openModal}
        title={buttonTitle ?? "LINE向けの文章（雛形）を確認・編集して、LINE WORKSへ送信 or コピーでシェアします"}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
        <span style={{ lineHeight: 0, display: "inline-flex" }}><Icons.line size={compact ? 15 : 17} /></span>
        {label}
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 420, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 620, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ lineHeight: 0, display: "inline-flex" }}><Icons.line size={20} /></span>
                LINEに送る（文章の確認・編集）
              </h3>
              <button className="btn ghost btn-xs" onClick={() => setOpen(false)}>閉じる</button>
            </div>

            <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
              雛形を確認・編集してから送信できます。クライアント名など<b>商流上出せない情報が入っていないか</b>確認してください。
              「コピー」で通常のLINEにも貼り付けできます。
            </div>

            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12}
              style={{ width: "100%", fontSize: 13, lineHeight: 1.7, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "inherit", resize: "vertical" }} />

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-4)", marginBottom: 6 }}>送信先（LINE WORKS のトーク）</div>
              {targets.length === 0 ? (
                <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                  送信先がまだありません。LINE WORKS で <b>Bot のいるトークに一度何か投稿</b>すると宛先に表示されます（コピーでのシェアは可能です）。
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 180, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 10, padding: 6 }}>
                  {targets.map((t) => (
                    <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, cursor: "pointer", background: sel === t.id ? "var(--color-brand-25)" : "transparent" }}>
                      <input type="radio" name="lw-target" checked={sel === t.id} onChange={() => setSel(t.id)} style={{ accentColor: "var(--color-brand-600)" }} />
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{targetLabel(t)}</span>
                      <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto", flexShrink: 0 }}>{t.kind === "channel" ? "グループ" : "1:1"} · 最終 {fmtSeen(t.last_seen_at)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="btn ghost" onClick={copy} title="本文をコピー（通常のLINE等に貼り付けてシェア）">
                <span className="material-symbols-outlined" style={{ fontSize: 17, marginRight: 4, verticalAlign: "-3px" }}>content_copy</span>コピー
              </button>
              <button type="button" className="btn brand" onClick={send} disabled={busy || !sel || targets.length === 0}
                title="選択したLINE WORKSトークへ、この本文を送信します">
                <span className="material-symbols-outlined" style={{ fontSize: 17, marginRight: 4, verticalAlign: "-3px" }}>send</span>
                {busy ? "送信中…" : "LINE WORKSに送信"}
              </button>
              {msg && <span style={{ fontSize: 11.5, color: msg.ok ? "#067647" : "var(--color-danger)" }}>{msg.text}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
