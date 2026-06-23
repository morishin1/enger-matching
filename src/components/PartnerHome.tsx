// パートナー企業(partner)向けホーム = 自社資産ダッシュボード。
//   ENGER をサブスクとして利用する顧客に「案件・人材を蓄積している実感」を見せる。
//   - KPI: 自社の案件/人材数（今月の伸び）、マッチング件数、共有数
//   - 直近の動き（登録履歴・最近のマッチング提案）
//   - 大型CTA: 案件登録 / 人材登録 / マッチング開始
//   他社情報は出さない（匿名化済みのカウント値のみ）。
import Link from "@/components/AppLink";
import { engerClient, dbConfigured } from "@/lib/supabase";

type Stats = {
  ownedJobs: number;     ownedJobsThisMonth: number;     ownedJobsPublished: number;
  ownedCands: number;    ownedCandsThisMonth: number;    ownedCandsAvail: number;
  sharedJobs: number;    sharedCands: number;
  proposalsThisMonth: number;
  recentJobs: { job_no: number; title: string | null; created_at: string | null; is_published: boolean | null }[];
  recentCands: { candidate_no: number; name: string | null; initials: string | null; created_at: string | null; status: string | null }[];
};

async function loadStats(companyName: string): Promise<Stats | null> {
  if (!dbConfigured) return null;
  const sb = engerClient();
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const [oj, ojNew, ojPub, oc, ocNew, ocAvail, sj, sc, props, recJ, recC] = await Promise.all([
    sb.from("jobs").select("job_no", { count: "exact", head: true }).eq("owner_company", companyName),
    sb.from("jobs").select("job_no", { count: "exact", head: true }).eq("owner_company", companyName).gte("created_at", monthAgo),
    sb.from("jobs").select("job_no", { count: "exact", head: true }).eq("owner_company", companyName).eq("is_published", true),
    sb.from("candidates").select("candidate_no", { count: "exact", head: true }).eq("owner_company", companyName),
    sb.from("candidates").select("candidate_no", { count: "exact", head: true }).eq("owner_company", companyName).gte("created_at", monthAgo),
    sb.from("candidates").select("candidate_no", { count: "exact", head: true }).eq("owner_company", companyName).in("status", ["稼働可", "稼働可能", "提案可", "available"]),
    sb.from("jobs").select("job_no", { count: "exact", head: true }).eq("shared", true).eq("is_published", true).neq("owner_company", companyName),
    sb.from("candidates").select("candidate_no", { count: "exact", head: true }).eq("shared", true).neq("owner_company", companyName),
    sb.from("proposals").select("id", { count: "exact", head: true }).ilike("company", `%${companyName}%`).gte("created_at", monthAgo),
    sb.from("jobs").select("job_no, title, created_at, is_published").eq("owner_company", companyName).order("created_at", { ascending: false }).limit(5),
    sb.from("candidates").select("candidate_no, name, initials, created_at, status").eq("owner_company", companyName).order("created_at", { ascending: false }).limit(5),
  ]);

  return {
    ownedJobs: oj.count ?? 0,
    ownedJobsThisMonth: ojNew.count ?? 0,
    ownedJobsPublished: ojPub.count ?? 0,
    ownedCands: oc.count ?? 0,
    ownedCandsThisMonth: ocNew.count ?? 0,
    ownedCandsAvail: ocAvail.count ?? 0,
    sharedJobs: sj.count ?? 0,
    sharedCands: sc.count ?? 0,
    proposalsThisMonth: props.count ?? 0,
    recentJobs: (recJ.data ?? []) as any[],
    recentCands: (recC.data ?? []) as any[],
  };
}

export async function PartnerHome({ companyName, displayName }: { companyName?: string | null; displayName?: string | null }) {
  const stats = companyName ? await loadStats(companyName).catch(() => null) : null;
  const hasNoAssets = !!stats && stats.ownedJobs === 0 && stats.ownedCands === 0;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Partner · パートナー企業</div>
          <h1>ようこそ{companyName ? `、${companyName}` : displayName ? `、${displayName} さん` : ""}</h1>
          <div className="sub">登録した案件・人材は<b>御社の資産</b>として蓄積され、ENGERのマッチング機能で他社案件/人材ともマッチング（匿名）できます。</div>
        </div>
      </div>

      {/* オンボーディング：登録ゼロのときの誘導 */}
      {hasNoAssets && (
        <div className="card" style={{ background: "#fff7ed", borderColor: "#fdba74", padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#9a3412", marginBottom: 4 }}>📥 まずは案件・人材を登録しましょう</div>
          <div style={{ fontSize: 12.5, color: "#7c2d12", lineHeight: 1.7 }}>御社の案件・人材を登録すると、即座にマッチング対象になります。CSV一括取込／個別入力どちらも可能です。</div>
        </div>
      )}

      {/* KPI: 自社の資産（メイン） */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 12, marginTop: 6 }}>
        <Kpi label="自社の案件" value={stats?.ownedJobs ?? 0} unit="件"
          sub={`公開中 ${stats?.ownedJobsPublished ?? 0} 件`}
          delta={stats?.ownedJobsThisMonth ?? 0} icon="work" tone="brand" />
        <Kpi label="自社の人材" value={stats?.ownedCands ?? 0} unit="名"
          sub={`稼働可 ${stats?.ownedCandsAvail ?? 0} 名`}
          delta={stats?.ownedCandsThisMonth ?? 0} icon="groups" tone="brand" />
        <Kpi label="今月のマッチ提案" value={stats?.proposalsThisMonth ?? 0} unit="件"
          sub="貴社案件への提案" icon="compare_arrows" tone="ink" />
        <Kpi label="共有プール" value={(stats?.sharedJobs ?? 0) + (stats?.sharedCands ?? 0)} unit="件"
          sub={`案件 ${stats?.sharedJobs ?? 0} / 人材 ${stats?.sharedCands ?? 0}（他社・匿名）`}
          icon="hub" tone="ink" />
      </div>

      {/* 大型CTA（資産を増やす） */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 12 }}>
        <ActionCard href="/jobs" icon="add_business" t="案件を登録 / 管理" d="自社の案件を登録。共有設定をONにすると他社マッチングの対象になります。" />
        <ActionCard href="/people" icon="person_add" t="人材を登録 / 管理" d="自社の人材を登録。スキル・希望条件を入れるほどマッチ精度が上がります。" />
        <ActionCard href="/matching" icon="compare_arrows" t="マッチングを開く" d="自社＋共有プールから相性の良いペアを表示（他社は匿名）。" />
      </div>

      {/* 直近の登録（資産が増えている実感） */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <RecentList title="📋 最近登録した自社案件" emptyText="まだ案件がありません。" linkAll="/jobs"
          rows={(stats?.recentJobs ?? []).map((j) => ({ key: `j${j.job_no}`, href: `/jobs/${j.job_no}`, head: `#${j.job_no}`, body: j.title || "（無題）", meta: j.created_at, tag: j.is_published ? null : "非公開" }))} />
        <RecentList title="🧑‍💻 最近登録した自社人材" emptyText="まだ人材がありません。" linkAll="/people"
          rows={(stats?.recentCands ?? []).map((c) => ({ key: `c${c.candidate_no}`, href: `/people/${c.candidate_no}`, head: `#${c.candidate_no}`, body: c.name || c.initials || "（名前未設定）", meta: c.created_at, tag: c.status }))} />
      </div>

      <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 12, color: "var(--color-ink-2)" }}>
        <b>テナント隔離</b>：自社で登録した案件・人材は御社のみ閲覧できます。共有設定をONにした案件・人材のみ、他社とのマッチング対象になります（他社からは匿名表示）。
      </div>
    </div>
  );
}

// ─── 小物コンポーネント ───────────────────────────────────────────────

function Kpi({ label, value, unit, sub, delta, icon, tone }: { label: string; value: number; unit?: string; sub?: string; delta?: number; icon: string; tone: "brand" | "ink" }) {
  const brand = tone === "brand";
  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 4, background: brand ? "var(--color-brand-25)" : "#fff", borderColor: brand ? "var(--color-brand-100)" : "var(--color-border)" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: brand ? "var(--color-brand-700)" : "var(--color-ink-2)" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
        <span className="tnum" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{value.toLocaleString()}</span>
        {unit && <span className="muted" style={{ fontSize: 11.5 }}>{unit}</span>}
        {typeof delta === "number" && delta > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#067647", background: "#e7f7ee", border: "1px solid #c4eeda", borderRadius: 99, padding: "2px 8px" }}>+{delta} / 30日</span>
        )}
      </div>
      {sub && <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ActionCard({ href, icon, t, d }: { href: string; icon: string; t: string; d: string }) {
  return (
    <Link href={href} className="card" style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", gap: 6, padding: 18, transition: "transform .12s, box-shadow .12s" }}>
      <span className="material-symbols-outlined" style={{ fontSize: 26, color: "var(--color-brand-700)" }}>{icon}</span>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{t}</div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>{d}</div>
    </Link>
  );
}

function RecentList({ title, rows, emptyText, linkAll }: { title: string; rows: { key: string; href: string; head: string; body: string; meta: string | null; tag: string | null }[]; emptyText: string; linkAll: string }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{title}</div>
        <Link href={linkAll} className="muted" style={{ fontSize: 11, textDecoration: "none" }}>すべて見る →</Link>
      </div>
      {rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 12, padding: "10px 2px" }}>{emptyText}</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r) => (
            <li key={r.key}>
              <Link href={r.href} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 4px", borderRadius: 6, textDecoration: "none", color: "inherit" }}>
                <span className="muted tnum" style={{ fontSize: 11, minWidth: 42 }}>{r.head}</span>
                <span style={{ flex: 1, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.body}</span>
                {r.tag && <span className="tag" style={{ fontSize: 10, padding: "1px 8px" }}>{r.tag}</span>}
                {r.meta && <span className="muted" style={{ fontSize: 10.5 }}>{new Date(r.meta).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
