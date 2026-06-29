"use client";

// KPI推移「メンバー編集・追加・削除」メニュー。
//   ・担当者名を追加／削除し、チーム（アウトサイド/インサイド/テレアポ）を割り当てる。
//   ・保存すると app_settings(kpi_members) に保存され、
//       - KPI推移「メンバー別 ステージ目標・KPI/KGI達成率」のメンバー行・役割
//       - 打ち合わせ記録の「自社担当」プルダウンの選択肢
//     に反映される（1か所で管理）。
//   ・管理者またはマネージャー/リーダーのみ編集可能（canEdit）。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveKpiMembers } from "@/app/settings/permission-actions";
import { ROLE_LABEL, type KpiRoleKey } from "@/lib/kpi-roles";
import type { KpiMember } from "@/lib/kpi-members";

const TEAMS: KpiRoleKey[] = ["outside", "inside", "telapo"];
const TEAM_TONE: Record<KpiRoleKey, { bg: string; fg: string; bd: string }> = {
  outside: { bg: "#e7f7ee", fg: "#067647", bd: "#bfe3cc" },
  inside: { bg: "#e8f1fb", fg: "#0b5cab", bd: "#bcd8f5" },
  telapo: { bg: "#fff1e6", fg: "#b45309", bd: "#f5b97f" },
};

export function KpiMembersEditor({ initial, suggestions = [], canEdit }: { initial: KpiMember[]; suggestions?: string[]; canEdit?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<KpiMember[]>(initial ?? []);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  if (!canEdit) return null;

  const setAll = (xs: KpiMember[]) => { setMembers(xs); setDirty(true); setMsg(null); };
  const add = (name: string) => {
    const n = (name ?? "").trim();
    if (!n) return;
    if (members.some((m) => m.name === n)) { setInput(""); return; }
    setAll([...members, { name: n, team: null }]);
    setInput("");
  };
  const remove = (i: number) => setAll(members.filter((_, j) => j !== i));
  const setTeam = (i: number, team: KpiRoleKey | null) => setAll(members.map((m, j) => (j === i ? { ...m, team } : m)));

  const save = () => {
    setMsg(null);
    start(async () => {
      const r = await saveKpiMembers(members);
      if (r.ok) { setMsg({ ok: true, text: "保存しました（KPI推移・打ち合わせ記録に反映されます）" }); setDirty(false); router.refresh(); }
      else setMsg({ ok: false, text: r.error ?? "保存に失敗しました" });
    });
  };

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, marginBottom: 12, background: "var(--color-surface-inset)" }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "transparent", border: 0, cursor: "pointer", padding: "10px 12px", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: "var(--color-ink-2)" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>group</span>
        メンバー編集・追加・削除（{members.length}名）
        <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>担当者と所属チーム（アウトサイド/インサイド/テレアポ）を管理。打ち合わせ記録の自社担当にも反映。</span>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, marginLeft: "auto" }}>{open ? "expand_less" : "expand_more"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {members.length === 0 && <div className="muted" style={{ fontSize: 11.5 }}>メンバー未登録です。下の入力欄から追加してください。</div>}
            {members.map((m, i) => (
              <div key={m.name + i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600 }}>{m.name}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  {TEAMS.map((t) => {
                    const on = m.team === t;
                    const tone = TEAM_TONE[t];
                    return (
                      <button key={t} type="button" onClick={() => setTeam(i, on ? null : t)}
                        title={on ? "クリックで未設定に戻す" : ROLE_LABEL[t]}
                        style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99,
                          border: `1px solid ${on ? tone.bd : "var(--color-border)"}`, background: on ? tone.bg : "var(--color-surface)", color: on ? tone.fg : "var(--color-ink-4)" }}>
                        {ROLE_LABEL[t]}
                      </button>
                    );
                  })}
                </div>
                <button type="button" onClick={() => remove(i)} title="削除"
                  style={{ padding: "2px 8px", fontSize: 12, fontWeight: 800, color: "#b42318", background: "transparent", border: 0, cursor: "pointer", borderRadius: 6 }}>✕</button>
              </div>
            ))}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); add(input); }} style={{ display: "flex", gap: 6 }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="担当者の氏名を入力して追加" maxLength={30}
              style={{ flex: 1, fontFamily: "inherit", fontSize: 12.5, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }} />
            <button type="submit" className="btn brand btn-xs" disabled={!input.trim()}>＋ 追加</button>
          </form>

          {suggestions.filter((s) => !members.some((m) => m.name === s)).length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 10.5, alignSelf: "center" }}>アカウントから追加:</span>
              {suggestions.filter((s) => !members.some((m) => m.name === s)).slice(0, 12).map((s) => (
                <button key={s} type="button" onClick={() => add(s)}
                  style={{ fontSize: 10.5, padding: "3px 9px", borderRadius: 99, border: "1px dashed var(--color-border-strong)", background: "transparent", cursor: "pointer", color: "var(--color-ink-3)", fontFamily: "inherit" }}>
                  + {s}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button type="button" className="btn brand btn-sm" disabled={pending || !dirty} onClick={save}>{pending ? "保存中…" : "保存する"}</button>
            {dirty && <span className="muted" style={{ fontSize: 11.5, color: "#b45309" }}>未保存の変更があります</span>}
            {msg && <span style={{ fontSize: 12, color: msg.ok ? "#067647" : "var(--color-danger)" }}>{msg.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
