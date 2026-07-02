import { Fragment } from "react";
import Link from "@/components/AppLink";
import { QualityRules, type Rule } from "@/components/QualityRules";
import { FocusCriteriaEditor } from "@/components/FocusCriteriaEditor";
import { MatchWindowEditor } from "@/components/MatchWindowEditor";
import { loadMatchWindow } from "@/lib/match-window";
import { MenuPermissionEditor } from "@/components/MenuPermissionEditor";
import { ReportScopeEditor } from "@/components/ReportScopeEditor";
import { ProposalOwnersEditor } from "@/components/ProposalOwnersEditor";
import { loadMenuPermissions } from "@/lib/menu-permissions";
import { loadReportScopes } from "@/lib/report-scope";
import { loadProposalOwners } from "@/lib/proposal-owners";
import { getStaff } from "@/lib/staff";
import { getUsageStats, featureLabel, YEN_PER_USD } from "@/lib/ai-usage";
import { loadFocusCriteria } from "@/lib/focus";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { ApprovalsView } from "@/components/ApprovalsView";
import { ActivityLogView } from "@/components/ActivityLogView";
import { listActivityLogs } from "@/lib/activity-logs";
import { currentAccess, listAccounts, listLpPendingCandidates } from "@/lib/accounts";

export const dynamic = "force-dynamic";

const yen = (usd: number) => `¥${Math.round(usd * YEN_PER_USD).toLocaleString("ja-JP")}`;

// 設定タブ（サイドバーを「設定」1つに集約）。よく使う設定をタブで切替。
//   マッチング（対象期間＋注力閾値）／ メニュー権限／ ユーザー管理（管理者のみ）／ その他（AI使用量・品質ルール）
//   ※ チームKGI／個人KGI は固有の検索パラメータを持つので別ページのまま、ヘッダ右にリンク配置。
const TABS_ALL = [
  { key: "matching", label: "マッチング",     icon: "target",          desc: "マッチング対象期間と「注力」の閾値" },
  { key: "menus",    label: "メニュー権限",   icon: "lock",            desc: "メニュー・日報閲覧・提案担当者の表示制御" },
  { key: "users",    label: "ユーザー管理",   icon: "manage_accounts", desc: "アカウントの承認・削除・担当者割当・無効化",     adminOnly: true },
  { key: "logs",     label: "ログ",           icon: "history",         desc: "削除・修正の操作ログ（担当者・日時・内容）" },
  { key: "other",    label: "その他",         icon: "more_horiz",      desc: "AI 使用量と品質ルール（滅多に触らない設定）" },
] as const;
type TabKey = typeof TABS_ALL[number]["key"];

async function getQuality(): Promise<{ rules: Rule[]; available: boolean; ngCount: number }> {
  if (!dbConfigured) return { rules: [], available: false, ngCount: 0 };
  try {
    const sb = engerClient();
    const rulesRes = await sb.from("quality_rules").select("id, kind, label, enabled, threshold, note").order("sort", { ascending: true });
    if (rulesRes.error) return { rules: [], available: false, ngCount: 0 };
    const ngRes = await sb.from("proposals").select("id", { count: "exact", head: true }).eq("disqualified", true);
    return { rules: (rulesRes.data ?? []) as Rule[], available: true, ngCount: ngRes.count ?? 0 };
  } catch { return { rules: [], available: false, ngCount: 0 }; }
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  // 管理者かどうか。admin のみ「ユーザー管理」タブを表示・選択可能にする。
  // ローカル(未認証)は admin 相当として扱う（既存ページ群と同方針）。
  const access = await currentAccess();
  const isAdmin = !access || access.role === "admin";

  // 旧タブキーの後方互換：focus → matching、quality/ai → other、accounts → users に丸めて遷移崩れを防ぐ。
  const legacy: Record<string, TabKey> = { focus: "matching", quality: "other", ai: "other", accounts: "users" };
  const requested = (sp.tab && legacy[sp.tab]) || (sp.tab as TabKey | undefined);

  // admin 以外は users タブを除外。
  const TABS = TABS_ALL.filter((t) => !("adminOnly" in t && t.adminOnly) || isAdmin);
  const tab: TabKey = (TABS.find((t) => t.key === requested)?.key ?? "matching") as TabKey;

  // アクティブタブだけ取得（縦量だけでなく無駄な往復も削減）
  const usage = tab === "other" ? await getUsageStats() : null;
  const focusCriteria = tab === "matching" ? await loadFocusCriteria() : null;
  const matchWindow = tab === "matching" ? await loadMatchWindow() : null;
  const quality = tab === "other" ? await getQuality() : null;
  const activityLogs = tab === "logs" ? await listActivityLogs({ limit: 500 }) : null;
  const menuPerms = tab === "menus" ? await loadMenuPermissions() : null;
  const reportScopes = tab === "menus" ? await loadReportScopes() : null;
  const proposalOwnersData = tab === "menus" ? await Promise.all([loadProposalOwners(), getStaff()]).then(([po, staff]) => ({ initial: po ?? { proposers: staff.members, closers: staff.members }, suggestions: staff.members })) : null;
  // ユーザー管理タブ。実アカウント＋LP（profiles）の昇格待ちを合算し、ApprovalsView で承認/削除/担当者割当を行う。
  const usersData = (tab === "users" && isAdmin)
    ? await Promise.all([listAccounts(), listLpPendingCandidates(), getStaff()]).then(([real, lp, staff]) => ({
        accounts: [...real, ...lp],
        agentOptions: staff.rows
          .filter((s: any) => s.active !== false && (s.email || s.name))
          .map((s: any) => ({ email: s.email ?? null, name: s.name ?? null })),
      }))
    : null;
  const usersPending = usersData?.accounts.filter((a) => a.status === "pending").length ?? 0;
  const maxDaily = usage ? Math.max(0.0001, ...usage.daily.map((d) => d.usd)) : 1;

  const Icon = ({ name, size = 16 }: { name: string; size?: number }) => (
    <span className="material-symbols-outlined" aria-hidden style={{ fontSize: size, lineHeight: 1, verticalAlign: "middle" }}>{name}</span>
  );

  // ヘッダ右に配置する「主要リンク」。設定ページ内タブから外し、ナビを1段に。
  const HeaderLink = ({ href, icon, label }: { href: string; icon: string; label: string }) => (
    <Link href={href} className="btn ghost btn-xs" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
      <Icon name={icon} /> {label}
    </Link>
  );

  return (
    <div className="page">
      <div className="page-head" style={{ flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
          <div className="meta">Settings · 設定</div>
          <h1>設定</h1>
          <div className="sub">マッチング・メニュー権限・ユーザー管理をタブで切替。KGI 設定はヘッダ右のリンクから。</div>
        </div>
        {/* チームKGI／個人KGI は固有の検索パラメータを持つので別ページのまま、ヘッダ右へ。 */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <HeaderLink href="/settings/team-kgi"   icon="flag"         label="チームKGI" />
          <HeaderLink href="/settings/person-kgi" icon="sports_score" label="個人KGI" />
        </div>
      </div>

      {/* タブナビ（URLベース） */}
      <nav aria-label="設定タブ" role="tablist"
        style={{ display: "flex", gap: 4, padding: 4, background: "var(--color-surface-inset)", borderRadius: 12, overflowX: "auto" }}>
        {TABS.map((t) => {
          const on = t.key === tab;
          // users タブには承認待ちバッジを表示（admin のみここに到達）
          const badge = t.key === "users" && usersPending > 0 ? usersPending : null;
          return (
            <Fragment key={t.key}>
              <Link href={`/settings?tab=${t.key}`} role="tab" aria-selected={on} title={t.desc}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "9px 14px", borderRadius: 8, textDecoration: "none",
                  background: on ? "var(--color-surface)" : "transparent",
                  color: on ? "var(--color-ink)" : "var(--color-ink-3)",
                  boxShadow: on ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
                  fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap",
                }}>
                <Icon name={t.icon} size={18} />
                <span>{t.label}</span>
                {badge != null && (
                  <span className="badge hot" style={{ fontSize: 10 }}>{badge}</span>
                )}
              </Link>
              {/* 「ログ」の隣に、各個人のKGI/KPIダッシュボード（/kpi）への入口を復元（要望）。
                  /kpi は期間・対象メンバー等の固有URLパラメータを持つため別ページのまま、タブと同デザインのリンクで置く。 */}
              {t.key === "logs" && (
                <Link href="/kpi" role="tab" title="各メンバーのKGI/KPIダッシュボード（達成率・推移・メンバー別アクティビティ）"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "9px 14px", borderRadius: 8, textDecoration: "none",
                    background: "transparent", color: "var(--color-ink-3)",
                    fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap",
                  }}>
                  <Icon name="monitoring" size={18} />
                  <span>KGI/KPIダッシュボード</span>
                  <Icon name="open_in_new" size={13} />
                </Link>
              )}
            </Fragment>
          );
        })}
      </nav>

      {/* === マッチング（対象期間 + 注力閾値） === */}
      {tab === "matching" && focusCriteria && (
        <div id="matching" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {matchWindow && <MatchWindowEditor initial={matchWindow} />}
          <FocusCriteriaEditor initial={focusCriteria} />
        </div>
      )}

      {/* === ユーザー管理（admin のみ。承認待ち/承認済みの切り替えは ApprovalsView 内タブ） === */}
      {tab === "users" && usersData && (
        <div id="users" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            登録ユーザーを <b>企業 / 人材 / 営業</b> 等のタブで切り分け、<b>承認待ち / 承認済み</b> を分けて表示。承認・削除・担当者割当・無効化などをまとめて行えます。
          </div>
          <ApprovalsView accounts={usersData.accounts} agents={usersData.agentOptions} />
        </div>
      )}

      {/* === ログ（削除・修正の操作ログ：担当者・日時・内容） === */}
      {tab === "logs" && activityLogs && (
        <div id="logs" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            提案（マッチングレコード）の<b>削除・編集・ステージ変更</b>などの操作を、<b>担当者・日時・内容</b>で記録します。削除は承認なしで行えますが、ここで誰がいつ何をしたかを確認できます。
          </div>
          <ActivityLogView logs={activityLogs.rows} available={activityLogs.available} />
        </div>
      )}

      {/* === メニュー権限（メニュー / 日報スコープ / 提案担当者） === */}
      {tab === "menus" && menuPerms && reportScopes && proposalOwnersData && (
        <div id="menus" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <MenuPermissionEditor initial={menuPerms} />
          <ReportScopeEditor initial={reportScopes} />
          <ProposalOwnersEditor initial={proposalOwnersData.initial} suggestions={proposalOwnersData.suggestions} />
        </div>
      )}

      {/* === その他（AI使用量・品質ルール） === */}
      {tab === "other" && (
        <div id="other" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {usage && (
            <div className="card" id="ai-usage">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon name="smart_toy" size={18} /> AI使用量・概算コスト
                </h3>
                <span className="muted" style={{ fontSize: 11 }}>直近30日 / 概算（¥{YEN_PER_USD}/$ 換算）</span>
              </div>

              {!usage.available ? (
                <div style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 10, padding: 14, fontSize: 12.5 }}>
                  使用量ログのテーブルが未作成です。SQL Editor で <span className="mono">supabase/ai-usage.sql</span> を実行すると、ここに使用量グラフが表示されます。
                </div>
              ) : (
                <>
                  <div className="kpi-grid" style={{ marginBottom: 14 }}>
                    <div className="kpi brand"><div><div className="val tnum">{yen(usage.thisMonth.usd)}</div><div className="label">今月の概算コスト</div><div className="note">{usage.thisMonth.count} 回</div></div></div>
                    <div className="kpi"><div><div className="val tnum">{yen(usage.total.usd)}</div><div className="label">直近30日コスト</div><div className="note">{usage.total.count} 回</div></div></div>
                    {usage.byFeature.slice(0, 2).map((f) => (
                      <div key={f.feature} className="kpi accent"><div><div className="val tnum">{yen(f.usd)}</div><div className="label">{featureLabel(f.feature)}</div><div className="note">{f.count} 回</div></div></div>
                    ))}
                  </div>

                  <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120, padding: "8px 4px", borderBottom: "1px solid var(--color-border)" }}>
                    {usage.daily.map((d, i) => {
                      const h = Math.round((d.usd / maxDaily) * 100);
                      return (
                        <div key={i} title={`${d.date}：${yen(d.usd)} / ${d.count}回`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%" }}>
                          <div style={{ width: "100%", maxWidth: 16, height: `${Math.max(d.usd > 0 ? 6 : 0, h)}%`, background: d.usd > 0 ? "var(--color-brand-600)" : "transparent", borderRadius: "3px 3px 0 0" }} />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-ink-4)", marginTop: 4 }}>
                    <span>{usage.daily[0]?.date}</span><span>30日間のAIコスト推移</span><span>{usage.daily[usage.daily.length - 1]?.date}</span>
                  </div>

                  {usage.byFeature.length > 0 && (
                    <div style={{ marginTop: 14, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--color-ink-3)" }}>
                      {usage.byFeature.map((f) => <span key={f.feature}>{featureLabel(f.feature)}：<b style={{ color: "var(--color-ink)" }}>{f.count}回 / {yen(f.usd)}</b></span>)}
                    </div>
                  )}
                  <div style={{ marginTop: 10, fontSize: 10.5, color: "var(--color-ink-4)" }}>※ トークン量×モデル単価からの概算です。正確な請求額は各AIプロバイダのダッシュボードをご確認ください。</div>
                </>
              )}
            </div>
          )}

          {quality && <div id="quality"><QualityRules rules={quality.rules} available={quality.available} ngCount={quality.ngCount} /></div>}
        </div>
      )}
    </div>
  );
}
