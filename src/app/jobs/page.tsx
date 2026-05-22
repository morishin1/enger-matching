import { Icons } from "@/components/icons";
import { ExportButton, JobImportButton } from "@/components/CsvTools";
import { EntityTable } from "@/components/EntityTable";
import { KpiTag } from "@/components/KpiTag";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getMatchingStats, pct } from "@/lib/stats";

export const dynamic = "force-dynamic";

const num = (n?: number) => (n == null ? "—" : n.toLocaleString("ja-JP"));

const JOB_EXPORT_HEADERS = [
  { key: "job_no", label: "案件番号" }, { key: "title", label: "案件名" }, { key: "client_name", label: "クライアント" },
  { key: "role_label", label: "職種" }, { key: "skillsCsv", label: "スキル" }, { key: "salary_min", label: "単価下限" },
  { key: "salary_max", label: "単価上限" }, { key: "remoteLabel", label: "リモート" },
];

const remoteLabel = (r: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams;
  let jobs: any[] = [];
  let total = 0;
  let dbError: string | null = null;
  const stats = await getMatchingStats();

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const baseCols = "job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills, is_focus, flow_note, status, created_at";
      // contact_email 列が未追加(email-columns.sql 未実行)でも落ちないようフォールバック
      let listRes: any = await sb.from("jobs")
        .select(`${baseCols}, contact_email, contact_name, source_mail_url`, { count: "exact" })
        .eq("is_published", true)
        .order("job_no", { ascending: false })
        .limit(300);
      if (listRes.error) {
        listRes = await sb.from("jobs")
          .select(baseCols, { count: "exact" })
          .eq("is_published", true)
          .order("job_no", { ascending: false })
          .limit(300);
      }
      jobs = listRes.data ?? [];
      total = listRes.count ?? jobs.length;
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です（.env.local / Vercel env）";
  }

  const jTotal = stats?.jobs_total ?? total;
  const proposable = stats?.jobs_proposable;
  const unmatched = stats ? Math.max(jTotal - (stats.jobs_proposable ?? 0), 0) : undefined;
  const detailPct = stats ? pct(stats.jobs_detail_full, stats.jobs_total) : undefined;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Jobs · 案件マスタ（実データ）</div>
          <h1>案件</h1>
          <div className="sub">
            中央 Supabase <b className="mono">enger.jobs</b> から取得した実案件です。CSVで取り込んだ案件がここに一覧表示され、マッチングの母数になります。
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          <ExportButton filename="案件一覧.csv" headers={JOB_EXPORT_HEADERS} rows={jobs.map((j) => ({ ...j, skillsCsv: (j.skills ?? []).join(" / "), remoteLabel: remoteLabel(j.remote_type) }))} />
          <JobImportButton />
        </div>
      </div>

      {dbError && (
        <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          <b>DB接続エラー：</b> {dbError}
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi brand">
          <div className="top"><div className="ico-box"><Icons.matching /></div><KpiTag kind="pri" /></div>
          <div><div className="val tnum">{num(proposable)}<span className="unit">件</span></div><div className="label">提案可能案件（有効案件）</div><div className="note">募集中 × マッチ候補1名以上</div></div>
        </div>
        <div className="kpi warn">
          <div className="top"><div className="ico-box"><Icons.bolt /></div><KpiTag kind="todo" /></div>
          <div><div className="val tnum">{num(unmatched)}<span className="unit">件</span></div><div className="label">未マッチ案件</div><div className="note">マッチ候補ゼロ・人材プール拡充で解消</div></div>
        </div>
        <div className="kpi">
          <div className="top"><div className="ico-box"><Icons.check /></div><KpiTag kind="fix" /></div>
          <div><div className="val tnum">{detailPct == null ? "—" : detailPct}<span className="unit">%</span></div><div className="label">要件詳細の充足率</div><div className="note">リモート頻度・希望業務まで入力済</div></div>
        </div>
        <div className="kpi accent">
          <div className="top"><div className="ico-box"><Icons.jobs /></div><KpiTag kind="flow" /></div>
          <div><div className="val tnum">{stats ? "+" + num(stats.jobs_new7) : "—"}<span className="unit">件</span></div><div className="label">新着案件（直近7日）</div><div className="note">流入が止まっていないかの監視</div></div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 2px" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>案件一覧</h3>
        <div className="muted" style={{ fontSize: 11.5 }}>検索・絞り込み・列の表示切替・チェックで注力に一括登録できます</div>
      </div>

      <EntityTable kind="jobs" rows={jobs} total={total} initialQuery={client} />
    </div>
  );
}
