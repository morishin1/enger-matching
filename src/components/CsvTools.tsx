"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseCsv, rowsToCsv, downloadCsv } from "@/lib/csv";
import { gmailMessageUrl } from "@/lib/gmail";
import { importCandidates, importJobs, upsertCandidateManual, upsertJobManual, findSimilarJobs, findSimilarCandidates, type CandidateInput, type JobInput, type SimilarJob, type SimilarCandidate } from "@/lib/actions";
import { Icons } from "./icons";

const salaryShort = (lo: number | null, hi: number | null) => lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "—";

const numOf = (s: string) => { const n = parseFloat((s || "").replace(/[^\d.]/g, "")); return isNaN(n) ? null : n; };
const dateOf = (s: string) => { const m = (s || "").match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/); return m ? `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}` : null; };
// GAS v2 はスキルに「名称:経験年数」を付ける（例: "Ruby on Rails:6"）。末尾の :数字 を落として純粋なスキル名にする。
const cleanSkill = (x: string) => x.trim().replace(/[:：]\s*\d+\+?\s*$/, "").trim();
const splitSkills = (s: string) => (s || "").split(/[,、\/／・]+/).map(cleanSkill).filter(Boolean);
// 単一の Drive ファイルID/URL を Drive 閲覧URLに正規化。カンマ区切りなら先頭を採用。
const driveUrl = (raw: string) => {
  const v = ((raw || "").split(/[,、\s]+/).filter(Boolean)[0] ?? "").trim();
  return /^https?:\/\//i.test(v) ? v : (/^[\w-]{20,}$/.test(v) ? `https://drive.google.com/file/d/${v}/view` : v);
};
const remoteOf = (s: string) => /フル/.test(s || "") ? "full_remote" : /出社|常駐|不可/.test(s || "") ? "onsite" : "partial_remote";
const garbled = (s: string) => /[�]/.test(s) || /[縺繧繝繚竊郢蝣]/.test(s); // 文字化け検知

/** 任意データを CSV ダウンロード */
export function ExportButton({ filename, headers, rows, label = "CSV書き出し" }: {
  filename: string; headers: { key: string; label: string }[]; rows: Record<string, unknown>[]; label?: string;
}) {
  return (
    <button className="btn" onClick={() => downloadCsv(filename, rowsToCsv(headers, rows))} disabled={rows.length === 0}>
      <Icons.arrow /><span>{label}</span>
    </button>
  );
}

const CAND_COL: Record<string, keyof CandidateInput | "_rate_min" | "_rate_max" | "_mail_id" | "_skill_based"> = {
  "コード": "code", "id": "code", "ID": "code", "氏名": "name", "名前": "name", "name": "name",
  "職種": "title", "タイトル": "title", "所属": "company", "会社": "company", "会社名": "company", "所属会社": "company",
  "所属区分": "affiliation", "区分": "affiliation", "雇用形態": "affiliation",
  "スキル": "skills", "必要スキル": "skills", "保有スキル": "skills", "技術スキル": "skills",
  "単価": "rate", "希望単価": "rate", "希望単価下限": "_rate_min", "希望単価上限": "_rate_max", "単価下限": "_rate_min", "単価上限": "_rate_max",
  "スキル見合い": "_skill_based",
  "稼働開始": "avail", "稼働": "avail", "稼働開始可能日": "avail", "勤務地": "location", "場所": "location", "希望勤務地": "location",
  "経験": "exp", "経験年数": "exp", "実務経験年数": "exp", "ステータス": "status", "状態": "status", "現在のステータス": "status",
  // マッチングのリモート評価に必須
  "リモート希望": "remote_pref", "リモート": "remote_pref", "リモート可否": "remote_pref",
  // 詳細プロフィール（詳細ページで表示）
  "年齢層": "age_band", "希望年齢層": "age_band", "国籍": "nationality",
  "スキルレベル": "skill_level", "日本語レベル": "japanese_level", "日本語": "japanese_level",
  "コミュニケーション力": "comm", "コミュ力": "comm", "備考": "note", "メモ": "note",
  "スキルシートURL": "skill_sheet_url", "スキルシート": "skill_sheet_url", "職務経歴書": "skill_sheet_url", "添付ファイルID": "skill_sheet_url", "添付ファイル": "skill_sheet_url",
  // メール連携：送信元(所属窓口)＝返信先 / 元メールへの直リンク（URL or GASのメッセージID）
  "送信元": "contact_email", "送信元メール": "contact_email", "送信元メールアドレス": "contact_email", "送信元アドレス": "contact_email", "差出人": "contact_email", "差出人メール": "contact_email", "sender_email": "contact_email", "from": "contact_email", "From": "contact_email", "窓口メール": "contact_email",
  "本人メール": "email", "連絡先メール": "email",
  "元メールURL": "source_mail_url", "元メール": "source_mail_url", "メールURL": "source_mail_url", "source_mail_url": "source_mail_url",
  "メールID": "_mail_id", "message_id": "_mail_id", "gmail_id": "_mail_id", "source_mail_id": "_mail_id",
};
const JOB_COL: Record<string, keyof JobInput | "_salary_min" | "_salary_max" | "_mail_id"> = {
  "案件名": "title", "クライアント名": "client_name", "クライアント": "client_name",
  "募集職種": "role_label", "職種": "role_label", "必要スキル": "skills", "スキル": "skills",
  "単価下限": "_salary_min", "単価上限": "_salary_max", "リモート可否": "remote_type", "リモート": "remote_type",
  "商流": "flow_note", "勤務地": "work_location", "稼働開始希望日": "start_date", "案件詳細": "detail", "ステータス": "status",
  // メール連携：窓口担当者 / 送信元(=返信先) / 元メールへの直リンク（URL or GASのメッセージID）
  "担当者": "contact_name", "担当者名": "contact_name", "窓口担当": "contact_name", "contact_name": "contact_name",
  "送信元": "contact_email", "送信元メール": "contact_email", "送信元メールアドレス": "contact_email", "送信元アドレス": "contact_email", "差出人": "contact_email", "差出人メール": "contact_email", "sender_email": "contact_email", "from": "contact_email", "From": "contact_email", "窓口メール": "contact_email",
  "元メールURL": "source_mail_url", "元メール": "source_mail_url", "メールURL": "source_mail_url", "source_mail_url": "source_mail_url",
  "メールID": "_mail_id", "message_id": "_mail_id", "gmail_id": "_mail_id", "source_mail_id": "_mail_id",
};
const CAND_TEMPLATE = ["氏名", "職種", "所属区分", "所属", "スキル", "希望単価", "稼働開始", "勤務地", "経験", "ステータス", "スキルシートURL"];

/** 仮説立案・マッチングに不可欠な重要データの欠落（取込ゲート用）。 */
function criticalMissing(kind: "candidates" | "jobs", rec: any): string[] {
  const m: string[] = [];
  if (!(rec.skills?.length)) m.push("スキル");
  if (kind === "candidates") {
    if (rec.rate_num == null && !rec.rate) m.push("単価");
  } else {
    if (rec.salary_min == null && rec.salary_max == null) m.push("単価");
    if (!rec.client_name) m.push("クライアント");
  }
  return m;
}
const JOB_TEMPLATE = ["案件名", "クライアント名", "募集職種", "必要スキル", "単価下限", "単価上限", "リモート可否", "勤務地", "稼働開始希望日", "ステータス"];

type ValRow = { rowNo: number; rec: any; label: string; errors: string[]; warnings: string[] };

function validate(kind: "candidates" | "jobs", grid: string[][]) {
  const header = grid[0].map((h) => h.trim());
  const COL = kind === "candidates" ? (CAND_COL as Record<string, string>) : (JOB_COL as Record<string, string>);
  const mapped = header.filter((h) => COL[h]);
  const unmapped = header.filter((h) => h && !COL[h]);
  const rows: ValRow[] = [];
  const seen = new Map<string, number>();
  // 生GAS人材CSVは「所属」=雇用形態・「会社名」=会社名。会社名列がある場合は所属を区分として解釈する。
  const candRaw = kind === "candidates" && header.includes("会社名");
  const rateText = (lo: number | null, hi: number | null) =>
    lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "";
  grid.slice(1).forEach((cols, idx) => {
    if (cols.every((c) => !(c || "").trim())) return; // 空行スキップ
    const rec: any = { skills: [] };
    let rawGarbled = false;
    header.forEach((h, i) => {
      let key = COL[h]; const v = (cols[i] ?? "").trim();
      if (v && garbled(v)) rawGarbled = true;
      if (candRaw && h === "所属") key = "affiliation"; // 生GAS: 所属=区分
      if (!key) return;
      if (key === "skills") rec.skills = kind === "candidates" ? v.split(/[,、\/／]+/).map(cleanSkill).filter(Boolean) : splitSkills(v);
      else if (key === "_salary_min") rec.salary_min = numOf(v);
      else if (key === "_salary_max") rec.salary_max = numOf(v);
      else if (key === "_rate_min") rec._rate_min = numOf(v);
      else if (key === "_rate_max") rec._rate_max = numOf(v);
      else if (key === "remote_type") rec.remote_type = remoteOf(v);
      else if (key === "start_date") rec.start_date = dateOf(v);
      else if (key === "skill_sheet_url") { if (v) rec.skill_sheet_url = driveUrl(v); }
      else if (key === "source_mail_url") { const u = gmailMessageUrl(v); if (u) rec.source_mail_url = u; }
      else if (key === "_mail_id") { if (!rec.source_mail_url) { const u = gmailMessageUrl(v); if (u) rec.source_mail_url = u; } }
      else rec[key] = v;
    });
    // 希望単価が下限/上限のみの場合はレンジ表記を組み立てる
    if (kind === "candidates" && !rec.rate && (rec._rate_min != null || rec._rate_max != null)) rec.rate = rateText(rec._rate_min ?? null, rec._rate_max ?? null);
    // 「スキル見合い」フラグがTRUEで単価が無い → 希望単価=「スキル見合い」（交渉前提・マッチングでは曖昧扱いで上位寄り）
    if (kind === "candidates" && !rec.rate && rec._skill_based && /^(true|1|○|◯|はい|yes|y|有|可|スキル見合い)$/i.test(String(rec._skill_based).trim())) rec.rate = "スキル見合い";
    if (kind === "candidates" && rec.rate) rec.rate_num = numOf(rec.rate);

    const errors: string[] = []; const warnings: string[] = [];
    // 重複警告も 氏名×会社×元メール で判定（取込ロジックと一致）。別メール由来の同名は重複としない。
    const dupKey = kind === "candidates" ? `${rec.name ?? ""}|${rec.company ?? ""}|${rec.source_mail_url ?? ""}` : `${rec.title ?? ""}|${rec.client_name ?? ""}`;
    if (kind === "candidates") {
      if (!rec.name) errors.push("氏名なし");
      if (!rec.skills?.length) warnings.push("スキル空");
      if (rec.rate && rec.rate_num == null) warnings.push("単価が数値化できない");
    } else {
      if (!rec.title) errors.push("案件名なし");
      if (!rec.client_name) warnings.push("クライアント名なし");
      if (!rec.skills?.length) warnings.push("スキル空");
    }
    if (rawGarbled) warnings.push("文字化けの可能性");
    if (dupKey.replace("|", "")) {
      if (seen.has(dupKey)) warnings.push(`重複(行${seen.get(dupKey)})`);
      else seen.set(dupKey, idx + 2);
    }
    rows.push({ rowNo: idx + 2, rec, label: kind === "candidates" ? (rec.name || "(無名)") : (rec.title || "(無題)"), errors, warnings });
  });
  return { rows, mapped, unmapped, header };
}

function CsvImport({ kind }: { kind: "candidates" | "jobs" }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<ReturnType<typeof validate> | null>(null);
  const [fileName, setFileName] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);

  const onFile = async (file: File) => {
    setMsg(null);
    const grid = parseCsv(await file.text());
    if (grid.length < 2) { setMsg({ ok: false, text: "データ行がありません" }); return; }
    setFileName(file.name);
    setPreview(validate(kind, grid));
  };

  const doImport = (mode: "all" | "clean" | "strict") => {
    if (!preview) return;
    const recs = preview.rows.filter((r) => {
      if (r.errors.length > 0) return false;
      if (mode === "clean") return r.warnings.length === 0;
      if (mode === "strict") return criticalMissing(kind, r.rec).length === 0;
      return true; // all（取込可能）
    }).map((r) => r.rec);
    if (recs.length === 0) { setMsg({ ok: false, text: "取込対象がありません" }); return; }
    // 大量CSV対策：1リクエストが大きすぎるとサーバ側ボディ上限(Vercel ~4.5MB)を超えて
    // 「This page couldn't load」になる。クライアントで分割送信し、件数に依存しないようにする。
    //   案件は detail(メール本文)が重いので小さめ。人材は軽い＋取込ごとに全件照合するため大きめにして回数を減らす。
    const CHUNK = kind === "candidates" ? 800 : 250;
    start(async () => {
      let inserted = 0, skipped = 0;
      setMsg(null);
      setProg({ done: 0, total: recs.length });
      try {
        for (let i = 0; i < recs.length; i += CHUNK) {
          const slice = recs.slice(i, i + CHUNK);
          const res = kind === "candidates"
            ? await importCandidates(slice as CandidateInput[], fileName)
            : await importJobs(slice as JobInput[], fileName);
          if (!res.ok) { setProg(null); setMsg({ ok: false, text: `${res.error || "取込に失敗しました"}（${inserted}件まで取込済み）` }); return; }
          inserted += res.inserted ?? 0;
          skipped += (res as any).skipped ?? 0;
          setProg({ done: Math.min(i + slice.length, recs.length), total: recs.length });
        }
        setProg(null);
        setMsg({ ok: true, text: `${inserted} 件を取り込みました${skipped ? `（重複 ${skipped} 件はスキップ）` : ""}` });
        setPreview(null);
        router.refresh();
      } catch (e) {
        setProg(null);
        setMsg({ ok: false, text: `${e instanceof Error ? e.message : "取込に失敗しました"}（通信エラーまたはサイズ超過の可能性。${inserted}件まで取込済み）` });
      }
    });
  };

  const template = kind === "candidates"
    ? { name: "人材テンプレート.csv", body: "﻿" + CAND_TEMPLATE.join(",") + "\n山田 太郎,バックエンドエンジニア,フリーランス,個人事業,Java/Spring/AWS,¥80万,即日,東京,8y,提案可,https://drive.google.com/file/d/XXXX/view" }
    : { name: "案件テンプレート.csv", body: "﻿" + JOB_TEMPLATE.join(",") + "\nReact開発案件,株式会社サンプル,フロントエンドエンジニア,React/TypeScript/AWS,70,90,一部リモート,東京,2026/06/01,募集中" };

  const errCount = preview?.rows.filter((r) => r.errors.length).length ?? 0;
  const warnCount = preview?.rows.filter((r) => !r.errors.length && r.warnings.length).length ?? 0;
  const okCount = preview ? preview.rows.length - errCount - warnCount : 0;
  const problems = preview?.rows.filter((r) => r.errors.length || r.warnings.length) ?? [];

  // 重要データ充足（取込分）
  const importable = preview?.rows.filter((r) => r.errors.length === 0) ?? [];
  const cov = {
    skills: importable.filter((r) => r.rec.skills?.length).length,
    money: importable.filter((r) => (kind === "candidates" ? (r.rec.rate_num != null || r.rec.rate) : (r.rec.salary_min != null || r.rec.salary_max != null))).length,
    extra: importable.filter((r) => (kind === "candidates" ? r.rec.affiliation : r.rec.client_name)).length,
  };
  const strictCount = importable.filter((r) => criticalMissing(kind, r.rec).length === 0).length;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
      <button className="btn brand" onClick={() => fileRef.current?.click()} disabled={pending}><Icons.plus /><span>{pending ? "取込中…" : "CSV取込"}</span></button>
      <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => downloadCsv(template.name, template.body)}>テンプレ</button>
      {msg && <span style={{ fontSize: 12, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</span>}

      {preview && (
        <div onClick={() => { if (!pending) setPreview(null); }} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>CSV取込プレビュー / 検証</h3>
              <button className="btn ghost btn-xs" onClick={() => setPreview(null)} disabled={pending}>閉じる</button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{fileName} · {preview.rows.length} 行</div>

            {/* 取込中の進捗バー */}
            {prog && (
              <div style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 600 }}>
                  <span>取り込み中… サーバへ送信しています</span>
                  <span className="mono">{prog.done}/{prog.total}（{Math.round((prog.done / Math.max(prog.total, 1)) * 100)}%）</span>
                </div>
                <div style={{ height: 8, borderRadius: 99, background: "var(--color-border)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round((prog.done / Math.max(prog.total, 1)) * 100)}%`, background: "var(--color-brand, #0b5cab)", transition: "width .25s ease" }} />
                </div>
                <div className="muted" style={{ fontSize: 10.5 }}>※ ブラウザを閉じずにお待ちください（分割送信のため少し時間がかかります）。</div>
              </div>
            )}

            {/* サマリ */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className="pill" style={{ background: "#e7f3ea", color: "#1aa260", borderColor: "transparent" }}>✓ 正常 {okCount}</span>
              <span className="pill" style={{ background: "#fff6e0", color: "#9a7b12", borderColor: "transparent" }}>⚠ 警告 {warnCount}</span>
              <span className="pill" style={{ background: "#fdecef", color: "#d23f57", borderColor: "transparent" }}>✗ 取込不可 {errCount}</span>
            </div>

            {/* 列マッピング */}
            <div style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>
              認識した列：{preview.mapped.join(" / ") || "なし"}
              {preview.unmapped.length > 0 && <div style={{ color: "var(--color-warn)" }}>未対応の列（無視）：{preview.unmapped.join(" / ")}</div>}
            </div>

            {/* 重要データ充足（この取込分） */}
            {importable.length > 0 && (
              <div style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>📋 重要データの充足（取込可能 {importable.length} 件中）</div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
                  <span>スキル <b style={{ color: cov.skills === importable.length ? "#067647" : "#b42318" }}>{cov.skills}/{importable.length}</b></span>
                  <span>単価 <b style={{ color: cov.money === importable.length ? "#067647" : "#b45309" }}>{cov.money}/{importable.length}</b></span>
                  <span>{kind === "candidates" ? "所属区分" : "クライアント"} <b style={{ color: cov.extra === importable.length ? "#067647" : "#b45309" }}>{cov.extra}/{importable.length}</b></span>
                </div>
              </div>
            )}

            {/* 問題行 */}
            {problems.length > 0 ? (
              <div className="card flush" style={{ maxHeight: 320, overflowY: "auto" }}>
                <table className="tbl">
                  <thead><tr><th style={{ width: 50 }}>行</th><th>{kind === "candidates" ? "氏名" : "案件名"}</th><th>検出された問題</th></tr></thead>
                  <tbody>
                    {problems.slice(0, 100).map((r) => (
                      <tr key={r.rowNo}>
                        <td className="mono muted">{r.rowNo}</td>
                        <td style={{ fontWeight: 600 }}>{r.label}</td>
                        <td>
                          {r.errors.map((e) => <span key={e} className="tag" style={{ fontSize: 10, background: "#fdecef", color: "#d23f57", marginRight: 4 }}>✗ {e}</span>)}
                          {r.warnings.map((w) => <span key={w} className="tag" style={{ fontSize: 10, background: "#fff6e0", color: "#9a7b12", marginRight: 4 }}>⚠ {w}</span>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {problems.length > 100 && <div className="muted" style={{ padding: "8px 12px", fontSize: 11 }}>ほか {problems.length - 100} 行…</div>}
              </div>
            ) : <div style={{ fontSize: 12.5, color: "var(--color-success)" }}>問題は検出されませんでした。</div>}

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn brand" disabled={pending || strictCount === 0} onClick={() => doImport("strict")} title="スキル・単価（案件はクライアントも）が揃った行だけ取り込みます">重要データ完備の {strictCount} 件のみ取込（推奨）</button>
              <button className="btn" disabled={pending} onClick={() => doImport("all")}>取込可能な {preview.rows.length - errCount} 件を取込</button>
              <button className="btn ghost" disabled={pending || okCount === 0} onClick={() => doImport("clean")}>正常 {okCount} 件のみ</button>
              <button className="btn ghost" onClick={() => setPreview(null)}>キャンセル</button>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>※「取込不可（✗）」は常に除外。<b>重要データ完備</b>＝スキル・単価{kind === "jobs" ? "・クライアント" : ""}が揃った行のみ。質を担保するなら「完備のみ」を推奨します。</div>
          </div>
        </div>
      )}
    </span>
  );
}

export function CandidateImportButton() { return <CsvImport kind="candidates" />; }
export function JobImportButton() { return <CsvImport kind="jobs" />; }

// ---- 1件手動登録モーダル ----------------------------------------------------
const fieldStyle: React.CSSProperties = { fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface)", fontFamily: "var(--font-sans)" };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--color-ink-3)" };

function FormField({ label, value, onChange, full, placeholder }: { label: string; value?: string; onChange: (v: string) => void; full?: boolean; placeholder?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: full ? "1 / -1" : undefined }}>
      <span style={labelStyle}>{label}</span>
      <input type="text" value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={fieldStyle} />
    </label>
  );
}
function FormSelect({ label, value, onChange, options }: { label: string; value?: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={labelStyle}>{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={fieldStyle}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
function FormTextarea({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
      <span style={labelStyle}>{label}</span>
      <textarea value={value ?? ""} rows={4} onChange={(e) => onChange(e.target.value)} style={{ ...fieldStyle, resize: "vertical", padding: "8px" }} />
    </label>
  );
}

function NewEntryButton({ kind }: { kind: "candidates" | "jobs" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  // 類似候補プレビュー（二重登録/取り違え防止）
  const [similarJobs, setSimilarJobs] = useState<SimilarJob[]>([]);
  const [similarCands, setSimilarCands] = useState<SimilarCandidate[]>([]);
  const [checking, setChecking] = useState(false);
  const close = () => { if (!pending) { setOpen(false); setMsg(null); setF({}); setSimilarJobs([]); setSimilarCands([]); } };

  // 入力に応じて既存の似た案件/人材を検索（デバウンス）。非公開も対象。
  const key1 = kind === "jobs" ? (f.title ?? "") : (f.name ?? "");
  const key2 = kind === "jobs" ? (f.client_name ?? "") : (f.company ?? "");
  useEffect(() => {
    if (!open) return;
    const t1 = key1.trim(), t2 = key2.trim();
    if (kind === "jobs" ? (t1.length < 2 && t2.length < 2) : t1.length < 1) {
      setSimilarJobs([]); setSimilarCands([]); setChecking(false); return;
    }
    setChecking(true);
    const h = setTimeout(async () => {
      try {
        if (kind === "jobs") {
          const r = await findSimilarJobs({ title: t1, client_name: t2 });
          if (r.ok) setSimilarJobs(r.items);
        } else {
          const r = await findSimilarCandidates({ name: t1, company: t2 });
          if (r.ok) setSimilarCands(r.items);
        }
      } finally { setChecking(false); }
    }, 400);
    return () => clearTimeout(h);
  }, [open, kind, key1, key2]);

  const submit = () => {
    setMsg(null);
    if (kind === "candidates") {
      const name = (f.name || "").trim();
      if (!name) { setMsg({ ok: false, text: "氏名は必須です" }); return; }
      const rec: any = {
        name,
        title: f.title?.trim() || null,
        company: f.company?.trim() || null,
        affiliation: f.affiliation?.trim() || null,
        skills: (f.skills || "").split(/[,、\/／]+/).map(cleanSkill).filter(Boolean),
        rate: f.rate?.trim() || null,
        avail: f.avail?.trim() || null,
        location: f.location?.trim() || null,
        exp: f.exp?.trim() || null,
        status: f.status?.trim() || null,
        skill_sheet_url: f.skill_sheet_url?.trim() ? driveUrl(f.skill_sheet_url.trim()) : null,
        email: f.email?.trim() || null,
        contact_email: f.contact_email?.trim() || null,
        source_mail_url: f.source_mail?.trim() ? (gmailMessageUrl(f.source_mail.trim()) ?? null) : null,
      };
      if (rec.rate) rec.rate_num = numOf(rec.rate);
      start(async () => {
        const res = await upsertCandidateManual(rec as CandidateInput);
        if (res.ok) {
          const lbl = res.action === "updated"
            ? `既存の人材を更新しました（P-${String(res.candidate_no ?? 0).padStart(5, "0")}）`
            : `登録しました（P-${String(res.candidate_no ?? 0).padStart(5, "0")}）`;
          setMsg({ ok: true, text: lbl }); router.refresh(); setTimeout(close, 900);
        } else setMsg({ ok: false, text: res.error || "登録に失敗しました" });
      });
    } else {
      const title = (f.title || "").trim();
      if (!title) { setMsg({ ok: false, text: "案件名は必須です" }); return; }
      const sMin = numOf(f.salary_min || ""); const sMax = numOf(f.salary_max || "");
      const rec: any = {
        title,
        client_name: f.client_name?.trim() || null,
        role_label: f.role_label?.trim() || null,
        skills: splitSkills(f.skills || ""),
        salary_min: sMin,
        salary_max: sMax,
        remote_type: f.remote_type || null,
        flow_note: f.flow_note?.trim() || null,
        work_location: f.work_location?.trim() || null,
        start_date: dateOf(f.start_date || "") || (f.start_date?.trim() || null),
        detail: f.detail?.trim() || null,
        status: f.status?.trim() || null,
        contact_name: f.contact_name?.trim() || null,
        contact_email: f.contact_email?.trim() || null,
        source_mail_url: f.source_mail?.trim() ? (gmailMessageUrl(f.source_mail.trim()) ?? null) : null,
      };
      start(async () => {
        const res = await upsertJobManual(rec as JobInput);
        if (res.ok) {
          const id = `No.${String(res.job_no ?? 0).padStart(5, "0")}`;
          const republished = "republished" in res && res.republished;
          const lbl = res.action === "updated"
            ? (republished
                ? `一覧に出ていなかった既存案件（${id}）を更新し、再公開しました。`
                : `既存の案件を更新しました（${id}）`)
            : `登録しました（${id}）`;
          setMsg({ ok: true, text: lbl }); router.refresh(); setTimeout(close, republished ? 1600 : 900);
        } else setMsg({ ok: false, text: res.error || "登録に失敗しました" });
      });
    }
  };

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}><Icons.plus /><span>新規登録</span></button>
      {open && (
        <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{kind === "candidates" ? "人材を新規登録" : "案件を新規登録"}</h3>
              <button className="btn ghost btn-xs" onClick={close} disabled={pending}>閉じる</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              {kind === "candidates" ? (
                <>
                  <FormField label="氏名 *" value={f.name} onChange={set("name")} />
                  <FormField label="職種" value={f.title} onChange={set("title")} placeholder="例：バックエンドエンジニア" />
                  <FormField label="所属会社" value={f.company} onChange={set("company")} />
                  <FormField label="所属区分" value={f.affiliation} onChange={set("affiliation")} placeholder="一社下社員 / 一社下フリーランス / 二社下以降" />
                  <FormField label="保有スキル（カンマ区切り）" value={f.skills} onChange={set("skills")} full placeholder="Java, Spring, AWS" />
                  <FormField label="希望単価" value={f.rate} onChange={set("rate")} placeholder="例：80万 / ¥70〜90万" />
                  <FormField label="経験年数" value={f.exp} onChange={set("exp")} placeholder="例：8 / 8年" />
                  <FormField label="稼働開始" value={f.avail} onChange={set("avail")} placeholder="例：即日 / 6月〜" />
                  <FormField label="希望勤務地" value={f.location} onChange={set("location")} />
                  <FormField label="ステータス" value={f.status} onChange={set("status")} placeholder="例：提案可 / 即アサイン可能" />
                  <FormField label="スキルシートURL（またはDrive ID）" value={f.skill_sheet_url} onChange={set("skill_sheet_url")} full />
                  <FormField label="本人メール" value={f.email} onChange={set("email")} />
                  <FormField label="所属窓口メール（返信先）" value={f.contact_email} onChange={set("contact_email")} />
                  <FormField label="元メールURL／Gmail メッセージ ID" value={f.source_mail} onChange={set("source_mail")} full />
                </>
              ) : (
                <>
                  <FormField label="案件名 *" value={f.title} onChange={set("title")} full />
                  <FormField label="クライアント名" value={f.client_name} onChange={set("client_name")} />
                  <FormField label="募集職種" value={f.role_label} onChange={set("role_label")} />
                  <FormField label="必要スキル（カンマ区切り）" value={f.skills} onChange={set("skills")} full placeholder="React, TypeScript, AWS" />
                  <FormField label="単価下限（万）" value={f.salary_min} onChange={set("salary_min")} placeholder="60" />
                  <FormField label="単価上限（万）" value={f.salary_max} onChange={set("salary_max")} placeholder="80" />
                  <FormSelect label="リモート可否" value={f.remote_type} onChange={set("remote_type")} options={[
                    { value: "", label: "未指定（一部リモート扱い）" },
                    { value: "full_remote", label: "フルリモート" },
                    { value: "partial_remote", label: "一部リモート" },
                    { value: "onsite", label: "出社必須" },
                  ]} />
                  <FormField label="商流" value={f.flow_note} onChange={set("flow_note")} />
                  <FormField label="勤務地" value={f.work_location} onChange={set("work_location")} />
                  <FormField label="稼働開始希望日" value={f.start_date} onChange={set("start_date")} placeholder="例：2026/06/01" />
                  <FormField label="ステータス" value={f.status} onChange={set("status")} placeholder="例：募集中" />
                  <FormField label="窓口担当者名" value={f.contact_name} onChange={set("contact_name")} />
                  <FormField label="窓口メール（返信先）" value={f.contact_email} onChange={set("contact_email")} />
                  <FormField label="元メールURL／Gmail メッセージ ID" value={f.source_mail} onChange={set("source_mail")} full />
                  <FormTextarea label="案件詳細" value={f.detail} onChange={set("detail")} />
                </>
              )}
            </div>

            {/* 類似候補プレビュー：完全一致でない既存も提示し、二重登録/取り違えを防ぐ */}
            {(checking || (kind === "jobs" ? similarJobs.length > 0 : similarCands.length > 0)) && (
              <div className="card" style={{ background: "var(--color-surface-inset)", padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-ink-2)" }}>
                    🔍 似た{kind === "jobs" ? "案件" : "人材"}が{kind === "jobs" ? similarJobs.length : similarCands.length}件あります
                  </span>
                  {checking && <span className="muted" style={{ fontSize: 10.5 }}>検索中…</span>}
                  <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto" }}>非公開も含めて確認しています</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {kind === "jobs" ? similarJobs.map((j) => (
                    <Link key={j.job_no} href={`/jobs/${j.job_no}`} onClick={() => setOpen(false)}
                      style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)", flexShrink: 0 }}>No.{String(j.job_no).padStart(5, "0")}</span>
                      <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.title}</span>
                      <span className="muted" style={{ fontSize: 11, flexShrink: 0 }}>{j.client_name ?? "—"} · {salaryShort(j.salary_min, j.salary_max)}</span>
                      {j.exact && <span className="tag" style={{ fontSize: 9.5, padding: "1px 6px", background: "#fff5e6", color: "#b45309", border: "1px solid #fde9b0", flexShrink: 0 }}>完全一致</span>}
                      {!j.is_published && <span className="tag" style={{ fontSize: 9.5, padding: "1px 6px", background: "#fdecef", color: "#b42318", border: "1px solid #f7c5cf", flexShrink: 0 }}>非公開</span>}
                    </Link>
                  )) : similarCands.map((c) => (
                    <Link key={c.candidate_no} href={`/people/${c.candidate_no}`} onClick={() => setOpen(false)}
                      style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)", flexShrink: 0 }}>P-{String(c.candidate_no).padStart(5, "0")}</span>
                      <span style={{ minWidth: 0, flex: 1, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                      <span className="muted" style={{ fontSize: 11, flexShrink: 0 }}>{[c.company, c.title, c.rate].filter(Boolean).join(" · ") || "—"}</span>
                      {c.exact && <span className="tag" style={{ fontSize: 9.5, padding: "1px 6px", background: "#fff5e6", color: "#b45309", border: "1px solid #fde9b0", flexShrink: 0 }}>完全一致</span>}
                    </Link>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--color-ink-4)" }}>
                  ※ 同じものがあれば上の行を開いて編集してください。別物なら、このまま「登録」して問題ありません。
                  {kind === "jobs" && "（案件名×クライアント名が完全一致の場合は新規ではなく既存が更新・再公開されます）"}
                </div>
              </div>
            )}

            {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={close} disabled={pending}>キャンセル</button>
              <button className="btn brand" onClick={submit} disabled={pending}>{pending ? "登録中…" : "登録"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---- メールから複数レコードを分離して一括取込 ------------------------------
// 1通のメールに複数名の人材／複数案件が書かれているケースを、AIで個別に分離して登録する。
function BulkExtractButton({ kind }: { kind: "candidates" | "jobs" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<any[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isJob = kind === "jobs";
  const noun = isJob ? "案件" : "人材";

  const close = () => { if (!loading && !pending) { setOpen(false); setText(""); setRecords([]); setPicked(new Set()); setMsg(null); } };

  const extract = async () => {
    if (!text.trim()) { setMsg({ ok: false, text: "メール本文を貼り付けてください" }); return; }
    setLoading(true); setMsg(null); setRecords([]); setPicked(new Set());
    try {
      const res = await fetch("/api/extract-bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, kind }) });
      const data = await res.json();
      if (!data.ok) { setMsg({ ok: false, text: data.error || "抽出に失敗しました" }); return; }
      const recs: any[] = data.records ?? [];
      setRecords(recs);
      setPicked(new Set(recs.map((_, i) => i)));
      setMsg({ ok: true, text: `${recs.length} 件を抽出しました。内容を確認して登録してください。` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "抽出に失敗しました" });
    } finally { setLoading(false); }
  };

  const toggle = (i: number) => setPicked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const register = () => {
    const chosen = records.filter((_, i) => picked.has(i));
    if (chosen.length === 0) { setMsg({ ok: false, text: "登録する行を選択してください" }); return; }
    setMsg(null);
    start(async () => {
      try {
        let res: any;
        if (isJob) {
          const rows: JobInput[] = chosen.map((j) => ({
            title: String(j.title ?? "").trim(),
            client_name: j.client_name?.trim() || null,
            role_label: j.role_label?.trim() || null,
            skills: Array.isArray(j.skills) ? j.skills.map(cleanSkill).filter(Boolean) : splitSkills(j.skills ?? ""),
            salary_min: j.salary_min != null ? Number(j.salary_min) : null,
            salary_max: j.salary_max != null ? Number(j.salary_max) : null,
            remote_type: j.remote_type || null,
            work_location: j.work_location?.trim() || null,
            start_date: dateOf(j.start_date || "") || (j.start_date?.trim() || null),
            flow_note: j.flow_note?.trim() || null,
            detail: j.detail?.trim() || null,
          }));
          res = await importJobs(rows, "メール一括取込");
        } else {
          const rows: CandidateInput[] = chosen.map((c) => {
            const rate = c.rate?.trim() || null;
            return {
              name: String(c.name ?? "").trim(),
              title: c.title?.trim() || null,
              company: c.company?.trim() || null,
              affiliation: c.affiliation?.trim() || null,
              skills: Array.isArray(c.skills) ? c.skills.map(cleanSkill).filter(Boolean) : splitSkills(c.skills ?? ""),
              rate,
              rate_num: rate ? numOf(rate) : null,
              exp: c.exp?.trim() || null,
              avail: c.avail?.trim() || null,
              location: c.location?.trim() || null,
            };
          });
          res = await importCandidates(rows, "メール一括取込");
        }
        if (res?.ok) {
          const n = res.inserted ?? chosen.length;
          setMsg({ ok: true, text: `${n} 件を登録しました${res.skipped ? `（重複 ${res.skipped} 件はスキップ）` : ""}` });
          router.refresh();
          setTimeout(close, 1200);
        } else {
          setMsg({ ok: false, text: res?.error || "登録に失敗しました" });
        }
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "登録に失敗しました" });
      }
    });
  };

  return (
    <>
      <button className="btn ghost" onClick={() => setOpen(true)} title={`1通のメールに複数の${noun}が書かれている場合、AIで分離して個別に取り込みます`}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>call_split</span><span>メールから一括取込</span>
      </button>
      {open && (
        <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 760, maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>メールから{noun}を一括取込</h3>
              <button className="btn ghost btn-xs" onClick={close} disabled={loading || pending}>閉じる</button>
            </div>
            <div style={{ fontSize: 12, color: "var(--color-ink-3)" }}>
              1通に複数の{noun}がまとまっているメールを貼り付け、「AIで分離抽出」を押すと個別の{noun}に分けて取り込めます。
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder={`メール本文を貼り付け（複数${noun}OK）`}
              style={{ width: "100%", fontFamily: "var(--font-sans)", fontSize: 12.5, lineHeight: 1.6, padding: 12, border: "1px solid var(--color-border-strong)", borderRadius: 10, resize: "vertical", background: "var(--color-surface)" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn brand" onClick={extract} disabled={loading || pending}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>auto_awesome</span>
                <span>{loading ? "抽出中…" : "AIで分離抽出"}</span>
              </button>
            </div>

            {records.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>抽出結果（{picked.size}/{records.length} 件を登録）</span>
                  <button className="btn ghost btn-xs" onClick={() => setPicked(new Set(records.map((_, i) => i)))}>全選択</button>
                  <button className="btn ghost btn-xs" onClick={() => setPicked(new Set())}>全解除</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {records.map((r, i) => {
                    const on = picked.has(i);
                    const skills = Array.isArray(r.skills) ? r.skills : splitSkills(r.skills ?? "");
                    return (
                      <label key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", border: `1px solid ${on ? "var(--color-brand-200)" : "var(--color-border)"}`, borderRadius: 10, background: on ? "var(--color-brand-25)" : "var(--color-surface)", cursor: "pointer" }}>
                        <input type="checkbox" checked={on} onChange={() => toggle(i)} style={{ marginTop: 3 }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{isJob ? r.title : r.name}
                            {isJob ? (r.client_name ? <span className="muted" style={{ fontWeight: 400 }}> ・ {r.client_name}</span> : null)
                                   : (r.company ? <span className="muted" style={{ fontWeight: 400 }}> ・ {r.company}</span> : null)}
                          </div>
                          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                            {isJob
                              ? [r.role_label, (r.salary_min || r.salary_max) ? `¥${r.salary_min ?? ""}〜${r.salary_max ?? ""}万` : null, r.work_location].filter(Boolean).join(" / ") || "—"
                              : [r.title, r.rate, r.exp, r.affiliation].filter(Boolean).join(" / ") || "—"}
                          </div>
                          {skills.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>{skills.slice(0, 8).map((s: string) => <span key={s} className="tag" style={{ fontSize: 10 }}>{s}</span>)}</div>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}
            {records.length > 0 && (
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn ghost" onClick={close} disabled={pending}>キャンセル</button>
                <button className="btn brand" onClick={register} disabled={pending || picked.size === 0}>{pending ? "登録中…" : `選択した ${picked.size} 件を登録`}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function CandidateNewButton() { return <NewEntryButton kind="candidates" />; }
export function JobNewButton() { return <NewEntryButton kind="jobs" />; }
export function CandidateBulkExtractButton() { return <BulkExtractButton kind="candidates" />; }
export function JobBulkExtractButton() { return <BulkExtractButton kind="jobs" />; }
