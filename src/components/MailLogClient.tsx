"use client";

// メール送信履歴の一覧 + 詳細モーダル。
//   - 検索（件名・宛先・送信者で部分一致）
//   - 差出人ドメインフィルタ（enger / 8grp）
//   - 行クリックで本文プレビュー
//   - 「再送（編集して送信）」で同内容を SendMailButton モーダルに引き継ぎ可能

import { useEffect, useMemo, useState } from "react";
import { SendMailButton } from "./SendMailButton";

type Row = {
  id: string;
  sender_key: string; from_address: string; to_address: string;
  cc_address: string | null; bcc_address: string | null;
  subject: string; body: string | null; message_id: string | null;
  sent_by_email: string | null; sent_by_name: string | null;
  related_kind: string | null; related_id: string | null;
  created_at: string;
};

const SENDER_LABEL: Record<string, { label: string; color: string }> = {
  enger: { label: "enger.jp", color: "#0095D9" },
  "8grp": { label: "8grp.co.jp", color: "#7c3aed" },
};

const fmtDateTime = (s: string) => {
  const d = new Date(s); if (isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const fmtShort = (s: string) => {
  const d = new Date(s); if (isNaN(d.getTime())) return "—";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function MailLogClient({ rows, initialQ, initialSender }: { rows: Row[]; initialQ: string; initialSender: string }) {
  const [q, setQ] = useState(initialQ);
  const [sender, setSender] = useState(initialSender);
  const [active, setActive] = useState<Row | null>(null);

  // クライアント側でも軽くフィルタ（URL更新は最小限）
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (sender && r.sender_key !== sender) return false;
      if (!n) return true;
      return [r.subject, r.to_address, r.from_address, r.sent_by_name, r.sent_by_email, r.cc_address].some((v) => String(v ?? "").toLowerCase().includes(n));
    });
  }, [rows, q, sender]);

  // KPI（今日/今月）
  const stats = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const monthStr = todayStr.slice(0, 7);
    let today = 0, month = 0;
    for (const r of rows) {
      const d = String(r.created_at).slice(0, 10);
      if (d === todayStr) today++;
      if (d.slice(0, 7) === monthStr) month++;
    }
    return { today, month, total: rows.length };
  }, [rows]);

  const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px 12px", fontSize: 12.5, verticalAlign: "middle" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* KPI */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div className="card" style={{ padding: "10px 16px", display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="muted" style={{ fontSize: 11 }}>本日</span>
          <span className="tnum" style={{ fontSize: 20, fontWeight: 800, color: "var(--color-brand-700)" }}>{stats.today}</span>
          <span className="muted" style={{ fontSize: 11 }}>件</span>
        </div>
        <div className="card" style={{ padding: "10px 16px", display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="muted" style={{ fontSize: 11 }}>今月</span>
          <span className="tnum" style={{ fontSize: 20, fontWeight: 800 }}>{stats.month}</span>
          <span className="muted" style={{ fontSize: 11 }}>件</span>
        </div>
        <div className="card" style={{ padding: "10px 16px", display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="muted" style={{ fontSize: 11 }}>累計（直近500件）</span>
          <span className="tnum" style={{ fontSize: 20, fontWeight: 800 }}>{stats.total}</span>
          <span className="muted" style={{ fontSize: 11 }}>件</span>
        </div>
      </div>

      {/* 検索 + フィルタ */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 320px", minWidth: 240 }}>
          <span className="material-symbols-outlined" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 18, color: "var(--color-ink-4)" }}>search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="件名・宛先・送信者で検索…"
            style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "9px 12px 9px 38px", borderRadius: 10, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-ink-3)" }}>
          差出人ドメイン
          <select value={sender} onChange={(e) => setSender(e.target.value)} style={{ fontFamily: "inherit", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            <option value="">すべて</option>
            <option value="enger">enger.jp</option>
            <option value="8grp">8grp.co.jp</option>
          </select>
        </label>
      </div>

      {/* テーブル */}
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <th style={th}>送信日時</th>
              <th style={th}>送信者</th>
              <th style={th}>差出人</th>
              <th style={th}>宛先</th>
              <th style={th}>件名</th>
              <th style={{ ...th, textAlign: "center" }}>詳細</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "var(--color-ink-4)", padding: 36 }}>
                {rows.length === 0 ? "送信履歴はまだありません。メール作成画面から送信するとここに記録されます。" : "条件に一致する送信履歴がありません。"}
              </td></tr>
            )}
            {filtered.map((r) => {
              const s = SENDER_LABEL[r.sender_key] ?? { label: r.sender_key, color: "#6b7280" };
              return (
                <tr key={r.id} onClick={() => setActive(r)} style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-soft)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ ...td, whiteSpace: "nowrap", color: "var(--color-ink-3)" }}>{fmtShort(r.created_at)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{r.sent_by_name || r.sent_by_email || "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: `${s.color}14`, color: s.color, border: `1px solid ${s.color}55` }}>
                      <span style={{ width: 5, height: 5, borderRadius: 99, background: s.color }} />{s.label}
                    </span>
                  </td>
                  <td style={{ ...td, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{r.to_address}</td>
                  <td style={{ ...td, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 380 }}>{r.subject || "—"}</td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setActive(r); }} className="btn ghost btn-xs">開く</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ fontSize: 11.5 }}>{filtered.length} 件 / 全 {rows.length} 件（直近500件）</div>

      {active && <DetailModal r={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function DetailModal({ r, onClose }: { r: Row; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const s = SENDER_LABEL[r.sender_key] ?? { label: r.sender_key, color: "#6b7280" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,36,64,.5)", display: "grid", placeItems: "center", padding: 20, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(720px, 96vw)", maxHeight: "92vh", overflowY: "auto", padding: 0, background: "var(--color-surface)" }}>
        <div style={{ position: "sticky", top: 0, background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 11.5 }}>送信履歴詳細</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{r.subject || "(件名なし)"}</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{fmtDateTime(r.created_at)}</div>
          </div>
          <button type="button" onClick={onClose} className="btn ghost" aria-label="閉じる" style={{ fontSize: 18, lineHeight: 1, padding: "4px 10px" }}>×</button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>送信情報</div>
            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", rowGap: 6, columnGap: 12, fontSize: 12.5 }}>
              <span style={{ color: "var(--color-ink-4)" }}>差出人</span>
              <span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: `${s.color}14`, color: s.color, border: `1px solid ${s.color}55`, marginRight: 6 }}>
                  <span style={{ width: 5, height: 5, borderRadius: 99, background: s.color }} />{s.label}
                </span>
                <span style={{ fontWeight: 600 }}>{r.from_address}</span>
              </span>
              <span style={{ color: "var(--color-ink-4)" }}>宛先(To)</span><span style={{ fontWeight: 600 }}>{r.to_address}</span>
              {r.cc_address && (<><span style={{ color: "var(--color-ink-4)" }}>CC</span><span>{r.cc_address}</span></>)}
              {r.bcc_address && (<><span style={{ color: "var(--color-ink-4)" }}>BCC</span><span>{r.bcc_address}</span></>)}
              <span style={{ color: "var(--color-ink-4)" }}>送信者</span><span>{r.sent_by_name || "—"} {r.sent_by_email && <span className="muted">({r.sent_by_email})</span>}</span>
              {r.related_kind && (<><span style={{ color: "var(--color-ink-4)" }}>関連</span><span>{r.related_kind}{r.related_id ? ` #${r.related_id}` : ""}</span></>)}
              {r.message_id && (<><span style={{ color: "var(--color-ink-4)" }}>Message-ID</span><span className="mono" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.message_id}</span></>)}
            </div>
          </div>

          <div className="card" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>本文</div>
            <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", lineHeight: 1.8, maxHeight: 360, overflowY: "auto" }}>{r.body || "(本文なし)"}</div>
          </div>
        </div>

        <div style={{ position: "sticky", bottom: 0, background: "var(--color-surface)", borderTop: "1px solid var(--color-border)", padding: "12px 22px", display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
          {/* 再送（同じ内容を編集して送れる・確認モーダル経由） */}
          <SendMailButton
            label="↻ 同じ内容で再送"
            className="btn ghost"
            to={r.to_address}
            cc={r.cc_address || ""}
            subject={r.subject}
            body={r.body || ""}
            relatedKind={r.related_kind || undefined}
            relatedId={r.related_id || undefined}
          />
        </div>
      </div>
    </div>
  );
}
