"use client";

// 受信メール一覧 + 詳細モーダル（Gmail 同期・AI抽出・登録・スキップ）。
//   ・「📥 Gmail 同期」: 直近の Gmail を取り込み（AI は呼ばない・無料）
//   ・行クリック: 詳細モーダルを開く
//   ・「✨ AI抽出」: そのメールだけ Claude Haiku で解析（コスト約 0.7円/通）
//   ・抽出後: 「案件として登録」「人材として登録」「スキップ」を選択

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncInboxFromGmail, extractInboxEmail, registerInboxAsJob, registerInboxAsCandidate, skipInboxEmail, archiveInboxEmail, autoIngestFromGmail, backfillInboxSourceMailUrls, exportInboxEmails, importInboxExtractions, type InboxExportRow, type InboxImportResult, type InboxImportSummary } from "@/lib/actions";

// ── 期間ダウンロード（ローカル整形用）──────────────────────────────
//   inbox_emails の生メール＋AI抽出結果を CSV / JSONL に整形してブラウザ保存する。
//   gmail_message_id を先頭列に含めるので、ローカルで磨いたプロンプトの結果を後で突き合わせ可能。
const EXPORT_COLS: (keyof InboxExportRow)[] = [
  "gmail_message_id", "received_at", "from_name", "from_email", "subject", "body",
  "has_attachment", "attachment_names", "extracted_kind", "extracted_summary",
  "extracted_data", "registered_job_no", "registered_candidate_no",
];
// 1セルを文字列化（配列は " / " 連結、オブジェクトは JSON 文字列）。
const cellStr = (v: unknown): string => {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(" / ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};
const csvEscape = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
function rowsToCsv(rows: InboxExportRow[]): string {
  const header = EXPORT_COLS.join(",");
  const lines = rows.map((r) => EXPORT_COLS.map((c) => csvEscape(cellStr((r as any)[c]))).join(","));
  // Excel が UTF-8 を正しく開けるよう BOM を先頭に付与。改行は CRLF。
  return "﻿" + [header, ...lines].join("\r\n");
}
function rowsToJsonl(rows: InboxExportRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}
function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// ブラウザのローカル日付を YYYY-MM-DD で返す（日本のユーザーは JST）。
function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── 書き戻しインポート（CSV/JSONL パース）──────────────────────────
//   ダウンロードしたファイルをローカルで整形（extracted_kind / extracted_data を編集）して再アップ。
//   JSONL は各行が {gmail_message_id, extracted_kind, extracted_data:{...}} でそのまま突き合わせ可。
//   CSV は extracted_data 列に JSON を入れるか、フラット列（title/name など）で指定できる。
type ImportRowIn = { gmail_message_id?: string; extracted_kind?: string; extracted_summary?: string; extracted_data?: any };

// 簡易 CSV パーサ（引用符・ダブルクオート・改行埋め込みに対応）。ヘッダ行必須。
function parseCsvRows(text: string): Record<string, string>[] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') { inQ = true; }
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* CRLF は \n 側で確定 */ }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c !== "")).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = r[i] ?? ""; });
    return o;
  });
}

// フラット列（extracted_data 列が無い CSV）から data オブジェクトを組む。
const FLAT_STR_KEYS = ["title", "client_name", "role_label", "remote_type", "flow_note", "work_location", "start_date", "detail", "name", "company", "rate", "exp", "remote_pref", "skill_sheet_url"];
function buildFlatData(o: Record<string, string>): any {
  const d: any = {};
  for (const k of FLAT_STR_KEYS) { const v = (o[k] ?? "").trim(); if (v) d[k] = v; }
  const sk = (o.skills ?? "").trim();
  if (sk) d.skills = sk.split(/\s*[/、,]\s*/).filter(Boolean);
  for (const k of ["salary_min", "salary_max"]) { const m = String(o[k] ?? "").match(/\d+/); if (m) d[k] = Number(m[0]); }
  return d;
}

// パース済み1レコードを取り込み行に正規化（JSON優先、無ければフラット列）。
function toImportRow(o: Record<string, any>): ImportRowIn {
  const gid = String(o.gmail_message_id ?? o.gmailMessageId ?? "").trim();
  const kind = String(o.extracted_kind ?? o.kind ?? "").trim();
  const summary = o.extracted_summary != null ? String(o.extracted_summary) : (o.summary != null ? String(o.summary) : undefined);
  let data: any = {};
  const rawData = o.extracted_data;
  if (rawData && typeof rawData === "object") data = rawData;                 // JSONL: 既にオブジェクト
  else if (typeof rawData === "string" && rawData.trim()) {                    // CSV: JSON文字列
    try { data = JSON.parse(rawData); } catch { data = { _parse_error: true }; }
  } else data = buildFlatData(o);                                             // CSV: フラット列
  return { gmail_message_id: gid, extracted_kind: kind, extracted_summary: summary, extracted_data: data };
}

// ファイル全文を取り込み行配列へ（JSONL / JSON配列 / CSV を自動判別）。
function parseImportText(text: string, filename: string): { rows: ImportRowIn[]; parseErrors: number } {
  const t = text.replace(/^﻿/, "").trim();
  const isJson = /\.jsonl?$/i.test(filename) || t.startsWith("{") || t.startsWith("[");
  let records: Record<string, any>[] = [];
  if (isJson) {
    if (t.startsWith("[")) { try { const a = JSON.parse(t); if (Array.isArray(a)) records = a; } catch { /* fallthrough */ } }
    if (records.length === 0) {
      records = t.split(/\r?\n/).map((ln) => ln.trim()).filter(Boolean).map((ln) => { try { return JSON.parse(ln); } catch { return { _bad: true }; } });
    }
  } else {
    records = parseCsvRows(text);
  }
  const rows = records.filter((r) => !r._bad).map(toImportRow);
  const parseErrors = records.filter((r) => r._bad).length + rows.filter((r) => r.extracted_data?._parse_error).length;
  return { rows, parseErrors };
}

const IMPORT_STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  job_new:            { label: "案件・新規",       tone: "#0095D9" },
  job_merged:         { label: "案件・既存に統合", tone: "#7c3aed" },
  cand_new:           { label: "人材・新規",       tone: "#067647" },
  cand_merged:        { label: "人材・既存に統合", tone: "#7c3aed" },
  archived:           { label: "アーカイブ",       tone: "#94a3b8" },
  already_registered: { label: "登録済み（スキップ）", tone: "#d98a2b" },
  not_found:          { label: "未取込",           tone: "#b42318" },
  invalid:            { label: "不正な行",         tone: "#b42318" },
  error:              { label: "エラー",           tone: "#b42318" },
};

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
  attachments?: { name: string; url: string; path?: string; size?: number; mime?: string }[] | null;
  received_at: string | null; synced_at: string;
  extracted_at: string | null; extracted_kind: string | null;
  extracted_summary: string | null; extracted_data: any;
  registered_at: string | null; registered_job_no: number | null; registered_candidate_no: number | null;
  is_archived: boolean;
};

export function MailboxClient({ rows, filter, gmailReady, page = 1, total = 0, perPage = 1000, maxPages = 20 }: {
  rows: Row[]; filter: string; gmailReady: boolean;
  /** ページング（1ページ perPage 件・最大 maxPages ページ）。total はフィルタ別の総件数。 */
  page?: number; total?: number; perPage?: number; maxPages?: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const [active, setActive] = useState<Row | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // 期間ダウンロード（ローカル整形用）の状態。既定は当日の1日分。
  const [dlFrom, setDlFrom] = useState<string>(todayLocal());
  const [dlTo, setDlTo] = useState<string>(todayLocal());
  const [dlFormat, setDlFormat] = useState<"csv" | "jsonl">("csv");
  const [dlInclArchived, setDlInclArchived] = useState(false);
  const [dlMsg, setDlMsg] = useState<string | null>(null);
  const [dlBusy, setDlBusy] = useState(false);

  const downloadRange = () => {
    if (dlBusy) return;
    if (dlFrom && dlTo && dlFrom > dlTo) { setDlMsg("開始日が終了日より後になっています。"); return; }
    setDlBusy(true);
    setDlMsg("メールを収集中…");
    (async () => {
      try {
        const res = await exportInboxEmails({ from: dlFrom || undefined, to: dlTo || undefined, includeArchived: dlInclArchived });
        if (!res.ok) { setDlMsg(`ダウンロード失敗: ${res.error}`); return; }
        const rows = res.rows ?? [];
        if (rows.length === 0) { setDlMsg("該当期間のメールが0通でした。まず「Gmail 同期」で取り込んでください。"); return; }
        const ext = dlFormat === "csv" ? "csv" : "jsonl";
        const filename = `inbox_${dlFrom || "all"}_${dlTo || "all"}.${ext}`;
        const text = dlFormat === "csv" ? rowsToCsv(rows) : rowsToJsonl(rows);
        const mime = dlFormat === "csv" ? "text/csv;charset=utf-8" : "application/x-ndjson;charset=utf-8";
        downloadText(filename, text, mime);
        setDlMsg(`✓ ${rows.length}通をダウンロードしました（${filename}）${res.capped ? "。上限に達したため一部のみ。期間を狭めてください。" : ""}`);
      } catch (e) {
        setDlMsg(`ダウンロード失敗: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setDlBusy(false);
      }
    })();
  };

  const sync = () => {
    if (!gmailReady) return;
    // 7日以内の件数を把握（最大3000件までID集計）しつつ、1回あたり最大500件を本文取込する。
    //   受信量が多いアカウントは1回で入りきらないため、残り（remaining）があれば続けて押すと全件取り込める。
    setSyncMsg("Gmail と同期中…（7日以内・1回最大500件・数十秒かかることがあります）");
    start(async () => {
      const r = await syncInboxFromGmail({ max: 3000, fetchCap: 500 });
      if (!r.ok) { setSyncMsg(`同期失敗: ${r.error}${r.account ? `（接続先: ${r.account}）` : ""}`); return; }
      const acc = r.account ? `接続先: ${r.account} ／ ` : "";
      if ((r.found ?? 0) === 0) {
        setSyncMsg(`${acc}直近7日で該当メール0通。アカウントが正しいか・期間内に受信があるか確認してください。`);
      } else {
        const remaining = r.remaining ?? 0;
        const tail = remaining > 0
          ? ` ／ 未取得 ${remaining}通（もう一度「Gmail 同期」で続きを取込）`
          : "（7日以内は全件取込済み）";
        setSyncMsg(`${acc}7日以内 ${r.found}通 ／ 新規取込 ${r.synced ?? 0}通 ／ 既存 ${r.skipped ?? 0}通${tail}`);
      }
      router.refresh();
      setTimeout(() => setSyncMsg(null), 20000);
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

  const repairLinks = () => {
    setSyncMsg("🔗 元メールリンクを補修中…");
    start(async () => {
      const r = await backfillInboxSourceMailUrls();
      if (!r.ok) { setSyncMsg(`補修失敗: ${r.error}`); return; }
      setSyncMsg(`✓ 元メールリンク補修: 案件${r.jobsFixed}件・人材${r.candidatesFixed}件を修正（対象${r.scanned}件を確認）`);
      router.refresh();
      setTimeout(() => setSyncMsg(null), 12000);
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
        <button type="button" className="btn ghost" disabled={pending} onClick={repairLinks}
          title="取込メール由来の案件/人材で「元メール」が開けない・別アカウントで開くものを、正しい受信アカウントの原本URLに一括張り替え">
          <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>link</span>
          元メールリンク補修
        </button>
        {syncMsg && <span className="muted" style={{ fontSize: 12 }}>{syncMsg}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-ink-4)" }}>search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="件名・差出人で絞り込み"
            style={{ fontFamily: "inherit", fontSize: 13, padding: "7px 11px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", minWidth: 240 }} />
        </div>
      </div>

      {/* 期間ダウンロード（ローカル整形用）。カレンダーで from/to を選び CSV/JSONL で保存。 */}
      <div className="card" style={{ padding: "12px 14px", display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12, background: "var(--color-surface-soft)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 200 }}>
          <span style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 700, letterSpacing: ".04em" }}>期間ダウンロード（ローカル整形用）</span>
          <span style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>受信日でメールを書き出し。<span className="mono">gmail_message_id</span> を含むので後で突き合わせ可。</span>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600 }}>
          開始日
          <input type="date" value={dlFrom} max={dlTo || undefined} onChange={(e) => setDlFrom(e.target.value)}
            style={{ fontFamily: "inherit", fontSize: 13, padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600 }}>
          終了日
          <input type="date" value={dlTo} min={dlFrom || undefined} onChange={(e) => setDlTo(e.target.value)}
            style={{ fontFamily: "inherit", fontSize: 13, padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600 }}>
          形式
          <select value={dlFormat} onChange={(e) => setDlFormat(e.target.value as "csv" | "jsonl")}
            style={{ fontFamily: "inherit", fontSize: 13, padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            <option value="csv">CSV（Excel）</option>
            <option value="jsonl">JSONL（AI入力向け）</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--color-ink-3)" }}>
          <input type="checkbox" checked={dlInclArchived} onChange={(e) => setDlInclArchived(e.target.checked)} />
          アーカイブも含む
        </label>
        <button type="button" className="btn brand" disabled={dlBusy} onClick={downloadRange}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>download</span>
          {dlBusy ? "作成中…" : "ダウンロード"}
        </button>
        {dlMsg && <span className="muted" style={{ fontSize: 12, flexBasis: "100%" }}>{dlMsg}</span>}
      </div>

      {/* 書き戻しインポート（ローカル整形結果を DB へ反映。二重登録チェック付き） */}
      <InboxImportPanel />

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

      {/* ページャ：1ページ perPage 件・最大 maxPages ページ（要望：500件では追いつかない→1000件×ページ送り）。 */}
      {(() => {
        const pages = Math.min(maxPages, Math.max(1, Math.ceil((total || 0) / perPage)));
        const href = (n: number) => `/mail?tab=import&filter=${encodeURIComponent(filter)}&page=${n}`;
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 11.5 }}>
              表示 {filtered.length.toLocaleString()} 件（このページ {rows.length.toLocaleString()} 件 ／ 全 {Math.max(total, rows.length).toLocaleString()} 件）
            </span>
            {pages > 1 && (
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                {page > 1 && <a className="btn ghost btn-xs" href={href(page - 1)} style={{ textDecoration: "none" }}>← 前へ</a>}
                {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                  <a key={n} href={href(n)} style={{
                    padding: "3px 9px", borderRadius: 7, textDecoration: "none", fontSize: 12,
                    fontWeight: n === page ? 800 : 600,
                    background: n === page ? "var(--color-brand-600)" : "transparent",
                    color: n === page ? "#fff" : "var(--color-ink-2)",
                    border: n === page ? "1px solid var(--color-brand-600)" : "1px solid var(--color-border)",
                  }}>{n}</a>
                ))}
                {page < pages && <a className="btn ghost btn-xs" href={href(page + 1)} style={{ textDecoration: "none" }}>次へ →</a>}
              </span>
            )}
          </div>
        );
      })()}

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
  const [msg, setMsg] = useState<{ ok?: boolean; text: string; nextHref?: string; nextLabel?: string } | null>(null);

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
      // 登録直後にマッチング画面へ直接遷移できる導線（次ステップ提示）。
      const nextHref = asKind === "job"
        ? `/matching?job=${no}`
        : `/matching?person=${no}`;
      setMsg({
        ok: true,
        text: asKind === "job" ? `案件 #${no} として登録しました` : `人材 #${no} として登録しました`,
        nextHref,
        nextLabel: asKind === "job" ? "→ この案件でマッチング" : "→ この人材でマッチング",
      });
      // モーダル自動閉鎖は無効化（次アクションを選んでもらう）。閉じる時に refresh。
      router.refresh();
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
            {/* 添付：スキルシート等は保存済みの公開URLで表示・DL。未保存（列未整備/画像のみ）は名前だけ表示。 */}
            {Array.isArray(r.attachments) && r.attachments.length > 0 ? (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>📎 添付（スキルシート等）</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {r.attachments.map((a, i) => (
                    <a key={i} href={a.url} target="_blank" rel="noreferrer" download
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--color-brand-700)", textDecoration: "none", padding: "6px 10px", borderRadius: 8, background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", maxWidth: "100%" }}
                      title={a.name}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>description</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                      <span className="material-symbols-outlined" style={{ fontSize: 15, marginLeft: "auto" }}>download</span>
                    </a>
                  ))}
                </div>
              </div>
            ) : r.attachment_names && r.attachment_names.length > 0 ? (
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--color-ink-3)" }}>📎 添付: {r.attachment_names.join(" / ")}（未保存：再同期すると保存されます）</div>
            ) : null}
          </div>

          {msg && (
            <div style={{ fontSize: 12.5, padding: "9px 12px", borderRadius: 8, background: msg.ok === false ? "#fdecef" : "#e7f7ee", color: msg.ok === false ? "var(--color-danger)" : "#067647", border: msg.ok === false ? "1px solid #f7c5cf" : "1px solid #bfe3cc", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span>{msg.text}</span>
              {msg.nextHref && msg.nextLabel && (
                <a href={msg.nextHref}
                  style={{ marginLeft: "auto", color: "var(--color-brand-700)", fontWeight: 800, textDecoration: "none", fontSize: 12.5, padding: "4px 10px", borderRadius: 6, background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)" }}>
                  {msg.nextLabel}
                </a>
              )}
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

// ────────────────────────────────────────────────────────
// 書き戻しインポート：ローカルで整形した CSV/JSONL を DB へ反映する。
//   フロー: ①ファイル選択 → ②「検証（ドライラン）」で二重登録チェック → ③「取り込み実行」。
//   二重登録は Layer A（登録済みメールをスキップ）＋ Layer B（既存に統合）でサーバ側が防止。
function InboxImportPanel() {
  const router = useRouter();
  const [rows, setRows] = useState<ImportRowIn[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [allowRe, setAllowRe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InboxImportResult[] | null>(null);
  const [summary, setSummary] = useState<InboxImportSummary | null>(null);
  const [wasDryRun, setWasDryRun] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const onFile = async (f: File | null) => {
    setResults(null); setSummary(null); setWasDryRun(true); // 新ファイルは再検証を必須にする
    if (!f) { setRows([]); setFileName(""); setMsg(null); return; }
    try {
      const text = await f.text();
      const parsed = parseImportText(text, f.name);
      setRows(parsed.rows); setFileName(f.name);
      setMsg(`${parsed.rows.length}行を読み込みました${parsed.parseErrors ? `（うち${parsed.parseErrors}行は解析エラーで除外）` : ""}。まず「検証」で二重登録をチェックしてください。`);
    } catch (e) {
      setRows([]); setFileName("");
      setMsg(`読み込み失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const run = (dryRun: boolean) => {
    if (busy || rows.length === 0) return;
    if (!dryRun && !confirm(`${rows.length}行をDBへ取り込みます。よろしいですか？（登録済みメールは${allowRe ? "上書き" : "スキップ"}）`)) return;
    setBusy(true); setMsg(dryRun ? "検証中…（DBは変更しません）" : "取り込み中…");
    (async () => {
      try {
        const res = await importInboxExtractions(rows, { dryRun, allowReregister: allowRe });
        if (!res.ok) { setMsg(`失敗: ${res.error}`); return; }
        setResults(res.results ?? []); setSummary(res.summary ?? null); setWasDryRun(dryRun);
        setMsg(dryRun ? "✓ 検証結果（DB未反映）。内容を確認して問題なければ「取り込み実行」を押してください。" : "✓ 取り込みが完了しました。");
        if (!dryRun) router.refresh();
      } catch (e) {
        setMsg(`失敗: ${e instanceof Error ? e.message : String(e)}`);
      } finally { setBusy(false); }
    })();
  };

  const chip = (label: string, n: number, tone: string) => (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: "var(--color-surface)", border: "1px solid var(--color-border)", color: tone }}>{label} {n}</span>
  );

  return (
    <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, background: "var(--color-surface-soft)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 220 }}>
          <span style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 700, letterSpacing: ".04em" }}>書き戻しインポート（CSV/JSONL）</span>
          <span style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>ローカル整形した抽出結果を <span className="mono">gmail_message_id</span> で突き合わせて登録。二重登録は自動でチェック。</span>
        </div>
        <label className="btn ghost" style={{ cursor: "pointer" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>upload_file</span>
          ファイルを選択
          <input type="file" accept=".jsonl,.json,.csv,.txt" style={{ display: "none" }}
            onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </label>
        {fileName && <span className="muted" style={{ fontSize: 12 }}>{fileName}（{rows.length}行）</span>}
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--color-ink-3)" }}
          title="オンにすると、既に案件/人材へ登録済みのメールも再登録（内容を上書き）します。既定はオフ＝スキップ。">
          <input type="checkbox" checked={allowRe} onChange={(e) => setAllowRe(e.target.checked)} />
          登録済みも上書き
        </label>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button type="button" className="btn" disabled={busy || rows.length === 0} onClick={() => run(true)}
            title="DBを変更せず、各行が新規登録・既存への統合・スキップのどれになるかを表示します。">
            <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>fact_check</span>
            検証（ドライラン）
          </button>
          <button type="button" className="btn brand" disabled={busy || rows.length === 0 || (wasDryRun && !results)} onClick={() => run(false)}
            title="検証で内容を確認してから実行してください。">
            <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>save</span>
            取り込み実行
          </button>
        </div>
      </div>

      {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}

      {summary && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>{wasDryRun ? "検証結果" : "取込結果"}（全{summary.total}）:</span>
          {chip("案件・新規", summary.jobNew, "#0095D9")}
          {chip("人材・新規", summary.candNew, "#067647")}
          {chip("既存に統合", summary.jobMerged + summary.candMerged, "#7c3aed")}
          {chip("スキップ(登録済)", summary.alreadyRegistered, "#d98a2b")}
          {chip("アーカイブ", summary.archived, "#94a3b8")}
          {summary.notFound > 0 && chip("未取込", summary.notFound, "#b42318")}
          {summary.invalid > 0 && chip("不正", summary.invalid, "#b42318")}
          {summary.error > 0 && chip("エラー", summary.error, "#b42318")}
        </div>
      )}

      {results && results.length > 0 && (
        <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
                <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, color: "var(--color-ink-4)" }}>gmail_message_id</th>
                <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, color: "var(--color-ink-4)" }}>結果</th>
                <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, color: "var(--color-ink-4)" }}>詳細</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => {
                const t = IMPORT_STATUS_LABEL[r.status] ?? { label: r.status, tone: "var(--color-ink-3)" };
                return (
                  <tr key={i} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td className="mono" style={{ padding: "5px 10px", color: "var(--color-ink-4)", fontSize: 10.5, whiteSpace: "nowrap" }}>{r.gmail_message_id.length > 16 ? r.gmail_message_id.slice(0, 16) + "…" : r.gmail_message_id}</td>
                    <td style={{ padding: "5px 10px", whiteSpace: "nowrap" }}><span style={{ fontWeight: 700, color: t.tone }}>{t.label}</span></td>
                    <td style={{ padding: "5px 10px", color: "var(--color-ink-3)" }}>{r.detail ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
