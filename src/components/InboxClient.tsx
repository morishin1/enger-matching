"use client";

// 受信箱：enger.jp お問い合わせの一覧（カード型）＋詳細モーダル。
//   一目で「誰が・どんな目的で・何を求めているか」が分かるようカテゴリ・要約・連絡先・経過日数を明示。
//   返信導線（メール / 電話）と対応ステータス更新をワンクリックで。

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContactStatus, deleteContactMessage, deleteContactMessages } from "@/app/inbox/actions";
import { isJunkContact, type ContactMsg } from "@/lib/contact";

export type { ContactMsg };

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  new:        { label: "新規",   bg: "#fef3c7", fg: "#92400e" },
  inprogress: { label: "対応中", bg: "#dbeafe", fg: "#1e40af" },
  done:       { label: "完了",   bg: "#dcfce7", fg: "#166534" },
};

// 問い合わせの「目的」を分かりやすく分類。topic 文字列を正規化してアイコン・色を割当。
type Purpose = { key: string; label: string; icon: string; fg: string; bg: string; hint: string };
const PURPOSES: Purpose[] = [
  { key: "job",      label: "案件相談",        icon: "work",          fg: "#0b5cab", bg: "#eaf4fd", hint: "クライアントが人材/案件サポートを探している" },
  { key: "talent",   label: "人材登録",        icon: "person_add",    fg: "#067647", bg: "#e7f7ee", hint: "エンジニアが登録・相談したい" },
  { key: "partner",  label: "パートナー希望", icon: "handshake",     fg: "#7c3aed", bg: "#ede9fe", hint: "SES/取引先としての提携相談" },
  { key: "doc",      label: "資料請求",        icon: "description",   fg: "#d97706", bg: "#fff3e0", hint: "サービス資料・料金表を求めている" },
  { key: "service",  label: "サービス問合せ", icon: "support_agent", fg: "#0891b2", bg: "#cffafe", hint: "サービス内容・機能の質問" },
  { key: "demo",     label: "デモ希望",        icon: "video_call",    fg: "#db2777", bg: "#fce7f3", hint: "デモ・打合せの予約希望" },
  { key: "other",    label: "その他",          icon: "help",          fg: "#6b7280", bg: "#f3f4f6", hint: "分類不能（手動確認）" },
];

function inferPurpose(topic?: string | null, message?: string | null): Purpose {
  const t = (topic ?? "").toLowerCase();
  const m = (message ?? "").toLowerCase();
  const blob = `${t} ${m}`;
  if (/(案件|プロジェクト|発注|要員|要件|人材を|エンジニアを|スポット|エンジニア紹介|採用)/i.test(blob)) return PURPOSES[0];
  if (/(登録|スカウト|案件を|案件紹介|働|転職|フリーランス|職務経歴|スキルシート)/i.test(blob)) return PURPOSES[1];
  if (/(パートナー|提携|協業|取引|商流|協力会社|bp|協業)/i.test(blob)) return PURPOSES[2];
  if (/(資料|料金|プラン|見積|カタログ|パンフ|価格)/i.test(blob)) return PURPOSES[3];
  if (/(サービス|機能|使い方|質問|問合|問い合)/i.test(blob)) return PURPOSES[4];
  if (/(デモ|商談|打合|打ち合わせ|ミーティング|面談|アポ)/i.test(blob)) return PURPOSES[5];
  return PURPOSES[6];
}

// 緊急度キーワード（メッセージから「急ぎ」「すぐ」等を検出）
const URGENT_RE = /(急ぎ|至急|早急|すぐ|本日中|今日中|明日まで|早めに|お急ぎ|お早め)/;

const fmtDateTime = (s: string) => {
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const fmtShort = (s: string) => {
  const d = new Date(s); if (isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const daysAgo = (s: string) => {
  const d = new Date(s).getTime();
  if (isNaN(d)) return 0;
  return Math.max(0, Math.floor((Date.now() - d) / 86400000));
};

function summarize(msg?: string | null, maxLen = 120): string {
  if (!msg) return "(本文なし)";
  const s = msg.replace(/\s+/g, " ").trim();
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

export function InboxClient({ rows }: { rows: ContactMsg[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [statusTab, setStatusTab] = useState<"all" | "new" | "inprogress" | "done">("new");
  const [purposeTab, setPurposeTab] = useState<string>("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [active, setActive] = useState<ContactMsg | null>(null);
  const [hideJunk, setHideJunk] = useState(true);

  const set = (id: string, status: "new" | "inprogress" | "done") => {
    setBusy(id);
    start(async () => { await updateContactStatus(id, status); setBusy(null); router.refresh(); });
  };

  const del = (id: string) => {
    if (!confirm("このお問い合わせを削除しますか？（元に戻せません）")) return;
    setBusy(id);
    start(async () => { await deleteContactMessage(id); setBusy(null); setActive(null); router.refresh(); });
  };

  const junkIds = useMemo(() => rows.filter((r) => isJunkContact(r)).map((r) => r.id), [rows]);
  const bulkDeleteJunk = () => {
    if (junkIds.length === 0) return;
    if (!confirm(`ジャンク（テスト/自動生成と思われる）${junkIds.length} 件を削除しますか？\n（元に戻せません）`)) return;
    start(async () => {
      const r = await deleteContactMessages(junkIds);
      if (!r.ok) alert(r.error || "削除に失敗しました");
      router.refresh();
    });
  };

  // 集計
  const stats = useMemo(() => {
    const byStatus: Record<string, number> = { all: rows.length, new: 0, inprogress: 0, done: 0 };
    const byPurpose: Record<string, number> = {};
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      const p = inferPurpose(r.topic, r.message);
      byPurpose[p.key] = (byPurpose[p.key] ?? 0) + 1;
    }
    return { byStatus, byPurpose };
  }, [rows]);

  // フィルタ済み
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (hideJunk && isJunkContact(r)) return false;
      if (statusTab !== "all" && r.status !== statusTab) return false;
      if (purposeTab && inferPurpose(r.topic, r.message).key !== purposeTab) return false;
      if (needle) {
        const hay = [r.company, r.name, r.email, r.phone, r.topic, r.role, r.message].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, statusTab, purposeTab, hideJunk]);

  if (rows.length === 0) {
    return <div className="card" style={{ fontSize: 13, color: "var(--color-ink-3)" }}>お問い合わせはまだありません。enger.jp のお問い合わせフォーム送信がここに届きます。</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ステータスタブ + 件数 */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--color-border)", overflowX: "auto" }}>
        {[
          { key: "new",        label: "新規" },
          { key: "inprogress", label: "対応中" },
          { key: "done",       label: "完了" },
          { key: "all",        label: "すべて" },
        ].map((t) => {
          const on = statusTab === t.key;
          const count = stats.byStatus[t.key] ?? 0;
          return (
            <button key={t.key} type="button" onClick={() => setStatusTab(t.key as any)}
              style={{ padding: "9px 16px", background: "transparent", border: 0,
                borderBottom: on ? "2px solid var(--color-brand-600)" : "2px solid transparent",
                color: on ? "var(--color-brand-700)" : "var(--color-ink-3)", fontWeight: on ? 700 : 600, fontSize: 13.5,
                cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
              <span>{t.label}</span>
              {count > 0 && <span className="badge" style={{ fontSize: 10, padding: "1px 7px" }}>{count}</span>}
            </button>
          );
        })}
      </div>

      {/* 目的フィルタチップ */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setPurposeTab("")} style={{
          fontFamily: "inherit", fontSize: 12, padding: "5px 12px", borderRadius: 99,
          border: `1px solid ${!purposeTab ? "var(--color-brand-600)" : "var(--color-border)"}`,
          background: !purposeTab ? "var(--color-brand-600)" : "var(--color-surface)",
          color: !purposeTab ? "#fff" : "var(--color-ink-2)", fontWeight: !purposeTab ? 700 : 600, cursor: "pointer",
        }}>すべての目的</button>
        {PURPOSES.map((p) => {
          const on = purposeTab === p.key;
          const count = stats.byPurpose[p.key] ?? 0;
          if (count === 0) return null;
          return (
            <button key={p.key} type="button" onClick={() => setPurposeTab(on ? "" : p.key)}
              title={p.hint}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit", fontSize: 12,
                padding: "5px 12px", borderRadius: 99,
                border: `1px solid ${on ? p.fg : p.fg + "55"}`,
                background: on ? p.fg : p.bg, color: on ? "#fff" : p.fg,
                fontWeight: 700, cursor: "pointer",
              }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, lineHeight: 1 }}>{p.icon}</span>
              {p.label} <span style={{ opacity: 0.85, fontSize: 11 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* 検索 */}
      <div style={{ position: "relative" }}>
        <span className="material-symbols-outlined" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 18, color: "var(--color-ink-4)" }}>search</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="会社名・氏名・メール・本文で検索…"
          style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "10px 12px 10px 38px", borderRadius: 10, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
      </div>

      {/* ジャンク（テスト/自動生成）の制御 */}
      {junkIds.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: "#fff6e0", border: "1px solid #fde9b0", borderRadius: 10, padding: "10px 14px" }}>
          <span style={{ fontSize: 12.5, color: "#9a7b12", fontWeight: 700 }}>
            ⚠ 意味のない内容（テスト/自動生成と思われる）が <b>{junkIds.length} 件</b> 検出されました
          </span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6b5410", cursor: "pointer" }}>
            <input type="checkbox" checked={hideJunk} onChange={(e) => setHideJunk(e.target.checked)} />
            一覧から隠す
          </label>
          <button type="button" className="btn btn-xs" disabled={pending} onClick={bulkDeleteJunk}
            style={{ marginLeft: "auto", background: "var(--color-danger)", color: "#fff", borderColor: "var(--color-danger)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, marginRight: 3, verticalAlign: "-2px" }}>delete_sweep</span>
            ジャンクを一括削除（{junkIds.length}）
          </button>
        </div>
      )}

      {/* カード一覧 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.length === 0 && (
          <div className="card" style={{ fontSize: 12.5, color: "var(--color-ink-4)", textAlign: "center", padding: 30 }}>該当する問い合わせがありません。</div>
        )}
        {shown.map((r) => {
          const st = STATUS[r.status] ?? STATUS.new;
          const purpose = inferPurpose(r.topic, r.message);
          const isUrgent = r.message && URGENT_RE.test(r.message);
          const dAgo = daysAgo(r.created_at);
          const isOld = dAgo >= 3 && r.status !== "done";

          return (
            <div key={r.id} onClick={() => setActive(r)} className="card" style={{
              display: "flex", flexDirection: "column", gap: 8,
              padding: 14, cursor: "pointer",
              opacity: r.status === "done" ? 0.65 : 1,
              borderLeft: `4px solid ${purpose.fg}`,
              transition: "transform .12s, box-shadow .12s",
            }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "")}>

              {/* ヘッダ行：目的バッジ + ステータス + 緊急 + 日付 */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: purpose.bg, color: purpose.fg, border: `1px solid ${purpose.fg}55` }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14, lineHeight: 1 }}>{purpose.icon}</span>
                  {purpose.label}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: st.bg, color: st.fg }}>{st.label}</span>
                {isUrgent && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: "#fee2e2", color: "#b42318", border: "1px solid #fca5a5" }}>
                    🔥 緊急
                  </span>
                )}
                {isOld && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: "#fff6e0", color: "#9a7b12", border: "1px solid #fde9b0" }}>
                    ⏰ 滞留 {dAgo}日
                  </span>
                )}
                {isJunkContact(r) && (
                  <span title="会社名・氏名・本文がランダム文字列。テスト/自動生成データの可能性。" style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: "#f3f4f6", color: "#6b7280", border: "1px solid #d1d5db" }}>
                    🗑 ジャンク疑い
                  </span>
                )}
                {r.topic && r.topic !== purpose.label && (
                  <span className="muted" style={{ fontSize: 11 }}>原文topic: {r.topic}</span>
                )}
                <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
                  {r.source || "Webフォーム"} · {fmtShort(r.created_at)}
                </span>
              </div>

              {/* 問い合わせ者 */}
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--color-ink)" }}>
                  {r.company || r.name || "（無題）"}
                </div>
                {r.company && r.name && <span style={{ fontSize: 12.5, color: "var(--color-ink-2)" }}>{r.name} 様</span>}
                {r.role && <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 99, background: "var(--color-surface-soft)", color: "var(--color-ink-3)" }}>{r.role}</span>}
              </div>

              {/* 連絡先 */}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--color-ink-2)" }}>
                {r.email && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>mail</span>{r.email}
                </span>}
                {r.phone && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>call</span>{r.phone}
                </span>}
              </div>

              {/* 本文サマリ */}
              {r.message && (
                <div style={{ fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.65, background: "var(--color-surface-soft)", borderRadius: 8, padding: "10px 12px" }}>
                  {summarize(r.message, 180)}
                </div>
              )}

              {/* クイック操作 */}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
                {r.email && (
                  <a href={`mailto:${r.email}?subject=${encodeURIComponent(`Re: ${r.topic || "お問い合わせ"}`)}&body=${encodeURIComponent(`${r.name || ""} 様\n\nお問い合わせありがとうございます。\n\n${r.message ? `> ${r.message.replace(/\n/g, "\n> ")}` : ""}`)}`}
                    className="btn ghost btn-xs" style={{ textDecoration: "none" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, marginRight: 2, verticalAlign: "-2px" }}>reply</span>返信
                  </a>
                )}
                {r.phone && (
                  <a href={`tel:${r.phone}`} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, marginRight: 2, verticalAlign: "-2px" }}>call</span>電話
                  </a>
                )}
                {r.status !== "inprogress" && <button className="btn btn-xs" disabled={pending && busy === r.id} onClick={() => set(r.id, "inprogress")}>対応中に</button>}
                {r.status !== "done" && <button className="btn ghost btn-xs" disabled={pending && busy === r.id} onClick={() => set(r.id, "done")}>完了</button>}
                {r.status === "done" && <button className="btn ghost btn-xs" disabled={pending && busy === r.id} onClick={() => set(r.id, "new")}>戻す</button>}
                <button className="btn ghost btn-xs" disabled={pending && busy === r.id} title="削除（元に戻せません）" onClick={() => del(r.id)} style={{ color: "var(--color-danger)" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: "-2px" }}>delete</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 11.5 }}>{shown.length} 件 / 全 {rows.length} 件</div>

      {active && <InquiryDetailModal r={active} onClose={() => setActive(null)} onStatus={(s) => set(active.id, s)} onDelete={() => del(active.id)} pending={pending && busy === active.id} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────
function InquiryDetailModal({ r, onClose, onStatus, onDelete, pending }: { r: ContactMsg; onClose: () => void; onStatus: (s: "new" | "inprogress" | "done") => void; onDelete: () => void; pending: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const purpose = inferPurpose(r.topic, r.message);
  const st = STATUS[r.status] ?? STATUS.new;
  const isUrgent = r.message && URGENT_RE.test(r.message);
  const dAgo = daysAgo(r.created_at);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,36,64,.45)", display: "grid", placeItems: "center", padding: 20, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(720px, 96vw)", maxHeight: "92vh", overflowY: "auto", padding: 0, background: "var(--color-surface)" }}>
        {/* ヘッダ */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", padding: "16px 22px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 11.5 }}>お問い合わせ詳細</div>
            <div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>{r.company || r.name || "（無題）"}</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
              {r.source || "Webフォーム"} · {fmtDateTime(r.created_at)} · {dAgo === 0 ? "本日" : `${dAgo}日前`}
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn ghost" aria-label="閉じる" style={{ fontSize: 18, lineHeight: 1, padding: "4px 10px" }}>×</button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* バッジ群 */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: purpose.bg, color: purpose.fg, border: `1px solid ${purpose.fg}55` }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, lineHeight: 1 }}>{purpose.icon}</span>
              {purpose.label}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: st.bg, color: st.fg }}>{st.label}</span>
            {isUrgent && <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: "#fee2e2", color: "#b42318", border: "1px solid #fca5a5" }}>🔥 緊急</span>}
            {r.topic && r.topic !== purpose.label && <span className="muted" style={{ fontSize: 11, padding: "3px 10px" }}>原文topic: {r.topic}</span>}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>💡 {purpose.hint}</div>

          {/* 連絡先 */}
          <div className="card" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>問い合わせ者</div>
            <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", rowGap: 6, columnGap: 12, fontSize: 12.5 }}>
              <span style={{ color: "var(--color-ink-4)" }}>会社</span><span style={{ fontWeight: 600 }}>{r.company || "—"}</span>
              <span style={{ color: "var(--color-ink-4)" }}>氏名</span><span style={{ fontWeight: 600 }}>{r.name || "—"}</span>
              <span style={{ color: "var(--color-ink-4)" }}>職種</span><span>{r.role || "—"}</span>
              <span style={{ color: "var(--color-ink-4)" }}>メール</span><span>{r.email ? <a href={`mailto:${r.email}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{r.email}</a> : "—"}</span>
              <span style={{ color: "var(--color-ink-4)" }}>電話</span><span>{r.phone ? <a href={`tel:${r.phone}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{r.phone}</a> : "—"}</span>
            </div>
          </div>

          {/* 本文 */}
          <div className="card" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>本文</div>
            <div style={{ fontSize: 13, color: "var(--color-ink)", whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{r.message || "(本文なし)"}</div>
          </div>
        </div>

        {/* フッタ */}
        <div style={{ position: "sticky", bottom: 0, background: "var(--color-surface)", borderTop: "1px solid var(--color-border)", padding: "12px 22px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {r.email && (
            <a href={`mailto:${r.email}?subject=${encodeURIComponent(`Re: ${r.topic || "お問い合わせ"}`)}&body=${encodeURIComponent(`${r.name || ""} 様\n\nお問い合わせありがとうございます。\n\n${r.message ? `> ${r.message.replace(/\n/g, "\n> ")}` : ""}`)}`}
              className="btn brand" style={{ textDecoration: "none" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>reply</span>メール返信
            </a>
          )}
          {r.phone && (
            <a href={`tel:${r.phone}`} className="btn" style={{ textDecoration: "none", background: "#1aa260", color: "#fff", borderColor: "#1aa260" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>call</span>電話
            </a>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {r.status !== "inprogress" && <button type="button" className="btn ghost" disabled={pending} onClick={() => onStatus("inprogress")}>対応中に</button>}
            {r.status !== "done" && <button type="button" className="btn ghost" disabled={pending} onClick={() => onStatus("done")}>完了にする</button>}
            {r.status === "done" && <button type="button" className="btn ghost" disabled={pending} onClick={() => onStatus("new")}>新規に戻す</button>}
            <button type="button" className="btn ghost" disabled={pending} onClick={onDelete} style={{ color: "var(--color-danger)" }} title="削除（元に戻せません）">
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px", marginRight: 4 }}>delete</span>削除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
