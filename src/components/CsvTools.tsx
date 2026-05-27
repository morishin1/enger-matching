"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, rowsToCsv, downloadCsv } from "@/lib/csv";
import { importCandidates, importJobs, type CandidateInput, type JobInput } from "@/lib/actions";
import { Icons } from "./icons";

const numOf = (s: string) => { const n = parseFloat((s || "").replace(/[^\d.]/g, "")); return isNaN(n) ? null : n; };
const dateOf = (s: string) => { const m = (s || "").match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/); return m ? `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}` : null; };
const splitSkills = (s: string) => (s || "").split(/[,、\/／・]+/).map((x) => x.trim()).filter(Boolean);
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

const CAND_COL: Record<string, keyof CandidateInput | "_rate_min" | "_rate_max"> = {
  "コード": "code", "id": "code", "ID": "code", "氏名": "name", "名前": "name", "name": "name",
  "職種": "title", "タイトル": "title", "所属": "company", "会社": "company", "会社名": "company", "所属会社": "company",
  "所属区分": "affiliation", "区分": "affiliation", "雇用形態": "affiliation",
  "スキル": "skills", "必要スキル": "skills", "保有スキル": "skills", "技術スキル": "skills",
  "単価": "rate", "希望単価": "rate", "希望単価下限": "_rate_min", "希望単価上限": "_rate_max", "単価下限": "_rate_min", "単価上限": "_rate_max",
  "稼働開始": "avail", "稼働": "avail", "稼働開始可能日": "avail", "勤務地": "location", "場所": "location", "希望勤務地": "location",
  "経験": "exp", "経験年数": "exp", "実務経験年数": "exp", "ステータス": "status", "状態": "status", "現在のステータス": "status",
  "スキルシートURL": "skill_sheet_url", "スキルシート": "skill_sheet_url", "職務経歴書": "skill_sheet_url", "添付ファイルID": "skill_sheet_url", "添付ファイル": "skill_sheet_url",
};
const JOB_COL: Record<string, keyof JobInput | "_salary_min" | "_salary_max"> = {
  "案件名": "title", "クライアント名": "client_name", "クライアント": "client_name",
  "募集職種": "role_label", "職種": "role_label", "必要スキル": "skills", "スキル": "skills",
  "単価下限": "_salary_min", "単価上限": "_salary_max", "リモート可否": "remote_type", "リモート": "remote_type",
  "商流": "flow_note", "勤務地": "work_location", "稼働開始希望日": "start_date", "案件詳細": "detail", "ステータス": "status",
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
  const driveUrl = (v: string) => /^https?:\/\//i.test(v) ? v : (/^[\w-]{20,}$/.test(v) ? `https://drive.google.com/file/d/${v}/view` : v);

  grid.slice(1).forEach((cols, idx) => {
    if (cols.every((c) => !(c || "").trim())) return; // 空行スキップ
    const rec: any = { skills: [] };
    let rawGarbled = false;
    header.forEach((h, i) => {
      let key = COL[h]; const v = (cols[i] ?? "").trim();
      if (v && garbled(v)) rawGarbled = true;
      if (candRaw && h === "所属") key = "affiliation"; // 生GAS: 所属=区分
      if (!key) return;
      if (key === "skills") rec.skills = kind === "candidates" ? v.split(/[,、\/／]+/).map((s) => s.trim()).filter(Boolean) : splitSkills(v);
      else if (key === "_salary_min") rec.salary_min = numOf(v);
      else if (key === "_salary_max") rec.salary_max = numOf(v);
      else if (key === "_rate_min") rec._rate_min = numOf(v);
      else if (key === "_rate_max") rec._rate_max = numOf(v);
      else if (key === "remote_type") rec.remote_type = remoteOf(v);
      else if (key === "start_date") rec.start_date = dateOf(v);
      else if (key === "skill_sheet_url") { if (v) rec.skill_sheet_url = driveUrl(v); }
      else rec[key] = v;
    });
    // 希望単価が下限/上限のみの場合はレンジ表記を組み立てる
    if (kind === "candidates" && !rec.rate && (rec._rate_min != null || rec._rate_max != null)) rec.rate = rateText(rec._rate_min ?? null, rec._rate_max ?? null);
    if (kind === "candidates" && rec.rate) rec.rate_num = numOf(rec.rate);

    const errors: string[] = []; const warnings: string[] = [];
    const dupKey = kind === "candidates" ? (rec.name ?? "") : `${rec.title ?? ""}|${rec.client_name ?? ""}`;
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
    start(async () => {
      const res = kind === "candidates" ? await importCandidates(recs as CandidateInput[], fileName) : await importJobs(recs as JobInput[], fileName);
      if (res.ok) { const sk = (res as any).skipped; setMsg({ ok: true, text: `${res.inserted} 件を取り込みました${sk ? `（重複 ${sk} 件はスキップ）` : ""}` }); setPreview(null); router.refresh(); }
      else setMsg({ ok: false, text: res.error || "取込に失敗しました" });
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
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>CSV取込プレビュー / 検証</h3>
              <button className="btn ghost btn-xs" onClick={() => setPreview(null)}>閉じる</button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{fileName} · {preview.rows.length} 行</div>

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
