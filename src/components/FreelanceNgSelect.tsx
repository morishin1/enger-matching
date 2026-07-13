"use client";

// #368：フリーランスの応募（NG / 空欄）のインライン選択。
//   案件詳細ドロワー・案件管理ページ内に置き、その場で選択→保存できる。
//   選択肢は「NG」と空欄（真っ白＝制限なし）の2択。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { updateJobById } from "@/lib/actions";

export function FreelanceNgSelect({ jobNo, initial, compact }: { jobNo: number; initial?: string | null; compact?: boolean }) {
  const [val, setVal] = useState(initial === "NG" ? "NG" : "");
  const [pending, start] = useTransition();
  const router = useRouter();

  const onChange = (next: string) => {
    const prev = val;
    setVal(next);
    start(async () => {
      const r = await updateJobById(jobNo, { freelance_ng: next === "NG" ? "NG" : null } as any);
      if (!r.ok) { setVal(prev); toast(("error" in r ? r.error : null) || "フリーランスの応募の保存に失敗しました", "error"); return; }
      // #389：DBに freelance_ng 列が未整備だと fail-soft で外されて保存されないため、明示エラーで知らせる。
      if ((r as any).skipped?.includes("freelance_ng")) {
        setVal(prev);
        toast("保存できませんでした：データベースに「フリーランスNG」列（freelance_ng）が未整備です。中央 Supabase の SQL Editor で supabase/jobs-freelance-ng.sql を実行してください", "error");
        return;
      }
      toast(next === "NG" ? "フリーランスNGに設定しました" : "フリーランスNGを解除しました", "success");
      router.refresh();
    });
  };

  return (
    <select
      value={val}
      disabled={pending}
      onChange={(e) => onChange(e.target.value)}
      title="フリーランスの応募（NG / 空欄）"
      style={{
        fontFamily: "inherit", fontSize: compact ? 12 : 13, padding: compact ? "3px 6px" : "5px 8px",
        borderRadius: 6, border: "1px solid var(--color-border-strong)",
        background: "var(--color-surface)", color: val === "NG" ? "#b42318" : "var(--color-ink)",
        fontWeight: val === "NG" ? 700 : 400, cursor: pending ? "wait" : "pointer",
      }}
    >
      <option value="">（空欄）</option>
      <option value="NG">NG</option>
    </select>
  );
}
