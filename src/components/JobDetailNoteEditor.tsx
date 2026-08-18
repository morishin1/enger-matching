"use client";

// 案件詳細ドロワーのインライン編集。#331⑧
//   `field` で編集対象を切り替える（人材側の CandidateNoteEditor と同じ作り）。
//     detail_note … 担当が手入力で整える「案件詳細」
//     detail      … 取り込んだ「メール原文」（#739：人材プロフィールと同じく案件でも直せるように）
//   メール原文は以前は読み取り専用の表示だけで、**値が空だと欄ごと出ない**ため
//   後から貼り付けることができなかった。常設の入力欄にして直せるようにする。
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { updateJobById } from "@/lib/actions";

/** 列が未整備だったときの案内。列ごとに直し方（実行するSQL）が違うので分けて持つ。 */
const MISSING_COLUMN_HINT: Record<string, string> = {
  detail_note:
    "保存できませんでした：データベースに「案件詳細」列（detail_note）が未整備です。中央 Supabase の SQL Editor で supabase/jobs-detail-note.sql を実行してください",
  detail:
    "保存できませんでした：データベースに「メール原文」列（detail）が未整備です。担当者にご連絡ください",
};

export function JobDetailNoteEditor({
  jobNo,
  initial,
  field = "detail_note",
  label = "案件詳細",
  placeholder = "案件のポイント・補足などを入力（保存でこの案件の案件詳細に反映されます）",
}: {
  jobNo: number;
  initial: string;
  field?: "detail_note" | "detail";
  label?: string;
  placeholder?: string;
}) {
  const [val, setVal] = useState(initial);
  const [savedVal, setSavedVal] = useState(initial);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = val !== savedVal;

  // #368①：案件詳細（右パネル）は全文が見えるよう、内容量に合わせて高さを自動調整（クリップさせない）。
  //   空欄のときは最小高さのまま（そのまま空欄表示）。
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const autosize = () => { const el = taRef.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.max(el.scrollHeight, 84) + "px"; };
  useEffect(() => { autosize(); }, [val]);

  const save = () => {
    start(async () => {
      const r = await updateJobById(jobNo, { [field]: val } as any);
      if (!r.ok) { toast(("error" in r ? r.error : null) || `${label}の保存に失敗しました`, "error"); return; }
      // #389：DBに列が未整備だと fail-soft で外されて「保存したのに消える」ため、
      //   成功扱いにせず明示エラーにする。
      if ((r as any).skipped?.includes(field)) {
        toast(MISSING_COLUMN_HINT[field] ?? `保存できませんでした：データベースに「${label}」列（${field}）が未整備です`, "error");
        return;
      }
      setSavedVal(val);
      toast(`${label}を保存しました`, "success");
      router.refresh();
    });
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea
          ref={taRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          rows={3}
          placeholder={placeholder}
          style={{ fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.7, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", resize: "vertical", width: "100%", boxSizing: "border-box", overflow: "hidden" }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="btn btn-xs" disabled={!dirty || pending} onClick={save}
            style={dirty ? { background: "var(--color-brand-600)", borderColor: "var(--color-brand-600)", color: "#fff" } : undefined}>
            {pending ? "保存中…" : `${label}を保存`}
          </button>
          {dirty && !pending && <span className="muted" style={{ fontSize: 11 }}>未保存の変更があります</span>}
        </div>
      </div>
    </div>
  );
}
