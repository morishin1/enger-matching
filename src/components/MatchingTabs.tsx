// マッチング配下のタブ（マッチング／案件／人材／エンジャー登録）。
// 各タブのバッジは直近7日の新着件数（getSidebarCounts.newJobs/newPeople/newEngineers）。
import Link from "next/link";
import { getSidebarCounts } from "@/lib/counts";

const TABS = [
  { key: "matching", href: "/matching", label: "マッチング" },
  { key: "jobs", href: "/jobs", label: "案件" },
  { key: "people", href: "/people", label: "人材" },
  { key: "engineers", href: "/engineers", label: "サイト登録" },
] as const;

export type MatchingTabKey = typeof TABS[number]["key"];

export async function MatchingTabs({ active }: { active: MatchingTabKey }) {
  const c = await getSidebarCounts();
  const totalOf: Record<MatchingTabKey, number | undefined> = {
    matching: undefined, // マッチング自体は集計対象が無いので非表示
    jobs: c.jobs,
    people: c.people,
    engineers: c.engineers,
  };
  const newOf: Record<MatchingTabKey, number | undefined> = {
    matching: undefined,
    jobs: c.newJobs,
    people: c.newPeople,
    engineers: c.newEngineers,
  };
  const fmt = (n?: number) => (n == null ? null : n.toLocaleString("ja-JP"));
  return (
    <div role="tablist" style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--color-border)", marginBottom: 16, overflowX: "auto" }}>
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
              padding: "10px 18px",
              borderBottom: isActive ? "2px solid var(--color-brand-600)" : "2px solid transparent",
              color: isActive ? "var(--color-brand-700)" : "var(--color-ink-3)",
              fontWeight: isActive ? 700 : 500,
              fontSize: 13.5,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              whiteSpace: "nowrap",
            }}
          >
            <span>{t.label}</span>
            {total != null && (
              <span className="badge" style={{ fontSize: 10.5, padding: "1px 7px" }}>{total}</span>
            )}
            {n != null && n > 0 && (
              <span className="badge hot" style={{ fontSize: 9.5, padding: "1px 6px", letterSpacing: ".04em" }} title={`直近7日の新着 ${n} 件`}>NEW</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
