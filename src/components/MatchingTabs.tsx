"use client";

// マッチング配下のタブ（マッチング / 案件 / 人材 / サイト登録）。
// 表示先：
//   - 通常はヘッダー(topbar)内に並べる（MatchingTabs）。
//   - /matching ではヘッダー側を非表示にし、ページ本体内（フローバー直下）に
//     MatchingPeerTabs として配置する（トップバーのスリム化）。
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SidebarCounts } from "@/lib/counts";

const TABS = [
  { key: "matching", href: "/matching", label: "マッチング" },
  { key: "jobs", href: "/jobs", label: "案件" },
  { key: "people", href: "/people", label: "人材" },
  { key: "engineers", href: "/engineers", label: "LP登録" },
] as const;

type TabKey = typeof TABS[number]["key"];

function activeFromPath(path: string): TabKey | null {
  if (path.startsWith("/matching")) return "matching";
  if (path.startsWith("/jobs")) return "jobs";
  if (path.startsWith("/people")) return "people";
  if (path.startsWith("/engineers")) return "engineers";
  return null;
}

/** ヘッダー用。/matching のときは本体側に描画を委譲して非表示にする（ヘッダースリム化）。 */
export function MatchingTabs({ counts, hideOnMatching = true }: { counts?: SidebarCounts; hideOnMatching?: boolean }) {
  const path = usePathname() ?? "";
  const active = activeFromPath(path);
  if (!active) return null;
  if (hideOnMatching && active === "matching") return null;
  return <PeerTabsInternal counts={counts} active={active} />;
}

/** マッチングページ本体用。ヘッダーから移動してきたタブ群をここに描画する。
 *  activeCount: 現在のページで絞り込み後の件数。アクティブタブのバッジを総数と連動表示する。 */
export function MatchingPeerTabs({ counts, activeCount }: { counts?: SidebarCounts; activeCount?: number }) {
  const path = usePathname() ?? "";
  const active = activeFromPath(path) ?? "matching";
  return <PeerTabsInternal counts={counts} active={active} activeCount={activeCount} />;
}

function PeerTabsInternal({ counts, active, activeCount }: { counts?: SidebarCounts; active: TabKey; activeCount?: number }) {
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
    <div role="tablist" style={{ display: "flex", gap: 2, alignItems: "center", overflowX: "auto", minWidth: 0, borderBottom: "1px solid var(--color-border)", marginBottom: 14 }}>
      {TABS.map((t) => {
        const isActive = t.key === active;
        const globalTotal = totalOf[t.key];
        // アクティブタブで絞り込み件数（activeCount）が渡され、総数と異なる場合は
        // 「絞り込み件数 / 総数」で連動表示。それ以外は従来どおり総数のみ。
        const isFiltered = isActive && activeCount != null && globalTotal != null && activeCount !== globalTotal;
        const total = fmt(isActive && activeCount != null ? activeCount : globalTotal);
        const n = newOf[t.key];
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={isActive}
            style={{
              padding: "10px 18px",
              borderBottom: isActive ? "3px solid var(--color-brand-600)" : "3px solid transparent",
              color: isActive ? "var(--color-brand-700)" : "var(--color-ink-2)",
              fontWeight: isActive ? 800 : 600,
              fontSize: 17,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              whiteSpace: "nowrap",
            }}
          >
            <span>{t.label}</span>
            {total != null && (
              <span className="badge" style={{ fontSize: 11, padding: "1px 7px", background: isFiltered ? "var(--color-brand-600)" : undefined, color: isFiltered ? "#fff" : undefined }}
                title={isFiltered ? `絞り込み ${total} 件 / 全 ${fmt(globalTotal)} 件` : undefined}>
                {total}{isFiltered && <span style={{ opacity: 0.8, fontWeight: 500 }}> / {fmt(globalTotal)}</span>}
              </span>
            )}
            {n != null && n > 0 && (
              <span
                className="material-symbols-outlined"
                title={`直近7日の新着 ${n} 件`}
                aria-label={`新着 ${n} 件`}
                style={{ fontSize: 18, lineHeight: 1, color: "var(--color-danger, #dc2626)", fontVariationSettings: "'FILL' 1" }}
              >
                fiber_new
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
