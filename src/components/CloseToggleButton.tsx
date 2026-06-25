"use client";

// 人材／案件の個別詳細ページの「クローズ／クローズ解除」ボタン。
//   クローズ = 一覧・マッチング対象外（検索では表示）。解除で復帰。
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { bulkSetClosed } from "@/lib/actions";

export function CloseToggleButton({ kind, idValue, isClosed }: { kind: "candidates" | "jobs"; idValue: number; isClosed?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const idField = kind === "candidates" ? "candidate_no" : "job_no";
  const revalidate = kind === "candidates" ? "/people" : "/jobs";
  const toggle = () => {
    if (!idValue) return;
    const next = !isClosed;
    start(async () => {
      const res = await bulkSetClosed(kind, idField, [idValue], next, revalidate);
      if (res.ok) {
        toast(next ? "クローズしました（一覧・マッチング対象外）" : "クローズを解除しました（一覧・マッチングに復帰）", "success");
        router.refresh();
      } else {
        toast(res.error ?? "更新に失敗しました", "error");
      }
    });
  };
  return (
    <button type="button" className="btn ghost" onClick={toggle} disabled={pending}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, color: isClosed ? "#067647" : "var(--color-ink-2)" }}
      title={isClosed ? "クローズを解除して一覧・マッチングに戻す" : "一覧・マッチング対象から外す（検索では表示）"}>
      <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>{isClosed ? "restart_alt" : "block"}</span>
      {pending ? "更新中…" : isClosed ? "クローズ解除" : "クローズ"}
    </button>
  );
}
