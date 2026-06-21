"use client";

// 承認者向け：「📨 メール内容を確認して送信」ボタン。
//   クリック時に承認確定＋ステージ進行（→所属確認）を先に行い、別タブで
//   /mail-compose（メールを送信（案件側・人材側）画面）を開く。
//   ?send=1 を付けることで、開いた画面では SendBothMailsButton（送信モーダル）が
//   自動でオープンする。実送信完了時の記録は MailComposeWizard 側の SendBothMailsButton が
//   行う（既存どおり）。
//
//   この変更により：
//     - 旧「✓ 承認して送信」確認モーダルは廃止（要望）
//     - クリック直後に承認タブから消え、所属確認へ移動（pending_mail は別タブ用に保持）

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveProposalForSend } from "@/lib/actions";

export function ApproveAndSendButton({ proposalId, jobNo, candNo }: { proposalId: string; jobNo?: number | null; candNo?: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const handle = () => {
    if (jobNo == null || candNo == null) { setErr("案件No/人材Noが不足しているため別画面を開けません"); return; }
    setErr(null);
    // ポップアップブロッカー対策：クリック直後に空タブを開いておき、承認サーバ処理が成功してから
    // URL を流し込む。
    //   ★ window.open() の features に "noopener" を含めると、Chromium 系などで戻り値は仕様上 null
    //     になる（参照 MDN）。これに気付かず popup.location.href が動かず、別タブが about:blank の
    //     まま「白い画面」になっていた（PR #344 のリグレッション）。
    //     代わりに opener を明示クリアして安全性は確保する。
    const popup = window.open("about:blank", "_blank");
    if (popup) { try { popup.opener = null; } catch { /* 一部ブラウザは setter 不可 */ } }
    const sendUrl = `/mail-compose?job_no=${jobNo}&cand_no=${candNo}&send=1`;
    start(async () => {
      const r = await approveProposalForSend(proposalId);
      if (!r.ok) { setErr(r.error); if (popup && !popup.closed) popup.close(); return; }
      // 承認＋ステージ進行が確定した後で、別タブ側の SSR が approved を読めるよう URL を差し替える。
      if (popup && !popup.closed) {
        popup.location.href = sendUrl;
      } else {
        // ポップアップブロッカーで空タブが開けなかった場合は、現在タブで遷移にフォールバック。
        //   「白い画面」のまま放置されるよりは導線を繋げる方を優先。
        window.location.href = sendUrl;
      }
      router.refresh();
    });
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "stretch" }}>
      <button type="button" className="btn brand btn-sm" disabled={pending} onClick={handle}
        title="承認して所属確認へ進めつつ、別タブでメール送信画面を開きます">
        {pending ? "処理中…" : "📨 メール内容を確認して送信"}
      </button>
      {err && <span style={{ fontSize: 11, color: "var(--color-danger)" }}>{err}</span>}
    </span>
  );
}
