import { Icons } from "@/components/icons";
import { engerClient, dbConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const remoteLabel = (r: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");

const salaryLabel = (lo: number | null, hi: number | null) => {
  if (lo && hi) return lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`;
  if (hi) return `〜¥${hi}万`;
  if (lo) return `¥${lo}万〜`;
  return "スキル見合い";
};

export default async function JobsPage() {
  let jobs: any[] = [];
  let total = 0;
  let withSkills = 0;
  let dbError: string | null = null;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const { data, count } = await sb
        .from("jobs")
        .select("job_no, title, client_name, role_label, salary_min, salary_max, remote_type, rank, skills", { count: "exact" })
        .eq("is_published", true)
        .order("job_no", { ascending: false })
        .limit(100);
      jobs = data ?? [];
      total = count ?? jobs.length;
      const { count: sc } = await sb.from("jobs").select("id", { count: "exact", head: true }).neq("skills", "{}");
      withSkills = sc ?? 0;
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
          <button className="btn"><Icons.filter /><span>絞り込み</span></button>
          <button className="btn brand"><Icons.plus /><span>CSV取込</span></button>
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

      <div className="card flush">
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>案件一覧</h3><div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>最新 100 件 / 全 {total.toLocaleString("ja-JP")} 件</div></div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 70 }}>No.</th><th>案件</th><th>職種</th><th>スキル</th>
              <th style={{ width: 110 }}>単価</th><th style={{ width: 90 }}>リモート</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "var(--color-ink-4)" }}>案件がありません</td></tr>
            ) : (
              jobs.map((j) => (
                <tr key={j.job_no}>
                  <td><span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>No.{String(j.job_no ?? 0).padStart(5, "0")}</span></td>
                  <td>
                    <div className="pri">{j.title}</div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{j.client_name ?? "—"}</div>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{j.role_label ?? "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(j.skills ?? []).slice(0, 4).map((s: string) => <span key={s} className="tag" style={{ fontSize: 10.5 }}>{s}</span>)}
                    </div>
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>{salaryLabel(j.salary_min, j.salary_max)}</td>
                  <td><span className="pill open">{remoteLabel(j.remote_type)}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
