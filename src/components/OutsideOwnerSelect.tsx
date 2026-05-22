"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobOutsideOwner } from "@/lib/actions";

/** 案件のエンド担当（アウトサイド）を一覧でインライン設定。 */
export function OutsideOwnerSelect({ jobNo, value, options }: { jobNo: number; value: string | null; options: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [val, setVal] = useState(value ?? "");

  const change = (v: string) => {
    setVal(v);
    start(async () => { await setJobOutsideOwner(jobNo, v || null); router.refresh(); });
  };

  const missing = !val;
  return (
    <select
      value={val}
      disabled={pending}
      onChange={(e) => change(e.target.value)}
      title="エンド担当（アウトサイド）"
      style={{
        fontSize: 11.5, padding: "4px 6px", borderRadius: 7, maxWidth: 110, width: "100%",
        border: `1px solid ${missing ? "var(--color-danger, #d23f57)" : "var(--color-border)"}`,
        background: missing ? "#fdecef" : "var(--color-surface)",
        color: missing ? "#b42318" : "var(--color-ink)",
      }}
    >
      <option value="">未設定</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
      {val && !options.includes(val) && <option value={val}>{val}</option>}
    </select>
  );
}
