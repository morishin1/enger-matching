"use client";

// #308：週次カレンダーの「実績」を手動で補正できる編集UI（管理者/マネージャーのみ）。
//   ・初期値＝現在の実効実績（上書きがあればその値、無ければ提案管理/打ち合わせからの自動集計）。
//   ・保存すると week_actual_overrides に保存され、週次カレンダー／合計の実績に反映される。
//   ・「自動集計に戻す」で上書きを消し、提案管理/打ち合わせからの自動集計へ戻す。
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { saveKgiWeekActualOverrides } from "@/lib/kgi-plan-actions";
import type { KgiWeekOverrides } from "@/lib/kgi-plan";

type WeekMeta = { index: number; label: string };
const KPIS: { key: keyof KgiWeekOverrides; label: string }[] = [
  { key: "proposal", label: "提案" },
  { key: "meeting", label: "面談" },
  { key: "placement", label: "稼働" },
  { key: "appointment", label: "打合せ" },
];

export function KgiWeekActualEditor({ month, weeks, effective, hasOverrides }: {
  month: string;
  weeks: WeekMeta[];
  /** 現在の実効実績（KPIキー→週配列）。上書き優先・無ければ自動集計値。入力の初期値に使う。 */
  effective: Record<string, number[]>;
  /** 既に上書きが保存されているか（バッジ表示用）。 */
  hasOverrides: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  // vals[kpiKey][weekIndex] = 文字列（入力欄）。初期値は実効実績を丸めた値。
  const init = useMemo(() => {
    const o: Record<string, string[]> = {};
    for (const k of KPIS) o[k.key] = weeks.map((_, wi) => String(Math.round(effective[k.key]?.[wi] ?? 0)));
    return o;
  }, [weeks, effective]);
  const [vals, setVals] = useState<Record<string, string[]>>(init);
  const setCell = (key: string, wi: number, v: string) =>
    setVals((s) => ({ ...s, [key]: s[key].map((x, i) => (i === wi ? v.replace(/[^0-9]/g, "") : x)) }));

  const colTotal = (key: string) => vals[key].reduce((s, v) => s + (Number(v) || 0), 0);

  const save = () => {
    start(async () => {
      const overrides: KgiWeekOverrides = {};
      for (const k of KPIS) overrides[k.key] = vals[k.key].map((v) => (v === "" ? null : Number(v)));
      const r = await saveKgiWeekActualOverrides({ month, overrides });
      if (!r.ok) { toast(r.error || "保存に失敗しました", "error"); return; }
      toast("週次実績を保存しました", "success");
      setOpen(false);
      router.refresh();
    });
  };
  const reset = () => {
    if (!confirm("週次実績の手動補正を消して、提案管理/打ち合わせからの自動集計に戻しますか？")) return;
    start(async () => {
      const r = await saveKgiWeekActualOverrides({ month, overrides: null });
      if (!r.ok) { toast(r.error || "初期化に失敗しました", "error"); return; }
      toast("自動集計に戻しました", "success");
      setOpen(false);
      router.refresh();
    });
  };

  const inp: React.CSSProperties = { width: 56, fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, textAlign: "right", padding: "5px 6px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" };

  return (
    <div style={{ borderBottom: open ? "1px solid var(--color-border)" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", flexWrap: "wrap" }}>
        <button type="button" className="btn ghost btn-xs" onClick={() => { setVals(init); setOpen((v) => !v); }}
          title="各週の実績数値を手動で補正します（提案管理/打ち合わせの自動集計を上書き）">
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 15, verticalAlign: "-3px", marginRight: 3 }}>edit_note</span>
          {open ? "閉じる" : "実績を手動補正"}
        </button>
        {hasOverrides && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: "#eef2ff", color: "#3730a3", border: "1px solid #c7d2fe" }}>手動補正あり</span>}
        <span className="muted" style={{ fontSize: 10.5 }}>各週の実績を直接入力できます（未入力/0は自動集計にフォールバック）。</span>
      </div>

      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>KPI＼週</th>
                  {weeks.map((w) => <th key={w.index} style={{ padding: "6px 8px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, textAlign: "right" }}>W{w.index}<div className="muted" style={{ fontSize: 9.5, fontWeight: 500 }}>{w.label}</div></th>)}
                  <th style={{ padding: "6px 10px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, textAlign: "right" }}>合計</th>
                </tr>
              </thead>
              <tbody>
                {KPIS.map((k) => (
                  <tr key={k.key}>
                    <td style={{ padding: "5px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>{k.label}</td>
                    {weeks.map((w, wi) => (
                      <td key={w.index} style={{ padding: "4px 6px", textAlign: "right" }}>
                        <input inputMode="numeric" value={vals[k.key][wi] ?? ""} onChange={(e) => setCell(k.key, wi, e.target.value)} style={inp} />
                      </td>
                    ))}
                    <td className="mono" style={{ padding: "5px 10px", textAlign: "right", fontWeight: 800, color: "var(--color-ink-3)" }}>{colTotal(k.key)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn brand btn-sm" disabled={pending} onClick={save}>{pending ? "保存中…" : "週次実績を保存"}</button>
            <button type="button" className="btn ghost btn-sm" disabled={pending} onClick={reset}>自動集計に戻す</button>
            <span className="muted" style={{ fontSize: 10.5 }}>※ 提案管理・打ち合わせの記録が正なので、通常は自動集計のままで構いません。集計漏れの補正用です。</span>
          </div>
        </div>
      )}
    </div>
  );
}
