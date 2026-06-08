"use client";

// 取引NG（取引停止）ボタン。撤退検討カードや企業一覧から、根拠を添えてNG指定/解除する。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCompanyNg } from "@/lib/actions";

export function CompanyNgButton({ company, isNg, ngReason, suggestedReason }:
  { company: string; isNg: boolean; ngReason?: string | null; suggestedReason?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(ngReason ?? suggestedReason ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const apply = (ng: boolean) => {
    setMsg(null);
    start(async () => {
      const r = await setCompanyNg(company, ng, ng ? reason : null);
      if (r.ok) { setOpen(false); router.refresh(); }
      else setMsg(r.error ?? "更新に失敗しました");
    });
  };

  if (isNg) {
    return (
      <button type="button" onClick={() => apply(false)} disabled={pending}
        title={ngReason ? `NG理由: ${ngReason}（クリックで解除）` : "NG解除"}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 800, padding: "3px 9px", borderRadius: 99, cursor: "pointer", fontFamily: "inherit", background: "#fdecef", color: "#b42318", border: "1px solid #f7c5cf" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>block</span>
        取引NG（解除）
      </button>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={pending}
        title="この企業を取引NGに指定"
        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 99, cursor: "pointer", fontFamily: "inherit", background: "#fff", color: "#b42318", border: "1px solid #f7c5cf" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>block</span>
        NG指定
      </button>
      {open && (
        <div onClick={() => !pending && setOpen(false)} role="dialog" aria-modal="true"
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "center", zIndex: 600, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 460, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "#b42318" }}>block</span>
              {company} を取引NGに指定
            </h3>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
              NGにすると企業一覧で🚫表示になり、撤退判断の記録として残ります。根拠（理由）を入力してください。
            </div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={500}
              placeholder="例）提案◯件で稼働化0・失注多数（単価が合わない）。市場も縮小トレンドのため新規育成は見送り。"
              style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: 10, borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", resize: "vertical" }} />
            {msg && <div style={{ fontSize: 12, color: "var(--color-danger)" }}>{msg}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn ghost btn-xs" onClick={() => setOpen(false)} disabled={pending}>キャンセル</button>
              <button type="button" onClick={() => apply(true)} disabled={pending}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, border: 0, background: "#b42318", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
                <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>block</span>
                {pending ? "保存中…" : "NGに指定する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
