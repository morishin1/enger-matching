"use client";

// 分析セクションの共通タブ。/kpi /funnel /pipeline /analytics の上部に並べ、
// 1つの「分析」エリア配下にあることを視覚化する（サイドバーが肥大化しないよう統合）。
//   ・KPI推移      → /kpi      （メンバー別動き＋指標推移＝活動の見える化）
//   ・ファネル      → /funnel   （提案→面談→稼働の歩留まり）
//   ・パイプライン  → /pipeline （売上フォーキャスト）
//   ・詳細分析      → /analytics（育成戦略・スコアカード・失注理由・コーチング）

import Link from "@/components/AppLink";
import { usePathname } from "next/navigation";

const TABS = [
  { key: "kpi",       href: "/kpi",       label: "KPI推移",     icon: "trending_up" },
  { key: "funnel",    href: "/funnel",    label: "ファネル",     icon: "filter_alt" },
  { key: "pipeline",  href: "/pipeline",  label: "パイプライン", icon: "stacked_line_chart" },
  { key: "analytics", href: "/analytics", label: "詳細分析",     icon: "insights" },
] as const;

type Key = typeof TABS[number]["key"];

function activeFromPath(path: string): Key | null {
  if (path.startsWith("/kpi")) return "kpi";
  if (path.startsWith("/funnel")) return "funnel";
  if (path.startsWith("/pipeline")) return "pipeline";
  if (path.startsWith("/analytics")) return "analytics";
  return null;
}

export function AnalyticsTabs() {
  const path = usePathname() ?? "";
  const active = activeFromPath(path);
  if (!active) return null;
  return (
    <nav role="tablist" aria-label="分析タブ"
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
