import { Icons } from "@/components/icons";
import { ExportButton, JobImportButton } from "@/components/CsvTools";
import { EntityTable } from "@/components/EntityTable";
import { engerClient, dbConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const JOB_EXPORT_HEADERS = [
  { key: "job_no", label: "案件番号" }, { key: "title", label: "案件名" }, { key: "client_name", label: "クライアント" },
  { key: "role_label", label: "職種" }, { key: "skillsCsv", label: "スキル" }, { key: "salary_min", label: "単価下限" },
  { key: "salary_max", label: "単価上限" }, { key: "remoteLabel", label: "リモート" },
];

const remoteLabel = (r: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");

export default async function JobsPage() {
  let jobs: any[] = [];
  let total = 0;
  let withSkills = 0;
  let dbError: string | null = null;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const [listRes, skRes] = await Promise.all([
        sb.from("jobs")
          .select("job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills, is_focus, flow_note, status, created_at", { count: "exact" })
          .eq("is_published", true)
          .order("job_no", { ascending: false })
          .limit(300),
        sb.from("jobs").select("id", { count: "exact", head: true }).neq("skills", "{}"),
      ]);
      jobs = listRes.data ?? [];
      total = listRes.count ?? jobs.length;
      withSkills = skRes.count ?? 0;
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です（.env.local / Vercel env）";
  }

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
          <div className="top"><div className="ico-box"><Icons.jobs /></div><div className="chip flat">実データ</div></div>
          <div><div className="val tnum">{total.toLocaleString("ja-JP")}<span className="unit">件</span></div><div className="label">掲載中の案件</div><div className="note">enger.jobs</div></div>
        </div>
        <div className="kpi accent">
          <div className="top"><div className="ico-box"><Icons.matching /></div><div className="chip">{total ? Math.round((withSkills / total) * 100) : 0}%</div></div>
          <div><div className="val tnum">{withSkills.toLocaleString("ja-JP")}<span className="unit">件</span></div><div className="label">スキル付き</div><div className="note">マッチング対象</div></div>
        </div>
        <div className="kpi">
          <div className="top"><div className="ico-box"><Icons.yen /></div><div className="chip flat">表示</div></div>
          <div><div className="val tnum">100<span className="unit">件</span></div><div className="label">表示中（最新順）</div><div className="note">job_no 降順</div></div>
        </div>
        <div className="kpi warn">
          <div className="top"><div className="ico-box"><Icons.bolt /></div><div className="chip">AI</div></div>
          <div><div className="val tnum">—</div><div className="label">未マッチ案件</div><div className="note">人材取込後に算出</div></div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 2px" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>案件一覧</h3>
        <div className="muted" style={{ fontSize: 11.5 }}>検索・絞り込み・列の表示切替・チェックで注力に一括登録できます</div>
      </div>

      <EntityTable kind="jobs" rows={jobs} total={total} />
    </div>
  );
}
