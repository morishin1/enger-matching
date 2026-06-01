"use client";

// 提案ボードの表示方式を「カンバン ⇄ リスト」で切り替えるラッパ。
//   - カンバン: ドラッグ&ドロップのステージ管理（ProposalBoard）
//   - リスト: KPI＋検索＋テーブル＋詳細モーダル（ProposalListView）
// 選択は localStorage に永続化。
import { useEffect, useState } from "react";
import { ProposalBoard } from "./ProposalBoard";
import { ProposalListView } from "./ProposalListView";

type View = "kanban" | "list";

export function ProposalBoardSwitcher({ proposals, members }: { proposals: any[]; members?: string[] }) {
  const [view, setView] = useState<View>("kanban");
  useEffect(() => {
    try { const v = localStorage.getItem("enger.proposal-board.view"); if (v === "kanban" || v === "list") setView(v); } catch { /* noop */ }
  }, []);
  const pick = (v: View) => { setView(v); try { localStorage.setItem("enger.proposal-board.view", v); } catch { /* noop */ } };

  const Btn = ({ v, icon, label }: { v: View; icon: string; label: string }) => {
    const on = view === v;
    return (
      <button type="button" onClick={() => pick(v)} aria-pressed={on}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 600, padding: "6px 12px", borderRadius: 8,
          border: "1px solid " + (on ? "var(--color-brand-600)" : "var(--color-border)"), background: on ? "var(--color-brand-600)" : "var(--color-surface)", color: on ? "#fff" : "var(--color-ink-2)", cursor: "pointer" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>{label}
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="muted" style={{ fontSize: 11.5, marginRight: 2 }}>表示</span>
        <Btn v="kanban" icon="view_kanban" label="カンバン" />
        <Btn v="list" icon="table_rows" label="リスト" />
      </div>
      {view === "kanban" ? <ProposalBoard proposals={proposals} members={members} /> : <ProposalListView proposals={proposals} members={members} />}
    </div>
  );
}
