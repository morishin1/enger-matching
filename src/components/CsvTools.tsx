"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, rowsToCsv, downloadCsv } from "@/lib/csv";
import { importCandidates, type CandidateInput } from "@/lib/actions";
import { Icons } from "./icons";

/** 任意データを CSV ダウンロード */
export function ExportButton({ filename, headers, rows, label = "CSV書き出し" }: {
  filename: string;
  headers: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  label?: string;
}) {
  return (
    <button className="btn" onClick={() => downloadCsv(filename, rowsToCsv(headers, rows))} disabled={rows.length === 0}>
      <Icons.arrow /><span>{label}</span>
    </button>
  );
}

// ヘッダ名 → フィールドのゆるいマッピング
const COL: Record<string, keyof CandidateInput> = {
  "コード": "code", "id": "code", "ID": "code",
  "氏名": "name", "名前": "name", "name": "name",
  "職種": "title", "タイトル": "title",
  "所属": "company", "会社": "company",
  "スキル": "skills", "必要スキル": "skills",
  "単価": "rate", "希望単価": "rate",
  "稼働開始": "avail", "稼働": "avail",
  "勤務地": "location", "場所": "location",
  "経験": "exp", "経験年数": "exp",
  "ステータス": "status", "状態": "status",
};

const TEMPLATE_HEADERS = ["氏名", "職種", "所属", "スキル", "希望単価", "稼働開始", "勤務地", "経験", "ステータス"];

export function CandidateImportButton() {
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [pending, start] = useTransition();

  const onFile = async (file: File) => {
    setMsg(null); setErr(false);
    const grid = parseCsv(await file.text());
    if (grid.length < 2) { setErr(true); setMsg("行がありません"); return; }
    const header = grid[0].map((h) => h.trim());
    const records: CandidateInput[] = grid.slice(1).map((cols) => {
      const rec: any = { skills: [] };
      header.forEach((h, i) => {
        const key = COL[h];
        if (!key) return;
        const v = (cols[i] ?? "").trim();
        if (key === "skills") rec.skills = v.split(/[,、\/／]+/).map((s) => s.trim()).filter(Boolean);
        else rec[key] = v;
      });
      if (rec.rate) rec.rate_num = parseFloat(String(rec.rate).replace(/[^\d.]/g, "")) || null;
      return rec as CandidateInput;
    });

    start(async () => {
      const res = await importCandidates(records, file.name);
      if (res.ok) { setMsg(`${res.inserted} 名を取り込みました`); router.refresh(); }
      else { setErr(true); setMsg(res.error || "取込に失敗しました"); }
    });
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <button className="btn brand" onClick={() => fileRef.current?.click()} disabled={pending}>
        <Icons.plus /><span>{pending ? "取込中…" : "CSV取込"}</span>
      </button>
      <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => downloadCsv("人材テンプレート.csv", "﻿" + TEMPLATE_HEADERS.join(",") + "\n山田 太郎,バックエンドエンジニア,フリーランス,Java/Spring/AWS,¥80万,即日,東京,8y,提案可")}>
        テンプレ
      </button>
      {msg && <span style={{ fontSize: 12, color: err ? "var(--color-danger)" : "var(--color-success)" }}>{msg}</span>}
    </span>
  );
}
