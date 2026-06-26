"use client";

// LINE 会話ビュー（/line の「トーク」タブ）。
//   左：Bot が参加するトークの一覧（lineworks_targets）
//   右：選択中トークのやりとり（チャットバブル）＋ ENGER からの返信入力
//   ・inbound = 相手の投稿（左・グレー） / outbound = Bot/ENGER（右・ブランド色）
//   ・msg_type='cards' はマッチ結果カードを描画（「ENGERで開く」リンク付き）
import { useState } from "react";
import Link from "@/components/AppLink";
import type { LineworksTarget } from "@/lib/lineworks-targets";
import type { LineworksMessage } from "@/lib/lineworks-messages";
import { getLineworksThread, sendLineworksReply } from "@/app/line/line-actions";

const fmtTime = (s: string) => {
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const targetLabel = (t: LineworksTarget) =>
  t.name?.trim() || (t.last_text ? `「${t.last_text.slice(0, 20)}…」` : `${t.kind === "channel" ? "グループ" : "1:1"} ${t.target_id.slice(-6)}`);

function Bubble({ m }: { m: LineworksMessage }) {
  const out = m.direction === "outbound";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: out ? "flex-end" : "flex-start", gap: 2 }}>
      <span style={{ fontSize: 10, color: "var(--color-ink-4)", padding: "0 4px" }}>
        {m.sender_name || (out ? "ENGER" : "相手")} · {fmtTime(m.created_at)}
      </span>
      {m.msg_type === "cards" && m.cards?.length ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxWidth: "100%" }}>
          {m.cards.map((c, i) => (
            <div key={i} style={{ width: 200, border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden", background: "var(--color-surface)" }}>
              <div style={{ padding: "8px 10px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-ink)", lineHeight: 1.4 }}>{c.title}</div>
                <div style={{ fontSize: 11, color: "var(--color-ink-3)", marginTop: 3 }}>{c.text}</div>
              </div>
              {c.url && (
                <Link href={c.url} style={{ display: "block", textAlign: "center", padding: "7px 0", borderTop: "1px solid var(--color-border)", fontSize: 12, fontWeight: 700, color: "var(--color-brand-700)", textDecoration: "none" }}>
                  ENGERで開く
                </Link>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          maxWidth: "78%", padding: "8px 12px", borderRadius: 12, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
          background: out ? "var(--color-brand-600)" : "var(--color-surface-inset)",
          color: out ? "#fff" : "var(--color-ink)",
          borderBottomRightRadius: out ? 3 : 12, borderBottomLeftRadius: out ? 12 : 3,
        }}>{m.body}</div>
      )}
    </div>
  );
}

export function LineConversations({ targets }: { targets: LineworksTarget[] }) {
  const [sel, setSel] = useState<LineworksTarget | null>(null);
  const [messages, setMessages] = useState<LineworksMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openThread = (t: LineworksTarget) => {
    setSel(t); setErr(null); setLoading(true); setMessages([]);
    getLineworksThread(t.kind, t.target_id).then((res) => {
      setLoading(false);
      if (!res.ok) { setErr(res.error || "読み込みに失敗しました"); return; }
      setMessages(res.messages);
    });
  };

  const send = () => {
    if (!sel || !text.trim()) return;
    setSending(true); setErr(null);
    const t = sel;
    sendLineworksReply({ kind: t.kind, targetId: t.target_id, text: text.trim() }).then((res) => {
      setSending(false);
      if (!res.ok) { setErr(res.error || "送信に失敗しました"); return; }
      setText("");
      openThread(t); // 送信後に再読込して反映
    });
  };

  if (targets.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 32, fontSize: 13, lineHeight: 1.8 }}>
        まだ LINE のやりとりがありません。<br />
        LINE WORKS で <b>Bot のいるトークに投稿</b>すると、ここにトークが表示されます。
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>※ Bot は過去履歴を取得できないため、表示されるのはこの機能の有効化以降のメッセージです。</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 280px) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
      {/* 左：トーク一覧 */}
      <div className="card flush" style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", fontSize: 12, fontWeight: 700 }}>トーク</div>
        <div style={{ display: "flex", flexDirection: "column", maxHeight: 540, overflowY: "auto" }}>
          {targets.map((t) => {
            const active = sel?.id === t.id;
            return (
              <button key={t.id} type="button" onClick={() => openThread(t)}
                style={{
                  display: "flex", flexDirection: "column", gap: 2, textAlign: "left", width: "100%", padding: "10px 14px",
                  background: active ? "var(--color-brand-25, #f0f6ff)" : "transparent", border: 0,
                  borderBottom: "1px solid var(--color-border)", cursor: "pointer",
                }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{targetLabel(t)}</span>
                <span style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>{t.kind === "channel" ? "グループ" : "1:1"} · 最終 {fmtTime(t.last_seen_at)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 右：スレッド */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 360 }}>
        {!sel ? (
          <div style={{ margin: "auto", color: "var(--color-ink-4)", fontSize: 13 }}>左のトークを選ぶとやりとりが表示されます。</div>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, paddingBottom: 8, borderBottom: "1px solid var(--color-border)" }}>{targetLabel(sel)}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 460, overflowY: "auto", padding: "4px 2px" }}>
              {loading ? (
                <div style={{ color: "var(--color-ink-4)", fontSize: 12, margin: "auto" }}>読み込み中…</div>
              ) : messages.length === 0 ? (
                <div style={{ color: "var(--color-ink-4)", fontSize: 12, margin: "auto" }}>このトークのメッセージはまだありません。</div>
              ) : (
                messages.map((m) => <Bubble key={m.id} m={m} />)
              )}
            </div>
            {/* 返信（ENGER → LINE） */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="このトークに返信…（ENGERから送信）"
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }}
                style={{ flex: 1, fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", resize: "vertical", fontFamily: "inherit" }} />
              <button type="button" className="btn" disabled={sending || !text.trim()} onClick={send} style={{ whiteSpace: "nowrap", opacity: sending || !text.trim() ? 0.6 : 1 }}>
                {sending ? "送信中…" : "送信"}
              </button>
            </div>
            {err && <div style={{ fontSize: 11.5, color: "var(--color-danger)" }}>{err}</div>}
          </>
        )}
      </div>
    </div>
  );
}
