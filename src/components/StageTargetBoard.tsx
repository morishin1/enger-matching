"use client";

// 提案ボードのステージ × 担当者の「目標/現在/達成率」ボード。
//   列とソース：
//     打ち合わせ      … 打合せ記録(meetings)の自社担当者×打ち合わせ日（currentOverrides で受け取る）
//     提案中          … 進行中の提案(proposals)の stage=提案中（提案者で突合・スナップショット）
//     案件の仕入れ    … 承認済(打合せ完了)＋自社担当者ありの企業から取り込んだ案件数（currentOverrides）
//     面談            … 「面談」フォルダに入ったことのある提案の件数（提案者・累計／移動や失注で減算せず、削除のみ減算）。
//                       meeting_reached_at をソースに currentOverrides で受け取る。
//     合格（稼働決定）… 進行中の提案で stage=合格（クロージング担当者で突合・スナップショット）。
//   目標は stage_targets に保存（キーは内部名）。KPI達成率（週次KPI）と KGI達成率（月次稼働化目標）も併記。
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { normalizeStage } from "@/lib/proposal-constants";
import { ownerMatches } from "@/lib/owner-match";
import { saveStageTarget } from "@/app/proposals/stage-actions";

// ボードの列定義。
//   source="proposal" は proposals のスナップショットから、attr で proposer/closer のどちらで突合するか指定。
//   source="override" は currentOverrides（打合せ/案件の仕入れ/面談到達）から集計。
//   label は表示名（省略時は key）。key は stage_targets / 集計のキー（変更しない）。
const STAGE_COLUMNS: { key: string; label?: string; source: "proposal" | "override"; attr?: "proposer" | "closer"; hint: string }[] = [
  { key: "打ち合わせ",   source: "override", hint: "打合せ記録の自社担当者が一致し、打ち合わせ日が入っている件数（メニュー「打合わせ」と連携）" },
  { key: "提案中",       source: "proposal", attr: "proposer", hint: "進行中の提案で「提案中」ステージの件数（提案者で集計）" },
  { key: "案件の仕入れ", source: "override", hint: "承認済（打合せ完了）かつ自社担当者ありの企業から取り込んだ案件のうち、自社担当者が一致する件数（案件側のみ）" },
  { key: "面談",         source: "override", hint: "「面談」フォルダに入ったことのある提案の件数（提案者・累計）。別フォルダや失注へ移っても減らず、レコード削除でのみ減算します。" },
  { key: "合格", label: "合格（稼働決定）", source: "proposal", attr: "closer", hint: "「合格」ステージに入った提案の件数（クロージング担当者で集計）。削除・見送りで減算します。" },
];
const STAGE_KEYS = STAGE_COLUMNS.map((c) => c.key);
const PROPOSAL_COLUMNS = STAGE_COLUMNS.filter((c) => c.source === "proposal");

type Props = {
  proposals: any[];                 // 進行中の提案（proposer / stage を持つ）
  members: string[];                // 担当者名リスト（提案者）
  stageTargets: Record<string, Record<string, number>>;
  // 打ち合わせ／案件の仕入れ 列の現在値（期間連動済み・担当者名→{列:件数}）。
  currentOverrides?: Record<string, Record<string, number>>;
  kgiByMember: Record<string, { placementTarget: number | null }>;
  kpiPctByMember: Record<string, number | null>;
  canEdit: boolean;
};

const pctTone = (pct: number | null) => pct == null ? "var(--color-ink-4)" : pct >= 100 ? "#067647" : pct >= 60 ? "#9a7b12" : "#b42318";

export function StageTargetBoard({ proposals, members, stageTargets, currentOverrides = {}, kgiByMember, kpiPctByMember, canEdit }: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  const [edits, setEdits] = useState<Record<string, string>>({}); // `${owner}|${stage}` -> 入力中の値

  // 担当者×列 の現在件数。提案系は proposals から、打合せ/仕入れは currentOverrides から。
  const current = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const name of members) m[name] = Object.fromEntries(STAGE_KEYS.map((s) => [s, 0]));
    // 提案系（提案中＝提案者／合格＝クロージング担当者）：進行中の提案を該当ステージ＋担当で寛容に突合。
    for (const col of PROPOSAL_COLUMNS) {
      for (const p of proposals) {
        if (normalizeStage(p?.stage) !== col.key) continue;
        const value = col.attr === "closer" ? p?.closer : p?.proposer;
        const who = members.find((nm) => ownerMatches(nm, value));
        if (who) m[who][col.key] = (m[who][col.key] ?? 0) + 1;
      }
    }
    // 打合せ／案件の仕入れ：サーバ集計＋期間絞り済みの currentOverrides を上書き反映。
    for (const [owner, byStage] of Object.entries(currentOverrides)) {
      m[owner] ??= Object.fromEntries(STAGE_KEYS.map((s) => [s, 0]));
      for (const [stage, n] of Object.entries(byStage)) m[owner][stage] = n;
    }
    return m;
  }, [proposals, members, currentOverrides]);

  // 保存後、サーバ値(stageTargets)が編集値に追いついたら入力中の値(edits)を解消する。
  //   こうすると「入力→0に戻る→また入力値」というチラつき（保存往復のタイムラグ）が出ない。
  useEffect(() => {
    setEdits((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(prev)) {
        const i = k.indexOf("|");
        const owner = k.slice(0, i), stage = k.slice(i + 1);
        const serverTg = stageTargets[owner]?.[stage] ?? 0;
        if (Number(v || 0) === serverTg) { delete next[k]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [stageTargets]);

  const save = (owner: string, stage: string, raw: string) => {
    const target = Math.max(0, Math.floor(Number(raw) || 0));
    start(async () => {
      const r = await saveStageTarget({ owner_name: owner, stage, target });
      if (!r.ok) {
        // 失敗時は楽観表示を取り消し（元の目標値に戻す）。
        setEdits((p) => { const n = { ...p }; delete n[`${owner}|${stage}`]; return n; });
        toast(r.error ?? "目標の保存に失敗しました", "error");
      } else router.refresh();
    });
  };

  const th: React.CSSProperties = { padding: "7px 8px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, textAlign: "center", whiteSpace: "nowrap", background: "var(--color-surface-soft)" };
  const td: React.CSSProperties = { padding: "6px 8px", borderTop: "1px solid var(--color-border)", textAlign: "center", fontSize: 12.5 };

  // 現在の合計があるメンバー or 目標があるメンバーのみ表示（0/0 の行は省く）。
  //   currentOverrides にだけ実績があるメンバー（打合せ/仕入れのみ）も対象に含める。
  const allMembers = useMemo(() => {
    const set = new Set(members);
    for (const nm of Object.keys(currentOverrides)) set.add(nm);
    return Array.from(set);
  }, [members, currentOverrides]);
  const shownMembers = allMembers.filter((nm) => {
    const cur = current[nm] ?? {};
    const tg = stageTargets[nm] ?? {};
    const hasCur = STAGE_KEYS.some((s) => (cur[s] ?? 0) > 0);
    const hasTg = STAGE_KEYS.some((s) => (tg[s] ?? 0) > 0);
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
              onBlur={(e) => {
                const target = Math.max(0, Math.floor(Number(e.target.value || 0)));
                if (target !== tg) {
                  // 楽観的に新しい値を表示し続ける（保存往復で 0 に戻るチラつきを防ぐ）。サーバ反映後に effect が解消。
                  setEdits((p) => ({ ...p, [key]: String(target) }));
                  save(owner, stage, String(target));
                } else {
                  setEdits((p) => { const n = { ...p }; delete n[key]; return n; });
                }
              }}
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
            {STAGE_COLUMNS.map((c) => <th key={c.key} style={th} title={c.hint}>{c.label ?? c.key}<div style={{ fontSize: 9.5, fontWeight: 500, color: "var(--color-ink-5)" }}>現在/目標</div></th>)}
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
                {STAGE_COLUMNS.map((c) => cell(owner, c.key))}
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
      <div className="muted" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.7 }}>
        <b>打ち合わせ</b>＝打合せ記録（メニュー「打合わせ」）の自社担当者×打ち合わせ日の件数。
        <b>案件の仕入れ</b>＝承認済（打合せ完了）かつ自社担当者ありの企業から取り込んだ案件数（案件側のみ・人材側は対象外）。
        <b>面談</b>＝「面談」フォルダに入ったことのある提案の件数（提案者・累計／別フォルダや失注へ移っても減らず、削除のみ減算）。
        <b>合格（稼働決定）</b>＝「合格」ステージの件数（クロージング担当者で集計）。
        いずれも上部の期間に連動します。
        {canEdit && <><br />※ 各列の数値（/の右）が目標。直接入力して変更できます（フォーカスを外すと保存）。KGI達成率＝当月の合格件数 ÷ 稼働化目標（person-kgi）。</>}
      </div>
    </div>
  );
}
