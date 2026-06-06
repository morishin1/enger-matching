"use client";

// 「送信する（クライアント＋人材へ）」ボタンとモーダル。
//   従来は新規タブで /mail-compose 全画面ウィザードへ遷移していたが、
//   マッチング画面の文脈（選択中の案件/人材/スコア）を保ったままその場で
//   メール作成→確認→送信できるようモーダル化。タブ切替不要・修正サイクル高速。
//   URL直接アクセス用に /mail-compose ページは残置（互換）。

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { MailComposeWizard } from "./MailComposeWizard";

export function SendMailModalButton({ job, cand, score, label = "📤 送信する（クライアント＋人材へ）", style }:
  { job: any; cand: any; score: number; label?: string; style?: CSSProperties }) {
  const [open, setOpen] = useState(false);
  // ESCで閉じる
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", h);
    // モーダル表示中は背景スクロールを止める
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = prev; };
  }, [open]);

  // job_no / candidate_no が無い旧モードは従来のリンクへフォールバック
  if (job?.job_no == null || cand?.candidate_no == null) {
    return null;
  }

  return (
    <>
      <button type="button" className="btn-mail block" onClick={() => setOpen(true)}
        style={{ fontSize: 13, padding: "0 22px", height: 38, ...(style ?? {}) }}
        title="クライアント宛と人材宛のメール内容をその場で確認・編集してから送信できます">
        {label}
      </button>
      {open && (
        <div onClick={() => setOpen(false)}
          role="dialog" aria-modal="true" aria-labelledby="send-mail-modal-title"
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "start center", zIndex: 500, padding: "32px 16px", overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} className="card"
            style={{ width: "100%", maxWidth: 1000, padding: 0, overflow: "hidden", boxShadow: "0 20px 60px rgba(15,23,42,.25)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-soft)", position: "sticky", top: 0, zIndex: 1 }}>
              <div style={{ minWidth: 0 }}>
                <div id="send-mail-modal-title" style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.3 }}>📤 メール送信（クライアント＋人材）</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {job.title} <span style={{ color: "var(--color-ink-4)" }}>×</span> {cand.name ?? cand.initials}
                </div>
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <Link href={`/mail-compose?job_no=${job.job_no}&cand_no=${cand.candidate_no}&score=${score}`}
                  target="_blank" rel="noopener noreferrer" className="btn ghost btn-xs"
                  title="従来の全画面ページで開く" style={{ textDecoration: "none" }}>↗ 別タブ</Link>
                <button type="button" className="btn ghost btn-xs" onClick={() => setOpen(false)} title="閉じる (Esc)">✕ 閉じる</button>
              </div>
            </div>
            <div style={{ padding: 16, maxHeight: "calc(100vh - 140px)", overflowY: "auto" }}>
              <MailComposeWizard job={job} cand={cand} score={score} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
