import { ExportButton, JobImportButton, JobNewButton, JobBulkExtractButton } from "@/components/CsvTools";
import { EntityTable } from "@/components/EntityTable";
import { PendingClientJobs, type PendingJob } from "@/components/PendingClientJobs";
import { EntityGrowthLine } from "@/components/EntityGrowthLine";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getStaff } from "@/lib/staff";
import { getEntityDelta } from "@/lib/import-stats";
import { getViewerScope, maskJobs } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const JOB_EXPORT_HEADERS = [
  { key: "job_no", label: "案件番号" }, { key: "title", label: "案件名" }, { key: "client_name", label: "クライアント" },
  { key: "role_label", label: "職種" }, { key: "skillsCsv", label: "スキル" }, { key: "salary_min", label: "単価下限" },
  { key: "salary_max", label: "単価上限" }, { key: "remoteLabel", label: "リモート" },
];

const remoteLabel = (r: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ client?: string; show?: string; q?: string }> }) {
  const { client, show, q } = await searchParams;
  const showAll = show === "all"; // 非公開（過去インポートで隠れている案件）も表示
  const needle = (q ?? client ?? "").trim();
  const scope = await getViewerScope();
  let jobs: any[] = [];
  let total = 0;
  let dbError: string | null = null;

  // パートナー企業：自社(owner_company)＋共有(shared)のみ。他社は匿名化。列が無ければ何も見せない(fail-closed)。
  if (scope.isTenant) {
    if (dbConfigured && scope.ownerKey) {
      try {
        const sb = engerClient();
        const cols = "job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills, is_focus, flow_note, status, detail, created_at, is_published, owner_company, shared";
        const ownedRes: any = await sb.from("jobs").select(cols).eq("owner_company", scope.ownerKey).order("job_no", { ascending: false }).limit(1000);
        const sharedRes: any = await sb.from("jobs").select(cols).eq("shared", true).eq("is_published", true).order("job_no", { ascending: false }).limit(1000);
        if (ownedRes.error || sharedRes.error) { dbError = "テナント分離用の列が未整備です（supabase/partner-tenant.sql を実行してください）"; }
        else {
          const map = new Map<number, any>();
          for (const r of [...(ownedRes.data ?? []), ...(sharedRes.data ?? [])]) if (r.job_no != null) map.set(r.job_no, r);
          // 二重の安全網：app側でも「自社 or 共有」に限定してから匿名化
          const rows = [...map.values()].filter((r) => r.owner_company === scope.ownerKey || r.shared === true);
          jobs = maskJobs(rows, scope.ownerKey, scope.meetingDone);
          total = jobs.length;
        }
      } catch (e) { dbError = e instanceof Error ? e.message : String(e); }
    } else if (!scope.ownerKey) {
      dbError = "会社情報が未設定です。管理者にお問い合わせください。";
    }
  } else if (dbConfigured) {
    try {
      const sb = engerClient();
      const baseCols = "job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills, is_focus, flow_note, status, detail, created_at, is_published";
      // 非公開も表示する場合は is_published フィルタを外す
      const withPub = (qb: any) => showAll ? qb : qb.eq("is_published", true);
      // 検索時は 300 件の上限を超えてDB全体を ilike 検索する。スキル(JSON配列)もテキストにキャストして拾う
      const withSearch = (qb: any) => {
        if (!needle) return qb;
        const like = `%${needle.replace(/[%_]/g, (m) => "\\" + m)}%`;
        // skills は jsonb/text[] のため ::text にキャストして部分一致
        return qb.or(`title.ilike.${like},client_name.ilike.${like},role_label.ilike.${like},skills::text.ilike.${like}`);
      };
      // 追加列(email-columns / sales-roles 未実行)でも落ちないよう段階フォールバック
      let listRes: any = await withSearch(withPub(sb.from("jobs")
        .select(`${baseCols}, outside_owner, contact_email, contact_name, source_mail_url`, { count: "exact" })))
        .order("job_no", { ascending: false })
        .limit(needle ? 1000 : 300);
      if (listRes.error) {
        listRes = await withSearch(withPub(sb.from("jobs")
          .select(`${baseCols}, outside_owner`, { count: "exact" })))
          .order("job_no", { ascending: false })
          .limit(needle ? 1000 : 300);
      }
      if (listRes.error) {
        listRes = await withSearch(withPub(sb.from("jobs")
          .select(baseCols, { count: "exact" })))
          .order("job_no", { ascending: false })
          .limit(needle ? 1000 : 300);
      }
      jobs = listRes.data ?? [];
      total = listRes.count ?? jobs.length;
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です（.env.local / Vercel env）";
  }

  // 企業掲載の承認待ち案件（社内のみ。パートナーには見せない）
  let pendingClientJobs: PendingJob[] = [];
  if (dbConfigured && !scope.isTenant) {
    try {
      const sb = engerClient();
      const { data } = await sb.from("jobs")
        .select("job_no, title, client_name, role_label, salary_min, salary_max, contract_types, description, posted_by_email, created_at")
        .eq("posted_by_client", true).eq("review_status", "pending")
        .order("created_at", { ascending: false }).limit(50);
      pendingClientJobs = (data ?? []) as PendingJob[];
    } catch { /* 列未追加なら無視 */ }
  }

  // エンド担当の選択肢（アウトサイド、無ければ全担当者）。パートナーには社内担当者名を渡さない。
  const staff = scope.isTenant ? { rows: [] as any[] } : await getStaff();
  const outsideNames = staff.rows.filter((s: any) => s.position === "outside").map((s: any) => s.name);
  const ownerOptions = outsideNames.length ? outsideNames : staff.rows.map((s: any) => s.name);
  const growth = scope.isTenant ? { total: jobs.length, last7: 0 } as any : await getEntityDelta("jobs");

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Jobs · 案件マスタ（実データ）</div>
          <h1>案件</h1>
          <EntityGrowthLine unit="件" delta={growth} />
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          {!scope.isTenant && (
            <a href={showAll ? "/jobs" : "/jobs?show=all"} className="btn ghost" style={{ textDecoration: "none", fontSize: 12 }}
              title={showAll ? "公開中の案件のみ表示" : "非公開（過去インポートで一覧に出ていない案件）も含めて表示"}>
              {showAll ? "公開中のみ表示" : "非公開も表示"}
            </a>
          )}
          {!scope.isTenant && <ExportButton filename="案件一覧.csv" headers={JOB_EXPORT_HEADERS} rows={jobs.map((j) => ({ ...j, skillsCsv: (j.skills ?? []).join(" / "), remoteLabel: remoteLabel(j.remote_type) }))} />}
          <JobNewButton />
          {!scope.isTenant && <JobBulkExtractButton />}
          {!scope.isTenant && <JobImportButton />}
        </div>
      </div>

      {scope.isTenant && (
        <div className="card" style={{ background: "#eef2ff", borderColor: "#c7d2fe", fontSize: 12.5, color: "var(--color-ink-2)" }}>
          <b>パートナー表示</b>：自社で登録した案件と、共有された案件のみ表示しています。<b>他社の案件はクライアント名・連絡先を伏せた匿名表示</b>です。
        </div>
      )}
      {!scope.isTenant && showAll && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 12.5 }}>
          <b>非公開を含めて表示中。</b> 公開フラグ（is_published）が立っていない案件も表示しています。手動登録で同名案件が「重複」になる場合、ここに隠れた既存案件が原因です。該当案件を開いて編集・再公開できます。
        </div>
      )}

      {dbError && (
        <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          <b>DB接続エラー：</b> {dbError}
        </div>
      )}

      {!scope.isTenant && <PendingClientJobs jobs={pendingClientJobs} />}

      <EntityTable kind="jobs" rows={jobs} total={total} initialQuery={needle || undefined} outsideOptions={ownerOptions} partner={scope.isTenant} meetingDone={scope.meetingDone}
        agentContact={{ line: process.env.NEXT_PUBLIC_AGENT_LINE_URL, email: process.env.NEXT_PUBLIC_AGENT_EMAIL, phone: process.env.NEXT_PUBLIC_AGENT_PHONE }} />
    </div>
  );
}
