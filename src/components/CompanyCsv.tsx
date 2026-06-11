"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, downloadCsv } from "@/lib/csv";
import { importCompanies, type CompanyInput } from "@/lib/actions";
import { Icons } from "./icons";

const COL: Record<string, keyof CompanyInput> = {
  "企業名": "name", "会社名": "name", "クライアント名": "name",
  "業種": "industry", "ティア": "tier", "tier": "tier", "ランク": "tier",
  "ステータス": "status", "状態": "status", "区分": "status",
  "担当": "owner_staff", "自社担当": "owner_staff", "営業担当": "owner_staff",
  "担当者名": "contact_name", "先方担当": "contact_name",
  "メール": "contact_email", "メールアドレス": "contact_email", "email": "contact_email",
  "電話": "phone", "TEL": "phone", "電話番号": "phone",
  "URL": "website", "HP": "website", "ウェブサイト": "website",
  "住所": "address", "メモ": "note", "備考": "note",
};
const HEADERS = [
  { key: "name", label: "企業名" }, { key: "industry", label: "業種" }, { key: "tier", label: "ティア" }, { key: "status", label: "ステータス" },
  { key: "owner_staff", label: "担当" }, { key: "contact_name", label: "担当者名" }, { key: "contact_email", label: "メール" },
  { key: "phone", label: "電話" }, { key: "website", label: "URL" }, { key: "address", label: "住所" }, { key: "note", label: "メモ" },
];
const TEMPLATE = HEADERS.map((h) => h.label);

export function CompanyCsv({ registered = [], isAdmin = false }: { registered?: any[]; isAdmin?: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 情報持ち出し防止：CSV取込/書出/テンプレは管理者のみ。
  if (!isAdmin) return null;

  const onFile = async (file: File) => {
    setMsg(null);
    const grid = parseCsv(await file.text());
    if (grid.length < 2) { setMsg({ ok: false, text: "データ行がありません" }); return; }
    const header = grid[0].map((h) => h.trim());
    const recs: CompanyInput[] = grid.slice(1).filter((c) => c.some((x) => (x || "").trim())).map((cols) => {
      const r: any = {}; header.forEach((h, i) => { const k = COL[h]; if (k) r[k] = (cols[i] ?? "").trim(); }); return r;
    }).filter((r) => r.name);
    if (recs.length === 0) { setMsg({ ok: false, text: "企業名のある行がありません" }); return; }
    start(async () => {
      const res = await importCompanies(recs);
      setMsg(res.ok ? { ok: true, text: `${res.inserted} 社を登録/更新しました` } : { ok: false, text: res.error ?? "取込に失敗しました" });
      if (res.ok) router.refresh();
    });
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
      <button className="btn brand" disabled={pending} onClick={() => fileRef.current?.click()}><Icons.plus /><span>{pending ? "取込中…" : "企業CSV取込"}</span></button>
      {/* 情報漏洩防止のため企業マスタの「書き出し（ダウンロード）」は廃止。取込用テンプレ（実データ無し）のみ残す。 */}
      <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => downloadCsv("企業テンプレート.csv", "﻿" + TEMPLATE.join(",") + "\n株式会社サンプル,SIer,A,主要,山田,鈴木,suzuki@example.com,03-1234-5678,https://example.com,東京都〇〇,直案件多数")}>テンプレ</button>
      {msg && <span style={{ fontSize: 12, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</span>}
    </div>
  );
}
