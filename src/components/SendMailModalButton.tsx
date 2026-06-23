"use client";

// 「送信する（クライアント＋人材へ）」ボタン。
//   以前はその場でモーダルを開いていたが、背景クリック等で誤って閉じる事故が多かったため、
//   別タブで /mail-compose（全画面ウィザード）を開く方式に統一。
//   ※ コンポーネント名は呼び出し元との互換のためそのまま（実体はリンクボタン）。

import Link from "@/components/AppLink";
import type { CSSProperties } from "react";

export function SendMailModalButton({ job, cand, score, label = "📤 送信する（クライアント＋人材へ）", style }:
  { job: any; cand: any; score: number; label?: string; style?: CSSProperties; members?: string[];
    alreadyProposed?: boolean;
    proposalId?: string | null;
    proposer?: string | null;
  }) {
  // job_no / candidate_no が無い旧モードは何もしない
  if (job?.job_no == null || cand?.candidate_no == null) {
    return null;
  }

  return (
    <Link
      href={`/mail-compose?job_no=${job.job_no}&cand_no=${cand.candidate_no}&score=${score}`}
      target="_blank"
      rel="noopener noreferrer"
      className="btn-mail block"
      style={{ fontSize: 13, padding: "0 22px", height: 38, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", ...(style ?? {}) }}
      title="クライアント宛と人材宛のメール内容を別タブで確認・編集してから送信できます"
    >
      {label}
    </Link>
  );
}
