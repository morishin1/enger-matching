"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "./icons";
import type { SidebarCounts } from "@/lib/counts";
import { type Role, hasSalesFunction } from "@/lib/roles";
import { isMenuAllowed } from "@/lib/menu-permissions";
import { ThemeToggle } from "./ThemeToggle";

type NavChild = { href: string; id: string; label: string; count?: keyof SidebarCounts; newCount?: keyof SidebarCounts };
type NavItem = { href: string; id: string; label: string; icon: keyof typeof Icons; count?: keyof SidebarCounts; hot?: boolean; children?: NavChild[] };

// 営業フローに沿った並び（ダッシュボード→取込→マスタ→マッチング→提案→稼働の順）。
// ダッシュボードを起点として先頭に置き、次に業務の入口となる「メール取込」を並べる。
// マッチングは「案件×人材」の中核。案件/人材/LP登録は子としてぶら下げ、
// 上部の統一タブ（MatchingPeerTabs）と意味的にも一致させる。
const NAV: NavItem[] = [
  { href: "/", id: "dashboard", label: "ダッシュボード", icon: "dashboard" },
  { href: "/mail", id: "mail", label: "メール取込", icon: "mail" },
  { href: "/companies", id: "companies", label: "企業", icon: "company", count: "companies" },
  { href: "/matching", id: "matching", label: "マッチング", icon: "matching", children: [
    { href: "/jobs",      id: "jobs",      label: "案件",   count: "jobs",      newCount: "newJobs" },
    { href: "/people",    id: "people",    label: "人材",   count: "people",    newCount: "newPeople" },
    { href: "/engineers", id: "engineers", label: "LP登録", count: "engineers", newCount: "newEngineers" },
  ] },
  { href: "/proposals", id: "proposals", label: "提案管理", icon: "proposals", count: "proposals" },
  // 稼働管理は「業務（稼働・請求）」と「書類送付」を子としてまとめる（散らばり防止）。
  { href: "/progress", id: "progress", label: "稼働管理", icon: "progress", count: "progress", children: [
    { href: "/progress",  id: "progress-ops", label: "業務（稼働・請求）" },
    { href: "/documents", id: "documents",    label: "書類送付" },
  ] },
];

// 振り返り・分析（時間軸での見直しに使う画面）。
//   「分析」1メニューに集約し、内部タブで KPI推移 / ファネル / パイプライン / 詳細分析 へ。
//   サイドバーの肥大化を避け、誰が見ても「ここで分析する」が一目で分かる導線にする。
const ANALYSIS: NavItem[] = [
  { href: "/kpi", id: "analytics-hub", label: "分析", icon: "analytics", children: [
    { href: "/kpi",       id: "kpi",       label: "KPI推移" },
    { href: "/funnel",    id: "funnel",    label: "ファネル" },
    { href: "/pipeline",  id: "pipeline",  label: "パイプライン" },
    { href: "/analytics", id: "analytics", label: "詳細分析" },
  ] },
];

// その他（補助ツール）。ユーザー管理（承認）は「設定」の子に統合（管理者しか触らない＆機能上も設定の一部）。
const TOOLS: NavItem[] = [
  { href: "/meetings", id: "meetings", label: "打合せ記録", icon: "inbox" },
  { href: "/reports", id: "reports", label: "日報", icon: "msg" },
  { href: "/pr", id: "pr", label: "PR・X集客", icon: "bolt" },
  { href: "/ai", id: "ai", label: "AIアシスタント", icon: "ai" },
  { href: "/settings", id: "settings", label: "設定", icon: "settings", children: [
    { href: "/settings/approvals", id: "approvals", label: "ユーザー管理", count: "approvalsPending" },
    { href: "/settings", id: "settings-main", label: "各種設定" },
  ] },
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

export function Sidebar({ counts, role = "admin", open = false, functions = [], teamRole = null, menuPerms, showTimecard = false }: { counts?: SidebarCounts; role?: Role; open?: boolean; functions?: string[]; teamRole?: string | null; menuPerms?: import("@/lib/menu-permissions").MenuPermissions; showTimecard?: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const [logoOk, setLogoOk] = useState(true);
  // 子メニュー展開（アクティブ階層は自動で開き、それ以外は折りたたみ。ユーザー操作で個別に開閉可）
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const isClient = role === "client";
  const isTenant = role === "partner" || role === "freelance";

  // 営業（一般）のメニューは「職能」で出し分け（兼務は和集合）
  const SALES_HREFS = ["/mail", "/matching", "/engineers", "/jobs", "/people", "/proposals", "/progress", "/companies", "/meetings", "/analytics", "/pipeline", "/kpi", "/funnel"];
  // ダッシュボード・稼働・分析・書類・企業は全エージェント可（分析ページは金額系を admin 限定で隠す）。
  //   企業は閲覧のみ（CSV書き出しは廃止）なので、職能に関わらずメンバーでも閲覧できるようにする。
  const allowed = new Set<string>(["/", "/progress", "/analytics", "/documents", "/companies"]);
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

  const nav0 = isClient ? CLIENT_NAV
    : isTenant ? TENANT_NAV
    : role === "agent" ? filterForAgent(NAV)
    : NAV; // admin は全部
  const analysis0 = (isClient || isTenant) ? []
    : role === "agent" ? filterForAgent(ANALYSIS)
    : ANALYSIS;
  const tools0base = (isClient || isTenant) ? []
    : role === "agent" ? TOOLS.filter((n) => n.href !== "/settings" && n.href !== "/settings/approvals") // 設定・ユーザー管理は admin のみ
    : TOOLS; // admin は設定・ユーザー管理含む全部
  // タイムカード（バイト/副業）。本人入力対象 or 承認者のみに表示（menuPerms の対象外＝常に出す）。
  const TIMECARD_ITEM: NavItem = { href: "/timecard", id: "timecard", label: "タイムカード", icon: "cal" };
  const tools0 = showTimecard ? [TIMECARD_ITEM, ...tools0base] : tools0base;

  // 役職(team_role)別メニュー表示権限の適用。
  //   ・管理者(admin)・クライアント・テナントは対象外（adminは常に全表示でロックアウト防止）。
  //   ・agent のみ menuPerms で絞り込む。子メニューも同様に判定。
  const applyMenuPerms = (items: NavItem[]): NavItem[] => {
    if (role !== "agent" || !menuPerms) return items;
    const out: NavItem[] = [];
    for (const n of items) {
      const kids = (n.children ?? []).filter((c) => isMenuAllowed(menuPerms, teamRole, c.href));
      if (isMenuAllowed(menuPerms, teamRole, n.href)) out.push({ ...n, children: kids });
      else if (kids.length > 0) out.push({ ...n, children: kids }); // 親が不可でも許可された子があれば親ごと表示
    }
    return out;
  };
  const nav = applyMenuPerms(nav0);
  const analysis = applyMenuPerms(analysis0);
  const tools = applyMenuPerms(tools0);

  return (
    <aside className={"side" + (open ? " open" : "")}>
      <div className="side-brand">
        {/* ロゴクリックで dx.enger.jp（ENGER business トップ）へ戻る */}
        <a href="https://dx.enger.jp" title="dx.enger.jp トップへ" style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit" }}>
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
        </a>
        {isClient && (
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".04em", color: "var(--color-brand-700)", background: "var(--color-brand-50)", border: "1px solid var(--color-brand-100)", padding: "2px 8px", borderRadius: 6, alignSelf: "center" }}>business</span>
        )}
      </div>

      {renderGroup(isClient ? "メニュー" : "取込・マッチング業務", nav)}
      {analysis.length > 0 && renderGroup("振り返り・分析", analysis)}
      {tools.length > 0 && renderGroup("その他", tools)}

      {/* サイドバー下部：ダークモード切替 */}
      <div style={{ marginTop: "auto", paddingTop: 12 }}>
        <ThemeToggle />
      </div>
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
                {/* Link と トグルボタンを並べる（<a> 内に <button> を入れない＝HTML仕様準拠）。
                    ネスト構造だとブラウザのDOM補正でハイドレーションがズレ、稀に
                    サイドメニュークリックが効かなくなる事象が起きていた。 */}
                <div style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
                  <Link href={n.href} className={"nav-item " + (parentActive ? "active" : "")}
                    style={{ flex: 1, minWidth: 0, paddingRight: hasChildren ? 6 : undefined }}>
                    <span className="ico">{Ico && <Ico />}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</span>
                    {badge != null && <span className={"badge " + (n.hot ? "hot" : "")}>{badge}</span>}
                  </Link>
                  {hasChildren && (
                    <button type="button" onClick={() => toggle(n.id)}
                      aria-label={isOpen ? "閉じる" : "開く"} aria-expanded={isOpen} title={isOpen ? "閉じる" : "開く"}
                      style={{ background: "transparent", border: 0, padding: "0 8px", marginLeft: 2, cursor: "pointer", color: "var(--color-ink-4)", display: "inline-flex", alignItems: "center", borderRadius: 8 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, transition: "transform .15s", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}>chevron_right</span>
                    </button>
                  )}
                </div>
                {isOpen && (() => {
                  // 兄弟の中で「最も長く一致する href」を1つだけ active にする。
                  // 例：/settings と /settings/approvals が兄弟だと、startsWith では
                  // /settings/approvals を開いたときに両方 active になってしまう。
                  const matched = n.children!.filter((c) => pathname === c.href || pathname.startsWith(c.href + "/"));
                  const activeChildHref = matched.length > 0
                    ? matched.reduce((best, c) => (c.href.length > best.length ? c.href : best), "")
                    : null;
                  return n.children!.map((c) => {
                  const total = c.count ? fmt(counts?.[c.count]) : null;
                  const newN = c.newCount ? counts?.[c.newCount] : undefined;
                  const subActive = c.href === activeChildHref;
                  return (
                    <Link key={c.id} href={c.href} className={"nav-item nav-sub " + (subActive ? "active" : "")}
                      style={{ paddingLeft: 38, fontSize: 12.5 }}>
                      <span style={{ color: "var(--color-ink-3)", fontWeight: 500 }}>{c.label}</span>
                      {total != null && <span className="badge" style={{ fontSize: 10 }}>{total}</span>}
                      {newN != null && newN > 0 && (
                        <span style={{ fontSize: 9, padding: "1px 6px", letterSpacing: ".04em", fontWeight: 800, borderRadius: 99, background: "var(--color-danger, #dc2626)", color: "#fff" }} title={`24時間以内の新着 ${newN} 件`}>NEW</span>
                      )}
                    </Link>
                  );
                  });
                })()}
              </Fragment>
            );
          })}
        </div>
      </Fragment>
    );
  }
}
