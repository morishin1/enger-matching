"use client";

// 案件詳細（案件詳細ドロワーのインライン編集）。#331⑧
//   取込メール原文（detail＝「メール原文」）とは別に、担当が手入力で整える案件詳細メモ。
//   窓口メールの下・メール原文の上に配置し、その場で入力・保存できるようにする。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { updateJobById } from "@/lib/actions";

export function JobDetailNoteEditor({ jobNo, initial }: { jobNo: number; initial: string }) {
  const [val, setVal] = useState(initial);
  const [savedVal, setSavedVal] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = val !== savedVal;

  const save = () => {
    start(async () => {
      const r = await updateJobById(jobNo, { detail_note: val } as any);
      if (!r.ok) { toast(("error" in r ? r.error : null) || "案件詳細の保存に失敗しました", "error"); return; }
      setSavedVal(val);
      toast("案件詳細を保存しました", "success");
      router.refresh();
    });
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>案件詳細</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          rows={4}
          placeholder="案件のポイント・補足などを入力（保存でこの案件の案件詳細に反映されます）"
          style={{ fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.7, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", resize: "vertical", width: "100%", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="btn btn-xs" disabled={!dirty || pending} onClick={save}
            style={dirty ? { background: "var(--color-brand-600)", borderColor: "var(--color-brand-600)", color: "#fff" } : undefined}>
            {pending ? "保存中…" : "案件詳細を保存"}
          </button>
          {dirty && !pending && <span className="muted" style={{ fontSize: 11 }}>未保存の変更があります</span>}
        </div>
      </div>
    </div>
  );
}
