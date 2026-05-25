import { PrComposer } from "@/components/PrComposer";
import { engerClient, publicAdmin, dbConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const remoteLabel = (r?: string | null) => (r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : "");
const rateLabel = (lo?: number | null, hi?: number | null) => (lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `¥${hi}万〜` : lo ? `¥${lo}万〜` : "");

export default async function PrPage() {
  let engTotal = 0, jobsPub = 0;
  let sample: { skills: string[]; rate: string; remote: string; role: string }[] = [];

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const pub = publicAdmin();
      const [e, j] = await Promise.all([
        pub.from("profiles").select("id", { count: "exact", head: true }).or("github_id.not.is.null,display_name.not.is.null"),
        sb.from("jobs").select("id", { count: "exact", head: true }).eq("is_published", true),
      ]);
      engTotal = e.count ?? 0;
      jobsPub = j.count ?? 0;
      // 匿名の注目案件（高単価順・企業名は出さない）
      const s = await sb.from("jobs").select("role_label, skills, salary_min, salary_max, remote_type")
        .eq("is_published", true).not("salary_max", "is", null).order("salary_max", { ascending: false }).limit(3);
      sample = ((s.data ?? []) as any[]).map((r) => ({
        role: r.role_label || "エンジニア",
        skills: (r.skills ?? []).slice(0, 3),
        rate: rateLabel(r.salary_min, r.salary_max),
        remote: remoteLabel(r.remote_type),
      }));
    } catch { /* noop */ }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">PR · X集客</div>
          <h1>PR・X集客</h1>
          <div className="sub">実データから投稿文を自動生成し、ワンクリックで X（旧Twitter）に投稿できます。文面は編集可。エンジニア登録の母数を増やす運用に活用してください。</div>
        </div>
      </div>
      <PrComposer engTotal={engTotal} jobsPub={jobsPub} sample={sample} />
    </div>
  );
}
