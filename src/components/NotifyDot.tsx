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

// それぞれの側で「やるべきこと」のヒント。ツールチップに添えて “なぜ赤いのか” を伝える。
const SIDE_HINT: Record<"job" | "cand", string> = {
  job:  "案件側：クライアントへの連絡・確認・状況フォローが必要です",
  cand: "人材側：候補者への打診・意思確認・面談調整が必要です",
};
const SIDE_LABEL: Record<"job" | "cand", string> = { job: "案", cand: "人" };
const SIDE_LABEL_FULL: Record<"job" | "cand", string> = { job: "案件", cand: "人材" };

const normalize = (s: NotifyStatus | string | null | undefined): NotifyStatus =>
  (s === "in_progress" || s === "done") ? s : "pending";

/** ドット単体（カードなどスペース無い場所向け）。ツールチップで何の・なぜ赤いかを伝える。 */
export function NotifyDot({ status, side, proposalId, size = 10, inline = false }: {
  status?: NotifyStatus | string | null;
  side: "job" | "cand";
  proposalId: string;
  size?: number;
  inline?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const s = normalize(status);
  const tone = TONE[s];
  const sideLabel = SIDE_LABEL_FULL[side];
  const title = s === "pending"
    ? `${sideLabel}: 未処理 — ${SIDE_HINT[side]}（クリックで処理中へ）`
    : s === "in_progress"
      ? `${sideLabel}: 処理中（クリックで完了へ）`
      : `${sideLabel}: 完了（クリックで未処理に戻す）`;

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

  if (s === "done") {
    return (
      <button type="button" onClick={cycle} title={title}
        style={{ width: size, height: size, padding: 0, borderRadius: 99, background: "transparent", border: "1px dashed #cbd5e1", cursor: pending ? "wait" : "pointer", verticalAlign: "middle", display: inline ? "inline-block" : undefined, opacity: pending ? 0.5 : 1 }} />
    );
  }
  return (
    <button type="button" onClick={cycle} title={title} aria-label={title}
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

/** ラベル付きチップ（案/人 + ドット）。リスト等のスペースがある場所で意味を明示するために使う。 */
export function NotifyChip({ status, side, proposalId }: {
  status?: NotifyStatus | string | null;
  side: "job" | "cand";
  proposalId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const s = normalize(status);
  const tone = TONE[s];
  const sideFull = SIDE_LABEL_FULL[side];
  const sideShort = SIDE_LABEL[side];
  const title = s === "pending"
    ? `${sideFull}側 — ${SIDE_HINT[side]}（クリックで処理中へ）`
    : s === "in_progress"
      ? `${sideFull}側：処理中（クリックで完了へ）`
      : `${sideFull}側：完了（クリックで未処理に戻す）`;

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

  // 控えめ：done は薄い灰色＋点線
  const bg = s === "done" ? "transparent" : `${tone.fg}14`;
  const fg = s === "done" ? "#94a3b8" : tone.fg;
  const bd = s === "done" ? "#cbd5e1" : tone.fg + "55";
  const dashed = s === "done";

  return (
    <button type="button" onClick={cycle} title={title} aria-label={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontFamily: "inherit", fontSize: 10.5, fontWeight: 700,
        padding: "2px 7px", borderRadius: 99,
        background: bg, color: fg, border: `1px ${dashed ? "dashed" : "solid"} ${bd}`,
        cursor: pending ? "wait" : "pointer", opacity: pending ? 0.5 : 1,
      }}>
      <span className={s === "pending" ? "enger-notify-pulse" : undefined}
        style={{ width: 6, height: 6, borderRadius: 99, background: s === "done" ? "transparent" : tone.fg, border: s === "done" ? "1px dashed #cbd5e1" : "none" }} />
      <span>{sideShort}</span>
      <span style={{ fontSize: 9.5, fontWeight: 600, opacity: 0.85 }}>{NOTIFY_LABEL[s]}</span>
    </button>
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
