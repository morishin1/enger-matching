"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendChatMessage, markThreadRead, setThreadStatus, saveThreadMemo } from "@/app/chat/actions";
import type { ChatThreadListItem, ChatThread, ChatMessage, ChatRead, ChatRole } from "@/lib/chat";

const dt = (d: string) => {
  const t = new Date(d);
  if (isNaN(t.getTime())) return "";
  return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};

const ROLE_LABEL: Record<ChatRole, string> = { company: "企業", freelance: "人材", agent: "担当" };

type Selected = { thread: ChatThread; messages: ChatMessage[]; reads: ChatRead[] } | null;

export function ChatClient({
  threads,
  selected,
  me,
  meName,
}: {
  threads: ChatThreadListItem[];
  selected: Selected;
  me: string;
  meName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState("");
  const [sendAs, setSendAs] = useState<ChatRole>("agent");
  const endRef = useRef<HTMLDivElement>(null);
  // スレッドごとのメモ（左一覧で手入力・保存）。初期値は各スレッドの memo。
  const [memos, setMemos] = useState<Record<string, string>>(() => Object.fromEntries(threads.map((t) => [t.id, t.memo ?? ""])));
  const [memoSavedId, setMemoSavedId] = useState<string | null>(null);
  const saveMemo = (id: string) => {
    start(async () => {
      const r = await saveThreadMemo({ thread_id: id, memo: memos[id] ?? "" });
      if (r.ok) { setMemoSavedId(id); setTimeout(() => setMemoSavedId((v) => (v === id ? null : v)), 1500); router.refresh(); }
      else alert(r.error ?? "メモの保存に失敗しました");
    });
  };
  // 表示名（姓名＋イニシャル）。
  const nameWithInitials = (name: string | null, initials: string | null) =>
    name ? (initials ? `${name}（${initials}）` : name) : "（人材）";

  const threadId = selected?.thread.id ?? null;

  // スレッドを開いたら担当(agent)の既読を更新。
  useEffect(() => {
    if (!threadId) return;
    markThreadRead({ thread_id: threadId }).then(() => router.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // 新着で最下部へスクロール。
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [selected?.messages.length]);

  const open = (id: string) => router.push(`/chat?t=${id}`);

  const send = () => {
    if (!threadId || !draft.trim()) return;
    start(async () => {
      const r = await sendChatMessage({ thread_id: threadId, body: draft, role: sendAs });
      if (r.ok) {
        setDraft("");
        router.refresh();
      } else {
        alert(r.error ?? "送信に失敗しました");
      }
    });
  };

  const toggleStatus = () => {
    if (!selected) return;
    const next = selected.thread.status === "closed" ? "open" : "closed";
    start(async () => {
      await setThreadStatus({ thread_id: selected.thread.id, status: next });
      router.refresh();
    });
  };

  // 参加者別の最終既読時刻。
  const readAt = (reads: ChatRead[], role: ChatRole) => {
    const r = reads.filter((x) => x.participant_role === role).map((x) => x.last_read_at).sort().pop();
    return r ?? null;
  };

  if (threads.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
        まだチャットはありません。エンジニアへスカウトを送ると、ここにスレッドが作成されます。
      </div>
    );
  }

  return (
    <div className="match-side-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 320px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      {/* 左：スレッド一覧 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "72vh", overflowY: "auto" }}>
        {threads.map((t) => {
          const active = t.id === threadId;
          return (
            <div
              key={t.id}
              className="card"
              style={{
                borderColor: active ? "var(--color-brand-400)" : undefined,
                background: active ? "var(--color-brand-25)" : undefined,
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {/* 人材名（姓名＋イニシャル）。クリックでスレッドを開く。 */}
              <button type="button" onClick={() => open(t.id)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, background: "transparent", border: 0, padding: 0, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                <b style={{ fontSize: 13, color: "var(--color-ink)" }}>{nameWithInitials(t.engineer_name, t.engineer_initials)}</b>
                {t.unread > 0 && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: "var(--color-brand-600)", borderRadius: 99, padding: "1px 7px" }}>{t.unread}</span>
                )}
              </button>
              {/* メモ（手入力・保存）。企業名/メッセージ抜粋/終了表示は廃止。 */}
              <textarea
                value={memos[t.id] ?? ""}
                onChange={(e) => setMemos((p) => ({ ...p, [t.id]: e.target.value }))}
                placeholder="メモ（この人材についての覚書）"
                rows={2}
                style={{ resize: "vertical", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--color-border)", fontSize: 11.5, fontFamily: "inherit", width: "100%", boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" className="btn ghost btn-xs" disabled={pending} onClick={() => saveMemo(t.id)}>メモを保存</button>
                {memoSavedId === t.id && <span style={{ fontSize: 10.5, color: "#067647" }}>✓ 保存しました</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* 右：会話 */}
      {selected ? (
        <div className="card" style={{ display: "flex", flexDirection: "column", minWidth: 0, padding: 0, overflow: "hidden" }}>
          {/* ヘッダ */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{nameWithInitials(selected.thread.engineer_name, selected.thread.engineer_initials)}</div>
              {selected.thread.job_title && (
                <div className="muted" style={{ fontSize: 11.5 }}>
                  案件 {selected.thread.job_title}{selected.thread.job_no ? ` (No.${String(selected.thread.job_no).padStart(5, "0")})` : ""}
                </div>
              )}
            </div>
            <button className="btn ghost btn-xs" disabled={pending} onClick={toggleStatus}>
              {selected.thread.status === "closed" ? "再開する" : "スレッドを終了"}
            </button>
          </div>

          {/* メッセージ */}
          <div style={{ flex: 1, overflowY: "auto", maxHeight: "56vh", padding: 16, display: "flex", flexDirection: "column", gap: 10, background: "var(--color-surface-2, var(--color-surface))" }}>
            {selected.messages.length === 0 && (
              <div className="muted" style={{ textAlign: "center", fontSize: 12, padding: 20 }}>まだメッセージはありません。下の入力欄から送信できます。</div>
            )}
            {selected.messages.map((m) => {
              const mine = m.sender_role === "agent";
              // 担当の発言には、相手（企業・人材）の既読を表示する。
              const compRead = readAt(selected.reads, "company");
              const flRead = readAt(selected.reads, "freelance");
              const readBadges = mine
                ? [
                    compRead && compRead >= m.created_at ? "企業既読" : null,
                    flRead && flRead >= m.created_at ? "人材既読" : null,
                  ].filter(Boolean)
                : [];
              return (
                <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 2 }}>
                  <div className="muted" style={{ fontSize: 10.5 }}>
                    <b>{ROLE_LABEL[m.sender_role]}</b>{m.sender_name ? ` ・ ${m.sender_name}` : ""} ・ {dt(m.created_at)}
                  </div>
                  <div
                    style={{
                      maxWidth: "78%",
                      padding: "8px 12px",
                      borderRadius: 12,
                      fontSize: 13,
                      lineHeight: 1.7,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      background: mine ? "var(--color-brand-600)" : "var(--color-surface)",
                      color: mine ? "#fff" : "var(--color-ink)",
                      border: mine ? "none" : "1px solid var(--color-border)",
                    }}
                  >
                    {m.body}
                  </div>
                  {readBadges.length > 0 && (
                    <div className="muted" style={{ fontSize: 10 }}>✓ {readBadges.join(" / ")}</div>
                  )}
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {/* 入力 */}
          <div style={{ borderTop: "1px solid var(--color-border)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
              <span className="muted">送信者：</span>
              {(["agent", "company", "freelance"] as ChatRole[]).map((r) => (
                <label key={r} style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                  <input type="radio" name="sendAs" checked={sendAs === r} onChange={() => setSendAs(r)} />
                  {ROLE_LABEL[r]}
                  {r === "agent" ? `（${meName}）` : "（代理入力）"}
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }}
                placeholder="メッセージを入力（⌘/Ctrl + Enter で送信）"
                rows={2}
                style={{ flex: 1, resize: "vertical", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 13, fontFamily: "inherit" }}
              />
              <button className="btn" disabled={pending || !draft.trim()} onClick={send}>送信</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>スレッドを選択してください。</div>
      )}
    </div>
  );
}
