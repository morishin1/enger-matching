"use client";

// マッチング対象期間（鮮度ウィンドウ）の設定UI。管理者のみ。
//   取込日が「直近 N 日」以内の案件・人材だけをマッチング対象にする。
//   毎日ローリングで自動更新。データはDB・検索には残り、マッチング画面の
//   「期間外も表示」で再表示できる（削除ではない）。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMatchWindow } from "@/lib/actions";
import type { MatchWindow } from "@/lib/match-window";

export function MatchWindowEditor({ initial }: { initial: MatchWindow }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [days, setDays] = useState(String(initial.days));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = () => {
    setMsg(null);
    const n = Math.min(365, Math.max(1, Math.floor(Number(days) || 7)));
    start(async () => {
      const r = await saveMatchWindow({ enabled, days: n });
      if (r.ok) { setMsg({ ok: true, text: "保存しました（マッチングに即反映されます）" }); setDays(String(n)); router.refresh(); }
      else setMsg({ ok: false, text: r.error ?? "保存に失敗しました" });
    });
  };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📅 マッチング対象期間</h3>
        <span className="muted" style={{ fontSize: 11 }}>取込が新しいデータだけをマッチング</span>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 14, lineHeight: 1.7 }}>
        取込日（ENGER に登録された日）が <b>直近 N 日以内</b> の案件・人材だけをマッチング対象にします。
        毎日ローリングで自動更新されるので、シート側の操作は不要です。
        <br />
        ※ 対象外になったデータは削除されません（一覧・検索には残ります）。マッチング画面の <b>「期間外も表示」</b> でいつでも確認できます。
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          期間で絞り込む（有効）
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, opacity: enabled ? 1 : 0.5 }}>
          直近
          <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} disabled={!enabled}
            style={{ width: 72, fontSize: 13, padding: "6px 9px", borderRadius: 7, border: "1px solid var(--color-border-strong)", textAlign: "right", fontFamily: "monospace" }} />
          日以内
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <button type="button" className="btn brand" disabled={pending} onClick={save}>{pending ? "保存中…" : "保存する"}</button>
        {msg && <span style={{ fontSize: 12, color: msg.ok ? "#067647" : "var(--color-danger)" }}>{msg.text}</span>}
      </div>
    </div>
  );
}
