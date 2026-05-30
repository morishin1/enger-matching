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

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ client?: string; show?: string }> }) {
  const { client, show } = await searchParams;
  const showAll = show === "all"; // 非公開（過去インポートで隠れている案件）も表示
  let jobs: any[] = [];
  let total = 0;
  let dbError: string | null = null;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const baseCols = "job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills, is_focus, flow_note, status, detail, created_at, is_published";
      // 非公開も表示する場合は is_published フィルタを外す
      const withPub = (qb: any) => showAll ? qb : qb.eq("is_published", true);
      // 追加列(email-columns / sales-roles 未実行)でも落ちないよう段階フォールバック
      let listRes: any = await withPub(sb.from("jobs")
        .select(`${baseCols}, outside_owner, contact_email, contact_name, source_mail_url`, { count: "exact" }))
        .order("job_no", { ascending: false })
        .limit(300);
      if (listRes.error) {
        listRes = await withPub(sb.from("jobs")
          .select(`${baseCols}, outside_owner`, { count: "exact" }))
          .order("job_no", { ascending: false })
          .limit(300);
      }
      if (listRes.error) {
        listRes = await withPub(sb.from("jobs")
          .select(baseCols, { count: "exact" }))
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
          <a href={showAll ? "/jobs" : "/jobs?show=all"} className="btn ghost" style={{ textDecoration: "none", fontSize: 12 }}
            title={showAll ? "公開中の案件のみ表示" : "非公開（過去インポートで一覧に出ていない案件）も含めて表示"}>
            {showAll ? "公開中のみ表示" : "非公開も表示"}
          </a>
          <ExportButton filename="案件一覧.csv" headers={JOB_EXPORT_HEADERS} rows={jobs.map((j) => ({ ...j, skillsCsv: (j.skills ?? []).join(" / "), remoteLabel: remoteLabel(j.remote_type) }))} />
          <JobNewButton />
          <JobImportButton />
        </div>
      </div>

      {showAll && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 12.5 }}>
          <b>非公開を含めて表示中。</b> 公開フラグ（is_published）が立っていない案件も表示しています。手動登録で同名案件が「重複」になる場合、ここに隠れた既存案件が原因です。該当案件を開いて編集・再公開できます。
        </div>
      )}

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
