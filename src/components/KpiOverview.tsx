"use client";

// KPI推移の概要（/kpi 最上部）。3ブロックで「チーム目標→役割→各メンバーの今日」を一目に。
//   ① チーム目標ファネル（提案→面談→稼働。目標 vs 今月実績・転換率）
//   ② 役割別 KGI/KPI 早見表（アウトサイド/インサイド/テレアポ）＋読み方
//   ③ メンバー別「今日のKPI/KGI」（役割別グループ・当日実績 vs 日次目標）
import { useState, useTransition } from "react";
import { ROLE_DEFS, ROLE_LABEL, FUNNEL_NOTES, funnelTargetCounts, type KpiRoleKey, type FunnelTarget } from "@/lib/kpi-roles";
import { setMemberKpiRole, saveKpiFunnelTarget } from "@/lib/kpi-roles-actions";
import { useRouter } from "next/navigation";

type MetricSet = { proposal: number; contact: number; adjusting: number; schedule: number; deal: number };
export type MemberToday = { name: string; email: string | null; kpiRole: KpiRoleKey | null; actual: MetricSet; target: MetricSet };

const pctText = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export function KpiOverview({
  funnelTarget, funnelActual, members, canManage,
}: {
  funnelTarget: FunnelTarget;
  funnelActual: { proposal: number; meeting: number; won: number };
  members: MemberToday[];
  canManage: boolean;
}) {
  const router = useRouter();
  const tgt = funnelTargetCounts(funnelTarget);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FunnelBlock target={funnelTarget} tgtCounts={tgt} actual={funnelActual} canManage={canManage} onSaved={() => router.refresh()} />
      <RoleReference members={members} />
      <TodayBoard members={members} canManage={canManage} onChanged={() => router.refresh()} />
    </div>
  );
}

// ── ① チーム目標ファネル ──────────────────────────────
function FunnelBlock({ target, tgtCounts, actual, canManage, onSaved }: {
  target: FunnelTarget; tgtCounts: { proposal: number; meeting: number; won: number };
  actual: { proposal: number; meeting: number; won: number }; canManage: boolean; onSaved: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [won, setWon] = useState(String(target.won));
  const [mr, setMr] = useState(String(Math.round(target.meetingRate * 100)));
  const [pr, setPr] = useState(String(Math.round(target.passRate * 100)));
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    setErr(null);
    start(async () => {
      const r = await saveKpiFunnelTarget({ won: Number(won), meetingRate: Number(mr), passRate: Number(pr) });
      if (!r.ok) { setErr(r.error || "保存に失敗しました"); return; }
      setEdit(false); onSaved();
    });
  };

  const Stage = ({ label, actualN, targetN, color }: { label: string; actualN: number; targetN: number; color: string }) => (
    <div style={{ flex: 1, minWidth: 110, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "12px 14px", textAlign: "center" }}>
      <div style={{ fontSize: 11.5, color: "var(--color-ink-4)", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1.2, fontFamily: "var(--font-display)" }}>
        {actualN}<span style={{ fontSize: 13, color: "var(--color-ink-4)", fontWeight: 700 }}> / {targetN}</span>
      </div>
      <div className="muted" style={{ fontSize: 10.5 }}>今月実績 / 目標 ({pctText(actualN, targetN)})</div>
    </div>
  );
  const Arrow = ({ label, actualRate, targetRate }: { label: string; actualRate: string; targetRate: string }) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 4px", minWidth: 84 }}>
      <div style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--color-ink-2)" }}>{actualRate}</div>
      <div className="muted" style={{ fontSize: 10 }}>目標 {targetRate}</div>
      <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--color-ink-5)" }}>arrow_forward</span>
    </div>
  );

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>チーム目標（KGI）= 月 {target.won} 稼働</h3>
        <span className="muted" style={{ fontSize: 11.5 }}>提案 → 面談 → 稼働 のファネルで「どこで詰まっているか」を見る</span>
        {canManage && !edit && <button type="button" className="btn ghost btn-xs" style={{ marginLeft: "auto" }} onClick={() => setEdit(true)}>目標を編集</button>}
      </div>

      {edit ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", background: "var(--color-surface-inset)", borderRadius: 10, padding: 12 }}>
          <label style={{ fontSize: 11, color: "var(--color-ink-4)", display: "flex", flexDirection: "column", gap: 3 }}>月の稼働目標
            <input type="number" min={1} value={won} onChange={(e) => setWon(e.target.value)} style={inp} />
          </label>
          <label style={{ fontSize: 11, color: "var(--color-ink-4)", display: "flex", flexDirection: "column", gap: 3 }}>面談率(%)（提案→面談）
            <input type="number" min={1} max={100} value={mr} onChange={(e) => setMr(e.target.value)} style={inp} />
          </label>
          <label style={{ fontSize: 11, color: "var(--color-ink-4)", display: "flex", flexDirection: "column", gap: 3 }}>合格率(%)（面談→稼働）
            <input type="number" min={1} max={100} value={pr} onChange={(e) => setPr(e.target.value)} style={inp} />
          </label>
          <button type="button" className="btn btn-xs" disabled={pending} onClick={save}>{pending ? "保存中…" : "保存"}</button>
          <button type="button" className="btn ghost btn-xs" disabled={pending} onClick={() => setEdit(false)}>キャンセル</button>
          {err && <span style={{ fontSize: 11, color: "var(--color-danger)" }}>{err}</span>}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "stretch", gap: 6, flexWrap: "wrap" }}>
          <Stage label="提案" actualN={actual.proposal} targetN={tgtCounts.proposal} color="#0b5cab" />
          <Arrow label="面談率" actualRate={pctText(actual.meeting, actual.proposal)} targetRate={`${Math.round(target.meetingRate * 100)}%`} />
          <Stage label="面談" actualN={actual.meeting} targetN={tgtCounts.meeting} color="#7c3aed" />
          <Arrow label="合格率" actualRate={pctText(actual.won, actual.meeting)} targetRate={`${Math.round(target.passRate * 100)}%`} />
          <Stage label="稼働" actualN={actual.won} targetN={tgtCounts.won} color="#067647" />
        </div>
      )}
    </div>
  );
}

// ── ② 役割別 KGI/KPI 早見表 ──────────────────────────
function RoleReference({ members }: { members: MemberToday[] }) {
  const countOf = (key: KpiRoleKey) => members.filter((m) => m.kpiRole === key).length;
  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>役割別 KGI / KPI</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {ROLE_DEFS.map((r) => (
          <div key={r.key} style={{ border: `1px solid ${r.accent}33`, borderTop: `3px solid ${r.accent}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8, background: "var(--color-surface)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: r.accent }}>{r.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: `${r.accent}1a`, color: r.accent }}>{countOf(r.key)}名</span>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-3)", lineHeight: 1.6 }}>{r.summary}</div>
            <div style={{ background: "var(--color-surface-inset)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 700 }}>KGI（成果）</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-ink)" }}>{r.kgi}</div>
              {r.kgiUnit && <div className="muted" style={{ fontSize: 11 }}>{r.kgiUnit}</div>}
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 700, marginBottom: 4 }}>KPI（やること）</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: "var(--color-ink-2)", lineHeight: 1.7 }}>
                {r.kpis.map((k, i) => <li key={i}>{k}</li>)}
              </ul>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 10, padding: "10px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-3)", marginBottom: 4 }}>読み方</div>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: "var(--color-ink-2)", lineHeight: 1.8 }}>
          {FUNNEL_NOTES.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      </div>
    </div>
  );
}

// ── ③ メンバー別「今日のKPI/KGI」 ────────────────────
function TodayBoard({ members, canManage, onChanged }: { members: MemberToday[]; canManage: boolean; onChanged: () => void }) {
  const groups: { key: KpiRoleKey | "none"; label: string }[] = [
    ...ROLE_DEFS.map((r) => ({ key: r.key, label: r.label })),
    { key: "none" as const, label: "未割当" },
  ];
  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>メンバー別「今日のKPI/KGI」</h3>
      {groups.map((g) => {
        const ms = members.filter((m) => (g.key === "none" ? !m.kpiRole : m.kpiRole === g.key));
        if (ms.length === 0) return null;
        const def = ROLE_DEFS.find((r) => r.key === g.key);
        const metrics = def?.metrics ?? [{ metric: "proposal" as const, label: "提案" }, { metric: "schedule" as const, label: "面談" }, { metric: "deal" as const, label: "合格/稼働" }];
        return (
          <div key={g.key}>
            <div style={{ fontSize: 12, fontWeight: 700, color: def?.accent ?? "var(--color-ink-3)", marginBottom: 6 }}>{g.label} <span className="muted" style={{ fontWeight: 400 }}>（{ms.length}名）</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ms.map((m) => (
                <div key={(m.email ?? m.name)} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 12px", border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-surface)" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, minWidth: 96 }}>{m.name}</span>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", flex: 1 }}>
                    {metrics.map(({ metric, label }) => {
                      const a = m.actual[metric]; const t = m.target[metric];
                      const hit = t > 0 && a >= t;
                      return (
                        <span key={metric} style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
                          <span style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>{label}</span>
                          <span style={{ fontSize: 16, fontWeight: 800, color: hit ? "#067647" : "var(--color-ink)" }}>{a}</span>
                          <span style={{ fontSize: 11, color: "var(--color-ink-4)" }}>/ {t || "—"}</span>
                        </span>
                      );
                    })}
                  </div>
                  {canManage && (
                    <RoleSelect email={m.email} current={m.kpiRole} onChanged={onChanged} />
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {members.length === 0 && <div className="muted" style={{ fontSize: 12 }}>対象メンバーがいません。</div>}
    </div>
  );
}

function RoleSelect({ email, current, onChanged }: { email: string | null; current: KpiRoleKey | null; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [val, setVal] = useState<string>(current ?? "");
  if (!email) return null;
  const change = (next: string) => {
    setVal(next);
    start(async () => { const r = await setMemberKpiRole(email, next as KpiRoleKey | ""); if (r.ok) onChanged(); });
  };
  return (
    <select value={val} disabled={pending} onChange={(e) => change(e.target.value)} title="役割を設定"
      style={{ fontSize: 11, padding: "3px 6px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
      <option value="">役割なし</option>
      {(Object.keys(ROLE_LABEL) as KpiRoleKey[]).map((k) => <option key={k} value={k}>{ROLE_LABEL[k]}</option>)}
    </select>
  );
}

const inp: React.CSSProperties = { width: 90, fontSize: 13, padding: "5px 8px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "inherit" };
