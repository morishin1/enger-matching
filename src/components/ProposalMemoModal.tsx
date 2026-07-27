"use client";

// メモ追加モーダル。カテゴリ（連絡記録／当社⇄案件側／当社⇄人材側）と本文を入力。
import { useEffect, useState, useTransition } from "react";
import { addProposalMemo } from "@/lib/actions";
import { PROPOSAL_MEMO_CATEGORIES, normalizeMemoCategory } from "@/lib/proposal-constants";

const CATEGORY_TONE: Record<string, { fg: string; bg: string }> = {
  連絡記録:        { fg: "#0095D9", bg: "#e0f2fe" },
  "当社→案件側":   { fg: "#b42318", bg: "#fdecef" },
  "案件側→当社":   { fg: "#d98a2b", bg: "#fef3e2" },
  "当社→人材側":   { fg: "#7c3aed", bg: "#ede9fe" },
  "人材側→当社":   { fg: "#067647", bg: "#e7f7ee" },
};
/** @client-only ブラウザ側でのみ使う（サーバーコンポーネントからは呼ばない）。 */
export const memoCategoryTone = (c: string) => CATEGORY_TONE[normalizeMemoCategory(c)] ?? { fg: "#6b7280", bg: "#f3f4f6" };

export function ProposalMemoModal({ proposalId, onClose, onAdded }: { proposalId: string; onClose: () => void; onAdded?: () => void }) {
  const [category, setCategory] = useState<string>(PROPOSAL_MEMO_CATEGORIES[0]);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await addProposalMemo(proposalId, category, body);
      if (!r.ok) { setError(r.error || "保存に失敗しました"); return; }
      onAdded?.();
      onClose();
    });
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,36,64,.55)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(520px, 96vw)", padding: 0, background: "var(--color-surface)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>メモを追加</div>
          <button type="button" onClick={onClose} className="btn ghost" aria-label="閉じる" style={{ fontSize: 18, lineHeight: 1, padding: "4px 10px" }}>×</button>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, color: "var(--color-ink-4)" }}>カテゴリ
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ fontFamily: "inherit", fontSize: 13.5, padding: "9px 11px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
              {PROPOSAL_MEMO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, color: "var(--color-ink-4)" }}>本文
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="例: 5/27(水) 17:30 架電 不通"
              style={{ fontFamily: "inherit", fontSize: 13, padding: "10px 11px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", resize: "vertical", minHeight: 110 }} />
          </label>
          {error && <div style={{ fontSize: 12, color: "var(--color-danger)", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "8px 11px" }}>{error}</div>}
        </div>
        <div style={{ padding: "12px 22px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" disabled={pending} onClick={onClose}>キャンセル</button>
          <button type="button" className="btn brand" disabled={pending || !body.trim()} onClick={submit}>{pending ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </div>
  );
}
