import { isContacted, isLost } from "@/lib/quality";

// グリップ（在庫の出所）別に歩留まりを見るための分析ボード。
//  人材グリップ … candidates.affiliation（プロパー/フリーランス/BP）で判定。BP=低グリップ。
//  案件グリップ … jobs.posted_by_client（企業ポータル掲載=エンド直）で判定（弱いシグナル）。
//  他決 … lost_reason / lost_phase のテキスト判定（構造化フィールドが無いため概算）。
//  初動 … proposed_at → called_at の日数（両方入力のある提案のみ）。

const MET = ["面談調整", "クロージング中", "面談合格", "稼働", "稼働決定"];
const WON = ["稼働", "稼働決定"];
const DAY = 86400000;
const daysAgo = (d?: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY) : null);
// 「他社で先に決まった/他決」を失注理由テキストから推定（概算）
const OTHER_RE = /他決|他社|別.?会社|別.?で決|先に決|他で決|他社決定/;

type Tier = "high" | "mid" | "low" | "unknown";
function talentTier(aff?: string | null): Tier {
  if (!aff) return "unknown";
  if (/プロパー|自社|正社/.test(aff)) return "high";
  if (/フリー|個人/.test(aff)) return "mid";
  if (/BP|パートナー|SES|協力|外注|他社/i.test(aff)) return "low";
  return "unknown";
}

type Agg = ReturnType<typeof agg>;
function agg(ps: any[]) {
  const total = ps.length;
  const met = ps.filter((p) => MET.includes(p.stage)).length;
  const won = ps.filter((p) => WON.includes(p.stage)).length;
  const lost = ps.filter((p) => isLost(p));
  const other = lost.filter((p) => OTHER_RE.test(`${p.lost_reason ?? ""} ${p.lost_phase ?? ""}`)).length;
  const leadDays = ps
    .filter((p) => p.proposed_at && p.called_at)
    .map((p) => Math.max(0, Math.round((new Date(p.called_at).getTime() - new Date(p.proposed_at).getTime()) / DAY)));
  const avgLead = leadDays.length ? Math.round((leadDays.reduce((s, n) => s + n, 0) / leadDays.length) * 10) / 10 : null;
  const stalled = ps.filter((p) => p.proposed_at && !p.called_at && !isContacted(p) && (daysAgo(p.proposed_at) ?? 0) >= 2).length;
  return {
    total, met, won, lost: lost.length, other,
    metRate: total ? Math.round((met / total) * 100) : 0,
    cvr: total ? Math.round((won / total) * 100) : 0,
    otherRate: lost.length ? Math.round((other / lost.length) * 100) : 0,
    avgLead, leadN: leadDays.length, stalled,
  };
}

const TIER_META: Record<Tier, { label: string; tone: string; note: string }> = {
  high: { label: "高（プロパー/自社）", tone: "#067647", note: "グリップ強・即動ける" },
  mid: { label: "中（フリーランス）", tone: "#0b5cab", note: "直契約に近い" },
  low: { label: "低（BP/パートナー）", tone: "#b42318", note: "返答遅い・他決リスク" },
  unknown: { label: "不明（所属未入力）", tone: "#6b7280", note: "所属区分を入力で判定可能" },
};

function Pct({ v, ok }: { v: number; ok?: boolean }) {
  return <span className="mono" style={{ fontWeight: 700, color: ok ? "#067647" : v >= 50 ? "var(--color-ink)" : "#b45309" }}>{v}%</span>;
}

export function GripBoard({ proposals, candidates, jobs }: { proposals: any[]; candidates: any[]; jobs: any[] }) {
  // 人材の所属 → グリップ階層の引き当て（id 優先・名前フォールバック）
  const affById = new Map<string, string | null>();
  const affByName = new Map<string, string | null>();
  for (const c of candidates) {
    if (c.id) affById.set(String(c.id), c.affiliation ?? null);
    if (c.name) affByName.set(String(c.name).trim(), c.affiliation ?? null);
  }
  const tierOf = (p: any): Tier => {
    let aff: string | null | undefined;
    if (p.candidate_id && affById.has(String(p.candidate_id))) aff = affById.get(String(p.candidate_id));
    else { const n = String(p.candidate_name ?? "").trim(); if (n && affByName.has(n)) aff = affByName.get(n); }
    return talentTier(aff);
  };

  // 案件タイトル → エンド直か（企業ポータル掲載）
  const jobEnd = new Map<string, boolean>();
  for (const j of jobs) { if (j.title != null) jobEnd.set(String(j.title), !!j.posted_by_client); }

  const valid = proposals.filter((p) => !p.disqualified);
  const byTier: Record<Tier, any[]> = { high: [], mid: [], low: [], unknown: [] };
  for (const p of valid) byTier[tierOf(p)].push(p);

  const overall = agg(valid);
  const hi = agg(byTier.high);
  const lo = agg(byTier.low);
  // グリップ済み = 高 + 中（BP・不明を除く）
  const gripped = byTier.high.length + byTier.mid.length;
  const grippedPct = valid.length ? Math.round((gripped / valid.length) * 100) : 0;

  const tiers: Tier[] = ["high", "mid", "low", "unknown"];

  // 案件の出所別（エンド直=ポータル掲載 / その他=取込・手入力）
  const endProps = valid.filter((p) => p.job_title != null && jobEnd.get(String(p.job_title)) === true);
  const otherProps = valid.filter((p) => !(p.job_title != null && jobEnd.get(String(p.job_title)) === true));
  const endAgg = agg(endProps), otherAgg = agg(otherProps);

  // 自動所見（高 vs 低グリップ）
  let insight: string | null = null;
  if (hi.total >= 3 && lo.total >= 3) {
    insight = `BP(低グリップ)の稼働率は ${lo.cvr}%、自社(高グリップ)は ${hi.cvr}%。他決率は BP ${lo.otherRate}% / 自社 ${hi.otherRate}%。グリップの高い在庫ほど稼働に繋がっています。BP在庫への提案配分をエンジャー直/自社抱えへ寄せる余地があります。`;
  } else if (valid.length > 0 && grippedPct < 40) {
    insight = `提案の ${100 - grippedPct}% が BP/所属不明（低グリップ）に偏っています。まずは所属区分の入力徹底と、エンジャー直・自社抱え人材の在庫増を。`;
  }

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🪝 グリップ分析（在庫の出所 × 歩留まり）</h3>
        <span className="muted" style={{ fontSize: 11 }}>BP偏重＝低グリップ。高グリップ在庫への移行余地を見る</span>
      </div>

      {/* ヘッドライン */}
      <div className="kpi-grid">
        <div className="kpi brand"><div><div className="val tnum">{grippedPct}<span className="unit">%</span></div><div className="label">グリップ済み比率</div><div className="note">高+中 / 有効提案{valid.length}件</div></div></div>
        <div className="kpi"><div><div className="val tnum">{lo.cvr}<span className="unit">%</span></div><div className="label">低グリップ(BP)の稼働率</div><div className="note">高グリップは {hi.cvr}%</div></div></div>
        <div className="kpi warn"><div><div className="val tnum">{overall.lost ? overall.otherRate : "—"}{overall.lost ? <span className="unit">%</span> : ""}</div><div className="label">他決率（概算）</div><div className="note">失注{overall.lost}件中 {overall.other}件が他決</div></div></div>
        <div className="kpi accent"><div><div className="val tnum">{overall.avgLead == null ? "—" : overall.avgLead}{overall.avgLead == null ? "" : <span className="unit">日</span>}</div><div className="label">平均初動（提案→架電）</div><div className="note">{overall.avgLead == null ? "提案日/架電日が未入力" : `対象${overall.leadN}件 · 未架電放置${overall.stalled}件`}</div></div></div>
      </div>

      {insight && (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-ink-2)", background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 8, padding: "9px 12px" }}>💡 {insight}</div>
      )}

      {/* 人材グリップ別 */}
      <div style={{ marginTop: 16 }}>
        <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>人材グリップ別（所属区分から判定）</div>
        <table className="tbl">
          <thead><tr><th>グリップ</th><th className="num">提案</th><th className="num">面談化</th><th className="num">稼働</th><th className="num">稼働率</th><th className="num">他決</th><th className="num">平均初動</th></tr></thead>
          <tbody>
            {tiers.map((t) => {
              const a: Agg = agg(byTier[t]);
              const m = TIER_META[t];
              return (
                <tr key={t}>
                  <td style={{ fontWeight: 600 }}><span style={{ color: m.tone }}>●</span> {m.label}<div className="muted" style={{ fontSize: 10 }}>{m.note}</div></td>
                  <td className="num">{a.total}</td>
                  <td className="num"><Pct v={a.metRate} /></td>
                  <td className="num">{a.won}</td>
                  <td className="num"><Pct v={a.cvr} ok={t === "high" || t === "mid"} /></td>
                  <td className="num">{a.lost ? `${a.other}/${a.lost}` : "—"}</td>
                  <td className="num">{a.avgLead == null ? "—" : `${a.avgLead}日`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 案件出所別 */}
      <div style={{ marginTop: 16 }}>
        <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>案件の出所別（企業ポータル掲載＝エンド直）</div>
        <table className="tbl">
          <thead><tr><th>出所</th><th className="num">提案</th><th className="num">面談化</th><th className="num">稼働</th><th className="num">稼働率</th><th className="num">他決</th></tr></thead>
          <tbody>
            <tr><td style={{ fontWeight: 600 }}><span style={{ color: "#067647" }}>●</span> 企業掲載（エンド直）</td><td className="num">{endAgg.total}</td><td className="num"><Pct v={endAgg.metRate} /></td><td className="num">{endAgg.won}</td><td className="num"><Pct v={endAgg.cvr} ok /></td><td className="num">{endAgg.lost ? `${endAgg.other}/${endAgg.lost}` : "—"}</td></tr>
            <tr><td style={{ fontWeight: 600 }}><span style={{ color: "#6b7280" }}>●</span> その他（取込・手入力）</td><td className="num">{otherAgg.total}</td><td className="num"><Pct v={otherAgg.metRate} /></td><td className="num">{otherAgg.won}</td><td className="num"><Pct v={otherAgg.cvr} /></td><td className="num">{otherAgg.lost ? `${otherAgg.other}/${otherAgg.lost}` : "—"}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ fontSize: 10.5, marginTop: 12, lineHeight: 1.6 }}>
        ※ 人材グリップは <span className="mono">candidates.affiliation</span>（プロパー/フリーランス/BP）から判定。所属未入力は「不明」。<br />
        ※ 他決は <span className="mono">lost_reason / lost_phase</span> のテキスト判定による<b>概算</b>です。正確に測るには失注理由に「他決」区分を設けるのが推奨。<br />
        ※ 初動は <span className="mono">proposed_at → called_at</span> の両方が入力された提案のみ集計。案件出所は企業ポータル掲載分のみ「エンド直」と判定（手入力のエンド案件は「その他」に含まれます）。
      </div>
    </div>
  );
}
