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
  { key: "架電",         source: "override", hint: "テレアポの架電・接触数（コンタクト）。月1,200件目安（40〜80件/日×20営業日）。" },
  { key: "打ち合わせ",   source: "override", hint: "打合せ記録の自社担当者が一致し、打ち合わせ日が入っている件数（メニュー「打合わせ」と連携）" },
  // ⑤「案件の仕入れ」と「提案中」の列を入れ替え（案件の仕入れ → 提案中 の順）。
  { key: "案件の仕入れ", source: "override", hint: "承認済（打合せ完了）かつ自社担当者ありの企業から取り込んだ案件のうち、自社担当者が一致する件数（案件側のみ）" },
  { key: "提案中",       source: "override", hint: "「提案中」に入ったことのある提案の件数（提案者・累計）。別フォルダや失注へ移っても減らず、レコード削除でのみ減算します。" },
  { key: "面談",         source: "override", hint: "「面談」フォルダに入ったことのある提案の件数（提案者・累計）。別フォルダや失注へ移っても減らず、レコード削除でのみ減算します。" },
  { key: "合格", label: "合格（稼働決定）", source: "proposal", attr: "closer", hint: "「合格」ステージに入った提案の件数（クロージング担当者で集計）。削除・見送りで減算します。" },
];
const STAGE_KEYS = STAGE_COLUMNS.map((c) => c.key);
const PROPOSAL_COLUMNS = STAGE_COLUMNS.filter((c) => c.source === "proposal");

// 役割ごとに「やるべき」列。該当しない列は対象外（グレー）表示にする（営業マニュアル§10の役割分担）。
//   打ち合わせ/案件の仕入れ＝アウトサイド、提案中＝インサイド、面談＝両者、合格＝アウトサイド。
//   テレアポは本ボードの列に該当なし（架電は別途）。
const COLUMN_ROLES: Record<string, ("outside" | "inside" | "telapo")[]> = {
  "架電": ["telapo"],
  "打ち合わせ": ["outside"],
  "提案中": ["inside"],
  "案件の仕入れ": ["outside"],
  "面談": ["outside", "inside"],
  "合格": ["outside"],
};
// 役割フィルタの選択肢。
const ROLE_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "チーム全体" },
  { key: "outside", label: "アウトサイド" },
  { key: "inside", label: "インサイド" },
  { key: "telapo", label: "テレアポ" },
  { key: "me", label: "個人" },
];

// 役割別KGI（インサイド＝面談率／アウトサイド＝合格率／テレアポ＝独自KGIなし）。
type RoleKgi =
  | { role: "outside" | "inside"; label: string; rate: number | null; targetRate: number; numer: number; denom: number; numerLabel: string; denomLabel: string }
  | { role: "telapo" };
const ROLE_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  outside: { label: "アウトサイド", bg: "#e7f7ee", fg: "#067647" },
  inside:  { label: "インサイド",   bg: "#e7f0fb", fg: "#0b5cab" },
  telapo:  { label: "テレアポ",     bg: "#fff1e6", fg: "#b45309" },
};
const ROLE_ORDER: Record<string, number> = { outside: 0, inside: 1, telapo: 2 };

type Props = {
  proposals: any[];                 // 進行中の提案（proposer / stage を持つ）
  members: string[];                // 担当者名リスト（提案者）
  stageTargets: Record<string, Record<string, number>>;
  // 打ち合わせ／案件の仕入れ 列の現在値（期間連動済み・担当者名→{列:件数}）。
  currentOverrides?: Record<string, Record<string, number>>;
  kgiByMember: Record<string, { placementTarget: number | null }>;
  // メンバー名→役割、役割別KGI（面談率/合格率）。役割未設定は従来KGI（合格/稼働化目標）を表示。
  roleByMember?: Record<string, string>;
  roleKgiByMember?: Record<string, RoleKgi>;
  kpiPctByMember?: Record<string, number | null>;
  currentUserName?: string | null;   // 「個人」フィルタ用
  canEdit: boolean;
};

const pctTone = (pct: number | null) => pct == null ? "var(--color-ink-4)" : pct >= 100 ? "#067647" : pct >= 60 ? "#9a7b12" : "#b42318";
const roleOf = (owner: string, roleKgi: Record<string, RoleKgi>): string | null => roleKgi[owner]?.role ?? null;

export function StageTargetBoard({ proposals, members, stageTargets, currentOverrides = {}, kgiByMember, roleByMember = {}, roleKgiByMember = {}, kpiPctByMember = {}, currentUserName, canEdit }: Props) {
  const router = useRouter();
  const [, start] = useTransition();
  const [edits, setEdits] = useState<Record<string, string>>({}); // `${owner}|${stage}` -> 入力中の値
  const [roleFilter, setRoleFilter] = useState<string>("all"); // 役割フィルタ（チーム全体/アウト/イン/テレアポ/個人）

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
  }).filter((nm) => {
    // 役割フィルタ（チーム全体/アウト/イン/テレアポ/個人）。
    if (roleFilter === "all") return true;
    if (roleFilter === "me") return currentUserName ? ownerMatches(nm, currentUserName) : true;
    return roleOf(nm, roleKgiByMember) === roleFilter;
  }).sort((a, b) => {
    // 役割でまとめる（アウトサイド→インサイド→テレアポ→未設定）。同役割内は名前順。
    const ra = ROLE_ORDER[roleOf(a, roleKgiByMember) ?? ""] ?? 9;
    const rb = ROLE_ORDER[roleOf(b, roleKgiByMember) ?? ""] ?? 9;
    return ra !== rb ? ra - rb : a.localeCompare(b, "ja");
  });

  // ③④ チーム合計：表示中メンバーの「実数合計」と「目標合計」を列ごとに集計（一番下の行）。
  const teamTotals = STAGE_KEYS.reduce((acc, s) => {
    let cur = 0, tg = 0;
    for (const nm of shownMembers) { cur += current[nm]?.[s] ?? 0; tg += stageTargets[nm]?.[s] ?? 0; }
    acc[s] = { cur, tg };
    return acc;
  }, {} as Record<string, { cur: number; tg: number }>);

  const filterChips = (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
      {ROLE_FILTERS.map((f) => {
        const on = roleFilter === f.key;
        return (
          <button key={f.key} type="button" onClick={() => setRoleFilter(f.key)}
            style={{ fontFamily: "inherit", fontSize: 12, fontWeight: on ? 800 : 600, cursor: "pointer", padding: "5px 12px", borderRadius: 99,
              border: `1px solid ${on ? "var(--color-brand-600)" : "var(--color-border)"}`, background: on ? "var(--color-brand-600)" : "#fff", color: on ? "#fff" : "var(--color-ink-2)" }}>
            {f.label}
          </button>
        );
      })}
    </div>
  );

  if (shownMembers.length === 0) {
    return <div>{filterChips}<div className="muted" style={{ fontSize: 12, padding: 8 }}>対象の担当者がいません。</div></div>;
  }

  // 役割に該当しない列は「対象外」グレー表示（白紙にしない）。役割未設定の人は全列表示。
  const isOutOfScope = (owner: string, stage: string): boolean => {
    const role = roleOf(owner, roleKgiByMember);
    if (!role) return false;
    const cols = COLUMN_ROLES[stage];
    return !!cols && !cols.includes(role as "outside" | "inside" | "telapo");
  };

  const cell = (owner: string, stage: string) => {
    const cur = current[owner]?.[stage] ?? 0;
    const tg = stageTargets[owner]?.[stage] ?? 0;
    const pct = tg > 0 ? Math.round((cur / tg) * 100) : null;
    const key = `${owner}|${stage}`;
    if (isOutOfScope(owner, stage)) {
      return (
        <td key={stage} style={{ ...td, background: "var(--color-surface-inset)", color: "var(--color-ink-5)" }}>
          <span style={{ fontSize: 11 }}>対象外</span>
        </td>
      );
    }
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
    <div>
      {filterChips}
      <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>担当者</th>
            {STAGE_COLUMNS.map((c) => <th key={c.key} style={th} title={c.hint}>{c.label ?? c.key}<div style={{ fontSize: 9.5, fontWeight: 500, color: "var(--color-ink-5)" }}>現在/目標</div></th>)}
            <th style={th}>KPI達成率</th>
            <th style={th}>KGI達成率<div style={{ fontSize: 9.5, fontWeight: 500, color: "var(--color-ink-5)" }}>役割別（外=合格率／内=面談率）</div></th>
          </tr>
        </thead>
        <tbody>
          {shownMembers.map((owner) => {
            const kpiPct = kpiPctByMember[owner] ?? null;
            const kgiTarget = kgiByMember[owner]?.placementTarget ?? null;
            const passed = current[owner]?.["合格"] ?? 0;
            const kgiPct = kgiTarget && kgiTarget > 0 ? Math.round((passed / kgiTarget) * 100) : null;
            const role = roleOf(owner, roleKgiByMember);
            const rk = roleKgiByMember[owner];
            // KGI達成率セル：役割別（面談率/合格率）を優先。役割未設定は従来（合格/稼働化目標）。
            let kgiCell: React.ReactNode;
            if (rk && (rk.role === "outside" || rk.role === "inside")) {
              const ratePct = rk.rate == null ? null : Math.round(rk.rate * 100);
              const tgtPct = Math.round(rk.targetRate * 100);
              const achieve = (rk.rate != null && rk.targetRate > 0) ? Math.round((rk.rate / rk.targetRate) * 100) : null;
              kgiCell = (
                <td style={{ ...td, fontWeight: 800, color: pctTone(achieve) }}>
                  {ratePct == null ? "—" : `${rk.label} ${ratePct}%`}
                  <div style={{ fontSize: 10, fontWeight: 500, color: "var(--color-ink-5)" }}>目標{tgtPct}%・{rk.numer}{rk.numerLabel}/{rk.denom}{rk.denomLabel}</div>
                </td>
              );
            } else if (rk && rk.role === "telapo") {
              kgiCell = <td style={{ ...td, color: "var(--color-ink-4)" }}>—<div style={{ fontSize: 10, color: "var(--color-ink-5)" }}>独自KGIなし</div></td>;
            } else {
              kgiCell = (
                <td style={{ ...td, fontWeight: 800, color: pctTone(kgiPct) }}>
                  {kgiPct == null ? "—" : `${kgiPct}%`}
                  <div style={{ fontSize: 10, fontWeight: 500, color: "var(--color-ink-5)" }}>{passed}/{kgiTarget ?? "—"}</div>
                </td>
              );
            }
            return (
              <tr key={owner}>
                <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
                    <span>{owner}</span>
                    {role && ROLE_BADGE[role] && <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: ROLE_BADGE[role].bg, color: ROLE_BADGE[role].fg }}>{ROLE_BADGE[role].label}</span>}
                  </div>
                </td>
                {STAGE_COLUMNS.map((c) => cell(owner, c.key))}
                <td style={{ ...td, fontWeight: 800, color: pctTone(kpiPct) }}>{kpiPct == null ? "—" : `${kpiPct}%`}</td>
                {kgiCell}
              </tr>
            );
          })}
          {/* ③④ チーム合計（一番下）：表示中メンバーの実数合計／目標合計。 */}
          <tr style={{ background: "var(--color-surface-soft)", borderTop: "2px solid var(--color-border-strong)" }}>
            <td style={{ ...td, textAlign: "left", fontWeight: 800 }}>
              チーム合計
              <div style={{ fontSize: 9.5, fontWeight: 500, color: "var(--color-ink-5)" }}>{shownMembers.length}名の合計</div>
            </td>
            {STAGE_COLUMNS.map((c) => {
              const { cur, tg } = teamTotals[c.key] ?? { cur: 0, tg: 0 };
              const pct = tg > 0 ? Math.round((cur / tg) * 100) : null;
              return (
                <td key={c.key} style={{ ...td, fontWeight: 800 }}>
                  <div>{cur}<span style={{ color: "var(--color-ink-5)", fontWeight: 500 }}> / </span>{tg}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: pctTone(pct) }}>{pct == null ? "—" : `${pct}%`}</div>
                </td>
              );
            })}
            <td style={td}>—</td>
            <td style={td}>—</td>
          </tr>
        </tbody>
      </table>
      </div>
      <div className="muted" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.7 }}>
        <b>打ち合わせ</b>＝打合せ記録（メニュー「打合わせ」）の自社担当者×打ち合わせ日の件数。
        <b>案件の仕入れ</b>＝承認済（打合せ完了）かつ自社担当者ありの企業から取り込んだ案件数（案件側のみ・人材側は対象外）。
        <b>面談</b>＝「面談」フォルダに入ったことのある提案の件数（提案者・累計／別フォルダや失注へ移っても減らず、削除のみ減算）。
        <b>合格（稼働決定）</b>＝「合格」ステージの件数（クロージング担当者で集計）。
        いずれも上部の期間に連動します。
        <br /><b>KGI達成率（役割別）</b>＝<b style={{ color: ROLE_BADGE.outside.fg }}>アウトサイド</b>は合格率（面談→合格/稼働）、<b style={{ color: ROLE_BADGE.inside.fg }}>インサイド</b>は面談率（提案→面談）。テレアポは独自KGIなし。目標率はチームのファネル目標。役割と目標は「KPI＆KGI」ページで割当・設定できます（未設定は従来の合格÷稼働化目標）。
        <br />上部の役割フィルタ（チーム全体/アウト/イン/テレアポ/個人）で絞り込み。役割に該当しない列は<b>対象外</b>（グレー）表示です。
        {canEdit && <><br />※ 各列の数値（/の右）が目標。直接入力して変更できます（フォーカスを外すと保存）。</>}
      </div>
    </div>
  );
}
