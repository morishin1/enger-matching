"use client";

// 提案管理の「承認」フォルダ。承認待ち・差戻しの提案だけを集約して表示する。
//   ・承認者（admin / マネージャー / リーダー / 指名された承認者）：承認して送信・承認のみ・差戻し
//   ・提案者本人：状態の確認、差戻し理由の確認、メール作成画面への導線
//   承認されると stage が「所属確認」へ移り、このフォルダから自動的に消える（＝別フォルダへ移動）。

import { useState, useTransition } from "react";
import Link from "@/components/AppLink";
import { useRouter } from "next/navigation";
import { approveProposal, rejectProposal, deleteProposal } from "@/lib/actions";
import { ApproveAndSendButton } from "./ApproveAndSendButton";

type Row = {
  id: string;
  job_title?: string | null; company?: string | null;
  candidate_name?: string | null; c_init?: string | null;
  proposer?: string | null; approver?: string | null;
  approval_status?: string | null; reject_reason?: string | null;
  job_no?: number | null; candidate_no?: number | null;
  score?: number | null; rate?: string | null;
};

/** 氏名のゆるい一致（前後空白を無視）。サーバ側 approveProposal が最終的に権限を厳密判定する。 */
function nameEq(a?: string | null, b?: string | null): boolean {
  const x = (a ?? "").trim(); const y = (b ?? "").trim();
  return !!x && !!y && x === y;
}

export function ApprovalQueue({ rows, currentUserName, privileged }: {
  rows: Row[]; currentUserName?: string | null; privileged?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingRows = rows.filter((r) => (r.approval_status ?? "") !== "rejected");
  const rejectedRows = rows.filter((r) => (r.approval_status ?? "") === "rejected");

  const canApprove = (r: Row) => !!privileged || nameEq(currentUserName, r.approver);
  // 提案者本人・承認者・admin/マネージャーは削除可。誤承認の取り消し・差戻し後の整理に使う。
  const canDelete = (r: Row) => !!privileged || nameEq(currentUserName, r.approver) || nameEq(currentUserName, r.proposer);

  const doApproveOnly = (id: string) => {
    if (!confirm("メール下書きを使わずに承認だけしますか？（通常は『メール内容を確認して送信』をお使いください）")) return;
    setBusyId(id);
    start(async () => {
      const res = await approveProposal(id);
      setBusyId(null);
      if (!res.ok) alert(res.error); else router.refresh();
    });
  };

  const doReject = (id: string) => {
    const reason = window.prompt("差戻し理由を入力してください（提案者に表示されます）");
    if (reason == null) return;
    setBusyId(id);
    start(async () => {
      const res = await rejectProposal(id, reason);
      setBusyId(null);
      if (!res.ok) alert(res.error); else router.refresh();
    });
  };

  const doDelete = (r: Row) => {
    const who = `${r.job_title ?? "案件"}${r.company ? `（${r.company}）` : ""} × ${r.candidate_name ?? r.c_init ?? "人材"}`;
    if (!confirm(`この承認依頼を削除しますか？\n${who}\n\n※ 提案レコードごと削除されます（元に戻せません）。`)) return;
    setBusyId(r.id);
    start(async () => {
      const res = await deleteProposal(r.id);
      setBusyId(null);
      if (!res.ok) alert(res.error); else router.refresh();
    });
  };

  const Card = ({ r }: { r: Row }) => {
    const rejected = (r.approval_status ?? "") === "rejected";
    const mine = canApprove(r);
    const composeHref = (r.job_no != null && r.candidate_no != null)
      ? `/mail-compose?job_no=${r.job_no}&cand_no=${r.candidate_no}${r.score != null ? `&score=${r.score}` : ""}`
      : null;
    // タイトル（案件名×人材名）はクリックで該当のマッチング画面へ。
    //   案件→人材モードを既定（案件起点で他の候補も並ぶ）。
    const matchingHref = (r.job_no != null)
      ? `/matching?job=${r.job_no}${r.candidate_no != null ? `&cand=${r.candidate_no}` : ""}`
      : null;
    return (
      <div className="card" style={{ padding: 0, overflow: "hidden", borderColor: rejected ? "#f7c5cf" : "#fde9b0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: rejected ? "#fdecef" : "#fff6e0", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: rejected ? "#b42318" : "#9a7b12" }}>
            {rejected ? "🔴 差戻し" : "⏳ 承認待ち"}
          </span>
          {matchingHref ? (
            <Link href={matchingHref}
              title="マッチング画面で開く"
              style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-brand-700)", textDecoration: "none" }}>
              {r.job_title ?? "案件"}{r.company ? `（${r.company}）` : ""} <span style={{ opacity: 0.4 }}>×</span> {r.candidate_name ?? r.c_init ?? "人材"}
            </Link>
          ) : (
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-ink)" }}>
              {r.job_title ?? "案件"}{r.company ? `（${r.company}）` : ""} <span style={{ opacity: 0.4 }}>×</span> {r.candidate_name ?? r.c_init ?? "人材"}
            </span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--color-ink-3)" }}>
            提案者：<b>{r.proposer ?? "未設定"}</b> ／ 承認者：<b>{r.approver ?? "未設定"}</b>
          </span>
        </div>
        {rejected && r.reject_reason && (
          <div style={{ padding: "8px 14px", fontSize: 12, color: "#b42318", borderBottom: "1px solid var(--color-border)" }}>差戻し理由：{r.reject_reason}</div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", flexWrap: "wrap" }}>
          {mine ? (
            <>
              <ApproveAndSendButton proposalId={r.id} jobNo={r.job_no ?? null} candNo={r.candidate_no ?? null} />
              <button type="button" className="btn ghost btn-sm" disabled={pending && busyId === r.id}
                title="メール下書きが無い場合のみ使用（既に他経路で送信済みの提案を承認）"
                onClick={() => doApproveOnly(r.id)}>承認のみ</button>
              <button type="button" className="btn btn-sm" disabled={pending && busyId === r.id}
                style={{ color: "#b42318", borderColor: "#f7c5cf" }}
                onClick={() => doReject(r.id)}>差戻し</button>
            </>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>
              {rejected ? "提案内容を修正して再申請してください。" : `承認者（${r.approver ?? "未設定"}）の対応待ちです。`}
            </span>
          )}
          {composeHref && (
            <Link href={composeHref} className="btn ghost btn-sm" style={{ marginLeft: mine ? 0 : "auto", textDecoration: "none" }}>
              ✉️ メール内容を見る／編集
            </Link>
          )}
          {canDelete(r) && (
            <button type="button" className="btn ghost btn-sm" disabled={pending && busyId === r.id}
              title="この承認依頼を削除（提案レコードごと削除・元に戻せません）"
              style={{ marginLeft: composeHref ? 0 : "auto", color: "var(--color-danger)" }}
              onClick={() => doDelete(r)}>
              🗑 削除
            </button>
          )}
        </div>
      </div>
    );
  };

  if (rows.length === 0) {
    return <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>承認待ち・差戻しの提案はありません。</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {pendingRows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#9a7b12" }}>⏳ 承認待ち <span className="badge" style={{ fontSize: 10 }}>{pendingRows.length}</span></div>
          {pendingRows.map((r) => <Card key={r.id} r={r} />)}
        </div>
      )}
      {rejectedRows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#b42318" }}>🔴 差戻し <span className="badge" style={{ fontSize: 10 }}>{rejectedRows.length}</span></div>
          {rejectedRows.map((r) => <Card key={r.id} r={r} />)}
        </div>
      )}
    </div>
  );
}
