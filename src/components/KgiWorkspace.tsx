"use client";

// 個人KGI設定の統合ワークスペース。
//   ① チーム目標（部署全体）：KPI項目ごとに部署の月次目標を入力（定番カタログ＋カスタム）。
//   ② 「メンバーへ均等配分」：人数で割って各メンバー行に自動入力 → 手動で微調整。
//   ③ メンバー別KPI：項目ごとに月次目標を入力し、月→週→日のペース（稼働化は提案数に逆算）を表示。
//   保存：チーム目標は app_settings、メンバー別は person_kgi（複数KPIは targets に保存）。

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTeamGoal } from "@/lib/team-kgi-goals-actions";
import { savePersonKgi, savePersonKgiBulk } from "@/lib/person-kgi-actions";
import { planFromTarget } from "@/lib/person-kgi";
import { KPI_CATALOG, PLACEMENT_KEY, resolveMetric, makeCustomKey, cadence, type KpiMetric } from "@/lib/kpi-metrics";
import type { TeamGoal } from "@/lib/team-kgi-goals";

const fmtDateTime = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

type MemberInfo = { email: string; name: string; teamRole: string | null };
type PersonInit = { targets: Record<string, number>; note: string | null; updated_at: string | null; updated_by_name: string | null };

export function KgiWorkspace({ department, month, members, conv, bizDays, initialTeamGoal, initialPersons }: {
  department: string;
  month: string;
  members: MemberInfo[];
  conv: number | null;
  bizDays: number;
  initialTeamGoal: TeamGoal | null;
  initialPersons: Record<string, PersonInit>;
}) {
  const router = useRouter();

  // ① 活動中のKPI項目（順序つき）。未設定時は稼働化のみ。
  const [items, setItems] = useState<KpiMetric[]>(
    initialTeamGoal?.items?.length
      ? initialTeamGoal.items.map((i) => ({ key: i.key, label: i.label, unit: i.unit }))
      : [KPI_CATALOG[0]]
  );
  // チーム目標値（key→文字列）
  const [teamVals, setTeamVals] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const i of initialTeamGoal?.items ?? []) m[i.key] = i.team == null ? "" : String(i.team);
    return m;
  });
  const [teamNote, setTeamNote] = useState(initialTeamGoal?.note ?? "");

  // ③ メンバー別目標（email → key → 文字列）／メモ
  const [memberVals, setMemberVals] = useState<Record<string, Record<string, string>>>(() => {
    const m: Record<string, Record<string, string>> = {};
    for (const mem of members) {
      const row: Record<string, string> = {};
      const t = initialPersons[mem.email]?.targets ?? {};
      for (const [k, v] of Object.entries(t)) row[k] = v == null ? "" : String(v);
      m[mem.email] = row;
    }
    return m;
  });
  const [memberNotes, setMemberNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(members.map((mem) => [mem.email, initialPersons[mem.email]?.note ?? ""]))
  );

  const [teamMsg, setTeamMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [bulkMsg, setBulkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const count = members.length;

  // 項目操作 ---------------------------------------------------------------
  const addMetric = (m: KpiMetric) => {
    if (items.some((i) => i.key === m.key)) return;
    setItems((xs) => [...xs, m]);
  };
  const addCustom = () => {
    const label = (window.prompt("カスタム項目の名前（例：アポ獲得）") ?? "").trim();
    if (!label) return;
    const unit = (window.prompt("単位（例：件 / 万円 / 社）", "件") ?? "件").trim() || "件";
    const key = makeCustomKey(label);
    if (items.some((i) => i.key === key)) return;
    setItems((xs) => [...xs, { key, label, unit }]);
  };
  const removeMetric = (key: string) => {
    setItems((xs) => xs.filter((i) => i.key !== key));
  };

  const catalogRemaining = useMemo(() => KPI_CATALOG.filter((m) => !items.some((i) => i.key === m.key)), [items]);

  // 均等配分 ---------------------------------------------------------------
  const allocate = () => {
    setMemberVals((prev) => {
      const next: Record<string, Record<string, string>> = {};
      for (const mem of members) {
        const row = { ...(prev[mem.email] ?? {}) };
        for (const it of items) {
          const team = numOrNull(teamVals[it.key] ?? "");
          if (team != null && count > 0) row[it.key] = String(Math.round(team / count));
        }
        next[mem.email] = row;
      }
      return next;
    });
    setBulkMsg({ ok: true, text: `チーム目標を ${count} 名へ均等配分しました（保存は「全員を保存」）` });
  };

  // 保存 -------------------------------------------------------------------
  const saveTeam = () => {
    setTeamMsg(null);
    start(async () => {
      const res = await saveTeamGoal({
        department, month,
        items: items.map((i) => ({ key: i.key, label: i.label, unit: i.unit, team: numOrNull(teamVals[i.key] ?? "") })),
        note: teamNote.trim() || null,
      });
      if (res.ok) { setTeamMsg({ ok: true, text: "チーム目標を保存しました" }); router.refresh(); }
      else setTeamMsg({ ok: false, text: res.error || "保存に失敗しました" });
    });
  };

  const buildTargets = (email: string): Record<string, number | null> => {
    const row = memberVals[email] ?? {};
    const t: Record<string, number | null> = {};
    for (const it of items) t[it.key] = numOrNull(row[it.key] ?? "");
    return t;
  };

  const saveMember = (mem: MemberInfo) => {
    setRowMsg((m) => ({ ...m, [mem.email]: undefined as any }));
    start(async () => {
      const res = await savePersonKgi({
        owner_email: mem.email, owner_name: mem.name, month,
        targets: buildTargets(mem.email),
        note: (memberNotes[mem.email] ?? "").trim() || null,
      });
      setRowMsg((m) => ({ ...m, [mem.email]: { ok: res.ok, text: res.ok ? "保存しました" : (res.error || "失敗") } }));
      if (res.ok) router.refresh();
    });
  };

  const saveAll = () => {
    setBulkMsg(null);
    start(async () => {
      const res = await savePersonKgiBulk(members.map((mem) => ({
        owner_email: mem.email, owner_name: mem.name, month,
        targets: buildTargets(mem.email),
        note: (memberNotes[mem.email] ?? "").trim() || null,
      })));
      if (res.ok) { setBulkMsg({ ok: true, text: `全員（${count}名）のKPIを保存しました` }); router.refresh(); }
      else setBulkMsg({ ok: false, text: res.error || "保存に失敗しました" });
    });
  };

  // ペース表示（稼働化は提案数へ逆算、その他は単純按分） -----------------------
  const paceFor = (key: string, value: number | null): { month: number | null; week: number | null; day: number | null; reverse: boolean } => {
    if (value == null || value <= 0) return { month: null, week: null, day: null, reverse: key === PLACEMENT_KEY };
    if (key === PLACEMENT_KEY) {
      const p = planFromTarget(value, conv, month);
      return { month: p.monthlyProposals, week: p.weeklyProposals, day: p.dailyProposals, reverse: true };
    }
    const c = cadence(value, bizDays);
    return { ...c, reverse: false };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ① チーム目標（部署全体） */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🎯 チーム目標（{department}・部署全体）</h3>
          {teamMsg && <span style={{ fontSize: 12, color: teamMsg.ok ? "#067647" : "var(--color-danger)" }}>{teamMsg.ok ? "✓ " : "⚠ "}{teamMsg.text}</span>}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((it) => {
            const team = numOrNull(teamVals[it.key] ?? "");
            const per = team != null && count > 0 ? Math.round(team / count) : null;
            return (
              <div key={it.key} style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) 140px 1fr auto", gap: 12, alignItems: "center", padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: 10, background: it.key === PLACEMENT_KEY ? "var(--color-brand-25)" : "var(--color-surface)" }}>
                <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  {it.label}
                  {it.key === PLACEMENT_KEY && <span className="badge" style={{ fontSize: 9, padding: "1px 6px" }}>KGI中心</span>}
                </div>
                <div style={{ position: "relative" }}>
                  <input type="number" inputMode="decimal" step="any" min={0} value={teamVals[it.key] ?? ""}
                    onChange={(e) => setTeamVals((m) => ({ ...m, [it.key]: e.target.value }))} placeholder="部署目標"
                    style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 36px 8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
                  <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--color-ink-4)" }}>{it.unit}</span>
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {per != null ? <>1人あたり <b className="mono" style={{ color: "var(--color-ink)" }}>{per}</b>{it.unit}（{count}名で均等割）</> : `${count}名へ配分対象`}
                </div>
                <button type="button" className="btn ghost btn-xs" onClick={() => removeMetric(it.key)} title="この項目を外す" style={{ color: "var(--color-ink-4)" }}>✕</button>
              </div>
            );
          })}
          {items.length === 0 && <div className="muted" style={{ fontSize: 12 }}>KPI項目がありません。下のボタンから追加してください。</div>}
        </div>

        {/* 項目追加 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <span className="meta">項目を追加：</span>
          {catalogRemaining.map((m) => (
            <button key={m.key} type="button" className="btn ghost btn-xs" onClick={() => addMetric(m)}>＋ {m.label}</button>
          ))}
          <button type="button" className="btn ghost btn-xs" onClick={addCustom} style={{ borderStyle: "dashed" }}>＋ カスタム項目…</button>
        </div>

        {/* メモ＋保存＋配分 */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 220 }}>
            <span className="meta">メモ（任意）</span>
            <input type="text" value={teamNote} onChange={(e) => setTeamNote(e.target.value)} placeholder="部署の方針・補足など"
              style={{ width: "100%", fontFamily: "inherit", fontSize: 12.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
          </label>
          <button type="button" className="btn ghost" disabled={pending} onClick={saveTeam}>チーム目標を保存</button>
          <button type="button" className="btn brand" disabled={pending || count === 0} onClick={allocate} title="部署目標を人数で割って各メンバーに自動入力">
            <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>group</span>
            メンバーへ均等配分
          </button>
        </div>
        {initialTeamGoal?.updated_at && (
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>
            最終更新 {fmtDateTime(initialTeamGoal.updated_at)}{initialTeamGoal.updated_by_name ? ` ・ ${initialTeamGoal.updated_by_name}` : ""}
          </div>
        )}
      </div>

      {/* ③ メンバー別KPI */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>👥 {department} メンバー別KPI</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {bulkMsg && <span style={{ fontSize: 12, color: bulkMsg.ok ? "#067647" : "var(--color-danger)" }}>{bulkMsg.ok ? "✓ " : "⚠ "}{bulkMsg.text}</span>}
            <button type="button" className="btn brand btn-sm" disabled={pending || count === 0} onClick={saveAll}>全員を保存</button>
          </div>
        </div>

        {count === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>{department} に所属する active なメンバーがいません。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {members.map((mem) => {
              const init = initialPersons[mem.email];
              const msg = rowMsg[mem.email];
              return (
                <div key={mem.email} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, background: "var(--color-surface)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{mem.name}</div>
                      <div className="muted" style={{ fontSize: 10.5 }}>
                        {mem.email}{mem.teamRole === "manager" ? " ・ マネージャー" : mem.teamRole === "leader" ? " ・ リーダー" : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {msg && <span style={{ fontSize: 11, color: msg.ok ? "#067647" : "var(--color-danger)" }}>{msg.ok ? "✓ " : "⚠ "}{msg.text}</span>}
                      {init?.updated_at && <span className="muted" style={{ fontSize: 10 }}>更新 {fmtDateTime(init.updated_at)}{init.updated_by_name ? ` ・ ${init.updated_by_name}` : ""}</span>}
                      <button type="button" className="btn ghost btn-xs" disabled={pending} onClick={() => saveMember(mem)} style={{ height: 30 }}>保存</button>
                    </div>
                  </div>

                  {items.length === 0 ? (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>上でKPI項目を追加してください。</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                      {items.map((it) => {
                        const val = numOrNull(memberVals[mem.email]?.[it.key] ?? "");
                        const pace = paceFor(it.key, val);
                        return (
                          <div key={it.key} style={{ display: "grid", gridTemplateColumns: "minmax(90px,120px) 130px 1fr", gap: 10, alignItems: "center" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink-2)" }}>{it.label}</span>
                            <div style={{ position: "relative" }}>
                              <input type="number" inputMode="decimal" step="any" min={0} value={memberVals[mem.email]?.[it.key] ?? ""}
                                onChange={(e) => setMemberVals((m) => ({ ...m, [mem.email]: { ...(m[mem.email] ?? {}), [it.key]: e.target.value } }))}
                                placeholder="目標"
                                style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "6px 32px 6px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
                              <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--color-ink-4)" }}>{it.unit}</span>
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              <span className="muted" style={{ fontSize: 10.5 }}>{pace.reverse ? "逆算（提案数）" : "ペース"}</span>
                              <Chip label="月" value={pace.month} unit={pace.reverse ? "件" : it.unit} />
                              <Chip label="週" value={pace.week} unit={pace.reverse ? "件" : it.unit} />
                              <Chip label="日" value={pace.day} unit={pace.reverse ? "件" : it.unit} highlight />
                            </div>
                          </div>
                        );
                      })}
                      <label style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                        <span className="meta">メモ（任意）</span>
                        <input type="text" value={memberNotes[mem.email] ?? ""} onChange={(e) => setMemberNotes((m) => ({ ...m, [mem.email]: e.target.value }))} placeholder="背景・コミット内容など"
                          style={{ width: "100%", fontFamily: "inherit", fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
          ※ 稼働化は全社転換率（提案→稼働化）から必要提案数を逆算。その他の項目は 月÷4.33＝週／月÷営業日（{bizDays}日）＝日 で按分します。
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, unit, highlight }: { label: string; value: number | null; unit: string; highlight?: boolean }) {
  const v = value == null ? "—" : String(value);
  return (
    <span style={{
      display: "inline-flex", alignItems: "baseline", gap: 3, padding: "2px 8px", borderRadius: 99,
      background: highlight ? "var(--color-brand-25)" : "var(--color-surface-inset)",
      border: `1px solid ${highlight ? "var(--color-brand-100)" : "var(--color-border)"}`,
      fontSize: 11, color: "var(--color-ink-2)",
    }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      <span className="mono" style={{ fontWeight: 800, color: highlight ? "var(--color-brand-700)" : "var(--color-ink)" }}>{v}</span>
      <span style={{ fontSize: 10, color: "var(--color-ink-4)" }}>{unit}</span>
    </span>
  );
}
