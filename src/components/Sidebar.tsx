"use client";

import { useState, Fragment } from "react";
import Link from "@/components/AppLink";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "./icons";
import type { SidebarCounts } from "@/lib/counts";
import { type Role, hasSalesFunction } from "@/lib/roles";
import { isMenuAllowed } from "@/lib/menu-permissions";
import { ThemeToggle } from "./ThemeToggle";

type NavChild = { href: string; id: string; label: string; desc?: string; count?: keyof SidebarCounts; newCount?: keyof SidebarCounts };
type NavItem = { href: string; id: string; label: string; desc?: string; icon: keyof typeof Icons; count?: keyof SidebarCounts; dot?: keyof SidebarCounts; hot?: boolean; external?: boolean; children?: NavChild[] };

// 営業フローに沿った並び（ダッシュボード→取込→マスタ→マッチング→提案→稼働の順）。
// ダッシュボードを起点として先頭に置き、次に業務の入口となる「メール取込」を並べる。
// マッチングは「案件×人材」の中核。案件/人材/LP登録は子としてぶら下げ、
// 上部の統一タブ（MatchingPeerTabs）と意味的にも一致させる。
// サイドメニュー構成（要望）：
//   ダッシュボード → KGI/KPI → マッチング → 提案管理 → 打合せ記録 → 企業 → チャット →（その他: PR・集客 / 設定）
//   ダッシュボードは「現在のKGI/KPI」を起点に表示。マッチング配下＝案件/人材/フリーランス/LINE。
//   メール取り込みは業務の入口だが、上部を簡潔にするため「設定」配下へ移動（URLは従来どおり）。
const NAV: NavItem[] = [
  { href: "/", id: "dashboard", label: "ダッシュボード", desc: "現在のKGI/KPIと新着", icon: "dashboard" },
  { href: "/kgi", id: "kgi", label: "KGI/KPI", desc: "目標の分解と達成状況（営業日ベース）", icon: "analytics" },
  // 「マッチング」クリックはマッチング画面(/matching)に着地（既定タブ＝マッチング）。子は案件→人材→フリーランス→LINE。
  { href: "/matching", id: "matching", label: "マッチング", desc: "AIで最適な組み合わせを提案", icon: "matching", children: [
    { href: "/jobs",      id: "jobs",      label: "案件",       desc: "募集中の案件を管理",       count: "jobs",      newCount: "newJobs" },
    { href: "/people",    id: "people",    label: "人材",       desc: "登録人材を管理",           count: "people",    newCount: "newPeople" },
    { href: "/engineers", id: "engineers", label: "フリーランス", desc: "ENGERフリーランスの登録者", count: "engineers", newCount: "newEngineers" },
    { href: "/line",      id: "line",      label: "LINE",       desc: "LINE経由の人材・案件とトーク" },
  ] },
  { href: "/proposals", id: "proposals", label: "提案管理", desc: "提案状況・KPI・失注分析", icon: "proposals", count: "proposals" },
  { href: "/prospecting", id: "prospecting", label: "エンド開拓", desc: "リスト投入・接触・アポ獲得", icon: "bolt" },
  { href: "/meetings", id: "meetings", label: "打合せ記録", desc: "商談メモ・案件/人材情報の仕入れ", icon: "inbox" },
  { href: "/companies", id: "companies", label: "企業管理", desc: "取引先・商談の管理", icon: "company", count: "companies" },
  { href: "/chat", id: "chat", label: "チャット", desc: "人材・企業とのやりとり", icon: "msg", count: "chatUnread", hot: true },
  // 稼働管理は当面使わないためサイドメニューから非表示（要望）。復活時は下のコメントを解除するだけ。
  //   ※ ページ自体（/progress・/documents）は URL では引き続きアクセス可能。
  // { href: "/progress", id: "progress", label: "稼働管理", desc: "稼働・請求・書類の管理", icon: "progress", count: "progress", children: [
  //   { href: "/progress",  id: "progress-ops", label: "業務（稼働・請求）", desc: "稼働状況と請求" },
  //   { href: "/documents", id: "documents",    label: "書類送付", desc: "契約書類の送付" },
  // ] },
];

// 「分析」メニューは非表示にした（KPI推移は提案管理タブへ移動済み）。
//   各ページ（/kpi・/funnel・/pipeline・/analytics）は URL では引き続きアクセス可能。
//   復活させたい場合は ANALYSIS 配列を定義し、下の analysis0 にセットする。
const ANALYSIS: NavItem[] = [];

// その他（補助ツール）。日報は「設定」の配下にまとめ、AIアシスタントは非表示。
//   ※ メール取込は業務の入口なので admin ではトップメニュー（下の MAIL_TOP）に昇格した。
//   設定 …（親＝/settings）／ 日報（/reports）。
// その他（補助ツール）：PR・集客 と 設定（配下に メール取り込み / 日報）。
const TOOLS: NavItem[] = [
  { href: "/pr", id: "pr", label: "PR・集客", desc: "発信・集客", icon: "bolt" },
  { href: "/settings", id: "settings", label: "設定", desc: "アカウント・各種設定", icon: "settings", count: "approvalsPending", children: [
    { href: "/mail",    id: "mail",    label: "メール取り込み", desc: "Gmail取込・期間指定でダウンロード" },
    { href: "/reports", id: "reports", label: "日報",           desc: "気づき・改善の記録" },
    { href: "/settings/match-eval", id: "match-eval", label: "マッチング評価", desc: "成約/失注データでスコアを検証" },
  ] },
];

// テナント隔離ロール(partner/freelance)向けメニュー。漏洩防止のため限定（自分＋共有のみ／他社は匿名）。
const TENANT_NAV: NavItem[] = [
  { href: "/", id: "t-home", label: "ホーム", icon: "dashboard" },
  { href: "/matching", id: "t-matching", label: "マッチング", icon: "matching" },
  { href: "/jobs", id: "t-jobs", label: "案件（自分・共有）", icon: "jobs" },
  { href: "/people", id: "t-people", label: "人材（自分・共有）", icon: "people" },
];

// 企業↔運営のチャットは enger.jp（enger-lp）側の既存機能。シェル統一（enger-lp #96）後の
//   企業メニューは dx 側のこの CLIENT_NAV が正になるため、チャットの導線は外部リンクで残す。
//   ※ 実URLは環境変数 NEXT_PUBLIC_LP_CHAT_URL で上書き可（未設定時は下記の既定。要確認）。
const LP_CHAT_URL = process.env.NEXT_PUBLIC_LP_CHAT_URL || "https://enger.jp/business/chat";

// ユーザー企業(client)向けの専用メニュー。
//   構成：ダッシュボード → 自社案件 → おすすめ人材 → 選考管理 → チャット(enger-lp外部) → 自社情報。
//   「自社案件・自社情報が充実するほどマッチング率が上がる」導線を軸に、DXのマッチング機能と一致させる。
const CLIENT_NAV: NavItem[] = [
  { href: "/", id: "home", label: "ダッシュボード", icon: "dashboard" },
  { href: "/portal/jobs", id: "portal-jobs", label: "自社案件", icon: "jobs" },
  { href: "/portal/candidates", id: "portal-candidates", label: "おすすめ人材", icon: "people" },
  { href: "/portal/selection", id: "portal-selection", label: "選考管理", icon: "proposals" },
  { href: LP_CHAT_URL, id: "portal-chat", label: "チャット", icon: "msg", external: true },
  { href: "/portal/company", id: "portal-company", label: "自社情報", icon: "company" },
];

const fmt = (n?: number) => (n == null ? null : n.toLocaleString("ja-JP"));

// クリック直後の即時フィードバック。prefetch 無効＋force-dynamic で遷移がブロックされる間、
//   押したメニューに小さなスピナーを出し「固まった/押せてない」体感を防ぐ（Next 公式 useLinkStatus）。
//   ※ <Link> の子孫として描画する必要がある。
function NavPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span className="spinner" aria-label="読み込み中" style={{ width: 13, height: 13, borderWidth: 2, flex: "0 0 auto", marginLeft: 4 }} />;
}

export function Sidebar({ counts, role = "admin", open = false, functions = [], teamRole = null, menuPerms, showTimecard = false }: { counts?: SidebarCounts; role?: Role; open?: boolean; functions?: string[]; teamRole?: string | null; menuPerms?: import("@/lib/menu-permissions").MenuPermissions; showTimecard?: boolean }) {
  const pathname = usePathname();
  // パス「セグメント境界」で判定する。単純な startsWith だと href が別メニューの
  // 接頭辞になっているとき誤点灯する（例: /proposals や /progress が /pr＝PR・X集客に前方一致）。
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const [logoOk, setLogoOk] = useState(true);
  // 子メニュー展開（アクティブ階層は自動で開き、それ以外は折りたたみ。ユーザー操作で個別に開閉可）
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const isClient = role === "client";
  const isTenant = role === "partner" || role === "freelance";

  // 営業（一般）のメニューは「職能」で出し分け（兼務は和集合）
  const SALES_HREFS = ["/kgi", "/prospecting", "/mail", "/matching", "/engineers", "/jobs", "/people", "/proposals", "/chat", "/line", "/progress", "/companies", "/meetings", "/pr", "/analytics", "/pipeline", "/kpi", "/funnel"];
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

  // admin は要望の並び（NAV そのまま）。メール取り込みは「設定」配下に移動済み。
  const nav0 = isClient ? CLIENT_NAV
    : isTenant ? TENANT_NAV
    : role === "agent" ? filterForAgent(NAV)
    : NAV; // admin は全部
  const analysis0 = (isClient || isTenant) ? []
    : role === "agent" ? filterForAgent(ANALYSIS)
    : ANALYSIS;
  // 設定（ユーザー管理含む）は admin のみ。メール取込・日報は admin では設定配下にまとめるが、
  //   agent は設定を持たないため、access を失わないよう agent には単独メニューとして見せる
  //   （menuPerms で別途絞り込み）。
  const AGENT_MAIL: NavItem = { href: "/mail", id: "mail", label: "メール取込", desc: "案件・人材メールを取り込み", icon: "mail" };
  const AGENT_REPORTS: NavItem = { href: "/reports", id: "reports", label: "日報", desc: "気づき・改善の記録", icon: "msg" };
  const tools0base = (isClient || isTenant) ? []
    : role === "agent" ? [...TOOLS.filter((n) => n.href !== "/settings"), AGENT_MAIL, AGENT_REPORTS]
    : TOOLS; // admin は設定（配下にメール取込・日報）含む全部
  // タイムカード（バイト/副業）。本人入力対象 or 承認者のみに表示（menuPerms の対象外＝常に出す）。
  const TIMECARD_ITEM: NavItem = { href: "/timecard", id: "timecard", label: "タイムカード", icon: "cal" };
  const tools0 = showTimecard ? [TIMECARD_ITEM, ...tools0base] : tools0base;

  // 職能(営業/バックオフィス)別メニュー表示権限の適用。
  //   ・管理者(admin)・クライアント・テナントは対象外（adminは常に全表示でロックアウト防止）。
  //   ・agent のみ menuPerms で絞り込む（兼務は和集合）。子メニューも同様に判定。
  const applyMenuPerms = (items: NavItem[]): NavItem[] => {
    if (role !== "agent" || !menuPerms) return items;
    const out: NavItem[] = [];
    for (const n of items) {
      const kids = (n.children ?? []).filter((c) => isMenuAllowed(menuPerms, functions, c.href));
      if (isMenuAllowed(menuPerms, functions, n.href)) out.push({ ...n, children: kids });
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

      {renderGroup("メニュー", nav)}
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
            // hot バッジ（未読チャット等）は 0 のとき非表示。通常バッジは従来どおり総数を表示。
            const rawCount = n.count ? (counts?.[n.count] ?? 0) : null;
            const badge = rawCount == null ? null : (n.hot && rawCount === 0 ? null : fmt(rawCount));
            // ドット表示（未読チャット等の有無マーク。件数は出さず存在のみ示す）。
            const showDot = n.dot ? (counts?.[n.dot] ?? 0) > 0 : false;
            const hasChildren = (n.children?.length ?? 0) > 0;
            const childOnPath = n.children?.some((c) => pathname === c.href || pathname.startsWith(c.href + "/")) ?? false;
            const parentActive = isActive(n.href) || childOnPath;
            const isOpen = hasChildren && (expanded[n.id] ?? childOnPath);
            // 外部リンク（例: enger-lp のチャット）は Next Link ではなく素の <a> で別タブ遷移。
            //   dx の force-dynamic 先読み対象外・アクティブ判定対象外にする。
            if (n.external) {
              return (
                <Fragment key={n.id}>
                  <a href={n.href} target="_blank" rel="noopener noreferrer" className="nav-item"
                    style={{ display: "flex", alignItems: "center" }}>
                    <span className="ico">{Ico && <Ico />}</span>
                    <span className="nav-text">
                      <span className="nav-label">{n.label}</span>
                      {n.desc && <span className="nav-desc">{n.desc}</span>}
                    </span>
                    <span className="material-symbols-outlined" aria-label="外部サイト（別タブ）" title="別タブで開きます"
                      style={{ fontSize: 14, marginLeft: "auto", color: "var(--color-ink-4)" }}>open_in_new</span>
                  </a>
                </Fragment>
              );
            }
            return (
              <Fragment key={n.id}>
                {/* Link と トグルボタンを並べる（<a> 内に <button> を入れない＝HTML仕様準拠）。
                    ネスト構造だとブラウザのDOM補正でハイドレーションがズレ、稀に
                    サイドメニュークリックが効かなくなる事象が起きていた。 */}
                <div style={{ position: "relative", display: "flex", alignItems: "stretch" }}>
                  {/* prefetch 無効化: 既定だとサイドバーの全リンク(15〜20本)が画面表示のたびに
                      RSC を先読みし、各 force-dynamic ページ(認証+DBクエリ)を一斉実行してしまう。
                      これが「どのページを開いても約20本の重い関数が同時実行→混雑して /proposals が
                      遅い」主因＆認証/DBリクエスト過多の原因。実クリック時のみ取得する。 */}
                  <Link href={n.href} prefetch={false} className={"nav-item " + (parentActive ? "active" : "")}
                    style={{ flex: 1, minWidth: 0, paddingRight: hasChildren ? 6 : undefined }}>
                    <span className="ico">{Ico && <Ico />}</span>
                    <span className="nav-text">
                      <span className="nav-label">{n.label}</span>
                      {n.desc && <span className="nav-desc">{n.desc}</span>}
                    </span>
                    <NavPending />
                    {showDot && (
                      <span aria-label="未読あり" title="未読のチャットがあります"
                        style={{ width: 9, height: 9, borderRadius: 99, background: "var(--color-danger,#dc2626)", flexShrink: 0, marginLeft: badge != null ? 6 : "auto", boxShadow: "0 0 0 2px var(--color-surface)" }} />
                    )}
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
                    <Link key={c.id} href={c.href} prefetch={false} className={"nav-item nav-sub " + (subActive ? "active" : "")}
                      style={{ paddingLeft: 38, fontSize: 12.5 }}>
                      <span className="nav-text">
                        <span className="nav-label">{c.label}</span>
                        {c.desc && <span className="nav-desc">{c.desc}</span>}
                      </span>
                      <NavPending />
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
