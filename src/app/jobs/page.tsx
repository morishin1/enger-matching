import { Icons } from "@/components/icons";
import { ExportButton, JobImportButton } from "@/components/CsvTools";
import { EntityTable } from "@/components/EntityTable";
import { PendingClientJobs, type PendingJob } from "@/components/PendingClientJobs";
import { KpiTag } from "@/components/KpiTag";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getMatchingStats, pct } from "@/lib/stats";
import { getStaff } from "@/lib/staff";

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

  const jTotal = stats?.jobs_total ?? total;
  const proposable = stats?.jobs_proposable;
  const unmatched = stats ? Math.max(jTotal - (stats.jobs_proposable ?? 0), 0) : undefined;
  const detailPct = stats ? pct(stats.jobs_detail_full, stats.jobs_total) : undefined;

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

  // 重要データ充足（仮説立案の前提）。表示中の案件に対する欠落件数。
  const miss = {
    owner: jobs.filter((j) => !j.outside_owner).length,
    salary: jobs.filter((j) => !j.salary_min && !j.salary_max).length,
    skills: jobs.filter((j) => !(j.skills && j.skills.length)).length,
    client: jobs.filter((j) => !j.client_name).length,
  };
  const missTotal = miss.owner + miss.salary + miss.skills + miss.client;

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

      {/* 重要データの充足（仮説立案に必須） */}
      {jobs.length > 0 && (
        <div className="card" style={{ borderColor: missTotal > 0 ? "var(--color-warn, #e0a317)" : "var(--color-border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📋 重要データの充足（仮説立案の前提）</h3>
            <span className="muted" style={{ fontSize: 11 }}>表示中 {jobs.length} 件中の未入力</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 10, fontSize: 13 }}>
            <span>エンド担当 未設定 <b style={{ color: miss.owner ? "#b42318" : "#067647" }}>{miss.owner}</b></span>
            <span>単価 未入力 <b style={{ color: miss.salary ? "#b45309" : "#067647" }}>{miss.salary}</b></span>
            <span>スキル 未入力 <b style={{ color: miss.skills ? "#b45309" : "#067647" }}>{miss.skills}</b></span>
            <span>クライアント 未入力 <b style={{ color: miss.client ? "#b45309" : "#067647" }}>{miss.client}</b></span>
          </div>
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>※ これらは分析・仮説立案の土台になる必須項目です。下の一覧でエンド担当（赤背景＝未設定）を埋めてください。単価/スキルはCSV取込または案件詳細で補完します。</div>
        </div>
      )}

      <PendingClientJobs jobs={pendingClientJobs} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 2px" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>案件 おすすめランキング</h3>
        <div className="muted" style={{ fontSize: 11.5 }}>決まりやすい順に1位〜表示・行クリックで詳細・検索/絞り込み可</div>
      </div>

      <EntityTable kind="jobs" rows={jobs} total={total} initialQuery={client} outsideOptions={ownerOptions} />
    </div>
  );
}
