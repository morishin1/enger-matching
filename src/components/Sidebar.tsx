"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "./icons";
import { MOCK } from "@/lib/mock";

const NAV = [
  { href: "/", id: "dashboard", label: "ダッシュボード", icon: "dashboard" },
  { href: "/matching", id: "matching", label: "マッチング", icon: "matching", badge: 9, hot: true },
  { href: "/jobs", id: "jobs", label: "案件", icon: "jobs", badge: 28 },
  { href: "/people", id: "people", label: "人材", icon: "people", badge: 412 },
  { href: "/companies", id: "companies", label: "企業管理", icon: "company", badge: 46 },
  { href: "/proposals", id: "proposals", label: "提案管理", icon: "proposals", badge: 14 },
  { href: "/progress", id: "progress", label: "進捗管理", icon: "progress", badge: 21 },
  { href: "/pipeline", id: "pipeline", label: "パイプライン", icon: "pipeline" },
  { href: "/analytics", id: "analytics", label: "分析", icon: "analytics" },
];

const TOOLS = [
  { href: "/inbox", id: "inbox", label: "受信箱", icon: "inbox", badge: 4 },
  { href: "/ai", id: "ai", label: "AIアシスタント", icon: "ai" },
  { href: "/settings", id: "settings", label: "設定", icon: "settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="side">
      <div className="side-brand">
        <div className="logo">E</div>
        <div className="wm">
          ENGER
          <small>Matching v2</small>
        </div>
      </div>

      <div className="nav-group-label">業務</div>
      <div className="nav">
        {NAV.map((n) => {
          const Ico = Icons[n.icon];
          return (
            <Link key={n.id} href={n.href} className={"nav-item " + (isActive(n.href) ? "active" : "")}>
              <span className="ico">{Ico && <Ico />}</span>
              <span>{n.label}</span>
              {n.badge != null && <span className={"badge " + (n.hot ? "hot" : "")}>{n.badge}</span>}
            </Link>
          );
        })}
      </div>

      <div className="nav-group-label">ツール</div>
      <div className="nav">
        {TOOLS.map((n) => {
          const Ico = Icons[n.icon];
          return (
            <Link key={n.id} href={n.href} className={"nav-item " + (isActive(n.href) ? "active" : "")}>
              <span className="ico">{Ico && <Ico />}</span>
              <span>{n.label}</span>
              {n.badge != null && <span className="badge">{n.badge}</span>}
            </Link>
          );
        })}
      </div>

      <div className="side-foot">
        <div className="ava">{MOCK.user.initials}</div>
        <div className="me">
          {MOCK.user.name}
          <small>{MOCK.user.role}</small>
        </div>
      </div>
    </aside>
  );
}
