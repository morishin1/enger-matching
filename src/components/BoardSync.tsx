"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncBoardInvoices, boardConnectionTest } from "@/app/billing/board-actions";

const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "未同期");

/** board 請求の手動同期（管理者・バックオフィス向け）。当月の送付状況を board から読み取り更新。 */
export function BoardSync({ period, lastSyncedAt }: { period: string; lastSyncedAt?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [debug, setDebug] = useState<string | null>(null);

  const sync = () => start(async () => {
    setDebug(null);
    setMsg({ ok: true, text: `board と同期中…（${period}）` });
    const r = await syncBoardInvoices(period);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "同期に失敗しました" }); router.refresh(); return; }
    if ((r.mapped ?? 0) === 0) { setMsg({ ok: false, text: "board案件IDが未設定です。各稼働の請求欄に案件ID（または案件番号）を入力してください。" }); router.refresh(); return; }
    const warn = r.capHit ? "（取得上限に到達。古い請求が多い場合は取りこぼしの可能性あり）" : "";
    setMsg({ ok: true, text: `✓ ${period} を同期：${r.matched ?? 0}件一致 / ${r.updated ?? 0}件更新（ひもづけ${r.mapped ?? 0}件・走査${r.scanned ?? 0}件）${warn}` });
    router.refresh();
  });

  const test = () => start(async () => {
    setMsg(null);
    setDebug("接続テスト中…");
    const r = await boardConnectionTest();
    if (!r.ok) { setDebug(null); setMsg({ ok: false, text: r.error ?? "接続テストに失敗しました" }); return; }
    setDebug(JSON.stringify(r.probe, null, 2));
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 10.5 }} title="board 請求の最終同期">board同期: {fmt(lastSyncedAt)}</span>
        <button type="button" className="btn ghost btn-xs" disabled={pending} onClick={test} title="board API への接続と請求一覧の形を確認">接続テスト</button>
        <button type="button" className="btn brand btn-xs" disabled={pending} onClick={sync} title="board の請求ステータスを読み取り、当月の送付状況を更新">{pending ? "同期中…" : "🔄 今すぐ同期"}</button>
      </div>
      {msg && <div style={{ fontSize: 11, fontWeight: 600, color: msg.ok ? "#067647" : "#b42318", maxWidth: 360, textAlign: "right" }}>{msg.text}</div>}
      {debug && (
        <pre style={{ maxWidth: 520, maxHeight: 320, overflow: "auto", fontSize: 10, lineHeight: 1.4, background: "var(--color-surface-inset)", border: "1px solid var(--color-border)", borderRadius: 8, padding: 10, textAlign: "left", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{debug}</pre>
      )}
    </div>
  );
}
