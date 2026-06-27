"use client";

// 個人 KPI ダッシュボード UI。
//   ・期間タブ（日/週/月/四半期/カレンダー）
//   ・指標カード（達成率バー）
//   ・推移ライン（直近12期間の達成率%）
//   ・「目標を編集」モーダル（週次目標をフォームで保存）

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { METRIC_LABELS, METRIC_ORDER, type Metric, type PeriodType } from "@/lib/kpi";
import { saveKpiTargets } from "@/lib/actions";
import { KpiPeriodBar } from "./KpiPeriodBar";

type Snapshot = Record<Metric, { target: number; actual: number; pct: number }>;
type HistoryPoint = { label: string; pct: number; actual: number; target: number };
type HistoryRow = { label: string; start: string; cells: Record<Metric, { actual: number; target: number }> };

// 「前日」は UI 上の選択肢（サーバ側で day を前日基準に集計）。
type UiPeriod = PeriodType | "yesterday";
const PERIODS: { key: UiPeriod; label: string }[] = [
  { key: "day", label: "日" },
  { key: "yesterday", label: "前日" },
  { key: "week", label: "週" },
  { key: "month", label: "月" },
  { key: "quarter", label: "四半期" },
  { key: "custom", label: "任意（カレンダー）" },
];

const toneOf = (pct: number) => pct >= 100 ? "#067647" : pct >= 80 ? "#0095D9" : pct >= 50 ? "#b45309" : "#b42318";

// 集計期間を説明する注記。タブごとに表示（選択タブの期間そのままで集計＝累計しない）。
function periodNote(period: UiPeriod): string {
  if (period === "yesterday") return "前日（昨日）の実績・目標";
  if (period === "day")     return "選択した日（当日）の実績・目標";
  if (period === "week")    return "選択した週（月〜日）の実績・目標";
  if (period === "quarter") return "選択した四半期の実績・目標";
  if (period === "custom")  return "指定期間の実績・目標";
  return "選択した月の実績・目標"; // month
}

function fmtRange(startIso: string, endIso: string) {
  const s = new Date(startIso), e = new Date(new Date(endIso).getTime() - 1);
  const fmt = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  return s.toDateString() === e.toDateString() ? fmt(s) : `${fmt(s)} 〜 ${fmt(e)}`;
}

export function KpiDashboardClient(props: {
  access: { email: string; name: string | null; role: string; isManager?: boolean };
  target: { email: string; name: string };
  scope?: "person" | "team";
  members: { name: string; email: string }[];
  period: UiPeriod;
  range: { start: string; end: string };
  custom: { from: string; to: string } | null;
  snapshot: Snapshot;
  weeklyTargets: Partial<Record<Metric, number>>;
  weekStart: string;
  history: HistoryPoint[];
  historyTable?: HistoryRow[];
  historyPeriodLabel?: string;
  /** 期間タブを内蔵表示しない（上位で単一の期間バーを使う場合）。custom の日付入力は残す。 */
  hidePeriodTabs?: boolean;
}) {
  const router = useRouter();
  const isAdmin = props.access.role === "admin";
  const isManager = !!props.access.isManager;
  const isTeam = props.scope === "team";
  const [showEdit, setShowEdit] = useState(false);

  const setParam = (k: string, v: string | null) => {
    const u = new URL(window.location.href);
    if (v == null || v === "") u.searchParams.delete(k); else u.searchParams.set(k, v);
    router.push(u.pathname + "?" + u.searchParams.toString());
  };

  const overall = useMemo(() => {
    const items = METRIC_ORDER.map((m) => props.snapshot[m]).filter((x) => x.target > 0);
    if (items.length === 0) return 0;
    return Math.round(items.reduce((s, x) => s + x.pct, 0) / items.length);
  }, [props.snapshot]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "16px 18px" }}>
      {/* ヘッダ */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
          <span className="material-symbols-outlined" style={{ verticalAlign: "-5px", marginRight: 6, color: "var(--color-brand-600)" }}>insights</span>
          KPI &amp; KGI
        </h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {props.target.name || "(担当未設定)"} ／ {fmtRange(props.range.start, props.range.end)}
        </span>
        {isAdmin && props.members.length > 0 && !isTeam && (
          <select value={props.target.email} onChange={(e) => setParam("owner", e.target.value)}
            style={{ marginLeft: 6, fontSize: 12.5, padding: "5px 8px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }}>
            {props.members.map((m) => <option key={m.email} value={m.email}>{m.name}</option>)}
          </select>
        )}
        <div style={{ marginLeft: "auto" }}>
          {/* 目標編集は管理者／マネージャー（チーム役職 manager/leader）のみ。
              メンバー(team_role=member) は自分の目標であっても編集不可（運用ルール）。 */}
          {(isAdmin || isManager) && (
            <button type="button" className="btn" onClick={() => setShowEdit(true)}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>tune</span>
              目標を編集（週次）
            </button>
          )}
        </div>
      </div>

      {/* チーム / 個人 タブ（全員が切替可能・既定はチーム） */}
      <div style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--color-surface-soft)", borderRadius: 10, alignSelf: "flex-start" }}>
        {([
          { key: "team", label: "チーム", icon: "groups" },
          { key: "person", label: "個人", icon: "person" },
        ] as const).map((t) => {
          const on = t.key === "team" ? isTeam : !isTeam;
          return (
            <button key={t.key} type="button"
              onClick={() => setParam("owner", t.key === "team" ? "__team__" : (props.access.email))}
              style={{ padding: "6px 14px", borderRadius: 8, border: 0, cursor: "pointer",
                background: on ? "var(--color-surface)" : "transparent",
                color: on ? "var(--color-brand-700)" : "var(--color-ink-3)",
                fontWeight: on ? 800 : 600, fontSize: 13,
                boxShadow: on ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 期間バー（統一デザインの6チップ＋全期間カレンダー）。
          ダッシュボード(/)でのみ表示。提案管理のKPI推移は上位(ProposalsWorkspace)が
          KpiPeriodBar を別途出すため hidePeriodTabs=true で非表示にする。 */}
      {!props.hidePeriodTabs && <KpiPeriodBar current={props.period} basePath="/" card={false} />}

      {/* 総合達成率 */}
      <div className="card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>総合達成率</div>
          <div className="mono" style={{ fontSize: 32, fontWeight: 800, color: toneOf(overall) }}>{overall}%</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ height: 10, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(overall, 100)}%`, height: "100%", background: toneOf(overall), borderRadius: 99, transition: "width .3s" }} />
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            目標が設定されている指標の達成率の平均（参考値）
          </div>
        </div>
      </div>

      {/* 指標カード（選択タブの期間そのままで集計） */}
      <div className="muted" style={{ fontSize: 11.5, marginTop: -6 }}>
        {periodNote(props.period)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {METRIC_ORDER.map((m) => {
          const s = props.snapshot[m];
          const lab = METRIC_LABELS[m];
          const tone = s.target > 0 ? toneOf(s.pct) : "#94a3b8";
          return (
            <div key={m} className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: lab.tone }}>{lab.short}</span>
                <span className="muted" style={{ fontSize: 11 }}>{lab.long}</span>
                <span className="mono" style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: tone }}>
                  {s.target > 0 ? `${s.pct}%` : "—"}
                </span>
              </div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
                {s.actual}<span style={{ fontSize: 12, color: "var(--color-ink-4)", fontWeight: 500 }}> / {s.target}</span>
              </div>
              <div style={{ height: 6, background: "var(--color-surface-inset)", borderRadius: 99, marginTop: 8, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(s.pct, 100)}%`, height: "100%", background: tone, borderRadius: 99 }} />
              </div>
              {s.target > 0 && s.actual < s.target && (
                <div style={{ fontSize: 11, color: "var(--color-ink-4)", marginTop: 6 }}>あと {s.target - s.actual} 件</div>
              )}
            </div>
          );
        })}
      </div>

      {/* 推移グラフ */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>達成率の推移（直近12{PERIODS.find((p) => p.key === (props.period === "custom" ? "week" : props.period === "yesterday" ? "day" : props.period))?.label}）</span>
          <span className="muted" style={{ fontSize: 11 }}>指標: 提案 ／ 各期間単体の達成率</span>
        </div>
        <HistoryChart data={props.history} />
      </div>

      {/* 推移テーブル（全指標 × 期間の実績/目標）。月次/年次の数値を表で確認できる。 */}
      {props.historyTable && props.historyTable.length > 0 && (
        <HistoryTable rows={props.historyTable} periodLabel={props.historyPeriodLabel ?? ""} teamName={isTeam ? "チーム全体" : props.target.name} />
      )}

      {showEdit && (
        <EditTargetModal
          weekStart={props.weekStart}
          scope={isTeam ? "team" : "person"}
          ownerEmail={isTeam ? "" : props.target.email} ownerName={props.target.name}
          initial={props.weeklyTargets}
          onClose={() => setShowEdit(false)}
        />
      )}
    </div>
  );
}

// 全指標 × 期間の実績/目標を一覧表で表示。新しい期間が右に来るよう逆順に並べる。
function HistoryTable({ rows, periodLabel, teamName }: { rows: HistoryRow[]; periodLabel: string; teamName: string }) {
  const ordered = [...rows].reverse(); // 直近を上に
  const th: React.CSSProperties = { padding: "7px 10px", textAlign: "right", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, whiteSpace: "nowrap", background: "var(--color-surface-soft)" };
  const td: React.CSSProperties = { padding: "6px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap" };
  return (
    <div className="card flush" style={{ overflowX: "auto" }}>
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "baseline", gap: 8, borderBottom: "1px solid var(--color-border)" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>📋 実績の推移表</span>
        <span className="muted" style={{ fontSize: 11 }}>{teamName} ／ {periodLabel}ごと（実績 / 目標）。各期間単体の数値。</span>
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>期間</th>
            {METRIC_ORDER.map((m) => (
              <th key={m} style={{ ...th, color: METRIC_LABELS[m].tone }}>{METRIC_LABELS[m].short}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => (
            <tr key={r.start}>
              <td style={{ ...td, textAlign: "left", fontFamily: "inherit", fontWeight: 700 }}>{r.label}</td>
              {METRIC_ORDER.map((m) => {
                const c = r.cells[m];
                const hit = c.target > 0 && c.actual >= c.target;
                return (
                  <td key={m} style={{ ...td, color: hit ? "#067647" : "var(--color-ink)" }}>
                    <b>{c.actual}</b>
                    <span style={{ color: "var(--color-ink-4)", fontSize: 10.5 }}> / {c.target || "—"}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryChart({ data }: { data: HistoryPoint[] }) {
  if (data.length === 0) return <div className="muted" style={{ fontSize: 12 }}>データなし</div>;
  const W = 720, H = 160, P = 26;
  const innerW = W - P * 2, innerH = H - P * 2;
  const maxY = Math.max(120, ...data.map((d) => d.pct));
  const step = innerW / Math.max(1, data.length - 1);
  const points = data.map((d, i) => {
    const x = P + i * step;
    const y = P + innerH - (Math.min(d.pct, maxY) / maxY) * innerH;
    return { x, y, ...d };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const targetY = P + innerH - (100 / maxY) * innerH;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxHeight: 200 }}>
        <line x1={P} y1={targetY} x2={W - P} y2={targetY} stroke="#0095D9" strokeDasharray="4 4" opacity="0.6" />
        <text x={W - P} y={targetY - 4} textAnchor="end" fontSize="9" fill="#0095D9">目標 100%</text>
        <path d={path} fill="none" stroke="#0095D9" strokeWidth="2" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.5} fill={toneOf(p.pct)} />
            <text x={p.x} y={H - 6} textAnchor="middle" fontSize="9.5" fill="#64748b">{p.label}</text>
            <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="9.5" fill={toneOf(p.pct)} fontWeight="700">{p.pct}%</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function EditTargetModal(props: {
  weekStart: string;
  scope?: "person" | "team";
  ownerEmail: string; ownerName: string;
  initial: Partial<Record<Metric, number>>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<Metric, string>>(() => {
    const o: Record<Metric, string> = {} as any;
    for (const m of METRIC_ORDER) o[m] = String(props.initial[m] ?? "");
    return o;
  });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const save = () => {
    start(async () => {
      const targets: Partial<Record<Metric, number>> = {};
      for (const m of METRIC_ORDER) {
        const n = Number(vals[m]);
        if (Number.isFinite(n) && n >= 0) targets[m] = Math.floor(n);
      }
      const r = props.scope === "team"
        ? await saveKpiTargets({ scope: "team", teamKey: "its", weekStart: props.weekStart, targets })
        : await saveKpiTargets({ scope: "person", ownerEmail: props.ownerEmail, ownerName: props.ownerName, weekStart: props.weekStart, targets });
      if (!r.ok) { setMsg(`保存失敗: ${r.error}`); return; }
      setMsg("✓ 保存しました");
      router.refresh();
      setTimeout(() => props.onClose(), 800);
    });
  };

  return (
    <div onClick={props.onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(520px, 92vw)", padding: 18 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>週次目標を編集</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {props.ownerName} ／ 週開始 {props.weekStart}（月曜）
        </p>
        {/* ラベルを入力欄の上に積む（長いラベルでも横にはみ出さずモーダル枠内に収める）。 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
          {METRIC_ORDER.map((m) => (
            <label key={m} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, minWidth: 0 }}>
              <span style={{ color: METRIC_LABELS[m].tone, fontWeight: 700, lineHeight: 1.3 }}>
                {METRIC_LABELS[m].short} <span style={{ color: "var(--color-ink-4)", fontWeight: 400, fontSize: 11 }}>({METRIC_LABELS[m].long})</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <input type="number" min={0} value={vals[m]} onChange={(e) => setVals((v) => ({ ...v, [m]: e.target.value }))}
                  style={{ flex: 1, minWidth: 0, fontSize: 13, padding: "6px 9px", borderRadius: 6, border: "1px solid var(--color-border-strong)", textAlign: "right", fontFamily: "monospace" }} />
                <span style={{ fontSize: 11, color: "var(--color-ink-4)", whiteSpace: "nowrap" }}>件/週</span>
              </span>
            </label>
          ))}
        </div>
        {msg && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>{msg}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="btn" onClick={props.onClose} disabled={pending}>キャンセル</button>
          <button type="button" className="btn brand" onClick={save} disabled={pending}>保存</button>
        </div>
      </div>
    </div>
  );
}
