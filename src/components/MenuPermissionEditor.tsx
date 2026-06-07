"use client";

// 役職別メニュー表示権限マトリクス。
//   行＝メニュー、列＝役職（マネージャー/リーダー/メンバー/役職なし）。チェックでON/OFF。
//   「保存」で app_settings に保存し、サイドバーに反映。管理者は常に全表示（対象外）。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMenuPermissions } from "@/app/settings/permission-actions";
import { MENU_ITEMS, MENU_ROLE_KEYS, MENU_ROLE_LABEL, type MenuPermissions } from "@/lib/menu-permissions";

export function MenuPermissionEditor({ initial }: { initial: MenuPermissions }) {
  const router = useRouter();
  const [perms, setPerms] = useState<MenuPermissions>(() => JSON.parse(JSON.stringify(initial)));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const toggle = (rk: typeof MENU_ROLE_KEYS[number], href: string) => {
    setPerms((p) => {
      const next = { ...p, [rk]: { ...p[rk], [href]: !(p[rk]?.[href] !== false) } };
      return next;
    });
    setDirty(true);
  };
  const setCol = (rk: typeof MENU_ROLE_KEYS[number], on: boolean) => {
    setPerms((p) => { const col: Record<string, boolean> = {}; for (const m of MENU_ITEMS) col[m.href] = on; return { ...p, [rk]: col }; });
    setDirty(true);
  };

  const save = () => {
    setMsg(null);
    start(async () => {
      const r = await saveMenuPermissions(perms);
      if (r.ok) { setMsg({ ok: true, text: "保存しました（サイドバーに反映されます）" }); setDirty(false); router.refresh(); }
      else setMsg({ ok: false, text: r.error ?? "保存に失敗しました" });
    });
  };

  const on = (rk: typeof MENU_ROLE_KEYS[number], href: string) => perms[rk]?.[href] !== false;
  const th: React.CSSProperties = { padding: "8px 10px", fontSize: 11.5, fontWeight: 700, color: "var(--color-ink-3)", textAlign: "center", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: "6px 10px", textAlign: "center", borderTop: "1px solid var(--color-border)" };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🔐 役職別メニュー表示権限</h3>
        <span className="muted" style={{ fontSize: 11 }}>チェックを外すと、その役職のサイドバーから非表示になります</span>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12, lineHeight: 1.7 }}>
        対象は<b>エージェント</b>のみ。<b>管理者は常に全メニュー表示</b>（ロックアウト防止）。
        ダッシュボード・設定・ユーザー管理（承認）は土台のため対象外で常時表示します。
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 520 }}>
          <thead>
            <tr style={{ background: "var(--color-surface-soft)" }}>
              <th style={{ ...th, textAlign: "left" }}>メニュー</th>
              {MENU_ROLE_KEYS.map((rk) => (
                <th key={rk} style={th}>
                  <div>{MENU_ROLE_LABEL[rk]}</div>
                  <div style={{ display: "inline-flex", gap: 4, marginTop: 4 }}>
                    <button type="button" onClick={() => setCol(rk, true)} title="全ON" style={{ fontSize: 9.5, padding: "1px 6px", borderRadius: 6, border: "1px solid var(--color-border)", background: "#fff", cursor: "pointer", color: "#067647" }}>全ON</button>
                    <button type="button" onClick={() => setCol(rk, false)} title="全OFF" style={{ fontSize: 9.5, padding: "1px 6px", borderRadius: 6, border: "1px solid var(--color-border)", background: "#fff", cursor: "pointer", color: "#b42318" }}>全OFF</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MENU_ITEMS.map((m) => (
              <tr key={m.href}>
                <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{m.label}<span className="muted mono" style={{ fontSize: 10, marginLeft: 6, fontWeight: 400 }}>{m.href}</span></td>
                {MENU_ROLE_KEYS.map((rk) => (
                  <td key={rk} style={td}>
                    <input type="checkbox" checked={on(rk, m.href)} onChange={() => toggle(rk, m.href)} style={{ width: 16, height: 16, accentColor: "var(--color-brand-600)", cursor: "pointer" }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <button type="button" className="btn brand" disabled={pending || !dirty} onClick={save}>{pending ? "保存中…" : "保存する"}</button>
        {dirty && <span className="muted" style={{ fontSize: 11.5, color: "#b45309" }}>未保存の変更があります</span>}
        {msg && <span style={{ fontSize: 12, color: msg.ok ? "#067647" : "var(--color-danger)" }}>{msg.text}</span>}
      </div>
    </div>
  );
}
