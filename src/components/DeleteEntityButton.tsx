"use client";

// 人材／案件の個別ページの「削除」ボタン。
// 削除前に confirm で確認。削除成功時は一覧へ戻る。
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkDeleteJobs, bulkDeleteCandidates } from "@/lib/actions";

export function DeleteEntityButton({ kind, idValue, label }: { kind: "candidates" | "jobs"; idValue: number; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isCand = kind === "candidates";
  const doDelete = () => {
    if (!idValue) return;
    if (!window.confirm(`${isCand ? "この人材" : "この案件"}「${label ?? (isCand ? `P-${String(idValue).padStart(5, "0")}` : `No.${String(idValue).padStart(5, "0")}`)}」を削除しますか？\n（提案管理に紐づくものがあれば、提案側の参照は残ります）`)) return;
    start(async () => {
      const res = isCand ? await bulkDeleteCandidates([idValue]) : await bulkDeleteJobs([idValue]);
      if (res.ok) {
        router.push(isCand ? "/people" : "/jobs");
        router.refresh();
      } else {
        window.alert(`削除に失敗しました: ${res.error ?? "不明なエラー"}`);
      }
    });
  };
  return (
    <button type="button" className="btn ghost" onClick={doDelete} disabled={pending} style={{ color: "var(--color-danger)" }}>
      {pending ? "削除中…" : "🗑 削除"}
    </button>
  );
}
