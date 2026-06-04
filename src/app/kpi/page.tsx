// 個人 KPI ダッシュボード（/kpi）。
//   - 期間切替: 日 / 週 / 月 / 四半期 / カレンダー任意
//   - 7 指標（提案 / CL / ○ / × / PC=受託 / N=EC / 打合せ）の達成率
//   - 推移グラフ（直近12期間）
//   - 管理者は「対象メンバー」を切替可能、メンバー以外は自分のみ
//   - 「目標を編集」モーダルで週次目標をその場で設定

import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { getKpiSnapshot, getKpiHistory, getWeeklyTargets, jstStartOfWeek, type PeriodType, type Metric } from "@/lib/kpi";
import { KpiDashboardClient } from "@/components/KpiDashboardClient";

export const dynamic = "force-dynamic";

export default async function KpiDashboardPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; owner?: string }> }) {
  const access = await currentAccess();
  if (!access) return <div style={{ padding: 24 }}>ログインが必要です。</div>;
  if (!dbConfigured) return <div style={{ padding: 24 }}>DB 接続が設定されていません。</div>;

  const sp = await searchParams;
  const period: PeriodType = (["day", "week", "month", "quarter", "custom"] as const).includes(sp.period as any)
    ? (sp.period as PeriodType) : "week";

  // 管理者は ?owner=email で対象切替可能。それ以外は自分のみ。
  let targetEmail = access.email.toLowerCase();
  let targetName  = access.name ?? "";
  if (access.role === "admin" && sp.owner) {
    const sb = engerAdmin();
    const r: any = await sb.from("staff").select("name, email").ilike("email", sp.owner).maybeSingle();
    if (r.data) { targetEmail = (r.data.email ?? "").toLowerCase(); targetName = r.data.name ?? ""; }
  }

  // 名前未解決（app_users.name が空の場合）→ staff から email で引く
  if (!targetName) {
    const sb = engerAdmin();
    const r: any = await sb.from("staff").select("name").ilike("email", targetEmail).maybeSingle();
    targetName = r.data?.name ?? "";
  }

  // ITS メンバー一覧（管理者の切替用）
  let members: { name: string; email: string }[] = [];
  if (access.role === "admin") {
    const sb = engerAdmin();
    const r: any = await sb.from("staff").select("name, email")
      .eq("active", true).not("email", "is", null).order("name");
    members = (r.data ?? []).filter((s: any) => s.email);
  }

  // 期間スナップショット
  const weekStart = jstStartOfWeek(new Date());
  const weekly = await getWeeklyTargets({ ownerEmail: targetEmail, weekStart });
  const custom = (period === "custom" && sp.from && sp.to) ? { from: sp.from, to: sp.to } : undefined;
  const { range, snapshot } = await getKpiSnapshot({
    ownerName: targetName || null,
    type: period, custom, weeklyTargets: weekly,
  });

  // 推移グラフ（custom は推移を取らない）
  const historyType: Exclude<PeriodType, "custom"> = period === "custom" ? "week" : period;
  const history = await getKpiHistory({
    ownerName: targetName || null, ownerEmail: targetEmail,
    type: historyType, periods: 12, metric: "proposal",
  });

  return (
    <KpiDashboardClient
      access={{ email: access.email, name: access.name, role: access.role }}
      target={{ email: targetEmail, name: targetName }}
      members={members}
      period={period}
      range={{ start: range.start.toISOString(), end: range.end.toISOString() }}
      custom={custom ?? null}
      snapshot={snapshot}
      weeklyTargets={weekly as Partial<Record<Metric, number>>}
      weekStart={weekStart.toISOString().slice(0, 10)}
      history={history}
    />
  );
}
