"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "./icons";
import type { SidebarCounts } from "@/lib/counts";
import { canAccess, type Role } from "@/lib/roles";

const NAV = [
  { href: "/", id: "dashboard", label: "ダッシュボード", icon: "dashboard" },
  { href: "/matching", id: "matching", label: "マッチング", icon: "matching", count: "matching", hot: true },
  { href: "/jobs", id: "jobs", label: "案件", icon: "jobs", count: "jobs" },
  { href: "/people", id: "people", label: "人材", icon: "people", count: "people" },
  { href: "/proposals", id: "proposals", label: "提案管理", icon: "proposals", count: "proposals" },
  { href: "/progress", id: "progress", label: "稼働管理", icon: "progress", count: "progress" },
  { href: "/companies", id: "companies", label: "企業管理", icon: "company", count: "companies" },
  { href: "/billing", id: "billing", label: "請求・勤怠", icon: "yen" },
  { href: "/meetings", id: "meetings", label: "打合せ記録", icon: "inbox" },
  { href: "/pipeline", id: "pipeline", label: "パイプライン", icon: "pipeline" },
  { href: "/analytics", id: "analytics", label: "分析", icon: "analytics" },
] as const;

const TOOLS = [
  { href: "/inbox", id: "inbox", label: "受信箱", icon: "inbox" },
  { href: "/ai", id: "ai", label: "AIアシスタント", icon: "ai" },
  { href: "/settings", id: "settings", label: "設定", icon: "settings" },
] as const;

// ユーザー企業(client)向けの専用メニュー
const CLIENT_NAV = [
  { href: "/", id: "home", label: "ホーム", icon: "dashboard" },
  { href: "/portal/jobs", id: "portal-jobs", label: "自社案件", icon: "jobs" },
  { href: "/portal/candidates", id: "portal-candidates", label: "おすすめ人材", icon: "people" },
] as const;

const fmt = (n?: number) => (n == null ? null : n.toLocaleString("ja-JP"));

export function Sidebar({ counts, role = "admin", open = false }: { counts?: SidebarCounts; role?: Role; open?: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const [logoOk, setLogoOk] = useState(true);
  const isClient = role === "client";
  const nav = isClient ? CLIENT_NAV : NAV.filter((n) => canAccess(role, n.href));
  const tools = isClient ? [] : TOOLS.filter((n) => canAccess(role, n.href));

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
              <small>Matching</small>
            </div>
          </>
        )}
      </div>

      <div className="nav-group-label">{isClient ? "メニュー" : "業務"}</div>
      <div className="nav">
        {nav.map((n) => {
          const Ico = Icons[n.icon];
          const badge = "count" in n ? fmt(counts?.[n.count as keyof SidebarCounts]) : null;
          return (
            <Link key={n.id} href={n.href} className={"nav-item " + (isActive(n.href) ? "active" : "")}>
              <span className="ico">{Ico && <Ico />}</span>
              <span>{n.label}</span>
              {badge != null && <span className={"badge " + (("hot" in n && n.hot) ? "hot" : "")}>{badge}</span>}
            </Link>
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
