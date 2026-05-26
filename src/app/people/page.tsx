import { CandidateImportButton, ExportButton } from "@/components/CsvTools";
import { EntityTable } from "@/components/EntityTable";
import { engerClient, dbConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const EXPORT_HEADERS = [
  { key: "kanriNo", label: "管理NO" }, { key: "name", label: "氏名" }, { key: "title", label: "職種" },
  { key: "affiliation", label: "所属" }, { key: "skillsCsv", label: "スキル" }, { key: "rate", label: "希望単価" },
  { key: "avail", label: "稼働開始" }, { key: "location", label: "勤務地" }, { key: "exp", label: "経験" }, { key: "status", label: "ステータス" },
];

export default async function PeoplePage() {
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
        .select(`${baseCols}, rank, email, contact_email, source_mail_url`, { count: "exact" })
        .order("candidate_no", { ascending: true })
        .limit(300);
      if (res.error) {
        res = await sb
          .from("candidates")
          .select(baseCols, { count: "exact" })
          .order("candidate_no", { ascending: true })
          .limit(300);
      }
      people = res.data ?? [];
      total = res.count ?? people.length;

      // 「決まりやすい順」：提案可・スキル有・単価帯(B)・鮮度・注力 で並べる（AI不使用）
      const days = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 9999);
      const freshScore = (d: string | null) => { const n = days(d); return n <= 1 ? 20 : n <= 3 ? 14 : n <= 14 ? 8 : 2; };
      const rankScore = (r: string | null) => r === "B" ? 15 : r === "A" ? 10 : r === "C" ? 5 : 0;
      const scoreOf = (p: any) => {
        const reasons: string[] = [];
        if ((p.status ?? "").includes("提案")) reasons.push("提案可ステータス");
        if (p.skills?.length) reasons.push("スキル登録あり");
        if (p.rank) reasons.push(`ランク${p.rank}`);
        if (days(p.created_at) <= 3) reasons.push("新着");
        if (p.saved || p.is_focus) reasons.push("注力人材");
        const score = Math.round(((p.status ?? "").includes("提案") ? 25 : 0) + ((p.skills?.length) ? 20 : 0) + rankScore(p.rank ?? null) + freshScore(p.created_at) + ((p.saved || p.is_focus) ? 10 : 0));
        return { score, reasons: reasons.slice(0, 3) };
      };
      people = people.map((p: any) => { const r = scoreOf(p); return { ...p, _score: r.score, _reasons: r.reasons }; }).sort((a: any, b: any) => b._score - a._score);
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  const exportRows = people.map((p) => ({ ...p, kanriNo: `P-${String(p.candidate_no ?? 0).padStart(5, "0")}`, skillsCsv: (p.skills ?? []).join(" / ") }));

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">People · 人材マスタ（実データ）</div>
          <h1>人材</h1>
          <div className="sub">
            登録人材 <b style={{ color: "var(--color-ink)" }}>{total.toLocaleString("ja-JP")} 名</b>。
            CSVで人材をアップロードすると、案件とのマッチング母数になります（<b className="mono">enger.candidates</b>）。
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          <ExportButton filename="人材一覧.csv" headers={EXPORT_HEADERS} rows={exportRows} />
          <CandidateImportButton />
        </div>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

      <EntityTable kind="people" rows={people} total={total} />
    </div>
  );
}
