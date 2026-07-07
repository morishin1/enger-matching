"use client";

// マッチング配下のタブ（マッチング / 案件 / 人材 / サイト登録）。
// 表示先：
//   - 通常はヘッダー(topbar)内に並べる（MatchingTabs）。
//   - /matching ではヘッダー側を非表示にし、ページ本体内（フローバー直下）に
//     MatchingPeerTabs として配置する（トップバーのスリム化）。
import Link from "@/components/AppLink";
import { usePathname, useSearchParams } from "next/navigation";
import type { SidebarCounts } from "@/lib/counts";
import { Icons } from "@/components/icons";

// タブ順は「マッチング → 注力 → 案件 → 人材 → フリーランス → LINE」。アイコンは Material Symbols Outlined。
//   ・注力＝旧・独立した「自動/注力」切り替えボタンを廃止し、通常タブへ統合（/matching?tab=focus）。
//   ・フリーランス＝ENGERフリーランス（LP登録/engineers）の登録者一覧。
//   ・LINE＝LINE経由の人材・案件＋LINE WORKSのやりとり（/line）。
const TABS = [
  { key: "matching", href: "/matching", label: "マッチング", icon: "compare_arrows" },
  { key: "focus", href: "/matching?tab=focus", label: "注力", icon: "favorite" },
  { key: "jobs", href: "/jobs", label: "案件", icon: "work" },
  { key: "people", href: "/people", label: "人材", icon: "groups" },
  { key: "engineers", href: "/engineers", label: "フリーランス", icon: "badge" },
  { key: "line", href: "/line", label: "LINE", icon: "chat" },
] as const;

type TabKey = typeof TABS[number]["key"];

// /matching は tab=focus のときだけ「注力」をアクティブにする（既定は「マッチング」＝自動）。
function resolveActiveTab(path: string, tabParam?: string | null): TabKey | null {
  if (path.startsWith("/matching")) return tabParam === "focus" ? "focus" : "matching";
  if (path.startsWith("/jobs")) return "jobs";
  if (path.startsWith("/people")) return "people";
  if (path.startsWith("/engineers")) return "engineers";
  if (path.startsWith("/line")) return "line";
  return null;
}

/** ヘッダー（トップバー）用。タブ対象ページ(マッチング/案件/人材/フリーランス/LINE)で常に表示。
 *  compact=true でトップバーに収まるコンパクト表示にする。 */
export function MatchingTabs({ counts, hideOnMatching = false, compact = true }: { counts?: SidebarCounts; hideOnMatching?: boolean; compact?: boolean }) {
  const path = usePathname() ?? "";
  const sp = useSearchParams();
  const active = resolveActiveTab(path, sp?.get("tab"));
  if (!active) return null;
  if (hideOnMatching && (active === "matching" || active === "focus")) return null;
  return <PeerTabsInternal counts={counts} active={active} compact={compact} />;
}

/** ページ本体用。説明文（各ページの page-head）の下に「パンくず → タブ」を縦に並べる。
 *  rightSlot を渡すと、タブ行の右側に並べて表示する（例：期間セレクタを全タブ共通の位置に置く）。 */
export function MatchingPeerTabs({ counts, activeCount, rightSlot }: { counts?: SidebarCounts; activeCount?: number; rightSlot?: React.ReactNode }) {
  const path = usePathname() ?? "";
  const sp = useSearchParams();
  const active = resolveActiveTab(path, sp?.get("tab")) ?? "matching";
  const sectionLabel = TABS.find((t) => t.key === active)?.label ?? "";
  // パンくず：ENGER / マッチング（/ セクション）。最後の項目を太字。
  const crumbs = active === "matching" ? ["ENGER", "マッチング"] : ["ENGER", "マッチング", sectionLabel];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && <span className="sep">/</span>}
            {i === crumbs.length - 1 ? <b>{c}</b> : <span>{c}</span>}
          </span>
        ))}
      </div>
      {/* タブ（左）＋期間など（右）を1段に。狭幅では右側が下へ折り返す。 */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <PeerTabsInternal counts={counts} active={active} activeCount={activeCount} />
        {rightSlot && <div style={{ flexShrink: 0, paddingBottom: 4 }}>{rightSlot}</div>}
      </div>
    </div>
  );
}

function PeerTabsInternal({ counts, active, activeCount, compact = false }: { counts?: SidebarCounts; active: TabKey; activeCount?: number; compact?: boolean }) {
  const totalOf: Record<TabKey, number | undefined> = {
    matching: undefined,
    focus: undefined,
    jobs: counts?.jobs,
    people: counts?.people,
    engineers: counts?.engineers,
    line: undefined,
  };
  const newOf: Record<TabKey, number | undefined> = {
    matching: undefined,
    focus: undefined,
    jobs: counts?.newJobs,
    people: counts?.newPeople,
    engineers: counts?.newEngineers,
    line: undefined,
  };
  const fmt = (n?: number) => (n == null ? null : n.toLocaleString("ja-JP"));

  return (
    <div role="tablist" style={{ display: "flex", gap: 2, alignItems: "stretch", overflowX: "auto", minWidth: 0, ...(compact ? {} : { borderBottom: "1px solid var(--color-border)", marginBottom: 14 }) }}>
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
              padding: compact ? "8px 12px" : "10px 18px",
              borderBottom: `${compact ? 2 : 3}px solid ${isActive ? "var(--color-brand-600)" : "transparent"}`,
              color: isActive ? "var(--color-brand-700)" : "var(--color-ink-2)",
              fontWeight: isActive ? 800 : 600,
              fontSize: compact ? 13.5 : 17,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              {/* LINE はブランドロゴ（Icons.line）、他は Material Symbols Outlined。 */}
              {t.key === "line"
                ? <span style={{ lineHeight: 0, display: "inline-flex" }}><Icons.line size={compact ? 17 : 20} /></span>
                : <span className="material-symbols-outlined" aria-hidden style={{ fontSize: compact ? 18 : 20, lineHeight: 1 }}>{t.icon}</span>}
              {t.label}
            </span>
            {total != null && (
              <span className="badge" style={{ fontSize: 11, padding: "1px 7px", background: isFiltered ? "var(--color-brand-600)" : undefined, color: isFiltered ? "#fff" : undefined }}
                title={isFiltered ? `絞り込み ${total} 件 / 全 ${fmt(globalTotal)} 件` : undefined}>
                {total}{isFiltered && <span style={{ opacity: 0.8, fontWeight: 500 }}> / {fmt(globalTotal)}</span>}
              </span>
            )}
            {n != null && n > 0 && (
              <span
                title={`24時間以内の新着 ${n} 件`}
                aria-label={`新着 ${n} 件`}
                style={{ fontSize: 9, padding: "1px 6px", letterSpacing: ".04em", fontWeight: 800, borderRadius: 99, background: "var(--color-danger, #dc2626)", color: "#fff", lineHeight: 1.4 }}
              >
                NEW
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
