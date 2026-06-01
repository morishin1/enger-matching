"use client";

// 提案開始件数（created_at基準）の期間別集計バー。
//   - 既定で「本日/今週/今月/過去30日」を表示
//   - 「カスタム」で日付範囲ピッカーを開き /api/proposals/stats を呼んで集計
//   - 提案者別の内訳もホバー or 展開で表示
import { useEffect, useState } from "react";

export type ProposalStartStatsProps = {
  // SSR で計算済みの固定期間カウント（DB の正確な COUNT）
  today: number; week: number; month: number; thirty: number;
};

type Period = "today" | "week" | "month" | "thirty" | "custom";

function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function isoMinusDays(n: number) { const d = new Date(Date.now() - n * 24 * 3600 * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

export function ProposalStartStats({ today, week, month, thirty }: ProposalStartStatsProps) {
  const [period, setPeriod] = useState<Period>("today");
  const [from, setFrom] = useState<string>(todayStr());
  const [to, setTo] = useState<string>(todayStr());
  const [custom, setCustom] = useState<{ loading: boolean; count: number | null; byProposer: [string, number][]; error?: string }>({ loading: false, count: null, byProposer: [] });
  const [showProposer, setShowProposer] = useState(false);

  useEffect(() => {
    if (period !== "custom") return;
    const ctl = new AbortController();
    setCustom((s) => ({ ...s, loading: true, error: undefined }));
    fetch(`/api/proposals/stats?from=${from}&to=${to}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error || "取得に失敗しました");
        const by = Object.entries(d.byProposer ?? {}).sort((a: any, b: any) => b[1] - a[1]) as [string, number][];
        setCustom({ loading: false, count: d.count, byProposer: by });
      })
      .catch((e) => { if (e.name !== "AbortError") setCustom({ loading: false, count: null, byProposer: [], error: e.message }); });
    return () => ctl.abort();
  }, [period, from, to]);

  const cardCount = period === "today" ? today : period === "week" ? week : period === "month" ? month : period === "thirty" ? thirty : (custom.count ?? 0);
  const label = period === "today" ? "本日" : period === "week" ? "今週（直近7日）" : period === "month" ? "今月（直近30日）" : period === "thirty" ? "過去30日" : `${from} 〜 ${to}`;

  const Chip = ({ k, t, n }: { k: Period; t: string; n?: number }) => {
    const active = period === k;
    return (
      <button type="button" onClick={() => setPeriod(k)} style={{
        fontFamily: "inherit", fontSize: 12, padding: "5px 12px", borderRadius: 99,
        border: `1px solid ${active ? "var(--color-brand-600)" : "var(--color-border)"}`,
        background: active ? "var(--color-brand-600)" : "#fff",
        color: active ? "#fff" : "var(--color-ink-2)", fontWeight: active ? 700 : 600, cursor: "pointer",
      }}>
        {t}{typeof n === "number" && <span style={{ marginLeft: 6, opacity: 0.8 }}>{n}</span>}
      </button>
    );
  };

  return (
    <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--color-brand-700)" }}>rocket_launch</span>
          <span style={{ fontSize: 13, fontWeight: 800 }}>提案開始件数</span>
          <span className="muted" style={{ fontSize: 10.5 }}>created_at 基準・ステージ移動に左右されない</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Chip k="today"  t="本日"   n={today} />
          <Chip k="week"   t="今週"   n={week} />
          <Chip k="month"  t="今月"   n={month} />
          <Chip k="thirty" t="30日"   n={thirty} />
          <Chip k="custom" t="カスタム" />
        </div>
      </div>

      {period === "custom" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingTop: 4 }}>
          <label style={{ fontSize: 11.5, color: "var(--color-ink-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            開始 <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ fontFamily: "inherit", fontSize: 12, padding: "4px 7px", border: "1px solid var(--color-border-strong)", borderRadius: 6 }} />
          </label>
          <label style={{ fontSize: 11.5, color: "var(--color-ink-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            終了 <input type="date" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} style={{ fontFamily: "inherit", fontSize: 12, padding: "4px 7px", border: "1px solid var(--color-border-strong)", borderRadius: 6 }} />
          </label>
          <div style={{ display: "inline-flex", gap: 4 }}>
            {[
              { l: "昨日", f: () => { const y = isoMinusDays(1); setFrom(y); setTo(y); } },
              { l: "直近7日", f: () => { setFrom(isoMinusDays(6)); setTo(todayStr()); } },
              { l: "直近90日", f: () => { setFrom(isoMinusDays(89)); setTo(todayStr()); } },
            ].map((p) => (
              <button key={p.l} type="button" onClick={p.f} className="btn ghost btn-xs" style={{ fontSize: 11 }}>{p.l}</button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "6px 2px 0" }}>
        <span className="tnum" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: "var(--color-brand-700)" }}>
          {period === "custom" && custom.loading ? "…" : cardCount.toLocaleString()}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>件 ・ {label}</span>
        {period === "custom" && custom.error && <span style={{ fontSize: 11, color: "var(--color-danger)" }}>{custom.error}</span>}
        {period === "custom" && custom.byProposer.length > 0 && (
          <button type="button" onClick={() => setShowProposer((v) => !v)} className="btn ghost btn-xs" style={{ marginLeft: "auto", fontSize: 11 }}>
            {showProposer ? "提案者内訳を隠す" : "提案者内訳を表示"}
          </button>
        )}
      </div>

      {period === "custom" && showProposer && custom.byProposer.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 2 }}>
          {custom.byProposer.map(([name, n]) => (
            <span key={name} className="tag" style={{ fontSize: 11, background: "var(--color-brand-25)", color: "var(--color-brand-700)" }}>{name} <b style={{ marginLeft: 4 }}>{n}</b></span>
          ))}
        </div>
      )}
    </div>
  );
}
