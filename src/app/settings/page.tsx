import Link from "next/link";
import { AccountManager } from "@/components/AccountManager";
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
import { listAccounts } from "@/lib/accounts";
import { getUsageStats, featureLabel, YEN_PER_USD } from "@/lib/ai-usage";
import { loadFocusCriteria } from "@/lib/focus";
import { engerClient, dbConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const yen = (usd: number) => `¥${Math.round(usd * YEN_PER_USD).toLocaleString("ja-JP")}`;

// 設定タブの定義。URL ?tab=... で切替。
const TABS = [
  { key: "ai",        label: "AI使用量",          icon: "smart_toy",       desc: "各AIの呼び出し回数と概算コスト" },
  { key: "focus",     label: "マッチング設定",    icon: "target",          desc: "マッチング対象期間・「注力」の閾値" },
  { key: "quality",   label: "品質ルール",        icon: "rule",            desc: "提案の自動失格・警告ルール" },
  { key: "accounts",  label: "アカウント・権限",  icon: "manage_accounts", desc: "メンバーの権限・部署・職能" },
  { key: "menus",     label: "メニュー権限",      icon: "lock",            desc: "役職別にサイドバーの表示メニューを設定" },
] as const;
type TabKey = typeof TABS[number]["key"];

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
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "ai") as TabKey;

  // アクティブタブだけ取得（縦量だけでなく無駄な往復も削減）
  const usage = tab === "ai" ? await getUsageStats() : null;
  const focusCriteria = tab === "focus" ? await loadFocusCriteria() : null;
  const matchWindow = tab === "focus" ? await loadMatchWindow() : null;
  const quality = tab === "quality" ? await getQuality() : null;
  const accounts = tab === "accounts" ? await listAccounts() : null;
  const menuPerms = tab === "menus" ? await loadMenuPermissions() : null;
  const reportScopes = tab === "menus" ? await loadReportScopes() : null;
  const proposalOwnersData = tab === "menus" ? await Promise.all([loadProposalOwners(), getStaff()]).then(([po, staff]) => ({ initial: po ?? { proposers: staff.members, closers: staff.members }, suggestions: staff.members })) : null;
  const maxDaily = usage ? Math.max(0.0001, ...usage.daily.map((d) => d.usd)) : 1;

  const Icon = ({ name, size = 16 }: { name: string; size?: number }) => (
    <span className="material-symbols-outlined" aria-hidden style={{ fontSize: size, lineHeight: 1, verticalAlign: "middle" }}>{name}</span>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Settings · 設定</div>
          <h1>設定</h1>
          <div className="sub">アカウント・権限、注力の定義、品質ルール、AI使用量を管理します。提案者・クロージング担当の選択肢は「アカウント・権限管理」の社内メンバー（管理者・エージェント）から自動で作られます。</div>
        </div>
      </div>

      {/* 主要設定（別ページ。タブと併存） */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "10px 14px" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="explore" /> 主要設定：</span>
        <Link href="/settings/team-kgi" className="btn ghost btn-xs" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="flag" /> チームKGI設定</Link>
        <Link href="/settings/person-kgi" className="btn ghost btn-xs" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="sports_score" /> 個人KGI設定</Link>
        <Link href="/settings/approvals" className="btn ghost btn-xs" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="how_to_reg" /> アカウント承認</Link>
      </div>

      {/* タブナビ（URLベース） */}
      <nav aria-label="設定タブ" role="tablist"
        style={{ display: "flex", gap: 4, padding: 4, background: "var(--color-surface-inset)", borderRadius: 12, overflowX: "auto" }}>
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <Link key={t.key} href={`/settings?tab=${t.key}`} role="tab" aria-selected={on}
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
            </Link>
          );
        })}
      </nav>

      {/* === アクティブタブの中身 === */}
      {tab === "ai" && (
        <div className="card" id="ai-usage">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="smart_toy" size={18} /> AI使用量・概算コスト
            </h3>
            <span className="muted" style={{ fontSize: 11 }}>直近30日 / 概算（¥{YEN_PER_USD}/$ 換算）</span>
          </div>

          {!usage?.available ? (
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

      {tab === "focus" && focusCriteria && (
        <div id="focus" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {matchWindow && <MatchWindowEditor initial={matchWindow} />}
          <FocusCriteriaEditor initial={focusCriteria} />
        </div>
      )}

      {tab === "quality" && quality && (
        <div id="quality"><QualityRules rules={quality.rules} available={quality.available} ngCount={quality.ngCount} /></div>
      )}

      {tab === "accounts" && accounts && (
        <div id="accounts"><AccountManager accounts={accounts} /></div>
      )}

      {tab === "menus" && menuPerms && reportScopes && proposalOwnersData && (
        <div id="menus" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <MenuPermissionEditor initial={menuPerms} />
          <ReportScopeEditor initial={reportScopes} />
          <ProposalOwnersEditor initial={proposalOwnersData.initial} suggestions={proposalOwnersData.suggestions} />
        </div>
      )}
    </div>
  );
}
