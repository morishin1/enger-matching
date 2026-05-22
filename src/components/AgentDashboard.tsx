import Link from "next/link";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { DailyBriefing } from "./DailyBriefing";

const ACTIVE_STAGES = ["未対応", "提案中", "面談調整", "クロージング中"];
const MET_STAGES = ["面談調整", "クロージング中", "稼働決定"];
const DAY = 86400000;

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
const daysAgo = (d?: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY) : 99999);
const daysUntil = (d?: string | null) => (d ? Math.floor((new Date(d).getTime() - Date.now()) / DAY) : null);
const yen = (man: number) => (man >= 10000 ? `${(man / 10000).toFixed(1)}億円` : `${man.toLocaleString("ja-JP")}万円`);
const todayStr = () => new Date().toISOString().slice(0, 10);

async function grab(sb: any, table: string, rich: string, base: string, limit = 800): Promise<{ rows: any[]; ok: boolean }> {
  try {
    let r = await sb.from(table).select(rich).limit(limit);
    if (r.error) r = await sb.from(table).select(base).limit(limit);
    if (r.error) return { rows: [], ok: false };
    return { rows: r.data ?? [], ok: true };
  } catch { return { rows: [], ok: false }; }
}

// 小さな統計タイル
function Stat({ icon, label, value, sub, href, tone }: { icon: string; label: string; value: React.ReactNode; sub?: string; href?: string; tone?: string }) {
  const body = (
    <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 4, height: "100%" }}>
      <div style={{ fontSize: 11, color: "var(--color-ink-3)", fontWeight: 600 }}>{icon} {label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: tone ?? "var(--color-ink)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 10.5 }}>{sub}</div>}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none", display: "block" }}>{body}</Link> : body;
}

// 需要/供給の小バケット
function Bucket({ icon, label, count, items, href, tone, muted }: { icon: string; label: string; count: number; items: string[]; href?: string; tone: string; muted?: string }) {
  return (
    <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{icon} {label}</span>
        {muted ? <span className="muted" style={{ fontSize: 10.5 }}>{muted}</span> : <span style={{ fontSize: 13, fontWeight: 800, color: tone }}>{count}</span>}
      </div>
      {!muted && items.length > 0 && (
        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
          {items.slice(0, 4).map((t, i) => <li key={i} style={{ fontSize: 11.5, color: "var(--color-ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>・{t}</li>)}
          {count > 4 && <li className="muted" style={{ fontSize: 10.5 }}>ほか {count - 4} 件{href ? "" : ""}</li>}
        </ul>
      )}
      {!muted && count === 0 && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>なし 👍</div>}
    </div>
  );
}

export async function AgentDashboard({ role, myName }: { role: "admin" | "agent"; myName?: string | null }) {
  let jobs: any[] = [], proposals: any[] = [], engs: any[] = [], cands: any[] = [];
  let setup = false;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const [J, P, E, C] = await Promise.all([
        grab(sb, "jobs", "job_no, title, client_name, is_focus, status, created_at, is_published", "job_no, title, client_name, created_at"),
        grab(sb, "proposals", "id, job_title, company, stage, proposer, closer, rate, created_at, caller_status, meeting_date, meeting_status", "id, job_title, company, stage, rate, created_at"),
        grab(sb, "engagements", "id, job_title, company, candidate_name, monthly_rate, start_date, end_date, status, cost, renewal_due, renewal_status", "id, job_title, company, monthly_rate, end_date, status"),
        grab(sb, "candidates", "id, initials, title, status, saved, rate_num, affiliation, start_date, last_contact_at", "id, initials, title, status, rate_num"),
      ]);
      jobs = J.rows; proposals = P.rows; engs = E.rows; cands = C.rows;
      if (!J.ok && !P.ok) setup = true;
    } catch { setup = true; }
  } else setup = true;

  // ===== 集計 =====
  const activeProps = proposals.filter((p) => ACTIVE_STAGES.includes(p.stage));
  const activeTitles = new Set(activeProps.map((p) => p.job_title).filter(Boolean));
  const pub = jobs.filter((j) => j.is_published !== false);
  const liveEngs = engs.filter((e) => (e.status ?? "稼働中") === "稼働中" || e.status === "予定");

  // --- 今日のアクション（締切のあるもの中心）---
  const today = todayStr();
  const hasMeetingDate = proposals.some((p) => p.meeting_date);
  const todaysMeetings = proposals.filter((p) => p.meeting_date === today);
  const meetingsAdjusting = proposals.filter((p) => p.stage === "面談調整");
  const renewSoon = liveEngs.filter((e) => { const d = daysUntil(e.end_date); return d != null && d <= 31 && d >= 0; });
  const callPending = proposals.filter((p) => p.stage === "未対応" || p.caller_status === "未架電");
  const closingStalled = proposals.filter((p) => p.stage === "クロージング中" && daysAgo(p.created_at) >= 7);
  const actionTotal = (hasMeetingDate ? todaysMeetings.length : meetingsAdjusting.length) + renewSoon.length + callPending.length + closingStalled.length;

  // --- お金レーン ---
  const pipelineMan = activeProps.reduce((s, p) => s + parseManYen(p.rate), 0);
  const confirmedMan = liveEngs.reduce((s, e) => s + parseManYen(e.monthly_rate), 0);
  const hasCost = engs.some((e) => e.cost != null);
  const grossMan = hasCost ? liveEngs.reduce((s, e) => s + (parseManYen(e.monthly_rate) - parseManYen(e.cost)), 0) : null;

  // --- ファネル（案件→提案→面談→稼働）---
  const fProposed = proposals.length;
  const fMet = proposals.filter((p) => MET_STAGES.includes(p.stage)).length;
  const fActive = liveEngs.length;
  const funnel = [
    { k: "案件(公開)", n: pub.length },
    { k: "提案", n: fProposed },
    { k: "面談到達", n: fMet },
    { k: "稼働", n: fActive },
  ];
  const fMax = Math.max(1, ...funnel.map((f) => f.n));

  // --- 需要(案件側) ---
  const newJobs = pub.filter((j) => daysAgo(j.created_at) <= 7);
  const focusUntouched = pub.filter((j) => j.is_focus && !activeTitles.has(j.title));
  const staleJobs = pub.filter((j) => daysAgo(j.created_at) >= 14 && !activeTitles.has(j.title));
  const jLabel = (j: any) => `${j.title ?? "（無題）"}（${j.client_name ?? "—"}）`;

  // --- 供給(候補者側) ---
  const hasLastContact = cands.some((c) => c.last_contact_at);
  const hot = cands.filter((c) => (c.status ?? "").includes("提案") || c.saved);
  const lostTouch = hasLastContact ? cands.filter((c) => daysAgo(c.last_contact_at) >= 21) : [];
  const endingSoonPeople = liveEngs.filter((e) => { const d = daysUntil(e.end_date); return d != null && d <= 60 && d >= 0; });
  const cLabel = (c: any) => `${c.initials || c.title || "人材"}${c.affiliation ? `・${c.affiliation}` : ""}${c.rate_num ? `・¥${Math.round(c.rate_num)}万` : ""}`;
  const eLabel = (e: any) => `${e.candidate_name || "—"}（${e.company ?? "—"} / 満了まで${daysUntil(e.end_date)}日）`;

  // --- 担当者本人 ---
  const isMine = (p: any) => myName && (p.proposer === myName || p.closer === myName);
  const myActive = activeProps.filter(isMine);
  const myPipelineMan = myActive.reduce((s, p) => s + parseManYen(p.rate), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Dashboard · エージェント</div>
          <h1>今日のアクション{actionTotal > 0 ? <span style={{ color: "var(--color-brand-600)" }}> {actionTotal}件</span> : ""}</h1>
          <div className="sub">締切のある対応を上段で、需要（案件）と供給（人材）を両輪で、既存売上は契約更新で守る。効率よくマッチして売上を伸ばしましょう。</div>
        </div>
      </div>

      {setup && (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>
          案件・提案テーブルが未作成、またはデータがありません。<span className="mono">supabase/schema-matching.sql</span> 実行後に実データが表示されます。
        </div>
      )}

      {/* AIブリーフィング（今日やるべきこと） */}
      {!setup && (
        <DailyBriefing metrics={{
          meetings: hasMeetingDate ? todaysMeetings.length : meetingsAdjusting.length,
          renewSoon: renewSoon.length, callPending: callPending.length, closingStalled: closingStalled.length,
          focusUntouched: focusUntouched.length, staleJobs: staleJobs.length, newJobs: newJobs.length,
          hot: hot.length, endingSoon: endingSoonPeople.length,
          pipelineMan, confirmedMan, fJobs: pub.length, fProposed, fMet, fActive,
        }} />
      )}

      {/* ① 今日のアクション（締切あり） */}
      <div className="kpi-grid">
        <Stat icon="📅" label={hasMeetingDate ? "本日の面談・商談" : "面談調整中"} value={hasMeetingDate ? todaysMeetings.length : meetingsAdjusting.length} sub={hasMeetingDate ? "本日予定" : "日程未設定（agent-ops.sql で予定管理）"} href="/proposals" tone="#0b5cab" />
        <Stat icon="🔄" label="要更新確認" value={renewSoon.length} sub="30日以内に契約満了" href="/progress" tone="#b45309" />
        <Stat icon="📞" label="初動待ち" value={callPending.length} sub="未対応 / 未架電" href="/proposals" tone="#067647" />
        <Stat icon="🤝" label="クロージング滞留" value={closingStalled.length} sub="7日以上動きなし" href="/proposals" tone="#b42318" />
      </div>

      {/* お金レーン：見込み → 確定 → 粗利 */}
      <div className="kpi-grid">
        <div className="kpi brand"><div><div className="val tnum">{yen(pipelineMan)}</div><div className="label">見込み（進行中の月額）</div><div className="note">{activeProps.length} 件の提案</div></div></div>
        <div className="kpi accent"><div><div className="val tnum">{yen(confirmedMan)}</div><div className="label">確定（稼働中の月額）</div><div className="note">{liveEngs.length} 名 稼働</div></div></div>
        <div className="kpi"><div><div className="val tnum">{grossMan == null ? "—" : yen(grossMan)}</div><div className="label">粗利（月額）</div><div className="note">{grossMan == null ? "原価データ未設定（agent-ops.sql）" : "売上−原価"}</div></div></div>
        <div className="kpi warn"><div><div className="val tnum">{funnel[1].n ? Math.round((fActive / funnel[1].n) * 100) : 0}<span className="unit">%</span></div><div className="label">提案→稼働 率</div><div className="note">面談到達 {fProposed ? Math.round((fMet / fProposed) * 100) : 0}%</div></div></div>
      </div>

      {/* ② 両輪：需要（案件）⇔ 供給（人材） */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap, 20px)" }} className="duo-grid">
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📁 案件側（需要）</h3>
            <Link href="/jobs" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-700,#0b5cab)", textDecoration: "none" }}>案件一覧 →</Link>
          </div>
          <Bucket icon="⭐" label="注力・未提案" count={focusUntouched.length} items={focusUntouched.map(jLabel)} tone="#b45309" />
          <Bucket icon="🌥" label="鮮度切れ（14日+・提案なし）" count={staleJobs.length} items={staleJobs.map(jLabel)} tone="#6b7280" />
          <Bucket icon="📦" label="新着在庫（参照のみ）" count={newJobs.length} items={[]} tone="var(--color-ink-3)" muted={`${newJobs.length} 件 · 7日以内`} />
        </div>

        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🧑‍💻 候補者側（供給）</h3>
            <Link href="/people" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-700,#0b5cab)", textDecoration: "none" }}>人材一覧 →</Link>
          </div>
          <Bucket icon="🔥" label="ホット（即動ける）" count={hot.length} items={hot.map(cLabel)} tone="#067647" />
          <Bucket icon="⏳" label="満了間近・再提案候補（60日内）" count={endingSoonPeople.length} items={endingSoonPeople.map(eLabel)} tone="#0b5cab" />
          <Bucket icon="📵" label="連絡途絶（21日+）" count={lostTouch.length} items={lostTouch.map(cLabel)} tone="#b42318" muted={hasLastContact ? undefined : "最終接触日が必要（agent-ops.sql）"} />
        </div>
      </div>

      {/* ③ 契約更新アラート（既存売上の防衛線） */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🛡 契約更新アラート（既存売上の防衛線）</h3>
          <Link href="/progress" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-700,#0b5cab)", textDecoration: "none" }}>稼働管理 →</Link>
        </div>
        <div className="kpi-grid">
          <Stat icon="📆" label="来月満了" value={`${renewSoon.length} 名`} sub="30日以内に契約満了" tone="#b45309" />
          <Stat icon="⏰" label="回答期限切れ間近" value={engs.some((e) => e.renewal_due) ? `${engs.filter((e) => { const d = daysUntil(e.renewal_due); return d != null && d <= 7 && d >= 0; }).length} 件` : "—"} sub={engs.some((e) => e.renewal_due) ? "更新回答の期限7日内" : "更新期限データ未設定"} tone="#b42318" />
          <Stat icon="📉" label="ドロップ予兆" value={engs.some((e) => e.renewal_status) ? `${engs.filter((e) => e.renewal_status === "終了予定").length} 件` : "—"} sub={engs.some((e) => e.renewal_status) ? "更新意向=終了予定" : "更新意向データ未設定"} tone="#6b7280" />
        </div>
        {renewSoon.length > 0 && (
          <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
            {renewSoon.slice(0, 6).map((e, i) => (
              <li key={i} style={{ fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 10, borderBottom: "1px solid var(--color-border)", paddingBottom: 5 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.candidate_name || "—"} ・ {e.company ?? "—"}</span>
                <span className="mono" style={{ color: "#b45309", flexShrink: 0 }}>満了まで {daysUntil(e.end_date)}日</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ファネル */}
      <div className="card">
        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>📊 ファネル（案件 → 提案 → 面談 → 稼働）</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {funnel.map((f, i) => (
            <div key={f.k} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 12, color: "var(--color-ink-2)", fontWeight: 600 }}>{f.k}</span>
                {i > 0 && <span className="muted mono" style={{ fontSize: 10 }}>{funnel[i - 1].n ? Math.round((f.n / funnel[i - 1].n) * 100) : 0}%</span>}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{f.n}<span style={{ fontSize: 11, color: "var(--color-ink-4)", marginLeft: 3 }}>件</span></div>
              <div style={{ height: 6, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden" }}>
                <div style={{ width: `${(f.n / fMax) * 100}%`, height: "100%", background: "var(--color-brand-600)", borderRadius: 99 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 担当者本人 */}
      {myName && myActive.length > 0 && (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>👤 {myName} さんの担当</div>
            <div style={{ fontSize: 13 }}>進行中 <b>{myActive.length}</b> 件</div>
            <div style={{ fontSize: 13 }}>見込み <b>{yen(myPipelineMan)}</b></div>
            <Link href="/proposals" className="btn brand btn-xs" style={{ marginLeft: "auto", textDecoration: "none" }}>提案管理へ</Link>
          </div>
        </div>
      )}
    </div>
  );
}
