"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCandidateAffiliation } from "@/lib/actions";

const OPTIONS = ["プロパー", "BP", "フリーランス"];

/** 人材の所属区分を一覧でインライン設定（マスク判定キー・必須）。 */
export function AffiliationSelect({ candidateNo, value }: { candidateNo: number; value: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [val, setVal] = useState(value ?? "");
  const change = (v: string) => { setVal(v); start(async () => { await setCandidateAffiliation(candidateNo, v || null); router.refresh(); }); };
  const missing = !val;
  return (
    <select value={val} disabled={pending} onChange={(e) => change(e.target.value)} title="所属区分（必須）"
      style={{ fontSize: 11, padding: "4px 6px", borderRadius: 7, width: "100%", maxWidth: 120,
        border: `1px solid ${missing ? "var(--color-danger,#d23f57)" : "var(--color-border)"}`,
        background: missing ? "#fdecef" : "var(--color-surface)", color: missing ? "#b42318" : "var(--color-ink)" }}>
      <option value="">未設定</option>
      {OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
      {val && !OPTIONS.includes(val) && <option value={val}>{val}</option>}
    </select>
  );
}
