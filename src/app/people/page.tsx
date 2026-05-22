import { Icons } from "@/components/icons";
import { CandidateImportButton, ExportButton } from "@/components/CsvTools";
import { EntityTable } from "@/components/EntityTable";
import { KpiTag } from "@/components/KpiTag";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getMatchingStats, pct } from "@/lib/stats";

export const dynamic = "force-dynamic";

const num = (n?: number) => (n == null ? "—" : n.toLocaleString("ja-JP"));

const EXPORT_HEADERS = [
  { key: "kanriNo", label: "管理NO" }, { key: "name", label: "氏名" }, { key: "title", label: "職種" },
  { key: "affiliation", label: "所属" }, { key: "skillsCsv", label: "スキル" }, { key: "rate", label: "希望単価" },
  { key: "avail", label: "稼働開始" }, { key: "location", label: "勤務地" }, { key: "exp", label: "経験" }, { key: "status", label: "ステータス" },
];

export default async function PeoplePage() {
  let people: any[] = [];
  let total = 0;
  let dbError: string | null = null;
  const stats = await getMatchingStats();

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
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  const exportRows = people.map((p) => ({ ...p, kanriNo: `P-${String(p.candidate_no ?? 0).padStart(5, "0")}`, skillsCsv: (p.skills ?? []).join(" / ") }));

  const cTotal = stats?.cand_total ?? total;
  const proposable = stats?.cand_proposable;
  const usableRate = stats && cTotal ? (((stats.cand_proposable ?? 0) / cTotal) * 100) : undefined;
  const profilePct = stats ? pct(stats.cand_profile_full, stats.cand_total) : undefined;

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

      <div className="kpi-grid">
        <div className="kpi brand">
          <div className="top"><div className="ico-box"><Icons.check /></div><KpiTag kind="pri" /></div>
          <div>
            <div className="val tnum">{num(proposable)}<span className="unit">名</span></div>
            <div className="label">提案可能人材（有効プール）</div>
            <div className="note">
              {stats ? `登録${num(stats.cand_total)} → スキル${num(stats.cand_skills)} → 提案可${num(stats.cand_proposable)}` : "ステータス=提案可"}
              {usableRate != null && `　使えるのは${usableRate.toFixed(1)}%`}
            </div>
          </div>
        </div>
        <div className="kpi">
          <div className="top"><div className="ico-box"><Icons.people /></div><KpiTag kind="fix" /></div>
          <div><div className="val tnum">{profilePct == null ? "—" : profilePct}<span className="unit">%</span></div><div className="label">プロフィール充足率</div><div className="note">スキル・希望条件が揃った割合</div></div>
        </div>
        <div className="kpi warn">
          <div className="top"><div className="ico-box"><Icons.bolt /></div><KpiTag kind="todo" /></div>
          <div><div className="val tnum">{num(stats?.cand_stale)}<span className="unit">名</span></div><div className="label">鮮度切れ人材</div><div className="note">30日以上 情報更新なし・NG判定候補</div></div>
        </div>
        <div className="kpi accent">
          <div className="top"><div className="ico-box"><Icons.star /></div><KpiTag kind="check" /></div>
          <div><div className="val tnum">{num(stats?.cand_dupes)}<span className="unit">件</span></div><div className="label">重複疑い</div><div className="note">名寄せで検出した同一人物の疑い</div></div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 2px" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>人材一覧</h3>
        <div className="muted" style={{ fontSize: 11.5 }}>検索・絞り込み・列の表示切替・チェックで注力に一括登録できます</div>
      </div>

      <EntityTable kind="people" rows={people} total={total} />
    </div>
  );
}
