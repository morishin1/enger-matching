"use client";

// マッチング配下のタブ（マッチング / 案件 / 人材 / サイト登録）。
// ヘッダー(topbar)内のパンくず右側に並べて表示する想定。
// pathname で active 判定し、該当画面以外では何も描画しない（早期 null）。
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SidebarCounts } from "@/lib/counts";

const TABS = [
  { key: "matching", href: "/matching", label: "マッチング" },
  { key: "jobs", href: "/jobs", label: "案件" },
  { key: "people", href: "/people", label: "人材" },
  { key: "engineers", href: "/engineers", label: "サイト経由登録" },
] as const;

type TabKey = typeof TABS[number]["key"];

function activeFromPath(path: string): TabKey | null {
  if (path.startsWith("/matching")) return "matching";
  if (path.startsWith("/jobs")) return "jobs";
  if (path.startsWith("/people")) return "people";
  if (path.startsWith("/engineers")) return "engineers";
  return null;
}

export function MatchingTabs({ counts }: { counts?: SidebarCounts }) {
  const path = usePathname() ?? "";
  const active = activeFromPath(path);
  if (!active) return null;

  const totalOf: Record<TabKey, number | undefined> = {
    matching: undefined,
    jobs: counts?.jobs,
    people: counts?.people,
    engineers: counts?.engineers,
  };
  const newOf: Record<TabKey, number | undefined> = {
    matching: undefined,
    jobs: counts?.newJobs,
    people: counts?.newPeople,
    engineers: counts?.newEngineers,
  };
  const fmt = (n?: number) => (n == null ? null : n.toLocaleString("ja-JP"));

  return (
    <div role="tablist" style={{ display: "flex", gap: 0, alignItems: "center", overflowX: "auto", minWidth: 0 }}>
      {TABS.map((t) => {
        const isActive = t.key === active;
        const total = fmt(totalOf[t.key]);
        const n = newOf[t.key];
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={isActive}
            style={{
              padding: "8px 14px",
              borderBottom: isActive ? "2px solid var(--color-brand-600)" : "2px solid transparent",
              color: isActive ? "var(--color-brand-700)" : "var(--color-ink-3)",
              fontWeight: isActive ? 700 : 500,
              fontSize: 13,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
            }}
          >
            <span>{t.label}</span>
            {total != null && <span className="badge" style={{ fontSize: 10, padding: "1px 6px" }}>{total}</span>}
            {n != null && n > 0 && (
              <span className="badge hot" style={{ fontSize: 9, padding: "1px 6px", letterSpacing: ".04em" }} title={`直近7日の新着 ${n} 件`}>NEW</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
