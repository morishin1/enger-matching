"use client";

// KGIダッシュボード：月間売上目標の手動入力 ＋「AIで週次/日次KPIを計算」ボタン。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveKgiSalesTarget, computeKgiPlan } from "@/lib/kgi-plan-actions";

export function KgiPlanControls({ month, initialTarget, hasPlan, canEdit }: {
  month: string; initialTarget: number | null; hasPlan: boolean; canEdit: boolean;
}) {
  const router = useRouter();
  const [val, setVal] = useState<string>(initialTarget != null ? String(initialTarget) : "");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const saveTarget = () => {
    if (!canEdit) return;
    const n = val.trim() === "" ? null : Math.max(0, Math.floor(Number(val) || 0));
    setMsg(null);
    start(async () => {
      const r = await saveKgiSalesTarget({ month, salesTargetMan: n });
      if (!r.ok) { setMsg(`保存失敗: ${r.error}`); return; }
      setMsg("売上目標を保存しました。「AIで計算」で週次/日次KPIを割り振れます。");
      router.refresh();
    });
  };

  const compute = () => {
    if (!canEdit || busy) return;
    setBusy(true); setMsg("AIが売上目標から逆算しています…");
    (async () => {
      try {
        const r = await computeKgiPlan({ month });
        if (!r.ok) { setMsg(`計算失敗: ${r.error}`); return; }
        setMsg(r.usedAI ? "✓ AIが売上目標から週次/日次KPIを割り振りました。" : "✓ 逆算しました（AI未使用・既定の転換率）。");
        router.refresh();
      } catch (e) {
        setMsg(`計算失敗: ${e instanceof Error ? e.message : String(e)}`);
      } finally { setBusy(false); }
    })();
  };

  return (
    <div className="card" style={{ padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 14 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>月間売上目標（手動）</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input type="number" min={0} value={val} disabled={!canEdit || pending}
            onChange={(e) => setVal(e.target.value)} placeholder="例：4000"
            style={{ width: 140, fontSize: 18, fontWeight: 800, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", textAlign: "right", background: "var(--color-surface)", color: "var(--color-ink)" }} />
          <span style={{ fontSize: 14, fontWeight: 700 }}>万円</span>
        </span>
      </label>
      {canEdit && (
        <>
          <button type="button" className="btn" disabled={pending} onClick={saveTarget}>目標を保存</button>
          <button type="button" className="btn brand" disabled={busy || pending} onClick={compute}
            title="売上目標から、必要な提案数・面談数・稼働人数・打ち合わせ数をAIが逆算し、週次/日次に割り振ります。">
            <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>auto_awesome</span>
            {busy ? "計算中…" : hasPlan ? "AIで再計算" : "AIで週次/日次KPIを計算"}
          </button>
        </>
      )}
      {!canEdit && <span className="muted" style={{ fontSize: 12 }}>目標の設定は管理者/マネージャーのみ可能です。</span>}
      {msg && <span className="muted" style={{ fontSize: 12, flexBasis: "100%" }}>{msg}</span>}
    </div>
  );
}
