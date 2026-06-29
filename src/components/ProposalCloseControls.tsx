"use client";

// 提案詳細の「案件クローズ / 人材クローズ」ボタン。
//   ・機能は人材一覧・案件一覧のクローズボタン（CloseToggleButton）と完全に同じ：
//     押すと is_closed をトグル（クローズ⇔解除）。理由入力や会社評価への連動は無し。
//   ・クローズ済みのときは「○○クローズ済み」表示になり、再度押すと解除（再開）。
//   ・一覧へ行かずに提案詳細の通知ステータス隣でそのまま操作できる。
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkSetClosed } from "@/lib/actions";

export function ProposalCloseControls({ side, label, no, closed }: {
  side: "job" | "cand";
  label: string;          // 「案件」or「人材」
  no: number | null | undefined;
  closed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const table = side === "job" ? "jobs" : "candidates";
  const idField = side === "job" ? "job_no" : "candidate_no";

  const toggle = () => {
    if (!no) return;
    const next = !closed;
    start(async () => {
      const res = await bulkSetClosed(table, idField, [no], next, "/proposals");
      if (res.ok) router.refresh();
      else alert((res as any).error ?? "更新に失敗しました");
    });
  };

  return (
    <button type="button" className="btn ghost btn-xs" disabled={pending || !no} onClick={toggle}
      title={!no ? `${label}No が不明` : closed ? `${label}のクローズを解除して再開` : `${label}を一覧・マッチング対象から外す`}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, width: "100%", justifyContent: "center", color: closed ? "#067647" : undefined }}>
      <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>{closed ? "check_circle" : "block"}</span>
      {pending ? "更新中…" : closed ? `${label}クローズ済み` : `${label}クローズ`}
    </button>
  );
}
