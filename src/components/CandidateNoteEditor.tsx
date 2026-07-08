"use client";

// 人材詳細（/people/[candidate_no]）の備考欄（インライン編集）。#276③
//   ENGERフリーランス経由で登録された人材は note が空で「備考」行自体が出ず、
//   メモを書き込めなかったため、常設のテキスト入力＋保存ボタンとして設置する。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { updateCandidateById } from "@/lib/actions";

export function CandidateNoteEditor({ candidateNo, initial }: { candidateNo: number; initial: string }) {
  const [val, setVal] = useState(initial);
  const [savedVal, setSavedVal] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = val !== savedVal;

  const save = () => {
    start(async () => {
      const r = await updateCandidateById(candidateNo, { note: val } as any);
      if (!r.ok) { toast(("error" in r ? r.error : null) || "備考の保存に失敗しました", "error"); return; }
      setSavedVal(val);
      toast("備考を保存しました", "success");
      router.refresh();
    });
  };

  return (
    // #330②：ラベルを上に置き、入力欄を全幅に広げる（旧: 120px ラベル列で右に寄って狭かった）。
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "9px 0", fontSize: 13 }}>
      <div className="muted" style={{ fontSize: 12 }}>備考</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          rows={3}
          placeholder="対応メモ・特記事項などを入力（保存でこの人材の備考に反映されます）"
          style={{ fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.7, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="btn btn-xs" disabled={!dirty || pending} onClick={save}
            style={dirty ? { background: "var(--color-brand-600)", borderColor: "var(--color-brand-600)", color: "#fff" } : undefined}>
            {pending ? "保存中…" : "備考を保存"}
          </button>
          {dirty && !pending && <span className="muted" style={{ fontSize: 11 }}>未保存の変更があります</span>}
        </div>
      </div>
    </div>
  );
}
