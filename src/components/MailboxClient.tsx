"use client";

// 受信メール一覧 + 詳細モーダル（Gmail 同期・AI抽出・登録・スキップ）。
//   ・「📥 Gmail 同期」: 直近の Gmail を取り込み（AI は呼ばない・無料）
//   ・行クリック: 詳細モーダルを開く
//   ・「✨ AI抽出」: そのメールだけ Claude Haiku で解析（コスト約 0.7円/通）
//   ・抽出後: 「案件として登録」「人材として登録」「スキップ」を選択

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncInboxFromGmail, extractInboxEmail, registerInboxAsJob, registerInboxAsCandidate, skipInboxEmail, archiveInboxEmail, autoIngestFromGmail } from "@/lib/actions";

const fmtDateTime = (d: any) => {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "—";
  const now = new Date();
  const sameDay = t.toDateString() === now.toDateString();
  if (sameDay) return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};

const KIND_TONE: Record<string, { fg: string; bg: string; label: string }> = {
  job:       { fg: "#0095D9", bg: "#dbeafe", label: "案件" },
  candidate: { fg: "#067647", bg: "#e7f7ee", label: "人材" },
  skip:      { fg: "#6b7280", bg: "#f3f4f6", label: "スキップ" },
  spam:      { fg: "#b42318", bg: "#fdecef", label: "スパム" },
};

type Row = {
  id: string; gmail_message_id: string;
  subject: string | null; from_email: string | null; from_name: string | null;
  body: string | null;
  has_attachment: boolean; attachment_names: string[] | null;
  received_at: string | null; synced_at: string;
  extracted_at: string | null; extracted_kind: string | null;
  extracted_summary: string | null; extracted_data: any;
  registered_at: string | null; registered_job_no: number | null; registered_candidate_no: number | null;
  is_archived: boolean;
};

export function MailboxClient({ rows, filter, gmailReady }: { rows: Row[]; filter: string; gmailReady: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const [active, setActive] = useState<Row | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const sync = () => {
    if (!gmailReady) return;
    setSyncMsg("Gmail と同期中…（数秒〜数十秒）");
    start(async () => {
      const r = await syncInboxFromGmail({ max: 100 });
      if (!r.ok) { setSyncMsg(`同期失敗: ${r.error}`); return; }
      setSyncMsg(`✓ 新規 ${r.synced ?? 0}通 / 既存スキップ ${r.skipped ?? 0}通`);
      router.refresh();
      setTimeout(() => setSyncMsg(null), 8000);
    });
  };

  const autoRun = () => {
    if (!gmailReady) return;
    setSyncMsg("🤖 自動取込中…（同期→AI分類→自動登録、1〜2分かかります）");
    start(async () => {
      const r = await autoIngestFromGmail();
      if (!r.ok) { setSyncMsg(`自動取込失敗: ${r.error}`); return; }
      setSyncMsg(`✓ 同期${r.synced}・AI抽出${r.extracted}・案件自動登録${r.autoJobs}・人材自動登録${r.autoCandidates}・要確認${r.needsReview}・自動アーカイブ${r.archived}${r.errors ? `（エラー${r.errors}）` : ""}`);
      router.refresh();
      setTimeout(() => setSyncMsg(null), 15000);
    });
  };

  const filtered = rows.filter((r) => {
    if (!q.trim()) return true;
    const n = q.trim().toLowerCase();
    return [r.subject, r.from_email, r.from_name, r.extracted_summary].some((v) => String(v ?? "").toLowerCase().includes(n));
  });

  const tabs = [
    { key: "unprocessed", label: "未処理", icon: "inbox" },
    { key: "extracted",   label: "AI抽出済（未登録）", icon: "auto_awesome" },
    { key: "registered",  label: "登録済", icon: "check_circle" },
    { key: "archived",    label: "アーカイブ", icon: "archive" },
  ];

  const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "10px 12px", fontSize: 12.5, verticalAlign: "middle" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 操作バー */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn brand" disabled={!gmailReady || pending} onClick={sync}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>download</span>
          Gmail 同期
        </button>
        <button type="button" className="btn" disabled={!gmailReady || pending} onClick={autoRun}
          title="Gmail を絞り込み同期→AIで案件/人材判定→自信度0.75以上は自動登録／無関係は自動アーカイブ／低自信は要確認に残す">
          <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>auto_awesome</span>
          🤖 今すぐ自動取込
        </button>
        {syncMsg && <span className="muted" style={{ fontSize: 12 }}>{syncMsg}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-ink-4)" }}>search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="件名・差出人で絞り込み"
            style={{ fontFamily: "inherit", fontSize: 13, padding: "7px 11px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", minWidth: 240 }} />
        </div>
      </div>

      {/* タブ */}
      <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--color-border)" }}>
        {tabs.map((t) => {
          const on = filter === t.key;
          return (
            <a key={t.key} href={`/mailbox?filter=${t.key}`} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", textDecoration: "none",
              borderBottom: on ? "2px solid var(--color-brand-600)" : "2px solid transparent",
              color: on ? "var(--color-brand-700)" : "var(--color-ink-3)", fontWeight: on ? 700 : 600, fontSize: 13,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{t.icon}</span>{t.label}
            </a>
          );
        })}
      </div>

      {/* テーブル */}
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
              <th style={th}>受信</th>
              <th style={th}>差出人</th>
              <th style={th}>件名 / 要約</th>
              <th style={th}>📎</th>
              <th style={th}>状態</th>
              <th style={{ ...th, textAlign: "center" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "var(--color-ink-4)", padding: 36 }}>
                {rows.length === 0 ? "メールがありません。「Gmail 同期」で取り込んでください。" : "条件に一致するメールがありません。"}
              </td></tr>
            )}
            {filtered.map((r) => {
              const tone = r.extracted_kind ? KIND_TONE[r.extracted_kind] : null;
              return (
                <tr key={r.id} onClick={() => setActive(r)} style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface-soft)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ ...td, whiteSpace: "nowrap", color: "var(--color-ink-3)" }}>{fmtDateTime(r.received_at)}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{r.from_name || r.from_email || "—"}</div>
                    {r.from_name && r.from_email && <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{r.from_email}</div>}
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 520 }}>{r.subject || "(件名なし)"}</div>
                    {r.extracted_summary && <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 520 }}>{r.extracted_summary}</div>}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>{r.has_attachment ? "📎" : ""}</td>
                  <td style={td}>
                    {r.registered_at ? (
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#e7f7ee", color: "#067647" }}>
                        ✓ 登録済 {r.registered_job_no ? `案件#${r.registered_job_no}` : r.registered_candidate_no ? `人材#${r.registered_candidate_no}` : ""}
                      </span>
                    ) : tone ? (
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: tone.bg, color: tone.fg }}>{tone.label}</span>
                    ) : (
                      <span style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 99, background: "var(--color-surface-soft)", color: "var(--color-ink-4)" }}>未処理</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setActive(r); }} className="btn ghost btn-xs">開く</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ fontSize: 11.5 }}>{filtered.length} 件 / 全 {rows.length} 件</div>

      {active && <MailboxDetailModal r={active} onClose={() => setActive(null)} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────
function MailboxDetailModal({ r, onClose }: { r: Row; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [data, setData] = useState<any>(r.extracted_data);
  const [kind, setKind] = useState<string | null>(r.extracted_kind);
  const [summary, setSummary] = useState<string | null>(r.extracted_summary);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const runExtract = () => {
    setMsg({ text: "AI抽出中…（Claude Haiku・約 0.7円）" });
    start(async () => {
      const res = await extractInboxEmail(r.id);
      if (!res.ok) { setMsg({ ok: false, text: res.error || "AI抽出に失敗しました" }); return; }
      setKind(res.kind ?? null); setSummary(res.summary ?? null); setData(res.data ?? null);
      setMsg({ ok: true, text: `判定: ${res.kind} / ${res.summary ?? ""}` });
    });
  };

  const registerAs = (asKind: "job" | "candidate") => {
    start(async () => {
      const res: any = asKind === "job"
        ? await registerInboxAsJob(r.id)
        : await registerInboxAsCandidate(r.id);
      if (!res.ok) { setMsg({ ok: false, text: res.error || "登録に失敗しました" }); return; }
      const no = asKind === "job" ? res.job_no : res.candidate_no;
      setMsg({ ok: true, text: asKind === "job" ? `案件 #${no} として登録しました` : `人材 #${no} として登録しました` });
      setTimeout(() => { router.refresh(); onClose(); }, 1000);
    });
  };

  const skip = () => {
    if (!confirm("このメールをスキップ（アーカイブ）しますか？")) return;
    start(async () => {
      await skipInboxEmail(r.id, "営業判断によりスキップ");
      router.refresh(); onClose();
    });
  };

  const archive = () => {
    start(async () => {
      await archiveInboxEmail(r.id, !r.is_archived);
      router.refresh(); onClose();
    });
  };

  const fromLine = [r.from_name, r.from_email && `<${r.from_email}>`].filter(Boolean).join(" ");
  const dt = r.received_at ? new Date(r.received_at) : null;
  const dtStr = dt && !isNaN(dt.getTime()) ? `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}` : "—";

  const tone = kind ? KIND_TONE[kind] : null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,36,64,.45)", display: "grid", placeItems: "center", padding: 20, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(880px, 96vw)", maxHeight: "92vh", overflowY: "auto", padding: 0, background: "var(--color-surface)" }}>
        {/* ヘッダ */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 11.5 }}>受信メール</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis" }}>{r.subject || "(件名なし)"}</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{fromLine} · {dtStr}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <a href={`https://mail.google.com/mail/u/0/#all/${r.gmail_message_id}`} target="_blank" rel="noreferrer" className="btn ghost btn-xs" title="Gmailで開く" style={{ textDecoration: "none" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 4 }}>open_in_new</span>Gmail
            </a>
            <button type="button" onClick={onClose} className="btn ghost" aria-label="閉じる" style={{ fontSize: 18, lineHeight: 1, padding: "4px 10px" }}>×</button>
          </div>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* AI 判定 */}
          <div className="card" style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div className="muted" style={{ fontSize: 11.5 }}>AI 抽出結果</div>
              {!r.extracted_at && <button type="button" className="btn brand btn-sm" disabled={pending} onClick={runExtract}>
                <span className="material-symbols-outlined" style={{ fontSize: 15, marginRight: 4, verticalAlign: "-2px" }}>auto_awesome</span>
                {pending ? "解析中…" : "AI抽出（約0.7円）"}
              </button>}
              {r.extracted_at && <button type="button" className="btn ghost btn-xs" disabled={pending} onClick={runExtract} title="もう一度AI抽出を実行（追加課金あり）">再抽出</button>}
            </div>
            {tone && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: tone.bg, color: tone.fg }}>{tone.label}</span>
                {summary && <span style={{ fontSize: 12.5 }}>{summary}</span>}
              </div>
            )}
            {data && (
              <pre style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, background: "var(--color-surface-soft)", padding: 10, borderRadius: 8, maxHeight: 240, overflow: "auto", margin: 0 }}>{JSON.stringify(data, null, 2)}</pre>
            )}
            {!r.extracted_at && !data && <div className="muted" style={{ fontSize: 12 }}>未抽出。AI抽出ボタンを押すと Claude Haiku で判定します。</div>}
          </div>

          {/* 本文 */}
          <div className="card" style={{ padding: 14 }}>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>本文</div>
            <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", maxHeight: 320, overflowY: "auto", lineHeight: 1.7 }}>{r.body || "(本文なし)"}</div>
            {r.attachment_names && r.attachment_names.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--color-ink-3)" }}>📎 添付: {r.attachment_names.join(" / ")}</div>
            )}
          </div>

          {msg && (
            <div style={{ fontSize: 12.5, padding: "9px 12px", borderRadius: 8, background: msg.ok === false ? "#fdecef" : "#e7f7ee", color: msg.ok === false ? "var(--color-danger)" : "#067647", border: msg.ok === false ? "1px solid #f7c5cf" : "1px solid #bfe3cc" }}>
              {msg.text}
            </div>
          )}
        </div>

        {/* フッタ操作 */}
        <div style={{ position: "sticky", bottom: 0, background: "var(--color-surface)", borderTop: "1px solid var(--color-border)", padding: "12px 22px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {!r.registered_at && (
            <>
              <button type="button" className="btn" style={{ background: "#0095D9", color: "#fff", borderColor: "#0095D9" }} disabled={pending} onClick={() => registerAs("job")}>
                <span className="material-symbols-outlined" style={{ fontSize: 15, marginRight: 4, verticalAlign: "-2px" }}>work</span>
                案件として登録
              </button>
              <button type="button" className="btn" style={{ background: "#1aa260", color: "#fff", borderColor: "#1aa260" }} disabled={pending} onClick={() => registerAs("candidate")}>
                <span className="material-symbols-outlined" style={{ fontSize: 15, marginRight: 4, verticalAlign: "-2px" }}>person</span>
                人材として登録
              </button>
              <button type="button" className="btn ghost" disabled={pending} onClick={skip}>スキップ</button>
            </>
          )}
          {r.registered_at && (
            <span style={{ fontSize: 12, color: "#067647", fontWeight: 700 }}>
              ✓ 登録済 {r.registered_job_no ? `(案件 #${r.registered_job_no})` : r.registered_candidate_no ? `(人材 #${r.registered_candidate_no})` : ""}
            </span>
          )}
          <button type="button" className="btn ghost" disabled={pending} onClick={archive} style={{ marginLeft: "auto" }}>
            {r.is_archived ? "アーカイブ解除" : "アーカイブ"}
          </button>
        </div>
      </div>
    </div>
  );
}
