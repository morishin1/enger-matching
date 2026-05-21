import { Icons } from "@/components/icons";
import { CandidateImportButton, ExportButton } from "@/components/CsvTools";
import { engerClient, dbConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const EXPORT_HEADERS = [
  { key: "code", label: "コード" }, { key: "name", label: "氏名" }, { key: "title", label: "職種" },
  { key: "company", label: "所属" }, { key: "skillsCsv", label: "スキル" }, { key: "rate", label: "希望単価" },
  { key: "avail", label: "稼働開始" }, { key: "location", label: "勤務地" }, { key: "exp", label: "経験" }, { key: "status", label: "ステータス" },
];

export default async function PeoplePage() {
  let people: any[] = [];
  let total = 0;
  let dbError: string | null = null;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const { data, count } = await sb
        .from("candidates")
        .select("code, name, initials, title, company, skills, rate, avail, location, exp, status, score", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(300);
      people = data ?? [];
      total = count ?? people.length;
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  const exportRows = people.map((p) => ({ ...p, skillsCsv: (p.skills ?? []).join(" / ") }));

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

      <div className="card flush">
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--color-border)" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>人材一覧</h3>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>最新 {Math.min(people.length, 300)} 名 / 全 {total.toLocaleString("ja-JP")} 名</div>
        </div>
        <table className="tbl">
          <thead>
            <tr><th>人材</th><th>職種 / 所属</th><th>スキル</th><th style={{ width: 100 }}>希望単価</th><th style={{ width: 100 }}>稼働開始</th><th style={{ width: 90 }}>状態</th></tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "var(--color-ink-4)" }}>
                まだ人材がありません。右上の「CSV取込」からアップロードしてください（「テンプレ」で書式を確認できます）。
              </td></tr>
            ) : (
              people.map((p, i) => (
                <tr key={p.code ?? i}>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div className="ava">{p.initials || (p.name ?? "?").charAt(0)}</div>
                      <div><div className="pri">{p.name}</div>{p.code && <div className="muted mono" style={{ fontSize: 10.5 }}>{p.code}</div>}</div>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{p.title ?? "—"}<br /><span className="muted" style={{ fontSize: 11 }}>{p.company ?? ""}</span></td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(p.skills ?? []).slice(0, 5).map((s: string) => <span key={s} className="tag" style={{ fontSize: 10.5 }}>{s}</span>)}
                    </div>
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>{p.rate ?? "—"}</td>
                  <td className="num muted">{p.avail ?? "—"}</td>
                  <td><span className="pill open">{p.status}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
