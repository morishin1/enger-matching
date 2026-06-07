import { engerClient, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { canSeeMargin } from "@/lib/engagement-access";
import { normalizeStage } from "@/lib/proposal-constants";

export const dynamic = "force-dynamic";

// ステージ別の成約確度（加重見込みに使用）
const STAGE_PROB: Record<string, number> = { 所属確認: 0.05, 提案中: 0.2, 面談: 0.5, 合格: 0.9 };
const STAGE_ORDER = ["所属確認", "提案中", "面談", "合格"];
const STAGE_TONE: Record<string, string> = { 所属確認: "#6b7280", 提案中: "#0095D9", 面談: "#d98a2b", 合格: "#1aa260" };

function parseManYen(rate?: string | number | null): number {
  if (rate == null) return 0;
  if (typeof rate === "number") return rate >= 10000 ? Math.round(rate / 10000) : Math.round(rate);
  const m = String(rate).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (/万/.test(rate)) return Math.round(n);
  if (n >= 10000) n = n / 10000;
  return Math.round(n);
}
const yen = (man: number) => (man >= 10000 ? `${(man / 10000).toFixed(1)}億円` : `${Math.round(man).toLocaleString("ja-JP")}万円`);

async function grab(sb: any, table: string, rich: string, base: string) {
  try { let r = await sb.from(table).select(rich).limit(1000); if (r.error) r = await sb.from(table).select(base).limit(1000); return r.error ? [] : (r.data ?? []); } catch { return []; }
}

export default async function PipelinePage() {
  const access = await currentAccess();
  const role = access?.role ?? "admin";
  let proposals: any[] = [], engs: any[] = [];
  let setup = false;
  if (dbConfigured) {
    const sb = engerClient();
    proposals = await grab(sb, "proposals", "id, stage, rate, disqualified, company, job_title", "id, stage, rate");
    engs = await grab(sb, "engagements", "id, monthly_rate, cost, affiliation, status, start_date, end_date", "id, monthly_rate, status");
    if (proposals.length === 0 && engs.length === 0) setup = true;
  } else setup = true;

  // ---- 確度別パイプライン（進行中提案） ----
  // DB stage（旧名混在）を新ステージに正規化してから集計。終了系(見送り/失注/稼働)は除外。
  const TERMINAL = ["見送り", "失注", "稼働", "稼働決定"];
  const active = proposals.filter((p) => !TERMINAL.includes(p.stage) && !p.disqualified)
    .map((p) => ({ ...p, _stage: normalizeStage(p.stage) }));
  const byStage = STAGE_ORDER.map((s) => {
    const rows = active.filter((p) => p._stage === s);
    const amount = rows.reduce((a, p) => a + parseManYen(p.rate), 0);
    const prob = STAGE_PROB[s] ?? 0;
    return { stage: s, count: rows.length, amount, prob, weighted: Math.round(amount * prob) };
  });
  const weightedTotal = byStage.reduce((a, s) => a + s.weighted, 0);
  const rawTotal = byStage.reduce((a, s) => a + s.amount, 0);
  const stageMax = Math.max(1, ...byStage.map((s) => s.amount));

  // ---- 月次フォーキャスト（確定＝稼働の月額売上） ----
  const live = engs.filter((e) => (e.status ?? "稼働中") === "稼働中" || e.status === "予定");
  const today = new Date();
  const months: { label: string; confirmed: number; gross: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const mStart = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const mEnd = new Date(today.getFullYear(), today.getMonth() + i + 1, 0);
    let confirmed = 0, gross = 0;
    for (const e of live) {
      const s = e.start_date ? new Date(e.start_date) : null;
      const en = e.end_date ? new Date(e.end_date) : null;
      const activeInMonth = (!s || s <= mEnd) && (!en || en >= mStart);
      if (!activeInMonth) continue;
      const rate = parseManYen(e.monthly_rate);
      confirmed += rate;
      if (canSeeMargin(role, e.affiliation) && e.cost != null) gross += rate - parseManYen(e.cost);
    }
    months.push({ label: `${mStart.getMonth() + 1}月`, confirmed, gross });
  }
  const mMax = Math.max(1, ...months.map((m) => m.confirmed));
  const thisMonthConfirmed = months[0]?.confirmed ?? 0;
  const thisMonthGross = months[0]?.gross ?? 0;
  const landing = thisMonthConfirmed + weightedTotal; // 着地予測 = 確定 + 加重見込み

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Pipeline · 売上フォーキャスト</div>
          <h1>パイプライン（売上予測）</h1>
          <div className="sub">進行中提案を<b>確度で加重</b>した見込みと、稼働の<b>確定月額</b>から着地を予測します。確度はステージで自動設定（提案中25%→面談50%→クロージング70%→面談合格90%）。</div>
        </div>
      </div>

      {setup && <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>提案・稼働のデータがありません。</div>}

      <div className="kpi-grid">
        <div className="kpi brand"><div><div className="val tnum">{yen(weightedTotal)}</div><div className="label">加重見込み（進行中）</div><div className="note">総額 {yen(rawTotal)}</div></div></div>
        <div className="kpi accent"><div><div className="val tnum">{yen(thisMonthConfirmed)}</div><div className="label">確定MRR（当月・稼働）</div><div className="note">{live.length} 名 稼働</div></div></div>
        <div className="kpi"><div><div className="val tnum">{yen(landing)}</div><div className="label">今月の着地予測</div><div className="note">確定 + 加重見込み</div></div></div>
        <div className="kpi warn"><div><div className="val tnum">{thisMonthGross > 0 ? yen(thisMonthGross) : "—"}</div><div className="label">確定粗利{role !== "admin" ? "（閲覧可分）" : ""}</div><div className="note">{thisMonthGross > 0 ? "売上−原価" : "原価データ未設定"}</div></div></div>
      </div>

      {/* 確度別パイプライン */}
      <div className="card">
        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>🎯 確度別パイプライン（進行中提案）</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {byStage.map((s) => (
            <div key={s.stage} style={{ display: "grid", gridTemplateColumns: "minmax(96px,120px) 1fr 78px 92px", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: STAGE_TONE[s.stage] }} />{s.stage}</span>
              <div style={{ height: 14, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden", position: "relative" }}>
                <div style={{ position: "absolute", inset: 0, width: `${(s.amount / stageMax) * 100}%`, height: "100%", background: `${STAGE_TONE[s.stage]}40` }} />
                <div style={{ position: "absolute", top: 0, left: 0, width: `${(s.weighted / stageMax) * 100}%`, height: "100%", background: STAGE_TONE[s.stage], borderRadius: 99 }} />
              </div>
              <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", textAlign: "right" }}>{Math.round(s.prob * 100)}% · {s.count}件</span>
              <span className="mono" style={{ fontSize: 12, fontWeight: 700, textAlign: "right" }}>{yen(s.amount)}</span>
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 10.5, marginTop: 10 }}>濃いバー＝確度加重の見込み、薄いバー＝総額。加重見込み合計 <b style={{ color: "var(--color-ink-2)" }}>{yen(weightedTotal)}</b></div>
      </div>

      {/* 月次フォーキャスト */}
      <div className="card">
        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>📈 月次フォーキャスト（確定MRR・稼働の継続）</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, alignItems: "end", height: 160 }}>
          {months.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
              <span className="mono" style={{ fontSize: 11, fontWeight: 700 }}>{m.confirmed.toLocaleString("ja-JP")}</span>
              <div title={`${m.label}：確定 ${yen(m.confirmed)}`} style={{ width: "70%", maxWidth: 40, height: `${Math.max(4, (m.confirmed / mMax) * 100)}%`, background: i === 0 ? "var(--color-brand-600)" : "var(--color-brand-400, #4db3e6)", borderRadius: "5px 5px 0 0" }} />
              <span style={{ fontSize: 11, color: "var(--color-ink-3)", fontWeight: i === 0 ? 700 : 400 }}>{m.label}</span>
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>※ 稼働中・予定の月額を、契約満了日まで各月に積み上げ。満了が近い契約があると将来月が下がります（＝更新で守るべき売上）。</div>
      </div>
    </div>
  );
}
