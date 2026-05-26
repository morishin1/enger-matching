import { ExportButton, JobImportButton } from "@/components/CsvTools";
import { EntityTable } from "@/components/EntityTable";
import { PendingClientJobs, type PendingJob } from "@/components/PendingClientJobs";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getStaff } from "@/lib/staff";

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
      const baseCols = "job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills, is_focus, flow_note, status, created_at";
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

      // 「決まりやすい順」：企業の決定率(分析データ) + 注力 + 鮮度 + スキル有 + 単価帯 で並べる（AI不使用）
      try {
        const pr = await sb.from("proposals").select("company, stage").limit(3000);
        const stat: Record<string, { won: number; total: number }> = {};
        for (const p of (pr.data ?? []) as any[]) {
          const c = (p.company || "").trim(); if (!c) continue;
          stat[c] ??= { won: 0, total: 0 }; stat[c].total++;
          if (["稼働", "稼働決定", "面談合格"].includes(p.stage)) stat[c].won++;
        }
        const days = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 9999);
        const freshScore = (d: string | null) => { const n = days(d); return n <= 1 ? 20 : n <= 3 ? 14 : n <= 14 ? 8 : 2; };
        const bandScore = (j: any) => { const v = j.salary_max ?? j.salary_min ?? 0; return v >= 90 ? 8 : v >= 70 ? 10 : v > 0 ? 5 : 0; };
        const scoreOf = (j: any) => {
          const s = stat[(j.client_name || "").trim()];
          const closeRate = s && s.total ? s.won / s.total : 0;
          const reasons: string[] = [];
          if (closeRate >= 0.25 && s && s.total >= 2) reasons.push(`この企業の成約率 ${Math.round(closeRate * 100)}%`);
          if (j.is_focus) reasons.push("注力案件");
          if (days(j.created_at) <= 3) reasons.push("新着");
          if (j.skills?.length) reasons.push("スキル要件が明確");
          const v = j.salary_max ?? j.salary_min ?? 0; if (v >= 70 && v < 90) reasons.push("動きやすい単価帯");
          const score = Math.round(closeRate * 40 + (j.is_focus ? 20 : 0) + freshScore(j.created_at) + ((j.skills?.length) ? 10 : 0) + bandScore(j));
          return { score, reasons: reasons.slice(0, 3) };
        };
        jobs = jobs.map((j: any) => { const r = scoreOf(j); return { ...j, _score: r.score, _reasons: r.reasons }; }).sort((a: any, b: any) => b._score - a._score);
      } catch { /* 並べ替え失敗時は元の順 */ }
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

      <PendingClientJobs jobs={pendingClientJobs} />

      <EntityTable kind="jobs" rows={jobs} total={total} initialQuery={client} outsideOptions={ownerOptions} />
    </div>
  );
}
