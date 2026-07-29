import Link from "@/components/AppLink";
import { MatchingPeerTabsServer } from "@/components/MatchingPeerTabsServer";
import { NewRegistrationsList } from "@/components/NewRegistrationsList";
import { listAccounts, listLpPendingCandidates, listLpTalentEntries } from "@/lib/accounts";
import { engerAdmin, dbConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 0725改善：登録 → 成約 のパイプライン数（エージェントが「いまどこに玉があるか」を一目で掴む）。
//   件数はベストエフォート（列・テーブル未整備なら null → "—" 表示。この画面は絶対に落とさない）。
async function loadPipelineCounts(): Promise<{ candidates: number | null; proposing: number | null; meeting: number | null; won: number | null }> {
  const out = { candidates: null as number | null, proposing: null as number | null, meeting: null as number | null, won: null as number | null };
  if (!dbConfigured) return out;
  try {
    const admin = engerAdmin();
    const count = async (fn: (qb: any) => any): Promise<number | null> => {
      try {
        const r: any = await fn(admin);
        return r.error ? null : (typeof r.count === "number" ? r.count : null);
      } catch { return null; }
    };
    // マッチング対象の人材（クローズ・削除済みを除く）。列未整備環境はフィルタを緩めて再試行。
    out.candidates = await count((sb: any) => sb.from("candidates").select("id", { count: "exact", head: true }).eq("is_closed", false).is("deleted_at", null))
      ?? await count((sb: any) => sb.from("candidates").select("id", { count: "exact", head: true }));
    // 提案中（承認待ち〜確認中）／面談（面談・合格）／成約（稼働・稼働決定）
    out.proposing = await count((sb: any) => sb.from("proposals").select("id", { count: "exact", head: true }).in("stage", ["承認待ち", "所属確認", "提案中", "確認中"]));
    out.meeting = await count((sb: any) => sb.from("proposals").select("id", { count: "exact", head: true }).in("stage", ["面談", "合格"]));
    out.won = await count((sb: any) => sb.from("proposals").select("id", { count: "exact", head: true }).in("stage", ["稼働", "稼働決定"]));
  } catch { /* 集計失敗はすべて "—" 表示 */ }
  return out;
}

function PipelineBar({ newcomers, counts }: { newcomers: number; counts: Awaited<ReturnType<typeof loadPipelineCounts>> }) {
  const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("ja-JP"));
  const steps: { label: string; sub: string; value: string; href: string; accent?: boolean }[] = [
    { label: "新着（承認待ち）", sub: "面談チェックで本登録", value: newcomers.toLocaleString("ja-JP"), href: "/newcomers", accent: newcomers > 0 },
    { label: "マッチング対象", sub: "人材一覧（シート閲覧可）", value: fmt(counts.candidates), href: "/people" },
    { label: "提案中", sub: "承認待ち〜確認中", value: fmt(counts.proposing), href: "/proposals" },
    { label: "面談", sub: "面談・合格", value: fmt(counts.meeting), href: "/proposals" },
    { label: "成約", sub: "稼働・稼働決定", value: fmt(counts.won), href: "/proposals" },
  ];
  return (
    <div className="card" style={{ padding: "10px 12px", display: "flex", alignItems: "stretch", gap: 4, overflowX: "auto" }}>
      {steps.map((st, i) => (
        <div key={st.label} style={{ display: "flex", alignItems: "center", gap: 4, flex: "1 0 auto" }}>
          <Link href={st.href} style={{ textDecoration: "none", color: "inherit", flex: 1 }}>
            <div style={{ border: `1px solid ${st.accent ? "var(--color-brand-300, #7cc4f0)" : "var(--color-border)"}`, background: st.accent ? "var(--color-brand-25, #f0f8ff)" : "var(--color-surface)", borderRadius: 10, padding: "8px 12px", minWidth: 128 }}>
              <div className="muted" style={{ fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>{st.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3, color: st.accent ? "var(--color-brand-700)" : "var(--color-ink)" }}>{st.value}</div>
              <div className="muted" style={{ fontSize: 10, whiteSpace: "nowrap" }}>{st.sub}</div>
            </div>
          </Link>
          {i < steps.length - 1 && (
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-ink-4)", flexShrink: 0 }}>chevron_right</span>
          )}
        </div>
      ))}
    </div>
  );
}

// マッチング → 新着：各LP（右腕COO・エンジャーフリーランス 等）から登録された人材の承認待ち一覧。
//   ・LP登録エントリー（coo_talent_entries）… 承認＝enger.candidates へ取込（マッチング対象に）
//   ・enger.jp の profiles/auth 由来 … 承認＝ログイン可の人材アカウントに
//   すべてこの1画面で承認でき、登録元バッジでどのLPから来たかが分かる。
export default async function NewcomersPage() {
  const [rows, pipeline] = await Promise.all([
    Promise.all([listAccounts(), listLpPendingCandidates(), listLpTalentEntries()]).then(([real, lp, entries]) =>
      [
        ...entries,
        ...real.filter((a) => a.status === "pending"),
        ...lp,
      ]
        .filter((a) => a.role !== "client" && a.role !== "partner" && a.role !== "admin" && a.role !== "agent")
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    ).catch(() => []),
    loadPipelineCounts(),
  ]);

  return (
    <div className="page">
      <MatchingPeerTabsServer activeCount={rows.length} />
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">ENGER · 新着登録</div>
          <h1>新着</h1>
          <div className="sub">
            <b>エンジャーフリーランス（enger.jp）</b>から登録された人材の承認待ち一覧です。
            承認すると本人が人材ダッシュボードを使えるようになり、フリーランス一覧・マッチング対象に反映されます。
            企業の新規登録は <a href="/companies?tab=new">企業管理 → 新着</a> で確認できます。
          </div>
        </div>
      </div>
      {/* 0725改善：登録→成約のパイプライン。各ステップから該当画面へ直行できる。 */}
      <PipelineBar newcomers={rows.length} counts={pipeline} />
      <NewRegistrationsList rows={rows} kind="talent" />
    </div>
  );
}
