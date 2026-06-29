"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendChatMessage, markThreadRead, saveThreadMemo, updateThreadSubject, createThread, deleteThread } from "@/app/chat/actions";
import type { ChatThreadListItem, ChatThread, ChatMessage, ChatRead, ChatRole } from "@/lib/chat";

const dt = (d: string) => {
  const t = new Date(d);
  if (isNaN(t.getTime())) return "";
  return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};

const ROLE_LABEL: Record<ChatRole, string> = { company: "企業", freelance: "人材", agent: "担当" };

// 新規スレッド相手の検索用：全角/半角・大小・ひらがな↔カタカナを吸収して比較しやすい形へ正規化。
//   これで「漢字氏名」「フリガナ（ひらがな/カタカナどちらの入力でも）」「イニシャル」のいずれでも一致する。
const normForSearch = (s: string) =>
  String(s ?? "")
    .normalize("NFKC")                                                  // 全角英数・半角カナ等を統一
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)); // ひらがな→カタカナ

// スレッドの短縮ID（UUID 先頭6桁）。タイトル横に目立たないよう表示する。
const threadShortId = (id?: string | null) => {
  const hex = String(id ?? "").replace(/[^0-9a-f]/gi, "");
  return hex ? `T-${hex.slice(0, 6).toUpperCase()}` : "";
};

// ②スレッドID検索：表示形式「T-89365F」全体でも、数字/英字の部分一致でもヒットさせる。
//   クエリから T- や区切りを除いて英数字だけにし、UUID 全体(16進)に対する部分一致で判定する。
//   （短縮IDは UUID 先頭6桁なので、UUID 全体との部分一致で短縮IDの一致も自然に含まれる。）
const matchThreadId = (id: string | null | undefined, query: string): boolean => {
  const nq = String(query ?? "").toUpperCase().replace(/^T-?/, "").replace(/[^0-9A-F]/g, "");
  if (!nq) return true;
  const hex = String(id ?? "").replace(/-/g, "").toUpperCase();
  return hex.includes(nq);
};

/** 新規スレッドの相手（フリーランス）候補。氏名(漢字)・フリガナ(カナ)・イニシャル・人材IDで検索する。
 *  ・sei/mei  : 姓・名（漢字）を個別保持（表示名整形用）。
 *  ・initials : 自動生成イニシャル（initial_auto）。
 *  ・freelanceId : 人材ID（E-C94D4）。氏名未登録時の表示名フォールバック。
 *  ・account  : display_name / github / メールのローカルパート（極端な例外時のみ使う代替識別子）。 */
type EngineerOption = { id: string; name: string; kana?: string; initials?: string | null; regInitial?: string | null; sei?: string | null; mei?: string | null; freelanceId?: string | null; account?: string | null };

// 日本語（漢字・かな）を含むか。氏名がローマ字（display_name）止まりかどうかの判定に使う。
const hasJaText = (s: string) => /[　-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/.test(String(s ?? ""));

type Selected = { thread: ChatThread; messages: ChatMessage[]; reads: ChatRead[] } | null;

export function ChatClient({
  threads,
  selected,
  me,
  meName,
  isStaff = true,
  engineers = [],
}: {
  threads: ChatThreadListItem[];
  selected: Selected;
  me: string;
  meName: string;
  /** ENGERスタッフ(admin/agent)か。新規作成・削除・タイトル/メモ編集を出すかの判定。 */
  isStaff?: boolean;
  /** 新規スレッドの相手（フリーランス）候補。 */
  engineers?: EngineerOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState("");
  const [draftFocused, setDraftFocused] = useState(false); // 入力欄の選択中フラグ（外枠/背景の出し分け）
  const [sendAs, setSendAs] = useState<ChatRole>("agent");
  const [companyName, setCompanyName] = useState(""); // ④企業として代理送信する時に手入力する企業名
  const [threadQ, setThreadQ] = useState("");         // ②スレッドID検索クエリ
  const endRef = useRef<HTMLDivElement>(null);
  // 新規スレッド作成モーダル。
  const [showNew, setShowNew] = useState(false);
  const [newEng, setNewEng] = useState("");
  const [newSubject, setNewSubject] = useState("");
  // スレッドタイトル（subject）の編集状態。スレッド切替時に同期。
  const [subject, setSubject] = useState(selected?.thread.subject ?? "");
  const [subjectSaved, setSubjectSaved] = useState(false);
  useEffect(() => { setSubject(selected?.thread.subject ?? ""); setSubjectSaved(false); }, [selected?.thread.id, selected?.thread.subject]);
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
  //   カッコ内は「ローマ字イニシャル」のみ表示（フリガナ/明示イニシャル由来）。
  //   漢字氏名から作った擬似イニシャル（名字）などローマ字でない値は“イニシャル未登録”とみなし、
  //   カッコを出さず氏名のみ表示する（フリガナ未登録なら空欄でOK、という要望に対応）。
  const nameWithInitials = (name: string | null, initials: string | null) => {
    if (!name) return "（人材）";
    const ini = (initials ?? "").trim();
    const romaji = /[A-Za-z]/.test(ini) ? ini.toUpperCase() : ""; // ローマ字を含む時のみ採用
    return romaji ? `${name}（${romaji}）` : name;
  };

  const threadId = selected?.thread.id ?? null;
  // スレッド名(subject)の保存状態：dirty=編集中(未保存) / saved=保存済み(かつ非空)。外枠色の出し分けに使う。
  const savedSubject = selected?.thread.subject ?? "";
  const subjectDirty = subject !== savedSubject;
  const subjectIsSaved = !subjectDirty && subject.trim().length > 0;

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
      try {
        const r = await sendChatMessage({ thread_id: threadId, body: draft, role: sendAs, senderName: sendAs === "company" ? companyName : null });
        if (r.ok) {
          setDraft("");
          setDraftFocused(false); // 送信したら入力欄の強調を元に戻す
          router.refresh();
        } else {
          alert(r.error ?? "送信に失敗しました");
        }
      } catch (e) {
        // サーバアクションが例外を投げても無反応にならないようにする。
        alert(e instanceof Error ? e.message : "送信に失敗しました（通信エラー）");
      }
    });
  };

  // タイトル（subject）保存。人材側にも同期表示される（chat_threads.subject）。
  const saveSubject = () => {
    if (!selected) return;
    start(async () => {
      const r = await updateThreadSubject({ thread_id: selected.thread.id, subject });
      if (r.ok) { setSubjectSaved(true); setTimeout(() => setSubjectSaved(false), 1500); router.refresh(); }
      else alert(r.error ?? "タイトルの保存に失敗しました");
    });
  };

  // 新規スレッド作成（スタッフのみ）。
  const submitNew = () => {
    if (!newEng) { alert("相手（フリーランス）を選択してください"); return; }
    const eng = engineers.find((e) => e.id === newEng);
    start(async () => {
      try {
        const r = await createThread({ engineer_id: newEng, engineer_name: eng?.name ?? null, subject: newSubject });
        if (r.ok && r.thread_id) {
          // 自動付与されたスレッドIDを明示（②）。遷移先ヘッダでも T-XXXXXX を表示。
          setShowNew(false); setNewEng(""); setNewSubject("");
          alert(`新規スレッドを作成しました（スレッドID：${threadShortId(r.thread_id)}）`);
          router.push(`/chat?t=${r.thread_id}`);
        } else {
          alert(r.error ?? "スレッドの作成に失敗しました");
        }
      } catch (e) {
        // サーバアクションが例外を投げても無反応にならないようにする。
        alert(e instanceof Error ? e.message : "スレッドの作成に失敗しました（通信エラー）");
      }
    });
  };

  // スレッド削除（スタッフのみ）。削除すると人材側も含めて内容が見えなくなる。
  const removeThread = () => {
    if (!selected) return;
    if (!confirm("このスレッドを削除します。やり取り（メッセージ）も完全に削除され、人材側からも見えなくなります。よろしいですか？")) return;
    start(async () => {
      const r = await deleteThread({ thread_id: selected.thread.id });
      if (r.ok) router.push("/chat");
      else alert(r.error ?? "削除に失敗しました");
    });
  };

  // 参加者別の最終既読時刻。
  const readAt = (reads: ChatRead[], role: ChatRole) => {
    const r = reads.filter((x) => x.participant_role === role).map((x) => x.last_read_at).sort().pop();
    return r ?? null;
  };

  if (threads.length === 0) {
    return (
      <>
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          まだチャットはありません。エンジニアへスカウトを送るか、新規スレッドを作成してください。
          {isStaff && <button type="button" className="btn" onClick={() => setShowNew(true)}><span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: "-3px", marginRight: 4 }}>add</span>新規スレッドを作成</button>}
        </div>
        {isStaff && showNew && <NewThreadModal engineers={engineers} value={newEng} onValue={setNewEng} subject={newSubject} onSubject={setNewSubject} onClose={() => setShowNew(false)} onSubmit={submitNew} pending={pending} />}
      </>
    );
  }

  return (
    <>
    <div className="match-side-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 320px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      {/* 左：スレッド一覧 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        {/* ＋新規スレッド（ENGERスタッフのみ）＋ ②スレッドID検索窓（隣に設置）。 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {isStaff && (
            <button type="button" className="btn ghost" onClick={() => setShowNew(true)}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0, whiteSpace: "nowrap" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>add</span>新規スレッド
            </button>
          )}
          {/* スレッドIDで検索（例：T-89365F／数字の部分一致でもヒット）。 */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, padding: "0 8px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 16, color: "var(--color-ink-5)" }}>search</span>
            <input value={threadQ} onChange={(e) => setThreadQ(e.target.value)} placeholder="スレッドIDで検索（例：T-89365F）"
              style={{ flex: 1, minWidth: 0, padding: "7px 0", border: 0, background: "transparent", outline: "none", fontSize: 12, fontFamily: "inherit", color: "var(--color-ink)" }} />
            {threadQ && (
              <button type="button" onClick={() => setThreadQ("")} title="クリア"
                style={{ flexShrink: 0, border: 0, background: "transparent", cursor: "pointer", color: "var(--color-ink-5)", display: "inline-flex" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
              </button>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "68vh", overflowY: "auto" }}>
        {threads.filter((t) => matchThreadId(t.id, threadQ)).length === 0 && (
          <div className="muted" style={{ fontSize: 12, textAlign: "center", padding: 16 }}>
            {threadQ ? `「${threadQ}」に一致するスレッドはありません。` : "スレッドがありません。"}
          </div>
        )}
        {threads.filter((t) => matchThreadId(t.id, threadQ)).map((t) => {
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
              {/* 人材名（姓名＋イニシャル）＋スレッドID。クリックでスレッドを開く。 */}
              <button type="button" onClick={() => open(t.id)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, background: "transparent", border: 0, padding: 0, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                  <b style={{ fontSize: 13, color: "var(--color-ink)" }}>{nameWithInitials(t.engineer_name, t.engineer_initials)}</b>
                  {t.id && <span className="mono" title={`スレッドID: ${t.id}`} style={{ fontSize: 9.5, color: "var(--color-ink-5)", letterSpacing: ".02em", flexShrink: 0 }}>{threadShortId(t.id)}</span>}
                </span>
                {t.unread > 0 && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: "var(--color-brand-600)", borderRadius: 99, padding: "1px 7px", flexShrink: 0 }}>{t.unread}</span>
                )}
              </button>
              {/* 社内メモ（手入力・保存）。スタッフ専用＝人材側には絶対に表示しない（完全非表示）。
                  ・UIは isStaff のときのみ描画。
                  ・保存先は service role 限定の chat_thread_memos（人材ロールに grant されないため漏れない）。 */}
              {isStaff && (
                <>
                  <textarea
                    value={memos[t.id] ?? ""}
                    onChange={(e) => setMemos((p) => ({ ...p, [t.id]: e.target.value }))}
                    placeholder="社内メモ（人材には表示されません）"
                    rows={2}
                    style={{ resize: "vertical", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--color-border)", fontSize: 11.5, fontFamily: "inherit", width: "100%", boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button type="button" className="btn ghost btn-xs" disabled={pending} onClick={() => saveMemo(t.id)}>メモを保存</button>
                    {memoSavedId === t.id && <span style={{ fontSize: 10.5, color: "#067647" }}>✓ 保存しました</span>}
                    <span className="muted" style={{ fontSize: 9.5, marginLeft: "auto" }}>社内専用</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
        </div>
      </div>

      {/* 右：会話 */}
      {selected ? (
        <div className="card" style={{ display: "flex", flexDirection: "column", minWidth: 0, padding: 0, overflow: "hidden" }}>
          {/* ヘッダ：人材名の隣にスレッドタイトル入力（横長）。右端に削除（スタッフのみ）。 */}
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{nameWithInitials(selected.thread.engineer_name, selected.thread.engineer_initials)}</div>
              {selected.thread.job_title && (
                <div className="muted" style={{ fontSize: 11.5 }}>
                  案件 {selected.thread.job_title}{selected.thread.job_no ? ` (No.${String(selected.thread.job_no).padStart(5, "0")})` : ""}
                </div>
              )}
            </div>
            {/* スレッド名（双方に表示）。スタッフは入力・保存、人材側は表示のみ。
                ・保存済み＝背景は白・外枠は薄い線（落ち着いた状態）。
                ・編集中（未保存）＝背景に色を付け、外枠も色付きにして「編集中」を一目で分かるようにする。 */}
            {isStaff ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 220 }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".06em", color: subjectDirty ? "var(--color-brand-700,#1d4ed8)" : "var(--color-ink-4)" }}>
                  スレッド名{subjectDirty ? "（編集中）" : subjectIsSaved ? "（保存済み）" : ""}
                </span>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  // 外枠は薄め(1px)。編集中だけ色付きにする。
                  border: `1px solid ${subjectDirty ? "var(--color-brand-400,#60a5fa)" : "var(--color-border)"}`,
                  // 背景：保存済み/未入力は白、編集中だけ水色。
                  background: subjectDirty ? "var(--color-brand-25,#eff6ff)" : "var(--color-surface)",
                  borderRadius: 10, padding: "2px 4px 2px 8px", transition: "border-color .2s, background .2s",
                }}>
                  <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 16, color: subjectDirty ? "var(--color-brand-600,#2563eb)" : "var(--color-ink-5)" }}>
                    {subjectDirty ? "edit" : "label"}
                  </span>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveSubject(); }}
                    placeholder="スレッド名を入力（例：【案件A】Java開発の件 / 2026年7月定期面談）"
                    style={{ flex: 1, minWidth: 0, padding: "6px 4px", border: 0, background: "transparent", outline: "none", fontSize: 13, fontFamily: "inherit", color: "var(--color-ink)" }}
                  />
                  <button type="button" className="btn btn-xs" disabled={pending || !subjectDirty} onClick={saveSubject} style={{ flexShrink: 0 }}>保存</button>
                  {subjectSaved && <span style={{ fontSize: 10.5, color: "#067647", whiteSpace: "nowrap", paddingRight: 2 }}>✓</span>}
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 120, fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>{selected.thread.subject || ""}</div>
            )}
            {/* スレッドID（タイトル横に目立たないよう表示）。クリック相当のコピー用に full UUID を tooltip に。 */}
            {selected.thread.id && (
              <span className="mono" title={`スレッドID: ${selected.thread.id}`}
                style={{ flexShrink: 0, fontSize: 10.5, color: "var(--color-ink-5)", letterSpacing: ".02em" }}>{threadShortId(selected.thread.id)}</span>
            )}
            {isStaff && (
              <button className="btn ghost btn-xs" disabled={pending} onClick={removeThread} title="このスレッドを削除（メッセージも完全削除）"
                style={{ flexShrink: 0, color: "#b42318", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>delete</span>スレッドを削除
              </button>
            )}
          </div>

          {/* メッセージ */}
          <div style={{ flex: 1, overflowY: "auto", maxHeight: "56vh", padding: 16, display: "flex", flexDirection: "column", gap: 10, background: "var(--color-surface-2, var(--color-surface))" }}>
            {selected.messages.length === 0 && (
              <div className="muted" style={{ textAlign: "center", fontSize: 12, padding: 20 }}>まだメッセージはありません。下の入力欄から送信できます。</div>
            )}
            {selected.messages.map((m) => {
              // こちら側（担当・企業として代理送信）だけを右寄せにする。
              //   フリーランスからの受信は role が "freelance" 以外（空/null/不明）になっている
              //   ケースがあり、!== "freelance" 判定だと受信が右に出てしまう。明示の自社ロール
              //   （agent / company）のみ右、それ以外（freelance・空・null・不明）は受信＝左に固定。
              const mine = m.sender_role === "agent" || m.sender_role === "company";
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
            {/* 送信者の選択。③人材（代理入力）は廃止。④企業はカッコ内に企業名を手入力できる。
                入力した企業名は人材(フリーランス)側にも送信者名として表示される（⑤）。 */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11.5, flexWrap: "wrap" }}>
              <span className="muted">送信者：</span>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                <input type="radio" name="sendAs" checked={sendAs === "agent"} onChange={() => setSendAs("agent")} />
                担当（{meName}）
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                <input type="radio" name="sendAs" checked={sendAs === "company"} onChange={() => setSendAs("company")} />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                  企業（
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    onFocus={() => setSendAs("company")}
                    placeholder="企業名を入力"
                    style={{
                      width: 140, padding: "2px 6px", borderRadius: 6, fontSize: 11.5, fontFamily: "inherit",
                      border: `1px solid ${sendAs === "company" ? "var(--color-brand-400,#60a5fa)" : "var(--color-border)"}`,
                      background: sendAs === "company" ? "var(--color-surface)" : "var(--color-surface-inset)",
                      color: "var(--color-ink)", outline: "none",
                    }}
                  />
                  ）
                </span>
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              {/* 入力欄：未選択時も外枠がはっきり見えるようにし、選択中（編集中）は外枠・背景・影で
                  「ここに入力中」と分かるように強調。送信(=blur)で元のデザインに戻る。 */}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={() => setDraftFocused(true)}
                onBlur={() => setDraftFocused(false)}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }}
                placeholder="メッセージを入力（⌘/Ctrl + Enter で送信）"
                rows={2}
                style={{
                  flex: 1, resize: "vertical", padding: "9px 11px", borderRadius: 10, fontSize: 13, fontFamily: "inherit",
                  outline: "none", transition: "border-color .15s, background .15s, box-shadow .15s",
                  border: `1.5px solid ${draftFocused ? "var(--color-brand-500,#2563eb)" : "var(--color-border-strong)"}`,
                  background: draftFocused ? "var(--color-brand-25,#eff6ff)" : "var(--color-surface)",
                  boxShadow: draftFocused ? "0 0 0 3px var(--color-brand-100,#dbeafe)" : "none",
                }}
              />
              <button className="btn" disabled={pending || !draft.trim()} onClick={send}>送信</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>スレッドを選択してください。</div>
      )}
    </div>
    {isStaff && showNew && <NewThreadModal engineers={engineers} value={newEng} onValue={setNewEng} subject={newSubject} onSubject={setNewSubject} onClose={() => setShowNew(false)} onSubmit={submitNew} pending={pending} />}
    </>
  );
}

// 新規スレッド作成モーダル（スタッフ専用）。相手（フリーランス）を選び、任意でタイトルを入力。
function NewThreadModal({ engineers, value, onValue, subject, onSubject, onClose, onSubmit, pending }: {
  engineers: EngineerOption[];
  value: string; onValue: (v: string) => void;
  subject: string; onSubject: (v: string) => void;
  onClose: () => void; onSubmit: () => void; pending: boolean;
}) {
  const [q, setQ] = useState("");
  // 姓名（漢字・カタカナ両方）＋イニシャルで検索。入力はひらがな/カタカナ/全角半角を吸収して比較。
  const nq = normForSearch(q.trim());
  const filtered = nq
    ? engineers.filter((e) => normForSearch(`${e.name} ${e.kana ?? ""} ${e.initials ?? ""} ${e.sei ?? ""} ${e.mei ?? ""} ${e.freelanceId ?? ""} ${e.account ?? ""}`).includes(nq))
    : engineers;
  // 表示名のマッピング（フォールバック付き）：
  //   1) 姓名（漢字）が両方ある → 「姓 名（姓）（イニシャル）」例：藤本 太郎（藤本）（FT）
  //   1') 片方のみ／単一の漢字氏名しか無い → 取れた漢字氏名をそのまま（姓の重複表示はしない）
  //   2) 漢字氏名なし → 人材ID（例：E-C94D4）。アカウントID/表示名には倒さない。
  //   3) 氏名も人材IDも無い極端な例外 → アカウント識別子（display_name / メールのローカルパート 等）
  const optionLabel = (e: EngineerOption): string => {
    const sei = (e.sei ?? "").trim();
    const mei = (e.mei ?? "").trim();
    const ini = (e.initials ?? "").trim();
    const iniPart = ini ? `（${ini}）` : "";
    if (sei && mei) return `${sei} ${mei}（${sei}）${iniPart}`;
    const nm = (e.name ?? "").trim();
    if (hasJaText(nm)) {
      const head = sei || mei;                       // 分割済みの姓/名があればカッコ表示
      const headPart = head && head !== nm ? `（${head}）` : ""; // 単一トークンの重複表示を避ける
      return `${nm}${headPart}${iniPart}`;
    }
    const fid = (e.freelanceId ?? "").trim();
    if (fid) return fid;
    return (e.account ?? "").trim() || "（無名）";
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 400, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>新規スレッドを作成</h3>
          <button type="button" className="btn ghost btn-xs" onClick={onClose}>閉じる</button>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--color-ink-3)" }}>
          相手（フリーランス）
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="氏名（漢字・カナ）/イニシャルで絞り込み…"
            style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", fontSize: 13, fontFamily: "inherit" }} />
          <select value={value} onChange={(e) => onValue(e.target.value)} size={6}
            style={{ padding: "6px", borderRadius: 8, border: "1px solid var(--color-border-strong)", fontSize: 13, fontFamily: "inherit" }}>
            {filtered.length === 0 && <option value="" disabled>該当なし</option>}
            {filtered.slice(0, 200).map((e) => <option key={e.id} value={e.id}>{optionLabel(e)}</option>)}
          </select>
          {engineers.length === 0 && <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>フリーランスの一覧を取得できませんでした。</span>}
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--color-ink-3)" }}>
          スレッドのタイトル（任意・後から変更可）
          <input value={subject} onChange={(e) => onSubject(e.target.value)} placeholder="例：【案件A】Java開発の件"
            style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", fontSize: 13, fontFamily: "inherit" }} />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn ghost btn-xs" onClick={onClose}>キャンセル</button>
          <button type="button" className="btn" disabled={pending || !value} onClick={onSubmit}>作成</button>
        </div>
      </div>
    </div>
  );
}
