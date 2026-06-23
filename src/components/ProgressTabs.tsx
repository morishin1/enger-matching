"use client";

// 稼働管理セクションの共通タブ。/progress と /documents の上部に並べる。
//   ・業務（稼働管理） → /progress  （月初業務・契約管理）
//   ・書類送付         → /documents （契約書類の送付状況）
// 両者は「稼働中の取引に伴う運用業務」という同じ文脈に属するため、サイドバーで
// 別メニューに散らさず1つの稼働管理にまとめる。

import Link from "@/components/AppLink";
import { usePathname } from "next/navigation";

const TABS = [
  { key: "progress",  href: "/progress",  label: "業務（稼働・請求）", icon: "checklist" },
  { key: "documents", href: "/documents", label: "書類送付",           icon: "description" },
] as const;

type Key = typeof TABS[number]["key"];

function activeFromPath(path: string): Key | null {
  if (path.startsWith("/progress")) return "progress";
  if (path.startsWith("/documents")) return "documents";
  return null;
}

export function ProgressTabs() {
  const path = usePathname() ?? "";
  const active = activeFromPath(path);
  if (!active) return null;
  return (
    <nav role="tablist" aria-label="稼働管理タブ"
      style={{ display: "flex", gap: 2, alignItems: "center", overflowX: "auto", minWidth: 0, borderBottom: "1px solid var(--color-border)", marginBottom: 14 }}>
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link key={t.key} href={t.href} role="tab" aria-selected={on}
            style={{
              padding: "10px 18px",
              borderBottom: on ? "3px solid var(--color-brand-600)" : "3px solid transparent",
              color: on ? "var(--color-brand-700)" : "var(--color-ink-2)",
              fontWeight: on ? 800 : 600,
              fontSize: 15,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
            }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18 }}>{t.icon}</span>
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
