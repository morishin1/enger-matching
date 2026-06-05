// 業務フロー（Gmail取込 → 案件/人材 → マッチング → 提案 → 稼働）の
// 「次の工程へ」誘導リンク。各ページのヘッダ右に置く。
import Link from "next/link";

export function NextStepLink({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <Link href={href} title={hint ?? `次の工程：${label}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        textDecoration: "none",
        fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
        padding: "7px 13px", borderRadius: 99,
        background: "var(--color-brand-25, #f0f9ff)",
        border: "1px solid var(--color-brand-200, #bfdcfa)",
        color: "var(--color-brand-700, #0b5cab)",
        whiteSpace: "nowrap",
      }}>
      <span>{label}</span>
      <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>arrow_forward</span>
    </Link>
  );
}
