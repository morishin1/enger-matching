import { redirect } from "next/navigation";
import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { scoreMatch, type Job, type Candidate } from "@/lib/match";

export const dynamic = "force-dynamic";

/** マッチングスコアのオフライン評価（admin専用）。
 *  過去の 成約（稼働/稼働決定）と 失注（見送り/失注）の提案ペアを「現在の辞書・配点」で
 *  再スコアリングし、成約側が失注側より高く出るか（=マッチングが結果を予測できているか）を検証する。
 *  辞書や配点を変更したら、このページを開き直すだけで最新ロジックの再評価になる。 */

const WON_STAGES = ["稼働", "稼働決定"];
const LOST_STAGES = ["見送り", "失注"];

type Row = {
  id: string; stage: string; job_title: string | null; company: string | null; c_init: string | null;
  candidate_id: string | null; job_id: string | null; lost_reason: string | null; created_at: string | null;
};
type Scored = Row & { score: number; excluded: boolean; matched: number; won: boolean };

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** AUC（Mann–Whitney U）：ランダムに選んだ成約ペアのスコアが失注ペアより高い確率。同点は0.5。 */
function auc(won: number[], lost: number[]): number | null {
  if (!won.length || !lost.length) return null;
  let u = 0;
  for (const w of won) for (const l of lost) u += w > l ? 1 : w === l ? 0.5 : 0;
  return u / (won.length * lost.length);
}

/** .in() の大量ID対策：チャンクして取得。 */
async function fetchByIds(admin: ReturnType<typeof engerAdmin>, table: string, cols: string, ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 300) {
    try {
      const r: any = await admin.from(table).select(cols).in("id", ids.slice(i, i + 300));
      for (const row of (r.data ?? [])) map.set(String(row.id), row);
    } catch { /* 一部失敗しても続行 */ }
  }
  return map;
}

export default async function MatchEvalPage() {
  const access = await currentAccess();
  if (access && access.role !== "admin") redirect("/settings");
  if (!dbConfigured) return <div className="page"><div className="card">Supabase の環境変数が未設定です。</div></div>;

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return <div className="page"><div className="card">サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です。</div></div>; }

  // 終了した提案（成約/失注）を取得。直近3000件で評価する。
  const pr: any = await admin.from("proposals")
    .select("id, stage, job_title, company, c_init, candidate_id, job_id, lost_reason, created_at")
    .in("stage", [...WON_STAGES, ...LOST_STAGES])
    .order("created_at", { ascending: false })
    .limit(3000);
  const rows: Row[] = pr.data ?? [];

  const linked = rows.filter((r) => r.candidate_id && r.job_id);
  const candIds = [...new Set(linked.map((r) => String(r.candidate_id)))];
  const jobIds = [...new Set(linked.map((r) => String(r.job_id)))];

  const candCols = "id, name, initials, title, skills, salary_min, salary_max, rate, rate_num, remote_pref, avail, affiliation, age_band, nationality, exp, status";
  const jobCols = "id, job_no, title, role_label, skills, salary_min, salary_max, remote_type, start_date, work_location, detail, flow_note, accept_flow_depth, client_name, status, created_at";
  const [candMap, jobMap] = await Promise.all([
    fetchByIds(admin, "candidates", candCols, candIds),
    fetchByIds(admin, "jobs", jobCols, jobIds),
  ]);

  // 現在のロジックで再スコアリング（国籍NG等のハード除外は excluded として別集計）。
  const scored: Scored[] = [];
  for (const r of linked) {
    const c = candMap.get(String(r.candidate_id));
    const j = jobMap.get(String(r.job_id));
    if (!c || !j) continue;
    const cand: Candidate = { ...c, name: c.name ?? c.initials ?? "" };
    const res = scoreMatch(j as Job, cand);
    scored.push({ ...r, score: res.score, excluded: !!res.excluded, matched: res.matchedSkills.length, won: WON_STAGES.includes(r.stage) });
  }

  const evalRows = scored.filter((s) => !s.excluded);
  const wonScores = evalRows.filter((s) => s.won).map((s) => s.score);
  const lostScores = evalRows.filter((s) => !s.won).map((s) => s.score);
  const aucVal = auc(wonScores, lostScores);

  // スコア帯別の成約率（判定しきい値 75/60/50 に合わせる）。
  const bands = [
    { label: "75点以上（提案推奨）", min: 75, max: 101 },
    { label: "60〜74点（条件付き推奨）", min: 60, max: 75 },
    { label: "50〜59点（条件付き検討）", min: 50, max: 60 },
    { label: "50点未満（提案不可域）", min: -1, max: 50 },
  ].map((b) => {
    const inBand = evalRows.filter((s) => s.score >= b.min && s.score < b.max);
    const w = inBand.filter((s) => s.won).length;
    return { ...b, total: inBand.length, won: w, rate: inBand.length ? Math.round((w / inBand.length) * 100) : null };
  });

  const highLost = evalRows.filter((s) => !s.won).sort((a, b) => b.score - a.score).slice(0, 10);
  const lowWon = evalRows.filter((s) => s.won).sort((a, b) => a.score - b.score).slice(0, 10);

  const wonAll = rows.filter((r) => WON_STAGES.includes(r.stage)).length;
  const lostAll = rows.length - wonAll;
  const aucLabel = aucVal == null ? "—" : aucVal.toFixed(3);
  const aucNote = aucVal == null ? "データ不足" : aucVal >= 0.7 ? "スコアは結果をよく予測できています" : aucVal >= 0.6 ? "スコアは結果をある程度予測できています" : aucVal >= 0.55 ? "予測力は弱め（改善余地あり）" : "スコアと結果がほぼ無関係（配点・辞書の見直し推奨）";

  const th = { textAlign: "left" as const, fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, padding: "6px 10px", borderBottom: "1px solid var(--color-border)" };
  const td = { fontSize: 12.5, padding: "7px 10px", borderBottom: "1px solid var(--color-border)" };

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 860 }}>
          <div className="meta">Match Evaluation · マッチング評価（オフライン検証）</div>
          <h1>マッチングスコアの答え合わせ</h1>
          <div className="sub">
            過去の<b>成約（稼働/稼働決定）</b>と<b>失注（見送り/失注）</b>の提案を「現在の辞書・配点」で再スコアリングし、
            成約側が高く出るかを検証します。スキル辞書や配点を変更したら、このページを開き直すだけで最新ロジックの再評価になります。
          </div>
        </div>
      </div>

      {/* サマリ */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi brand"><div><div className="val tnum">{aucLabel}</div><div className="label">AUC（成約＞失注の確率）</div></div></div>
        <div className="kpi"><div><div className="val tnum">{wonScores.length} / {lostScores.length}</div><div className="label">評価対象（成約/失注・リンクあり）</div></div></div>
        <div className="kpi"><div><div className="val tnum">{Math.round(mean(wonScores))} / {Math.round(mean(lostScores))}</div><div className="label">平均スコア（成約/失注）</div></div></div>
        <div className="kpi"><div><div className="val tnum">{median(wonScores)} / {median(lostScores)}</div><div className="label">中央値（成約/失注）</div></div></div>
      </div>

      <div className="card" style={{ marginBottom: 16, fontSize: 12.5, lineHeight: 1.8 }}>
        <b>読み方：</b>AUC は「ランダムに選んだ成約ペアのスコアが、失注ペアより高い確率」。0.5＝無関係、0.6以上＝ある程度予測、0.7以上＝良好。
        現在の判定は <b>{aucNote}</b>。
        <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
          対象：終了済み提案 {rows.length} 件（成約 {wonAll} / 失注 {lostAll}）のうち、案件・人材の両リンクが揃いスコア再計算できたのは {scored.length} 件
          （国籍要件などのハード除外 {scored.filter((s) => s.excluded).length} 件は集計から除外）。
          リンクの無い提案（メール本文からの手動作成など）は評価できません。
          ※ 提案されたペアのみの比較（選択バイアスあり）のため、傾向把握用の指標として使ってください。
        </div>
      </div>

      {/* スコア帯別 成約率 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800 }}>スコア帯別の成約率</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>スコア帯</th><th style={th}>件数</th><th style={th}>成約</th><th style={th}>成約率</th></tr></thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.label}>
                <td style={td}>{b.label}</td>
                <td style={{ ...td }} className="tnum">{b.total}</td>
                <td style={{ ...td }} className="tnum">{b.won}</td>
                <td style={{ ...td, fontWeight: 700, color: b.rate != null && b.rate >= 30 ? "var(--color-brand-700)" : undefined }} className="tnum">{b.rate == null ? "—" : `${b.rate}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>スコア帯が上がるほど成約率が高くなっていれば、配点が機能している証拠です。</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
        {/* 高スコアなのに失注 → 辞書/配点のノイズ or スキル以外の敗因 */}
        <div className="card">
          <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 800 }}>高スコアなのに失注（要因分析の材料）</h3>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>スキルは合っていたのに負けたペア。失注理由が単価・タイミングなら正常、スキール系ならタグのノイズを疑う。</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>点</th><th style={th}>案件 × 人材</th><th style={th}>失注理由</th></tr></thead>
            <tbody>
              {highLost.map((s) => (
                <tr key={s.id}>
                  <td style={{ ...td, fontWeight: 800 }} className="tnum">{s.score}</td>
                  <td style={td}><div style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.job_title ?? "—"}</div><div className="muted" style={{ fontSize: 11 }}>{s.c_init ?? "—"} · 一致スキル{s.matched}</div></td>
                  <td style={{ ...td, fontSize: 11.5 }}>{s.lost_reason ?? "—"}</td>
                </tr>
              ))}
              {highLost.length === 0 && <tr><td style={td} colSpan={3} className="muted">該当なし</td></tr>}
            </tbody>
          </table>
        </div>

        {/* 低スコアなのに成約 → 辞書の取りこぼし */}
        <div className="card">
          <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 800 }}>低スコアなのに成約（辞書の取りこぼし候補）</h3>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>スコア上は合わないのに決まったペア。タグ化されていないスキルの一致が隠れている可能性が高く、辞書追加のヒントになる。</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>点</th><th style={th}>案件 × 人材</th><th style={th}>会社</th></tr></thead>
            <tbody>
              {lowWon.map((s) => (
                <tr key={s.id}>
                  <td style={{ ...td, fontWeight: 800 }} className="tnum">{s.score}</td>
                  <td style={td}><div style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.job_title ?? "—"}</div><div className="muted" style={{ fontSize: 11 }}>{s.c_init ?? "—"} · 一致スキル{s.matched}</div></td>
                  <td style={{ ...td, fontSize: 11.5 }}>{s.company ?? "—"}</td>
                </tr>
              ))}
              {lowWon.length === 0 && <tr><td style={td} colSpan={3} className="muted">該当なし</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
