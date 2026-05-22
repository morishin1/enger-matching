import Link from "next/link";
import { engerClient, dbConfigured } from "@/lib/supabase";

const ACTIVE_STAGES = ["未対応", "提案中", "面談調整", "クロージング中"];
const DAY = 86400000;

/** rate テキスト("¥90万"/"90万"/"900000"等)から 万円 数値を推定。 */
function parseManYen(rate?: string | number | null): number {
  if (rate == null) return 0;
  if (typeof rate === "number") return rate >= 10000 ? Math.round(rate / 10000) : rate;
  const m = String(rate).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (/万/.test(rate)) return Math.round(n);
  if (n >= 10000) n = n / 10000; // 円表記とみなす
  return Math.round(n);
}
const daysAgo = (d?: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY) : 9999);
const yen = (man: number) => (man >= 10000 ? `${(man / 10000).toFixed(1)}億円` : `${man.toLocaleString("ja-JP")}万円`);

export async function AgentDashboard({ role, myName }: { role: "admin" | "agent"; myName?: string | null }) {
  let jobs: any[] = [];
  let proposals: any[] = [];
  let setup = false;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const [jr, pr] = await Promise.all([
        sb.from("jobs").select("job_no, title, client_name, is_focus, status, created_at, is_published").order("created_at", { ascending: false }).limit(500),
        sb.from("proposals").select("id, job_title, company, stage, proposer, closer, rate, ai_match, score, caller_status, created_at").order("created_at", { ascending: false }).limit(500),
      ]);
      if (jr.error || pr.error) setup = true;
      jobs = jr.data ?? [];
      proposals = pr.data ?? [];
    } catch { setup = true; }
  } else setup = true;

  // ---- ワークリスト集計 ----
  const activeProps = proposals.filter((p) => ACTIVE_STAGES.includes(p.stage));
  const activeJobTitles = new Set(activeProps.map((p) => p.job_title).filter(Boolean));
  const pub = jobs.filter((j) => j.is_published !== false);

  const newJobs = pub.filter((j) => daysAgo(j.created_at) <= 7);
  const staleJobs = pub.filter((j) => daysAgo(j.created_at) >= 14 && !activeJobTitles.has(j.title));
  const focusUntouched = pub.filter((j) => j.is_focus && !activeJobTitles.has(j.title));
  const callPending = proposals.filter((p) => p.stage === "未対応" || p.caller_status === "未架電" || (!p.caller_status && p.stage === "提案中"));
  const closingStalled = proposals.filter((p) => p.stage === "クロージング中" && daysAgo(p.created_at) >= 7);

  // ---- 売上(取扱)見込み・歩留まり ----
  const won = proposals.filter((p) => p.stage === "稼働決定");
  const pipelineMan = activeProps.reduce((s, p) => s + parseManYen(p.rate), 0);
  const wonMan = won.reduce((s, p) => s + parseManYen(p.rate), 0);
  const reached = proposals.filter((p) => ["面談調整", "クロージング中", "稼働決定"].includes(p.stage)).length;
  const decidedRate = proposals.length ? Math.round((won.length / proposals.length) * 100) : 0;
  const meetRate = proposals.length ? Math.round((reached / proposals.length) * 100) : 0;

  // ---- 担当者本人のスライス ----
  const isMine = (p: any) => myName && (p.proposer === myName || p.closer === myName);
  const myActive = activeProps.filter(isMine);
  const myWon = won.filter(isMine);
  const myPipelineMan = myActive.reduce((s, p) => s + parseManYen(p.rate), 0);

  const WORK = [
    { key: "new", icon: "🆕", label: "新着案件", desc: "7日以内・マッチング着手", items: newJobs, fmt: (j: any) => `${j.title ?? "（無題）"}（${j.client_name ?? "—"}）`, href: "/jobs", tone: "#0b5cab" },
    { key: "focus", icon: "⭐", label: "注力・未提案", desc: "注力案件でまだ提案なし", items: focusUntouched, fmt: (j: any) => `${j.title ?? "（無題）"}（${j.client_name ?? "—"}）`, href: "/matching", tone: "#b45309" },
    { key: "call", icon: "📞", label: "架電・初動待ち", desc: "未対応/未架電の提案", items: callPending, fmt: (p: any) => `${p.company ?? "—"}：${p.job_title ?? "—"}`, href: "/proposals", tone: "#067647" },
    { key: "closing", icon: "🤝", label: "クロージング滞留", desc: "7日以上動きなし", items: closingStalled, fmt: (p: any) => `${p.company ?? "—"}：${p.job_title ?? "—"}（${daysAgo(p.created_at)}日）`, href: "/proposals", tone: "#b42318" },
    { key: "stale", icon: "🌥", label: "鮮度切れ案件", desc: "14日以上・進行中提案なし", items: staleJobs, fmt: (j: any) => `${j.title ?? "（無題）"}（${j.client_name ?? "—"}）`, href: "/jobs", tone: "#6b7280" },
  ];
  const todoTotal = WORK.reduce((s, w) => s + w.items.length, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Dashboard · エージェント</div>
          <h1>今日のワークリスト{todoTotal > 0 ? <span style={{ color: "var(--color-brand-600)" }}> {todoTotal}件</span> : ""}</h1>
          <div className="sub">効率よくマッチングして売上につなげるため、いま動くべき案件・提案を上から処理しましょう。</div>
        </div>
      </div>

      {setup && (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>
          案件・提案テーブルが未作成、またはデータがありません。<span className="mono">supabase/schema-matching.sql</span> 実行後にここへ実データが表示されます。
        </div>
      )}

      {/* 売上(取扱)見込み・歩留まり */}
      <div className="kpi-grid">
        <div className="kpi brand"><div><div className="val tnum">{yen(pipelineMan)}</div><div className="label">進行中の取扱見込み（月額）</div><div className="note">{activeProps.length} 件の進行中提案</div></div></div>
        <div className="kpi accent"><div><div className="val tnum">{yen(wonMan)}</div><div className="label">稼働決定の月額</div><div className="note">{won.length} 件 決定</div></div></div>
        <div className="kpi"><div><div className="val tnum">{decidedRate}<span className="unit">%</span></div><div className="label">提案→稼働決定 率</div><div className="note">面談到達 {meetRate}%</div></div></div>
        <div className="kpi warn"><div><div className="val tnum">{todoTotal}<span className="unit">件</span></div><div className="label">本日の要対応</div><div className="note">下のリスト参照</div></div></div>
      </div>

      {/* 担当者本人サマリー */}
      {myName && (myActive.length > 0 || myWon.length > 0) && (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>👤 {myName} さんの担当</div>
            <div style={{ fontSize: 13 }}>進行中 <b>{myActive.length}</b> 件</div>
            <div style={{ fontSize: 13 }}>取扱見込み <b>{yen(myPipelineMan)}</b></div>
            <div style={{ fontSize: 13 }}>今期決定 <b>{myWon.length}</b> 件</div>
            <Link href="/proposals" className="btn brand btn-xs" style={{ marginLeft: "auto", textDecoration: "none" }}>提案管理へ</Link>
          </div>
        </div>
      )}

      {/* ワークリスト */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
        {WORK.map((w) => (
          <div key={w.key} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{w.icon} {w.label}</div>
              <span style={{ fontSize: 13, fontWeight: 800, color: w.tone }}>{w.items.length}</span>
            </div>
            <div className="muted" style={{ fontSize: 11 }}>{w.desc}</div>
            {w.items.length === 0 ? (
              <div className="muted" style={{ fontSize: 12, padding: "6px 0" }}>対応待ちはありません 👍</div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
                {w.items.slice(0, 5).map((it: any, i: number) => (
                  <li key={i} style={{ fontSize: 12, color: "var(--color-ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>・{w.fmt(it)}</li>
                ))}
                {w.items.length > 5 && <li className="muted" style={{ fontSize: 11 }}>ほか {w.items.length - 5} 件</li>}
              </ul>
            )}
            <Link href={w.href} className="btn btn-xs" style={{ marginTop: "auto", textDecoration: "none", alignSelf: "flex-start" }}>対応する →</Link>
          </div>
        ))}
      </div>
    </div>
  );
}
