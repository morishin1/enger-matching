// ダッシュボード冒頭の「新着サマリー」。直近7日のエンジニア登録／問い合わせ／新規人材／新規案件を一目で把握。
import Link from "next/link";
import { getSidebarCounts } from "@/lib/counts";
import { engerClient, dbConfigured } from "@/lib/supabase";

async function getNewInquiries(): Promise<number | undefined> {
  if (!dbConfigured) return undefined;
  try {
    const sb = engerClient();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const r = await sb.from("talent_interest").select("id", { count: "exact", head: true }).gte("created_at", since);
    return r.error ? undefined : (r.count ?? undefined);
  } catch { return undefined; }
}

export async function RecentActivity() {
  const [c, inquiries] = await Promise.all([getSidebarCounts(), getNewInquiries()]);
  const items: { href?: string; label: string; value: number; hot?: boolean }[] = [
    { href: "/engineers", label: "エンジニア登録", value: c.newEngineers ?? 0, hot: (c.newEngineers ?? 0) > 0 },
    { label: "問い合わせ（人材リクエスト）", value: inquiries ?? 0, hot: (inquiries ?? 0) > 0 },
    { href: "/people", label: "新規人材", value: c.newPeople ?? 0 },
    { href: "/jobs", label: "新規案件", value: c.newJobs ?? 0 },
  ];
  if (!items.some((i) => i.value > 0)) return null; // 全部 0 なら表示しない

  const cardStyle: React.CSSProperties = {
    flex: "1 1 200px", padding: 14, border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-surface)",
    display: "flex", flexDirection: "column", gap: 6, textDecoration: "none", color: "inherit",
  };
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700 }}>新着サマリー（直近7日）</div>
        <span className="muted" style={{ fontSize: 11 }}>※ 問い合わせの詳細は下部の一覧をご確認ください</span>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {items.map((it, i) => {
          const inner = (
            <>
              <div className="muted" style={{ fontSize: 11.5, fontWeight: 600 }}>{it.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: it.value > 0 ? (it.hot ? "var(--color-brand-700)" : "var(--color-ink)") : "var(--color-ink-4)" }}>+{it.value}</div>
            </>
          );
          return it.href ? (
            <Link key={i} href={it.href} style={cardStyle}>{inner}</Link>
          ) : (
            <div key={i} style={cardStyle}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
