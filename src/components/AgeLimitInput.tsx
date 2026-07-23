"use client";

// 0722①：案件の「年齢制限」（自由記述）のインライン編集。
//   案件一覧のドロワー内に置き、その場で入力→保存できる（FreelanceNgSelect と同パターン）。
//   例：「30〜55歳まで」「45歳以下」。保存内容はマッチングの年齢除外にも使われる。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { updateJobById } from "@/lib/actions";

export function AgeLimitInput({ jobNo, initial, compact }: { jobNo: number; initial?: string | null; compact?: boolean }) {
  const [val, setVal] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();

  const save = () => {
    const next = val.trim();
    if (next === (saved ?? "").trim()) return; // 変更なしは何もしない
    start(async () => {
      const r = await updateJobById(jobNo, { age_limit: next } as any);
      if (!r.ok) { toast(("error" in r ? r.error : null) || "年齢制限の保存に失敗しました", "error"); return; }
      // DBに age_limit 列が未整備だと fail-soft で外されて保存されないため、明示エラーで知らせる。
      if ((r as any).skipped?.includes("age_limit")) {
        toast("保存できませんでした：データベースに「年齢制限」列（age_limit）が未整備です。中央 Supabase の SQL Editor で supabase/job-age-limit.sql を実行してください", "error");
        return;
      }
      setSaved(next);
      toast(next ? `年齢制限を保存しました（${next}）` : "年齢制限をクリアしました", "success");
      router.refresh();
    });
  };

  return (
    <input
      type="text"
      value={val}
      disabled={pending}
      onChange={(e) => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      placeholder="例：30〜55歳まで"
      title="年齢制限（自由記述）。入力してフォーカスを外すと保存されます"
      style={{
        fontFamily: "inherit", fontSize: compact ? 12 : 13, padding: compact ? "3px 6px" : "5px 8px",
        borderRadius: 6, border: "1px solid var(--color-border-strong)",
        background: "var(--color-surface)", color: "var(--color-ink)",
        width: compact ? 140 : 180, cursor: pending ? "wait" : "text",
      }}
    />
  );
}
