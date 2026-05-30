import { CandidateImportButton, CandidateNewButton, CandidateBulkExtractButton, ExportButton } from "@/components/CsvTools";
import { EntityTable } from "@/components/EntityTable";
import { EntityGrowthLine } from "@/components/EntityGrowthLine";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getEntityDelta } from "@/lib/import-stats";
import { getViewerScope, maskCandidates } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const EXPORT_HEADERS = [
  { key: "kanriNo", label: "管理NO" }, { key: "name", label: "氏名" }, { key: "title", label: "職種" },
  { key: "affiliation", label: "所属" }, { key: "skillsCsv", label: "スキル" }, { key: "rate", label: "希望単価" },
  { key: "avail", label: "稼働開始" }, { key: "location", label: "勤務地" }, { key: "exp", label: "経験" }, { key: "status", label: "ステータス" },
];

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q: initialQuery } = await searchParams;
  const scope = await getViewerScope();
  let people: any[] = [];
  let total = 0;
  let dbError: string | null = null;

  const needle = (initialQuery ?? "").trim();
  // パートナー企業：自社(owner_company)＋共有(shared)のみ。他社は匿名化。列が無ければ何も見せない(fail-closed)。
  if (scope.isPartner) {
    if (dbConfigured && scope.company) {
      try {
        const sb = engerClient();
        const cols = "candidate_no, name, initials, title, affiliation, source_company, company, skills, rate, salary_min, salary_max, avail, location, exp, status, remote_pref, is_focus, created_at, owner_company, shared";
        const ownedRes: any = await sb.from("candidates").select(cols).eq("owner_company", scope.company).order("candidate_no", { ascending: false }).limit(1000);
        const sharedRes: any = await sb.from("candidates").select(cols).eq("shared", true).order("candidate_no", { ascending: false }).limit(1000);
        if (ownedRes.error || sharedRes.error) { dbError = "テナント分離用の列が未整備です（supabase/partner-tenant.sql を実行してください）"; }
        else {
          const map = new Map<number, any>();
          for (const r of [...(ownedRes.data ?? []), ...(sharedRes.data ?? [])]) if (r.candidate_no != null) map.set(r.candidate_no, r);
          const rows = [...map.values()].filter((r) => r.owner_company === scope.company || r.shared === true);
          people = maskCandidates(rows, scope.company);
          total = people.length;
        }
      } catch (e) { dbError = e instanceof Error ? e.message : String(e); }
    } else if (!scope.company) {
      dbError = "会社情報が未設定です。管理者にお問い合わせください。";
    }
  } else if (dbConfigured) {
    try {
      const sb = engerClient();
      const baseCols = "candidate_no, name, initials, title, affiliation, source_company, company, skills, rate, salary_min, salary_max, avail, location, exp, status, remote_pref, is_focus, created_at";
      // 検索時は 300 件上限を超えてDB全体を ilike 検索する。スキル(JSON配列)はテキストにキャスト
      const withSearch = (qb: any) => {
        if (!needle) return qb;
        const like = `%${needle.replace(/[%_]/g, (m) => "\\" + m)}%`;
        return qb.or(`name.ilike.${like},source_company.ilike.${like},company.ilike.${like},affiliation.ilike.${like},title.ilike.${like},skills::text.ilike.${like}`);
      };
      // rank / email 列が未追加でも落ちないようフォールバック
      let res: any = await withSearch(sb
        .from("candidates")
        .select(`${baseCols}, rank, email, contact_email, source_mail_url, skill_sheet_url`, { count: "exact" }))
        .order("candidate_no", { ascending: false })
        .limit(needle ? 1000 : 300);
      if (res.error) {
        res = await withSearch(sb
          .from("candidates")
          .select(baseCols, { count: "exact" }))
          .order("candidate_no", { ascending: false })
          .limit(needle ? 1000 : 300);
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
  const growth = scope.isPartner ? { total: people.length, last7: 0 } as any : await getEntityDelta("candidates");

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">People · 人材マスタ（実データ）</div>
          <h1>人材</h1>
          <EntityGrowthLine unit="名" delta={growth} />
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          {!scope.isPartner && <ExportButton filename="人材一覧.csv" headers={EXPORT_HEADERS} rows={exportRows} />}
          <CandidateNewButton />
          {!scope.isPartner && <CandidateBulkExtractButton />}
          {!scope.isPartner && <CandidateImportButton />}
        </div>
      </div>

      {scope.isPartner && (
        <div className="card" style={{ background: "#eef2ff", borderColor: "#c7d2fe", fontSize: 12.5, color: "var(--color-ink-2)" }}>
          <b>パートナー表示</b>：自社で登録した人材と、共有された人材のみ表示しています。<b>他社の人材は氏名・連絡先を伏せた匿名表示（イニシャル＋スキル＋単価）</b>です。
        </div>
      )}

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

      <EntityTable kind="people" rows={people} total={total} initialQuery={initialQuery} partner={scope.isPartner} />
    </div>
  );
}
