"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "./icons";
import type { SidebarCounts } from "@/lib/counts";
import { type Role, hasSalesFunction } from "@/lib/roles";

type NavChild = { href: string; id: string; label: string; count?: keyof SidebarCounts; newCount?: keyof SidebarCounts };
type NavItem = { href: string; id: string; label: string; icon: keyof typeof Icons; count?: keyof SidebarCounts; hot?: boolean; children?: NavChild[] };

// 営業フローに沿った並び（ダッシュボード→取込→マスタ→マッチング→提案→稼働の順）。
// ダッシュボードを起点として先頭に置き、次に業務の入口となる「メール取込」を並べる。
const NAV: NavItem[] = [
  { href: "/", id: "dashboard", label: "ダッシュボード", icon: "dashboard" },
  { href: "/mail", id: "mail", label: "メール取込", icon: "mail" },
  { href: "/companies", id: "companies", label: "企業", icon: "company", count: "companies" },
  { href: "/jobs", id: "jobs", label: "案件", icon: "jobs", count: "jobs" },
  { href: "/people", id: "people", label: "人材", icon: "people", count: "people", children: [
    { href: "/engineers", id: "engineers", label: "LP登録（フリーランス）", count: "engineers" },
  ] },
  { href: "/matching", id: "matching", label: "マッチング", icon: "matching" },
  { href: "/proposals", id: "proposals", label: "提案管理", icon: "proposals", count: "proposals" },
  { href: "/progress", id: "progress", label: "稼働管理", icon: "progress", count: "progress" },
];

// 振り返り・分析（時間軸での見直しに使う画面）。
const ANALYSIS: NavItem[] = [
  { href: "/kpi", id: "kpi", label: "KPI 推移", icon: "analytics" },
  { href: "/analytics", id: "analytics", label: "分析", icon: "analytics", children: [
    { href: "/pipeline", id: "pipeline", label: "パイプライン" },
    { href: "/documents", id: "documents", label: "書類送付" },
  ] },
];

// その他（補助ツール）。
const TOOLS: NavItem[] = [
  { href: "/settings/approvals", id: "approvals", label: "新規登録（承認）", icon: "person_add", count: "approvalsPending", hot: true },
  { href: "/meetings", id: "meetings", label: "打合せ記録", icon: "inbox" },
  { href: "/reports", id: "reports", label: "日報", icon: "msg" },
  { href: "/pr", id: "pr", label: "PR・X集客", icon: "bolt" },
  { href: "/ai", id: "ai", label: "AIアシスタント", icon: "ai" },
  { href: "/settings", id: "settings", label: "設定", icon: "settings" },
];

// テナント隔離ロール(partner/freelance)向けメニュー。漏洩防止のため限定（自分＋共有のみ／他社は匿名）。
const TENANT_NAV: NavItem[] = [
  { href: "/", id: "t-home", label: "ホーム", icon: "dashboard" },
  { href: "/matching", id: "t-matching", label: "マッチング", icon: "matching" },
  { href: "/jobs", id: "t-jobs", label: "案件（自分・共有）", icon: "jobs" },
  { href: "/people", id: "t-people", label: "人材（自分・共有）", icon: "people" },
];

// ユーザー企業(client)向けの専用メニュー
const CLIENT_NAV: NavItem[] = [
  { href: "/", id: "home", label: "ホーム", icon: "dashboard" },
  { href: "/portal/jobs", id: "portal-jobs", label: "自社案件", icon: "jobs" },
  { href: "/portal/candidates", id: "portal-candidates", label: "おすすめ人材", icon: "people" },
  { href: "/portal/selection", id: "portal-selection", label: "選考管理", icon: "proposals" },
  { href: "/portal/company", id: "portal-company", label: "企業プロフィール", icon: "company" },
];

const fmt = (n?: number) => (n == null ? null : n.toLocaleString("ja-JP"));

export function Sidebar({ counts, role = "admin", open = false, functions = [] }: { counts?: SidebarCounts; role?: Role; open?: boolean; functions?: string[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const [logoOk, setLogoOk] = useState(true);
  // 子メニュー展開（アクティブ階層は自動で開き、それ以外は折りたたみ。ユーザー操作で個別に開閉可）
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const isClient = role === "client";
  const isTenant = role === "partner" || role === "freelance";

  // 営業（一般）のメニューは「職能」で出し分け（兼務は和集合）
  const SALES_HREFS = ["/mail", "/matching", "/engineers", "/jobs", "/people", "/proposals", "/progress", "/companies", "/meetings", "/analytics", "/pipeline", "/kpi"];
  // ダッシュボード・稼働・分析・書類は全エージェント可（分析ページは金額系を admin 限定で隠す）
  const allowed = new Set<string>(["/", "/progress", "/analytics", "/documents"]);
  if (hasSalesFunction(functions)) SALES_HREFS.forEach((h) => allowed.add(h));
  if (functions.includes("バックオフィス")) { allowed.add("/progress"); allowed.add("/documents"); }

  // エージェントは許可された項目・子のみ。親が不可でも許可された子があれば親ごと表示。
  const filterForAgent = (items: NavItem[]): NavItem[] => {
    const out: NavItem[] = [];
    for (const n of items) {
      const kids = (n.children ?? []).filter((c) => allowed.has(c.href));
      if (allowed.has(n.href) || kids.length > 0) out.push({ ...n, children: kids });
    }
    return out;
  };

  const nav = isClient ? CLIENT_NAV
    : isTenant ? TENANT_NAV
    : role === "agent" ? filterForAgent(NAV)
    : NAV; // admin は全部
  const analysis = (isClient || isTenant) ? []
    : role === "agent" ? filterForAgent(ANALYSIS)
    : ANALYSIS;
  const tools = (isClient || isTenant) ? []
    : role === "agent" ? TOOLS.filter((n) => n.href !== "/settings") // 設定は admin のみ、承認はエージェントも可
    : TOOLS; // admin は設定・承認含む全部

  return (
    <aside className={"side" + (open ? " open" : "")}>
      <div className="side-brand">
        {logoOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/enger-logo.png"
            alt="ENGER"
            className="brand-logo"
            onError={() => setLogoOk(false)}
            style={{ height: 30, width: "auto", objectFit: "contain" }}
          />
        ) : (
          <>
            <div className="logo">E</div>
            <div className="wm">
              ENGER
              <small>{isClient ? "business" : "Matching"}</small>
            </div>
          </>
        )}
        {isClient && (
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".04em", color: "var(--color-brand-700)", background: "var(--color-brand-50)", border: "1px solid var(--color-brand-100)", padding: "2px 8px", borderRadius: 6, alignSelf: "center" }}>business</span>
        )}
      </div>

      {renderGroup(isClient ? "メニュー" : "取込・マッチング業務", nav)}
      {analysis.length > 0 && renderGroup("振り返り・分析", analysis)}
      {tools.length > 0 && renderGroup("その他", tools)}

    </aside>
  );

  // 1グループ（ラベル＋メニュー一覧）をレンダリング。NAV/ANALYSIS/TOOLSで共通利用。
  function renderGroup(label: string, items: NavItem[]) {
    return (
      <Fragment key={label}>
        <div className="nav-group-label">{label}</div>
        <div className="nav">
          {items.map((n) => {
            const Ico = Icons[n.icon];
            const badge = n.count ? fmt(counts?.[n.count]) : null;
            const hasChildren = (n.children?.length ?? 0) > 0;
            const childOnPath = n.children?.some((c) => pathname.startsWith(c.href)) ?? false;
            const parentActive = isActive(n.href) || childOnPath;
            const isOpen = hasChildren && (expanded[n.id] ?? childOnPath);
            return (
              <Fragment key={n.id}>
                <Link href={n.href} className={"nav-item " + (parentActive ? "active" : "")}
                  style={{ position: "relative" }}>
                  <span className="ico">{Ico && <Ico />}</span>
                  <span>{n.label}</span>
                  {badge != null && <span className={"badge " + (n.hot ? "hot" : "")}>{badge}</span>}
                  {hasChildren && (
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(n.id); }}
                      aria-label={isOpen ? "閉じる" : "開く"} title={isOpen ? "閉じる" : "開く"}
                      style={{ marginLeft: badge != null ? 4 : "auto", background: "transparent", border: "none", padding: "2px 4px", cursor: "pointer", color: "var(--color-ink-4)", display: "inline-flex", alignItems: "center", borderRadius: 4 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, transition: "transform .15s", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}>chevron_right</span>
                    </button>
                  )}
                </Link>
                {isOpen && n.children?.map((c) => {
                  const total = c.count ? fmt(counts?.[c.count]) : null;
                  const newN = c.newCount ? counts?.[c.newCount] : undefined;
                  const subActive = pathname.startsWith(c.href);
                  return (
                    <Link key={c.id} href={c.href} className={"nav-item nav-sub " + (subActive ? "active" : "")}
                      style={{ paddingLeft: 38, fontSize: 12.5 }}>
                      <span style={{ color: "var(--color-ink-3)", fontWeight: 500 }}>{c.label}</span>
                      {total != null && <span className="badge" style={{ fontSize: 10 }}>{total}</span>}
                      {newN != null && newN > 0 && (
                        <span className="badge hot" style={{ fontSize: 9, padding: "1px 6px", letterSpacing: ".04em" }} title={`直近7日の新着 ${newN} 件`}>NEW</span>
                      )}
                    </Link>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
      </Fragment>
    );
  }
}
