import { ExportButton, JobImportButton, JobNewButton } from "@/components/CsvTools";
import { EntityTable } from "@/components/EntityTable";
import { PendingClientJobs, type PendingJob } from "@/components/PendingClientJobs";
import { EntityGrowthLine } from "@/components/EntityGrowthLine";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getStaff } from "@/lib/staff";
import { getEntityDelta } from "@/lib/import-stats";

export const dynamic = "force-dynamic";

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

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const baseCols = "job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills, is_focus, flow_note, status, detail, created_at";
      // 追加列(email-columns / sales-roles 未実行)でも落ちないよう段階フォールバック
      let listRes: any = await sb.from("jobs")
        .select(`${baseCols}, outside_owner, contact_email, contact_name, source_mail_url`, { count: "exact" })
        .eq("is_published", true)
        .order("job_no", { ascending: false })
        .limit(300);
      if (listRes.error) {
        listRes = await sb.from("jobs")
          .select(`${baseCols}, outside_owner`, { count: "exact" })
          .eq("is_published", true)
          .order("job_no", { ascending: false })
          .limit(300);
      }
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

  // 企業掲載の承認待ち案件
  let pendingClientJobs: PendingJob[] = [];
  if (dbConfigured) {
    try {
      const sb = engerClient();
      const { data } = await sb.from("jobs")
        .select("job_no, title, client_name, role_label, salary_min, salary_max, contract_types, description, posted_by_email, created_at")
        .eq("posted_by_client", true).eq("review_status", "pending")
        .order("created_at", { ascending: false }).limit(50);
      pendingClientJobs = (data ?? []) as PendingJob[];
    } catch { /* 列未追加なら無視 */ }
  }

  // エンド担当の選択肢（アウトサイド、無ければ全担当者）
  const staff = await getStaff();
  const outsideNames = staff.rows.filter((s) => s.position === "outside").map((s) => s.name);
  const ownerOptions = outsideNames.length ? outsideNames : staff.rows.map((s) => s.name);
  const growth = await getEntityDelta("jobs");

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Jobs · 案件マスタ（実データ）</div>
          <h1>案件</h1>
          <EntityGrowthLine unit="件" delta={growth} />
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          <ExportButton filename="案件一覧.csv" headers={JOB_EXPORT_HEADERS} rows={jobs.map((j) => ({ ...j, skillsCsv: (j.skills ?? []).join(" / "), remoteLabel: remoteLabel(j.remote_type) }))} />
          <JobNewButton />
          <JobImportButton />
        </div>
      </div>

      {dbError && (
        <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          <b>DB接続エラー：</b> {dbError}
        </div>
      )}

      <PendingClientJobs jobs={pendingClientJobs} />

      <EntityTable kind="jobs" rows={jobs} total={total} initialQuery={client} outsideOptions={ownerOptions} />
    </div>
  );
}
