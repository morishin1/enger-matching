import Link from "next/link";
import { CompanyApprovalBadge } from "./CompanyApprovalBadge";

// 企業名を企業詳細（/companies/[name]）へのリンクにする。任意で承認バッジを併記。
export function CompanyLink({ name, approved, badge = false, badgeSize = "xs", linkStyle }: {
  name?: string | null; approved?: boolean; badge?: boolean; badgeSize?: "sm" | "xs"; linkStyle?: React.CSSProperties;
}) {
  const n = (name ?? "").trim();
  if (!n) return <span className="muted">—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Link href={`/companies/${encodeURIComponent(n)}`} title="企業の詳細（案件・人材）を見る"
        style={{ color: "var(--color-brand-700)", textDecoration: "none", ...linkStyle }}>{n}</Link>
      {badge && <CompanyApprovalBadge approved={!!approved} size={badgeSize} />}
    </span>
  );
}
