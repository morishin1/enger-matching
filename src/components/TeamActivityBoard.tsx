"use client";

// メンバー別アクティビティ一覧（ダッシュボード／KPI推移 上部）。
//   指標は KPI推移と同じ5つ：提案 / コンタクト / 調整中 / 日程確定 / 成約。
//   各メンバーの「実績 / 目標」を表示し、最下段に「チーム合計 / チーム目標 / 達成率」を出す。
//   ・チーム目標：kpi_targets(team scope) の今週分を期間に按分した値（指標ごと）。
//   ・達成率＝チーム合計実績 ÷ チーム目標 × 100（％）。
//   ・管理者/マネージャー（teamRole=manager|leader）には編集メニューを表示：
//       「メンバー編集」「チーム目標を編集」「メンバー目標を編集」。
//   列ヘッダクリックで並び替え。提案以外は CL担当に加算される。

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActivityRow } from "@/lib/team-activity";
import { METRIC_LABELS, METRIC_ORDER, type Metric } from "@/lib/kpi";
import { saveKpiTargets } from "@/lib/actions";
import { saveProposalOwners } from "@/app/settings/permission-actions";

type SortKey = Metric;

export type TeamActivityViewer = {
  role: string;
  teamRole?: string | null;
  isAdmin: boolean;
  isManager: boolean;
};

export type TeamMemberMeta = { name: string; email: string | null };

export function TeamActivityBoard({
  rows, periodLabel, teamTarget = {} as Partial<Record<Metric, number>>,
  teamWeeklyTarget = {} as Partial<Record<Metric, number>>,
  viewer, weekStart, proposalOwners,
}: {
  rows: ActivityRow[];
  periodLabel: string;
  teamTarget?: Partial<Record<Metric, number>>;       // 期間按分後（テーブル表示用）
  teamWeeklyTarget?: Partial<Record<Metric, number>>; // 期間按分前の週次値（モーダル初期値用）
  viewer?: TeamActivityViewer;
  weekStart?: string;        // 'YYYY-MM-DD'（編集モーダル用。未指定なら編集不可）
  proposalOwners?: { proposers: string[]; closers: string[] }; // メンバー編集用の現在値
}) {
  const [sortKey, setSortKey] = useState<SortKey>("proposal");
  const valOf = (r: ActivityRow, k: SortKey) => r.actual[k];
  const sorted = useMemo(() => [...rows].sort((a, b) => valOf(b, sortKey) - valOf(a, sortKey) || b.total - a.total), [rows, sortKey]);

  const totals = useMemo(() => {
    const act: Record<Metric, number> = { proposal: 0, contact: 0, adjusting: 0, schedule: 0, deal: 0 };
    for (const r of rows) for (const m of METRIC_ORDER) act[m] += r.actual[m];
    const actTotal = METRIC_ORDER.reduce((s, m) => s + act[m], 0);
    const tgtTotal = METRIC_ORDER.reduce((s, m) => s + (teamTarget[m] ?? 0), 0);
    return { act, actTotal, tgtTotal };
  }, [rows, teamTarget]);

  const pct = (a: number, t: number) => t > 0 ? Math.round((a / t) * 100) : (a > 0 ? 100 : 0);
  const teamPct = pct(totals.actTotal, totals.tgtTotal);
  const teamTone = teamPct >= 100 ? "#067647" : teamPct >= 80 ? "#0095D9" : teamPct >= 50 ? "#b45309" : "#b42318";

  const canEdit = !!viewer && (viewer.isAdmin || viewer.isManager) && !!weekStart;
  const [modal, setModal] = useState<null | "members" | "team" | "people">(null);

  const th: React.CSSProperties = { textAlign: "right", padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap", fontWeight: 700, color: "var(--color-ink-3)" };

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--color-brand-700)" }}>groups</span>
          メンバー別アクティビティ（{periodLabel}）
        </h3>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span className="muted">チーム達成率</span>
            <b style={{ fontSize: 16, color: teamTone }}>{totals.tgtTotal > 0 ? `${teamPct}%` : "—"}</b>
            <span className="muted" style={{ fontSize: 11 }}>（{totals.actTotal} / {totals.tgtTotal || "—"}）</span>
          </span>
          {canEdit && (
            <div style={{ display: "inline-flex", gap: 6 }}>
              <button type="button" className="btn ghost btn-xs" onClick={() => setModal("members")}
                title="メンバー別アクティビティに表示する人を増減">
                <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: "-3px", marginRight: 2 }}>group_add</span>
                メンバー編集
              </button>
              <button type="button" className="btn ghost btn-xs" onClick={() => setModal("team")}
                title="チームの週次目標を編集">
                <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: "-3px", marginRight: 2 }}>flag</span>
                チーム目標
              </button>
              <button type="button" className="btn ghost btn-xs" onClick={() => setModal("people")}
                title="各メンバーへの目標数値を入力">
                <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: "-3px", marginRight: 2 }}>tune</span>
                メンバー目標
              </button>
            </div>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>対象メンバーがいません。</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "var(--color-ink-3)" }}>メンバー</th>
                {METRIC_ORDER.map((m) => {
                  const on = sortKey === m; const tone = METRIC_LABELS[m].tone;
                  return (
                    <th key={m} onClick={() => setSortKey(m)} title="クリックで並び替え（上段=実績 / 下段=目標）"
                      style={{ ...th, fontWeight: on ? 800 : 700, color: on ? tone : "var(--color-ink-3)" }}>
                      {METRIC_LABELS[m].short}{on ? " ▾" : ""}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.email ?? r.name} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>{r.name}</td>
                  {METRIC_ORDER.map((m) => {
                    const a = r.actual[m]; const t = r.target[m]; const tone = METRIC_LABELS[m].tone;
                    const hit = t > 0 && a >= t;
                    // 2段表示：上段=実績（大きく太字。達成時は緑、未達は通常色）／下段=目標（小さく薄いグレー）。
                    return (
                      <td key={m} style={{ padding: "6px 10px", textAlign: "right", verticalAlign: "middle" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.15 }}>
                          <span className="mono" style={{ fontSize: 15, fontWeight: 800, color: hit ? "#067647" : a > 0 ? tone : "var(--color-ink-4)" }}>{a || "·"}</span>
                          {t > 0 && <span className="mono" style={{ color: "var(--color-ink-4)", fontSize: 10, fontWeight: 500 }}>目標 {t}</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--color-border)", fontWeight: 800, background: "var(--color-surface-soft)" }}>
                <td style={{ padding: "8px 10px", color: "var(--color-ink-2)" }}>チーム合計（実績）</td>
                {METRIC_ORDER.map((m) => (
                  <td key={m} style={{ padding: "8px 10px", textAlign: "right" }} className="mono">{totals.act[m]}</td>
                ))}
              </tr>
              <tr style={{ background: "var(--color-surface-soft)" }}>
                <td style={{ padding: "8px 10px", color: "var(--color-ink-3)", fontWeight: 700 }}>チーム目標</td>
                {METRIC_ORDER.map((m) => (
                  <td key={m} style={{ padding: "8px 10px", textAlign: "right", color: "var(--color-ink-3)" }} className="mono">
                    {teamTarget[m] ?? "—"}
                  </td>
                ))}
              </tr>
              <tr style={{ background: "var(--color-surface-soft)", borderTop: "1px dashed var(--color-border)" }}>
                <td style={{ padding: "8px 10px", color: "var(--color-ink-2)", fontWeight: 700 }}>達成率</td>
                {METRIC_ORDER.map((m) => {
                  const a = totals.act[m]; const t = teamTarget[m] ?? 0;
                  const p = pct(a, t);
                  const tone = t > 0 ? (p >= 100 ? "#067647" : p >= 80 ? "#0095D9" : p >= 50 ? "#b45309" : "#b42318") : "var(--color-ink-4)";
                  return (
                    <td key={m} style={{ padding: "8px 10px", textAlign: "right", color: tone, fontWeight: 800 }} className="mono">
                      {t > 0 ? `${p}%` : "—"}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="muted" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.6 }}>
        ※ 各セルは上段=実績（達成時は<b style={{ color: "#067647" }}>緑</b>）／下段=目標。提案=新規提案（提案者）。コンタクト/調整中/面談/合格は<b>CL担当</b>に加算（架電・通知・面談・合格に連動）。
        目標は各メンバーの週次目標を期間に按分。<b>達成率＝チーム合計実績 ÷ チーム目標 × 100</b>。
      </div>

      {modal === "members" && weekStart && (
        <MembersEditModal initial={proposalOwners ?? { proposers: [], closers: [] }} suggestions={rows.map((r) => r.name)} onClose={() => setModal(null)} />
      )}
      {modal === "team" && weekStart && (
        <TargetEditModal scope="team" weekStart={weekStart} title="チーム目標を編集（週次）" subtitle="会社全体（its）の週次目標。期間に応じて按分されます。"
          initial={teamWeeklyTarget} onClose={() => setModal(null)} />
      )}
      {modal === "people" && weekStart && (
        <PeopleTargetsModal weekStart={weekStart} rows={rows} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

// ───────── 編集モーダル ─────────

function TargetEditModal(props: {
  scope: "person" | "team";
  ownerEmail?: string; ownerName?: string;
  weekStart: string;
  title: string;
  subtitle?: string;
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
        : await saveKpiTargets({ scope: "person", ownerEmail: props.ownerEmail ?? "", ownerName: props.ownerName ?? "", weekStart: props.weekStart, targets });
      if (!r.ok) { setMsg(`保存失敗: ${r.error}`); return; }
      setMsg("✓ 保存しました");
      router.refresh();
      setTimeout(() => props.onClose(), 600);
    });
  };

  return (
    <ModalShell onClose={props.onClose} title={props.title} subtitle={props.subtitle}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
        {METRIC_ORDER.map((m) => (
          <label key={m} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ width: 110, color: METRIC_LABELS[m].tone, fontWeight: 700 }}>
              {METRIC_LABELS[m].short} <span style={{ color: "var(--color-ink-4)", fontWeight: 400, fontSize: 11 }}>({METRIC_LABELS[m].long})</span>
            </span>
            <input type="number" min={0} value={vals[m]} onChange={(e) => setVals((v) => ({ ...v, [m]: e.target.value }))}
              style={{ flex: 1, fontSize: 13, padding: "6px 9px", borderRadius: 6, border: "1px solid var(--color-border-strong)", textAlign: "right", fontFamily: "monospace" }} />
            <span style={{ fontSize: 11, color: "var(--color-ink-4)" }}>件/週</span>
          </label>
        ))}
      </div>
      {msg && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" className="btn" onClick={props.onClose} disabled={pending}>キャンセル</button>
        <button type="button" className="btn brand" onClick={save} disabled={pending}>保存</button>
      </div>
    </ModalShell>
  );
}

// 各メンバーの週次目標を一覧で編集。チーム目標との「割り振り」UI。
function PeopleTargetsModal({ weekStart, rows, onClose }: { weekStart: string; rows: ActivityRow[]; onClose: () => void }) {
  const router = useRouter();
  // 初期値は r.weeklyTarget（kpi_targets に保存された週次の生値）。
  //   ・期間が day/month/quarter のときも、ここは「週次」の値を見せる（モーダル単位は「件/週」固定）
  //   ・以前は r.target（期間按分後）を初期値にしていたため、保存→再オープンで値が縮小する
  //     バグがあった（例：100/週で保存→day表示で20が見える→そのまま保存→次回20/週として扱われ→さらに4が表示）
  const [vals, setVals] = useState<Record<string, Record<Metric, string>>>(() => {
    const o: Record<string, Record<Metric, string>> = {};
    for (const r of rows) {
      const k = r.email ?? r.name;
      o[k] = {} as any;
      for (const m of METRIC_ORDER) o[k][m] = String(r.weeklyTarget[m] || "");
    }
    return o;
  });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const saveAll = () => {
    start(async () => {
      // email が無いメンバーもサーバ側で名前から app_users / staff のメールを引き直すため、
      //   ここではスキップせず全員ぶん送信する。サーバが解決できなかった場合のみ失敗扱い。
      const tasks: { name: string; p: Promise<{ ok: boolean; error?: string }> }[] = [];
      const noNumericRows: string[] = [];
      for (const r of rows) {
        const k = r.email ?? r.name;
        const targets: Partial<Record<Metric, number>> = {};
        for (const m of METRIC_ORDER) {
          const n = Number(vals[k]?.[m] ?? "");
          if (Number.isFinite(n) && n >= 0) targets[m] = Math.floor(n);
        }
        if (Object.keys(targets).length === 0) { noNumericRows.push(r.name); continue; }
        tasks.push({ name: r.name, p: saveKpiTargets({ scope: "person", ownerEmail: r.email ?? null, ownerName: r.name, weekStart, targets }) });
      }
      const results = await Promise.all(tasks.map((t) => t.p));
      const failed = results.map((res, i) => ({ name: tasks[i].name, res })).filter((x) => !x.res.ok);
      if (failed.length > 0) {
        const detail = failed.slice(0, 3).map((f) => `${f.name}：${f.res.error}`).join(" / ");
        setMsg(`一部の保存に失敗しました（${failed.length} 名）。${detail}`);
        return;
      }
      setMsg(noNumericRows.length === rows.length ? "（数値が入力されていません）" : "✓ 保存しました");
      router.refresh();
      setTimeout(() => onClose(), 700);
    });
  };

  const totals = METRIC_ORDER.reduce((acc, m) => {
    acc[m] = 0;
    for (const r of rows) {
      const k = r.email ?? r.name;
      const n = Number(vals[k]?.[m] ?? "");
      if (Number.isFinite(n)) acc[m] += Math.max(0, Math.floor(n));
    }
    return acc;
  }, {} as Record<Metric, number>);

  return (
    <ModalShell onClose={onClose} title="メンバー目標を編集（週次・指標ごと）"
      subtitle={`週開始 ${weekStart}（月曜）。空欄は未設定。表下にメンバー合計を表示します。`}>
      <div style={{ maxHeight: "60vh", overflow: "auto", marginTop: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-soft)" }}>
              <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 700 }}>メンバー</th>
              {METRIC_ORDER.map((m) => (
                <th key={m} style={{ padding: "6px 8px", textAlign: "right", color: METRIC_LABELS[m].tone, fontWeight: 700 }}>{METRIC_LABELS[m].short}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const k = r.email ?? r.name;
              // email がクライアントで解決できていなくても、サーバ側で名前から app_users/staff の
              //   メールを引き直して保存する。よって UI 上の「保存対象外」表示は出さない。
              return (
                <tr key={k} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                  </td>
                  {METRIC_ORDER.map((m) => (
                    <td key={m} style={{ padding: "4px 6px", textAlign: "right" }}>
                      <input type="number" min={0} value={vals[k]?.[m] ?? ""}
                        onChange={(e) => setVals((s) => ({ ...s, [k]: { ...(s[k] ?? {} as any), [m]: e.target.value } }))}
                        style={{ width: 72, fontSize: 12.5, padding: "4px 6px", borderRadius: 6,
                          border: "1px solid var(--color-border-strong)",
                          background: "var(--color-surface)",
                          textAlign: "right", fontFamily: "monospace" }} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "var(--color-surface-soft)", borderTop: "2px solid var(--color-border)" }}>
              <td style={{ padding: "6px 8px", fontWeight: 800 }}>メンバー合計</td>
              {METRIC_ORDER.map((m) => (
                <td key={m} style={{ padding: "6px 8px", textAlign: "right", fontWeight: 800 }} className="mono">{totals[m]}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {msg && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button type="button" className="btn" onClick={onClose} disabled={pending}>キャンセル</button>
        <button type="button" className="btn brand" onClick={saveAll} disabled={pending}>{pending ? "保存中…" : "全員分保存"}</button>
      </div>
    </ModalShell>
  );
}

// アクティビティに表示するメンバーの増減（proposal_owners の proposers/closers を編集）。
function MembersEditModal({ initial, suggestions, onClose }: { initial: { proposers: string[]; closers: string[] }; suggestions: string[]; onClose: () => void }) {
  const router = useRouter();
  const [proposers, setProposers] = useState<string[]>(initial.proposers ?? []);
  const [closers, setClosers] = useState<string[]>(initial.closers ?? []);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const save = () => {
    start(async () => {
      const r = await saveProposalOwners({ proposers, closers });
      if (!r.ok) { setMsg(`保存失敗: ${r.error}`); return; }
      setMsg("✓ 保存しました");
      router.refresh();
      setTimeout(() => onClose(), 600);
    });
  };
  return (
    <ModalShell onClose={onClose} title="メンバー編集（表示する人の増減）"
      subtitle="提案者・クロージング担当の名前リストを編集します。ここに登録した人がアクティビティに表示されます。">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <NameList label="提案者" tone="brand" items={proposers} suggestions={suggestions} onChange={setProposers} />
        <NameList label="クロージング担当" tone="accent" items={closers} suggestions={suggestions} onChange={setClosers} />
      </div>
      {msg && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button type="button" className="btn" onClick={onClose} disabled={pending}>キャンセル</button>
        <button type="button" className="btn brand" onClick={save} disabled={pending}>保存</button>
      </div>
    </ModalShell>
  );
}

function NameList({ label, tone, items, suggestions, onChange }: { label: string; tone: "brand" | "accent"; items: string[]; suggestions: string[]; onChange: (xs: string[]) => void }) {
  const [input, setInput] = useState("");
  const color = tone === "accent" ? "#067647" : "var(--color-brand-700)";
  const bg = tone === "accent" ? "#e7f7ee" : "var(--color-brand-25)";
  const bd = tone === "accent" ? "#bfe3cc" : "var(--color-brand-100)";
  const add = (v: string) => { const n = (v ?? "").trim(); if (!n || items.includes(n)) return; onChange([...items, n]); setInput(""); };
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  return (
    <div style={{ border: `1px solid ${bd}`, background: bg, borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color, marginBottom: 6 }}>{label}（{items.length}名）</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        {items.length === 0 && <div className="muted" style={{ fontSize: 11.5 }}>未設定</div>}
        {items.map((name, i) => (
          <div key={name + i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 7, background: "#fff", border: "1px solid var(--color-border)" }}>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{name}</span>
            <button type="button" onClick={() => remove(i)} title="削除"
              style={{ padding: "2px 8px", fontSize: 12, fontWeight: 800, color: "#b42318", background: "transparent", border: 0, cursor: "pointer", borderRadius: 6 }}>✕</button>
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); add(input); }} style={{ display: "flex", gap: 6 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="氏名を入力" maxLength={30}
          style={{ flex: 1, fontSize: 12.5, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "#fff" }} />
        <button type="submit" className="btn brand btn-xs" disabled={!input.trim()}>＋追加</button>
      </form>
      {suggestions.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
          {Array.from(new Set(suggestions)).filter((s) => !items.includes(s)).slice(0, 8).map((s) => (
            <button key={s} type="button" onClick={() => add(s)}
              style={{ fontSize: 10.5, padding: "3px 9px", borderRadius: 99, border: "1px dashed var(--color-border-strong)", background: "transparent", cursor: "pointer", color: "var(--color-ink-3)", fontFamily: "inherit" }}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ModalShell({ onClose, title, subtitle, children }: { onClose: () => void; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(720px, 94vw)", padding: 18, maxHeight: "90vh", overflow: "auto" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{title}</h2>
        {subtitle && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
