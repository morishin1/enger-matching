import { PrComposer } from "@/components/PrComposer";
import { engerClient, publicAdmin, dbConfigured } from "@/lib/supabase";
import { PillTabs } from "@/components/PillTabs";
import { SimpleRangeYearMonthBar } from "@/components/SimpleRangeYearMonthBar";
import { hasCustomRange, inCustomRange } from "@/lib/period";

export const dynamic = "force-dynamic";

const remoteLabel = (r?: string | null) => (r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : "");
const rateLabel = (lo?: number | null, hi?: number | null) => (lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `¥${hi}万〜` : lo ? `¥${lo}万〜` : "");

// PrComposer のテンプレID → 表示名（pr_posts.kind と一致させる。src/components/PrComposer.tsx 参照）。
const KIND_LABEL: Record<string, string> = { count: "登録数アピール", jobs: "今週の新着案件", value: "市場価値診断" };

type PrPost = { operator: string | null; kind: string | null; created_at: string };

export default async function PrPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "history" ? "history" : "compose";

  let engTotal = 0, jobsPub = 0;
  let sample: { skills: string[]; rate: string; remote: string; role: string }[] = [];
  let posts: PrPost[] = [];

  if (dbConfigured) {
    try {
      if (tab === "compose") {
        const sb = engerClient();
        const pub = publicAdmin();
        const [e, j] = await Promise.all([
          pub.from("profiles").select("id", { count: "exact", head: true }).or("github_id.not.is.null,display_name.not.is.null"),
          sb.from("jobs").select("id", { count: "exact", head: true }).eq("is_published", true),
        ]);
        engTotal = e.count ?? 0;
        jobsPub = j.count ?? 0;
        // 匿名の注目案件（高単価順・企業名は出さない）
        const s = await sb.from("jobs").select("role_label, skills, salary_min, salary_max, remote_type")
          .eq("is_published", true).not("salary_max", "is", null).order("salary_max", { ascending: false }).limit(3);
        sample = ((s.data ?? []) as any[]).map((r) => ({
          role: r.role_label || "エンジニア",
          skills: (r.skills ?? []).slice(0, 3),
          rate: rateLabel(r.salary_min, r.salary_max),
          remote: remoteLabel(r.remote_type),
        }));
      } else {
        const sb = engerClient();
        const r = await sb.from("pr_posts").select("operator, kind, created_at").order("created_at", { ascending: false }).limit(2000);
        posts = (r.data ?? []) as PrPost[];
      }
    } catch { /* noop */ }
  }
  const postsInPeriod = hasCustomRange(sp.from, sp.to) ? posts.filter((p) => inCustomRange(p.created_at, sp.from, sp.to)) : posts;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">PR · X集客</div>
          <h1>PR・X集客</h1>
          <div className="sub">実データから投稿文を自動生成し、ワンクリックで X（旧Twitter）に投稿できます。文面は編集可。エンジニア登録の母数を増やす運用に活用してください。</div>
        </div>
      </div>

      <PillTabs
        active={tab}
        tabs={[
          { key: "compose", label: "テンプレ作成", icon: "edit_note", href: "/pr" },
          { key: "history", label: "投稿実績", icon: "insights", href: "/pr?tab=history" },
        ]}
        rightSlot={tab === "history" ? <SimpleRangeYearMonthBar basePath="/pr" /> : undefined}
      />

      {tab === "compose" ? <PrComposer engTotal={engTotal} jobsPub={jobsPub} sample={sample} /> : <PrHistoryView posts={postsInPeriod} />}
    </div>
  );
}

/** 投稿実績（選択期間）：件数サマリー＋担当別の投稿数。pr_posts（Xに投稿した記録）を集計する。 */
function PrHistoryView({ posts }: { posts: PrPost[] }) {
  const total = posts.length;
  const byKind = new Map<string, number>();
  const byOperator = new Map<string, number>();
  for (const p of posts) {
    const k = p.kind || "post";
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
    const o = p.operator || "不明";
    byOperator.set(o, (byOperator.get(o) ?? 0) + 1);
  }
  const operatorRows = Array.from(byOperator.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>投稿実績（選択期間）</div>
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi"><div><div className="val tnum">{total}</div><div className="label">投稿数</div></div></div>
        {Object.entries(KIND_LABEL).map(([k, label]) => (
          <div key={k} className="kpi"><div><div className="val tnum">{byKind.get(k) ?? 0}</div><div className="label">{label}</div></div></div>
        ))}
      </div>
      {total === 0 ? (
        <div className="muted" style={{ fontSize: 12.5 }}>この期間の投稿はありません。「テンプレ作成」タブから X に投稿すると、ここに記録されます。</div>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-ink-3)", marginBottom: 6 }}>担当別</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <tbody>
              {operatorRows.map(([op, cnt]) => (
                <tr key={op}>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>{op}</td>
                  <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)", textAlign: "right" }}>{cnt}件</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
