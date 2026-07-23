import { PrComposer } from "@/components/PrComposer";
import { engerClient, engerAdmin, publicAdmin, dbConfigured } from "@/lib/supabase";
import { PillTabs } from "@/components/PillTabs";
import { SimpleRangeYearMonthBar } from "@/components/SimpleRangeYearMonthBar";
import { hasCustomRange, inCustomRange } from "@/lib/period";

export const dynamic = "force-dynamic";

const remoteLabel = (r?: string | null) => (r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : "");
const rateLabel = (lo?: number | null, hi?: number | null) => (lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `¥${hi}万〜` : lo ? `¥${lo}万〜` : "");

// PrComposer のテンプレID → 表示名（pr_posts.kind と一致させる。src/components/PrComposer.tsx 参照）。
const KIND_LABEL: Record<string, string> = { count: "登録数アピール", jobs: "今週の新着案件", value: "市場価値診断", job: "案件カード", custom: "オリジナル投稿", card: "カード投稿（画像）" };

type PrPost = { operator: string | null; kind: string | null; created_at: string };

export default async function PrPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "history" ? "history" : sp.tab === "inflow" ? "inflow" : "compose";

  let engTotal = 0, jobsPub = 0;
  let sample: { skills: string[]; rate: string; remote: string; role: string }[] = [];
  let jobsList: { no: string; role: string; title: string; skills: string[]; rate: string; remote: string }[] = [];
  let posts: PrPost[] = [];
  let inflow = { registered: 0, met: 0, closed: 0 };

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
        // 匿名の注目案件（高単価順・企業名は出さない）。
        //   ★単価データに桁崩れ（raw円やゼロ埋め）が混在し「¥111〜100000000万」のような
        //     崩れた投稿文が出ていたため、月額が万単位で妥当な帯(20〜300万)の案件だけを採用する。
        const s = await sb.from("jobs").select("role_label, skills, salary_min, salary_max, remote_type")
          .eq("is_published", true).not("salary_max", "is", null).order("salary_max", { ascending: false }).limit(50);
        const saneRate = (lo: number, hi: number) => {
          const okHi = Number.isFinite(hi) && hi >= 20 && hi <= 300;
          const okLo = !lo || (Number.isFinite(lo) && lo >= 10 && lo <= hi);
          return okHi && okLo;
        };
        sample = ((s.data ?? []) as any[])
          .filter((r) => saneRate(Number(r.salary_min), Number(r.salary_max)))
          .slice(0, 2)
          .map((r) => ({
            role: r.role_label || "エンジニア",
            skills: (r.skills ?? []).slice(0, 3),
            rate: rateLabel(r.salary_min, r.salary_max),
            remote: remoteLabel(r.remote_type),
          }));
        // 案件カード投稿用：公開中で単価が妥当な案件を新着順に取得（/job/<No> の動的OGPカードが付く）。
        const jl = await sb.from("jobs").select("job_no, role_label, title, skills, salary_min, salary_max, remote_type")
          .eq("is_published", true).not("job_no", "is", null).order("created_at", { ascending: false }).limit(60);
        jobsList = ((jl.data ?? []) as any[])
          .filter((r) => r.job_no != null && saneRate(Number(r.salary_min), Number(r.salary_max)))
          .slice(0, 24)
          .map((r) => ({
            no: String(r.job_no),
            role: r.role_label || "エンジニア",
            title: String(r.title ?? ""),
            skills: (r.skills ?? []).map((s: any) => String(s)).slice(0, 4),
            rate: rateLabel(r.salary_min, r.salary_max),
            remote: remoteLabel(r.remote_type),
          }));
      } else if (tab === "inflow") {
        // X集客PR経由（signup_source='x'）の 登録→面談→成約 ファネル。人材ID(engineer_id)で突合。
        const pub = publicAdmin();
        const eng = engerAdmin();
        const reg = await pub.from("profiles").select("id, created_at").eq("signup_source", "x").limit(5000);
        let regRows = ((reg.data ?? []) as { id: string; created_at: string }[]);
        if (hasCustomRange(sp.from, sp.to)) regRows = regRows.filter((r) => inCustomRange(r.created_at, sp.from, sp.to));
        const ids = regRows.map((r) => r.id).filter(Boolean);
        const metSet = new Set<string>(), closedSet = new Set<string>();
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          const [ma, ap] = await Promise.all([
            eng.from("engineer_actions").select("engineer_id").eq("action", "面談済").in("engineer_id", chunk),
            eng.from("applications").select("engineer_id").eq("stage", "稼働").in("engineer_id", chunk),
          ]);
          ((ma.data ?? []) as any[]).forEach((r) => r?.engineer_id && metSet.add(String(r.engineer_id)));
          ((ap.data ?? []) as any[]).forEach((r) => r?.engineer_id && closedSet.add(String(r.engineer_id)));
        }
        inflow = { registered: ids.length, met: metSet.size, closed: closedSet.size };
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
          { key: "inflow", label: "X流入", icon: "trending_up", href: "/pr?tab=inflow" },
          { key: "history", label: "投稿実績", icon: "insights", href: "/pr?tab=history" },
        ]}
        rightSlot={tab !== "compose" ? <SimpleRangeYearMonthBar basePath="/pr" /> : undefined}
      />

      {tab === "compose"
        ? <PrComposer engTotal={engTotal} jobsPub={jobsPub} sample={sample} jobs={jobsList} />
        : tab === "inflow"
          ? <XInflowView inflow={inflow} />
          : <PrHistoryView posts={postsInPeriod} />}
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

/** X流入レポート（選択期間）：X集客PR経由(signup_source='x')の 登録→面談→成約 ファネル。
 *  登録＝profiles.signup_source='x' ／ 面談＝engineer_actions "面談済" ／ 成約＝applications stage="稼働"。 */
function XInflowView({ inflow }: { inflow: { registered: number; met: number; closed: number } }) {
  const { registered, met, closed } = inflow;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 12.5, lineHeight: 1.8 }}>
        𝕏 <b>X集客PRの効果</b>：投稿リンクの <code>utm_source=x</code> を辿って登録したフリーランス（<code>signup_source=&apos;x&apos;</code>）の、登録→面談→成約ファネルです。選択期間は<b>登録日</b>で絞り込みます。
      </div>
      <div className="kpi-grid">
        <div className="kpi"><div><div className="val tnum">{registered}</div><div className="label">X経由の登録</div></div></div>
        <div className="kpi"><div><div className="val tnum">{met}</div><div className="label">面談到達（{pct(met, registered)}%）</div></div></div>
        <div className="kpi"><div><div className="val tnum">{closed}</div><div className="label">成約・稼働（{pct(closed, registered)}%）</div></div></div>
      </div>
      {registered === 0 && (
        <div className="card muted" style={{ fontSize: 12.5, padding: 16 }}>
          この期間に X 経由（<code>signup_source=&apos;x&apos;</code>）の登録はまだありません。PR投稿リンク（<code>utm_source=x</code> 付き）からの新規登録が入ると、ここに 登録→面談→成約 が集計されます。
        </div>
      )}
      <div className="card" style={{ fontSize: 12, color: "var(--color-ink-3)", lineHeight: 1.8, padding: 16 }}>
        <b>集計ロジック</b>：登録＝<code>public.profiles.signup_source=&apos;x&apos;</code> ／ 面談到達＝その人材の対応履歴に「面談済」がある ／ 成約・稼働＝応募(applications)のステージが「稼働」。いずれも人材ID(engineer_id)で突合しています。
      </div>
    </div>
  );
}
