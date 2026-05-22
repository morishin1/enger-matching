import { Icons } from "@/components/icons";
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
      const baseCols = "candidate_no, name, initials, title, affiliation, skills, rate, avail, location, exp, status, remote_pref, is_focus";
      // rank 列が未追加(people-rank.sql 未実行)でも落ちないようフォールバック
      let res: any = await sb
        .from("candidates")
        .select(`${baseCols}, rank`, { count: "exact" })
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
          <div className="top"><div className="ico-box"><Icons.people /></div><div className="chip flat">実データ</div></div>
          <div><div className="val tnum">{total.toLocaleString("ja-JP")}<span className="unit">名</span></div><div className="label">登録人材</div><div className="note">enger.candidates</div></div>
        </div>
        <div className="kpi accent">
          <div className="top"><div className="ico-box"><Icons.check /></div><div className="chip">提案可</div></div>
          <div><div className="val tnum">{people.filter((p) => p.status === "提案可").length}<span className="unit">名</span></div><div className="label">提案可能</div><div className="note">ステータス別</div></div>
        </div>
        <div className="kpi">
          <div className="top"><div className="ico-box"><Icons.matching /></div><div className="chip flat">—</div></div>
          <div><div className="val tnum">{people.filter((p) => (p.skills ?? []).length > 0).length}<span className="unit">名</span></div><div className="label">スキル登録済</div><div className="note">マッチ対象</div></div>
        </div>
        <div className="kpi warn">
          <div className="top"><div className="ico-box"><Icons.star /></div><div className="chip">CSV</div></div>
          <div><div className="val" style={{ fontSize: 18 }}>取込/書出</div><div className="label">CSV 連携</div><div className="note">右上のボタン</div></div>
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
