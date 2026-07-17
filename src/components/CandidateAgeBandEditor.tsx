"use client";

// 人材プロフィール詳細の「年齢（年代）」インライン編集（#460）。
//   選択して保存すると updateCandidateById で age_band を更新する。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { updateCandidateById } from "@/lib/actions";

const AGE_OPTIONS = ["20代", "30代", "40代", "50代", "60代以上"];

export function CandidateAgeBandEditor({ candidateNo, initial }: { candidateNo: number; initial: string }) {
  const [val, setVal] = useState(initial ?? "");
  const [savedVal, setSavedVal] = useState(initial ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = val !== savedVal;

  const save = () => {
    start(async () => {
      const r = await updateCandidateById(candidateNo, { age_band: val || null } as any);
      if (!r.ok) { toast(("error" in r ? r.error : null) || "年代の保存に失敗しました", "error"); return; }
      setSavedVal(val);
      toast("年代を保存しました", "success");
      router.refresh();
    });
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <select value={val} onChange={(e) => setVal(e.target.value)} disabled={pending}
        style={{ fontFamily: "inherit", fontSize: 12.5, padding: "3px 6px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
        <option value="">未設定</option>
        {/* 既存値が候補に無い場合も失わないよう先頭に残す */}
        {val && !AGE_OPTIONS.includes(val) && <option value={val}>{val}</option>}
        {AGE_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      {dirty && (
        <button type="button" className="btn btn-xs" disabled={pending} onClick={save}
          style={{ background: "var(--color-brand-600)", borderColor: "var(--color-brand-600)", color: "#fff" }}>
          {pending ? "保存中…" : "保存"}
        </button>
      )}
    </span>
  );
}
