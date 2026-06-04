"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncBoardInvoices, boardConnectionTest, autoLinkBoardProjects } from "@/app/billing/board-actions";

const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "未同期");
const STALE_MS = 60 * 60 * 1000; // 1時間以上前の同期は「古い」とみなす

/** board 請求の同期（手動＋ページ表示時の自動同期）。当月の送付状況を board から読み取り更新。 */
export function BoardSync({ period, lastSyncedAt }: { period: string; lastSyncedAt?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [debug, setDebug] = useState<string | null>(null);
  const autoRan = useRef(false);

  const sync = () => start(async () => {
    setDebug(null);
    setMsg({ ok: true, text: `board と同期中…（${period}）` });
    const r = await syncBoardInvoices(period);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "同期に失敗しました" }); router.refresh(); return; }
    if ((r.mapped ?? 0) === 0) { setMsg({ ok: false, text: "board案件IDが未設定です。「🔗 自動ひもづけ」を実行するか、各稼働の請求欄に案件ID（または案件番号）を入力してください。" }); router.refresh(); return; }
    const warn = r.capHit ? "（取得上限に到達。古い請求が多い場合は取りこぼしの可能性あり）" : "";
    setMsg({ ok: true, text: `✓ ${period} を同期：${r.matched ?? 0}件一致 / ${r.updated ?? 0}件更新（ひもづけ${r.mapped ?? 0}件・走査${r.scanned ?? 0}件）${warn}` });
    router.refresh();
  });

  const autoLink = () => start(async () => {
    setDebug(null);
    setMsg({ ok: true, text: "board 案件と自動ひもづけ中…" });
    const r = await autoLinkBoardProjects();
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "自動ひもづけに失敗しました" }); router.refresh(); return; }
    const amb = r.ambiguous ? `／曖昧 ${r.ambiguous}件（手動）` : "";
    const nc = (r as any).noClient ? `／企業名不一致 ${(r as any).noClient}件` : "";
    const rn = (r as any).renamed ? `／会社名をboardに統一 ${(r as any).renamed}件` : "";
    setMsg({ ok: true, text: `✓ 自動ひもづけ：${r.linked ?? 0}/${r.targets ?? 0}件 紐づけ（board案件${r.projects ?? 0}件 走査${amb}${nc}${rn}）` });
    router.refresh();
  });

  // 自動同期：ページ表示時に最終同期が1時間以上前なら静かに同期して 未送付↔送付済 を最新化
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    const last = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
    if (Date.now() - last < STALE_MS) return; // まだ新しい
    start(async () => {
      setMsg({ ok: true, text: `🔄 自動同期中…（${period}）` });
      const r = await syncBoardInvoices(period);
      if (!r.ok) { setMsg({ ok: false, text: `自動同期失敗: ${r.error ?? "不明"}` }); router.refresh(); return; }
      if ((r.mapped ?? 0) === 0) { setMsg(null); router.refresh(); return; } // 未ひもづけは静かにスキップ
      setMsg({ ok: true, text: `✓ 自動同期：${r.matched ?? 0}件一致 / ${r.updated ?? 0}件更新` });
      router.refresh();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <button type="button" className="btn ghost btn-xs" disabled={pending} onClick={autoLink} title="board の案件一覧と企業名/人材名/案件名で照合し、未ひもづけの稼働に board案件ID を自動セット">{pending ? "処理中…" : "🔗 自動ひもづけ"}</button>
        <button type="button" className="btn brand btn-xs" disabled={pending} onClick={sync} title="board の請求ステータスを読み取り、当月の送付状況を更新">{pending ? "同期中…" : "🔄 今すぐ同期"}</button>
      </div>
      {msg && <div style={{ fontSize: 11, fontWeight: 600, color: msg.ok ? "#067647" : "#b42318", maxWidth: 360, textAlign: "right" }}>{msg.text}</div>}
      {debug && (
        <pre style={{ maxWidth: 520, maxHeight: 320, overflow: "auto", fontSize: 10, lineHeight: 1.4, background: "var(--color-surface-inset)", border: "1px solid var(--color-border)", borderRadius: 8, padding: 10, textAlign: "left", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{debug}</pre>
      )}
    </div>
  );
}
