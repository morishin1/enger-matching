"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "./icons";
import type { SidebarCounts } from "@/lib/counts";
import { type Role, hasSalesFunction } from "@/lib/roles";

type NavChild = { href: string; id: string; label: string; count?: keyof SidebarCounts; newCount?: keyof SidebarCounts };
type NavItem = { href: string; id: string; label: string; icon: keyof typeof Icons; count?: keyof SidebarCounts; hot?: boolean; children?: NavChild[] };

// 営業フローに沿った並び：
//   ① ダッシュボード（毎日のホーム）
//   ② 打合せ記録（クライアント/SESと商談・面談 → ここから案件/人材を獲得）
//   ③ 取り込んだ情報（企業 → 案件 → 人材 → LP登録）
//   ④ マッチング（案件×人材を当てる）
//   ⑤ 提案管理（提案→面談調整→クロージング→面談合格）
//   ⑥ 稼働管理（稼働化したペアの管理）
//   ⑦ 書類送付（契約書類）
//   ⑧ パイプライン／分析（全体の俯瞰と振り返り）
const NAV: NavItem[] = [
  { href: "/", id: "dashboard", label: "ダッシュボード", icon: "dashboard" },
  { href: "/meetings", id: "meetings", label: "打合せ記録", icon: "inbox" },
  { href: "/companies", id: "companies", label: "企業管理", icon: "company", count: "companies" },
  { href: "/jobs", id: "jobs", label: "案件", icon: "jobs", count: "jobs" },
  { href: "/people", id: "people", label: "人材", icon: "people", count: "people" },
  { href: "/engineers", id: "engineers", label: "LP登録", icon: "ai", count: "engineers" },
  { href: "/matching", id: "matching", label: "マッチング", icon: "matching" },
  { href: "/proposals", id: "proposals", label: "提案管理", icon: "proposals", count: "proposals" },
  { href: "/progress", id: "progress", label: "稼働管理", icon: "progress", count: "progress" },
  { href: "/documents", id: "documents", label: "書類送付", icon: "doc" },
  { href: "/pipeline", id: "pipeline", label: "パイプライン", icon: "pipeline" },
  { href: "/analytics", id: "analytics", label: "分析", icon: "analytics" },
];

const TOOLS: NavItem[] = [
  // 承認は日報の上に。承認待ちの未対応件数（pending合計）を NEW バッジで表示
  { href: "/settings/approvals", id: "approvals", label: "新規登録（承認）", icon: "person_add", count: "approvalsPending", hot: true },
  { href: "/reports", id: "reports", label: "日報", icon: "msg" },
  { href: "/inbox", id: "inbox", label: "受信箱", icon: "inbox" },
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
  const isClient = role === "client";
  const isTenant = role === "partner" || role === "freelance";

  // 営業（一般）のメニューは「職能」で出し分け（兼務は和集合）
  const SALES_HREFS = ["/matching", "/engineers", "/jobs", "/people", "/proposals", "/progress", "/companies", "/meetings", "/analytics"];
  const allowed = new Set<string>(["/", "/progress"]); // ダッシュボード・稼働/請求/勤怠は全エージェント可
  if (hasSalesFunction(functions)) SALES_HREFS.forEach((h) => allowed.add(h));
  if (functions.includes("バックオフィス")) { allowed.add("/progress"); allowed.add("/documents"); }

  const nav = isClient ? CLIENT_NAV
    : isTenant ? TENANT_NAV
    : role === "agent" ? NAV.filter((n) => allowed.has(n.href))
    : NAV; // admin は全部
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

      <div className="nav-group-label">{isClient ? "メニュー" : "業務"}</div>
      <div className="nav">
        {nav.map((n) => {
          const Ico = Icons[n.icon];
          const badge = n.count ? fmt(counts?.[n.count]) : null;
          const parentActive = isActive(n.href) || (n.children?.some((c) => pathname.startsWith(c.href)) ?? false);
          return (
            <Fragment key={n.id}>
              <Link href={n.href} className={"nav-item " + (parentActive ? "active" : "")}>
                <span className="ico">{Ico && <Ico />}</span>
                <span>{n.label}</span>
                {badge != null && <span className={"badge " + (n.hot ? "hot" : "")}>{badge}</span>}
              </Link>
              {n.children?.map((c) => {
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

      {tools.length > 0 && (
        <>
          <div className="nav-group-label">ツール</div>
          <div className="nav">
            {tools.map((n) => {
              const Ico = Icons[n.icon];
              return (
                <Link key={n.id} href={n.href} className={"nav-item " + (isActive(n.href) ? "active" : "")}>
                  <span className="ico">{Ico && <Ico />}</span>
                  <span>{n.label}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}

    </aside>
  );
}
