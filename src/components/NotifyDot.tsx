"use client";

// 通知ステータスドット。
//   - pending(未処理): 赤・脈動する → 「やってない・早くやって」と促す
//   - in_progress(処理中): 青・固定
//   - done(完了): 表示しない（クリックで再表示できるよう小さな灰色点）
//   クリックで pending → in_progress → done → pending と循環。
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProposalFields } from "@/lib/actions";

export type NotifyStatus = "pending" | "in_progress" | "done";
export const NOTIFY_LABEL: Record<NotifyStatus, string> = { pending: "未処理", in_progress: "処理中", done: "完了" };

const TONE: Record<NotifyStatus, { fg: string; bg: string; bd: string }> = {
  pending:     { fg: "#dc2626", bg: "#fee2e2", bd: "#fca5a5" },
  in_progress: { fg: "#0095D9", bg: "#dbeafe", bd: "#93c5fd" },
  done:        { fg: "#94a3b8", bg: "transparent", bd: "transparent" },
};

const NEXT: Record<NotifyStatus, NotifyStatus> = {
  pending: "in_progress",
  in_progress: "done",
  done: "pending",
};

export function NotifyDot({ status, side, proposalId, size = 10, inline = false }: {
  status?: NotifyStatus | string | null;
  side: "job" | "cand";
  proposalId: string;
  size?: number;
  inline?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const s: NotifyStatus = (status === "in_progress" || status === "done") ? status : "pending";
  const tone = TONE[s];
  const sideLabel = side === "job" ? "案件" : "人材";

  const cycle = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (pending) return;
    const next = NEXT[s];
    const field = side === "job" ? "job_notify_status" : "cand_notify_status";
    start(async () => {
      await updateProposalFields(proposalId, { [field]: next });
      router.refresh();
    });
  };

  // done は控えめ表示（薄い空白の輪郭のみ・クリック領域は確保）
  if (s === "done") {
    return (
      <button type="button" onClick={cycle} title={`${sideLabel}: 完了（クリックで未処理に戻す）`}
        style={{ width: size, height: size, padding: 0, borderRadius: 99, background: "transparent", border: "1px dashed #cbd5e1", cursor: pending ? "wait" : "pointer", verticalAlign: "middle", display: inline ? "inline-block" : undefined, opacity: pending ? 0.5 : 1 }} />
    );
  }

  return (
    <button type="button" onClick={cycle}
      title={`${sideLabel}: ${NOTIFY_LABEL[s]} — クリックで次の状態へ（未処理→処理中→完了）`}
      aria-label={`${sideLabel}通知ステータス: ${NOTIFY_LABEL[s]}`}
      className={s === "pending" ? "enger-notify-pulse" : undefined}
      style={{
        width: size, height: size, padding: 0, borderRadius: 99,
        background: tone.fg, border: `1px solid ${tone.bd}`,
        cursor: pending ? "wait" : "pointer", verticalAlign: "middle",
        display: inline ? "inline-block" : undefined, opacity: pending ? 0.5 : 1,
        boxShadow: s === "pending" ? `0 0 0 0 ${tone.fg}` : "none",
      }} />
  );
}

/** ピル + 2 つの通知ドット（案件側/人材側）を組み合わせた小コンポーネント。リストや詳細で再利用。 */
export function NotifyDotPair({ proposalId, jobStatus, candStatus }: { proposalId: string; jobStatus?: NotifyStatus | string | null; candStatus?: NotifyStatus | string | null }) {
  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
      <NotifyDot status={jobStatus} side="job" proposalId={proposalId} />
      <NotifyDot status={candStatus} side="cand" proposalId={proposalId} />
    </span>
  );
}
