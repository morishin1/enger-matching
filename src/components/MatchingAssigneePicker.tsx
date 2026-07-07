"use client";

// マッチング（おすすめ）の担当者フィルタ。負荷軽減のため、選択した担当者の人材だけを
//   マッチング対象にする。複数選択可・「全員」「未割当」も選べる。
//   選択して「表示する」を押すと URL の ?assignee= を更新し、サーバがその担当者ぶんだけを計算する。
//   （選ぶまでランキングは計算しない＝初期ロードが軽い。）
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const ALL_TOKEN = "__all__";
const UNASSIGNED_TOKEN = "__unassigned__";

export function MatchingAssigneePicker({
  agents, unassigned, total, opColMissing,
}: {
  agents: { name: string; count: number }[];
  unassigned: number;
  total: number;
  opColMissing?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  // URL の現在値からローカル選択状態を初期化。
  const initial = useMemo(() => {
    const raw = (sp?.get("assignee") ?? "").trim();
    const parts = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    return {
      all: parts.includes(ALL_TOKEN),
      unassigned: parts.includes(UNASSIGNED_TOKEN),
      names: new Set(parts.filter((p) => p !== ALL_TOKEN && p !== UNASSIGNED_TOKEN)),
    };
  }, [sp]);

  const [all, setAll] = useState(initial.all);
  const [unassignedSel, setUnassignedSel] = useState(initial.unassigned);
  const [names, setNames] = useState<Set<string>>(initial.names);

  const selectedCount = all ? total : [...names].reduce((s, n) => s + (agents.find((a) => a.name === n)?.count ?? 0), 0) + (unassignedSel ? unassigned : 0);
  const hasSelection = all || unassignedSel || names.size > 0;

  const toggleName = (n: string) => {
    setAll(false);
    setNames((prev) => { const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next; });
  };
  const toggleUnassigned = () => { setAll(false); setUnassignedSel((v) => !v); };
  const toggleAll = () => {
    const next = !all;
    setAll(next);
    if (next) { setNames(new Set()); setUnassignedSel(false); }
  };

  const apply = () => {
    const u = new URLSearchParams(sp?.toString() ?? "");
    let value = "";
    if (all) value = ALL_TOKEN;
    else {
      const parts = [...names];
      if (unassignedSel) parts.push(UNASSIGNED_TOKEN);
      value = parts.join(",");
    }
    if (value) u.set("assignee", value); else u.delete("assignee");
    router.push(`/matching?${u.toString()}`);
  };
  const clear = () => {
    const u = new URLSearchParams(sp?.toString() ?? "");
    u.delete("assignee");
    setAll(false); setUnassignedSel(false); setNames(new Set());
    router.push(`/matching?${u.toString()}`);
  };

  const chip = (active: boolean, label: React.ReactNode, onClick: () => void, key?: string) => (
    <button key={key} type="button" onClick={onClick}
      style={{
        fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
        border: active ? "1px solid var(--color-brand-600)" : "1px solid var(--color-border-strong)",
        background: active ? "var(--color-brand-600)" : "var(--color-surface)",
        color: active ? "#fff" : "var(--color-ink-2)", whiteSpace: "nowrap",
      }}>{label}</button>
  );

  const appliedRaw = (sp?.get("assignee") ?? "").trim();

  return (
    <div className="card" style={{ padding: "12px 16px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--color-brand-700)" }}>group</span>
        <b style={{ fontSize: 13 }}>担当者でしぼる</b>
        <span className="muted" style={{ fontSize: 11 }}>選んだ担当者の人材だけをマッチングします（負荷軽減のため、選ぶまで計算しません）。</span>
      </div>

      {opColMissing ? (
        <div className="muted" style={{ fontSize: 12 }}>
          担当者（operator）列が未整備のため個別の絞り込みはできません。「全員」で表示できます。
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {chip(all, <>全員 <span style={{ opacity: 0.85 }}>({total.toLocaleString("ja-JP")})</span></>, toggleAll, "__all__")}
          {agents.map((a) => chip(!all && names.has(a.name), <>{a.name} <span style={{ opacity: 0.7 }}>({a.count})</span></>, () => toggleName(a.name), a.name))}
          {unassigned > 0 && chip(!all && unassignedSel, <>未割当 <span style={{ opacity: 0.7 }}>({unassigned})</span></>, toggleUnassigned, "__unassigned__")}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn brand" onClick={apply} disabled={!hasSelection}
          style={{ fontWeight: 700 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>search</span>
          この担当者で表示（{selectedCount.toLocaleString("ja-JP")}名）
        </button>
        {appliedRaw && <button type="button" className="btn ghost" onClick={clear}>クリア</button>}
        {!hasSelection && <span className="muted" style={{ fontSize: 11 }}>担当者を1人以上選んでください。</span>}
      </div>
    </div>
  );
}
