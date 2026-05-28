import { CandidateImportButton, CandidateNewButton, ExportButton } from "@/components/CsvTools";
import { EntityTable } from "@/components/EntityTable";
import { EntityGrowthLine } from "@/components/EntityGrowthLine";
import { MatchingTabs } from "@/components/MatchingTabs";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getEntityDelta } from "@/lib/import-stats";

export const dynamic = "force-dynamic";

const EXPORT_HEADERS = [
  { key: "kanriNo", label: "管理NO" }, { key: "name", label: "氏名" }, { key: "title", label: "職種" },
  { key: "affiliation", label: "所属" }, { key: "skillsCsv", label: "スキル" }, { key: "rate", label: "希望単価" },
  { key: "avail", label: "稼働開始" }, { key: "location", label: "勤務地" }, { key: "exp", label: "経験" }, { key: "status", label: "ステータス" },
];

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: initialQuery } = await searchParams;
  let people: any[] = [];
  let total = 0;
  let dbError: string | null = null;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const baseCols = "candidate_no, name, initials, title, affiliation, source_company, skills, rate, salary_min, salary_max, avail, location, exp, status, remote_pref, is_focus, created_at";
      // rank / email 列が未追加でも落ちないようフォールバック
      let res: any = await sb
        .from("candidates")
        .select(`${baseCols}, rank, email, contact_email, source_mail_url, skill_sheet_url`, { count: "exact" })
        .order("candidate_no", { ascending: false })
        .limit(300);
      if (res.error) {
        res = await sb
          .from("candidates")
          .select(baseCols, { count: "exact" })
          .order("candidate_no", { ascending: false })
          .limit(300);
      }
      people = res.data ?? [];
      total = res.count ?? people.length;
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  const exportRows = people.map((p) => ({ ...p, kanriNo: `P-${String(p.candidate_no ?? 0).padStart(5, "0")}`, skillsCsv: (p.skills ?? []).join(" / ") }));
  const growth = await getEntityDelta("candidates");

  return (
    <div className="page">
      <MatchingTabs active="people" />
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">People · 人材マスタ（実データ）</div>
          <h1>人材</h1>
          <EntityGrowthLine unit="名" delta={growth} />
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          <ExportButton filename="人材一覧.csv" headers={EXPORT_HEADERS} rows={exportRows} />
          <CandidateNewButton />
          <CandidateImportButton />
        </div>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

      <EntityTable kind="people" rows={people} total={total} initialQuery={initialQuery} />
    </div>
  );
}
