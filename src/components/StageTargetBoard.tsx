"use client";

// 提案ボードのステージ（所属確認/提案中/確認中/面談/合格）× 担当者の「目標/現在/達成率」ボード。
//   現在件数は進行中の提案(proposals)から担当者(proposer)別に集計。目標は stage_targets に保存。
//   さらにメンバー別の KPI達成率（週次KPI）と KGI達成率（月次稼働化目標に対する合格到達）を併記する。
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { STAGE_TARGET_STAGES } from "@/lib/stage-targets";
import { normalizeStage } from "@/lib/proposal-constants";
import { ownerMatches } from "@/lib/owner-match";
import { saveStageTarget } from "@/app/proposals/stage-actions";

type Props = {
  proposals: any[];                 // 進行中の提案（proposer / stage を持つ）
  members: string[];                // 担当者名リスト（提案者）
  stageTargets: Record<string, Record<string, number>>;
  kgiByMember: Record<string, { placementTarget: number | null }>;
  kpiPctByMember: Record<string, number | null>;
  canEdit: boolean;
};

const pctTone = (pct: number | null) => pct == null ? "var(--color-ink-4)" : pct >= 100 ? "#067647" : pct >= 60 ? "#9a7b12" : "#b42318";

export function StageTargetBoard({ proposals, members, stageTargets, kgiByMember, kpiPctByMember, canEdit }: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  const [edits, setEdits] = useState<Record<string, string>>({}); // `${owner}|${stage}` -> 入力中の値

  // 担当者×ステージ の現在件数（進行中の提案を proposer で寛容に突合）。
  const current = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const name of members) m[name] = Object.fromEntries(STAGE_TARGET_STAGES.map((s) => [s, 0]));
    for (const p of proposals) {
      const st = normalizeStage(p?.stage);
      if (!(STAGE_TARGET_STAGES as readonly string[]).includes(st)) continue;
      const who = members.find((nm) => ownerMatches(nm, p?.proposer));
      if (who) m[who][st] = (m[who][st] ?? 0) + 1;
    }
    return m;
  }, [proposals, members]);

  const save = (owner: string, stage: string, raw: string) => {
    const target = Math.max(0, Math.floor(Number(raw) || 0));
    start(async () => {
      const r = await saveStageTarget({ owner_name: owner, stage, target });
      if (!r.ok) toast(r.error ?? "目標の保存に失敗しました", "error");
      else router.refresh();
    });
  };

  const th: React.CSSProperties = { padding: "7px 8px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, textAlign: "center", whiteSpace: "nowrap", background: "var(--color-surface-soft)" };
  const td: React.CSSProperties = { padding: "6px 8px", borderTop: "1px solid var(--color-border)", textAlign: "center", fontSize: 12.5 };

  // 現在の合計があるメンバー or 目標があるメンバーのみ表示（0/0 の行は省く）。
  const shownMembers = members.filter((nm) => {
    const cur = current[nm] ?? {};
    const tg = stageTargets[nm] ?? {};
    const hasCur = STAGE_TARGET_STAGES.some((s) => (cur[s] ?? 0) > 0);
    const hasTg = STAGE_TARGET_STAGES.some((s) => (tg[s] ?? 0) > 0);
    const hasKpi = kpiPctByMember[nm] != null;
    return hasCur || hasTg || hasKpi;
  });

  if (shownMembers.length === 0) {
    return <div className="muted" style={{ fontSize: 12, padding: 8 }}>対象の担当者がいません。</div>;
  }

  const cell = (owner: string, stage: string) => {
    const cur = current[owner]?.[stage] ?? 0;
    const tg = stageTargets[owner]?.[stage] ?? 0;
    const pct = tg > 0 ? Math.round((cur / tg) * 100) : null;
    const key = `${owner}|${stage}`;
    return (
      <td key={stage} style={td}>
        <div style={{ fontWeight: 700 }}>
          {cur}
          <span style={{ color: "var(--color-ink-5)", fontWeight: 500 }}> / </span>
          {canEdit ? (
            <input type="number" min={0} value={edits[key] ?? String(tg)} onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEdits((p) => ({ ...p, [key]: e.target.value }))}
              onBlur={(e) => { const v = e.target.value; setEdits((p) => { const n = { ...p }; delete n[key]; return n; }); if (Number(v || 0) !== tg) save(owner, stage, v); }}
              style={{ width: 40, fontSize: 12, padding: "2px 4px", borderRadius: 6, border: "1px solid var(--color-border-strong)", textAlign: "center", background: "var(--color-surface)" }} />
          ) : <span>{tg}</span>}
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: pctTone(pct) }}>{pct == null ? "—" : `${pct}%`}</div>
      </td>
    );
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>担当者</th>
            {STAGE_TARGET_STAGES.map((s) => <th key={s} style={th}>{s}<div style={{ fontSize: 9.5, fontWeight: 500, color: "var(--color-ink-5)" }}>現在/目標</div></th>)}
            <th style={th}>KPI達成率</th>
            <th style={th}>KGI達成率<div style={{ fontSize: 9.5, fontWeight: 500, color: "var(--color-ink-5)" }}>合格/稼働化目標</div></th>
          </tr>
        </thead>
        <tbody>
          {shownMembers.map((owner) => {
            const kpiPct = kpiPctByMember[owner] ?? null;
            const kgiTarget = kgiByMember[owner]?.placementTarget ?? null;
            const passed = current[owner]?.["合格"] ?? 0;
            const kgiPct = kgiTarget && kgiTarget > 0 ? Math.round((passed / kgiTarget) * 100) : null;
            return (
              <tr key={owner}>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{owner}</td>
                {STAGE_TARGET_STAGES.map((s) => cell(owner, s))}
                <td style={{ ...td, fontWeight: 800, color: pctTone(kpiPct) }}>{kpiPct == null ? "—" : `${kpiPct}%`}</td>
                <td style={{ ...td, fontWeight: 800, color: pctTone(kgiPct) }}>
                  {kgiPct == null ? "—" : `${kgiPct}%`}
                  <div style={{ fontSize: 10, fontWeight: 500, color: "var(--color-ink-5)" }}>{passed}/{kgiTarget ?? "—"}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canEdit && <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>※ 各ステージの数値（/の右）が目標。直接入力して変更できます（フォーカスを外すと保存）。KGI達成率＝当月の合格件数 ÷ 稼働化目標（person-kgi）。</div>}
    </div>
  );
}
