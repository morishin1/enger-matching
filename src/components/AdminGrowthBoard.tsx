import { unstable_cache } from "next/cache";
import { engerAdmin, publicAdmin, dbConfigured } from "@/lib/supabase";

type AgentRow = { name: string; proposals: number; scouts: number; meetings: number; won: number };
type RecentRow = { name: string; at: string | null; sub?: string };
type GrowthData = { engTotal: number; engGithub: number; eng30: number; clientTotal: number; client30: number; jobsPub: number; scoutCnt: number; appCnt: number; appPass: number; appActive: number; agents: AgentRow[]; recentEng: RecentRow[]; recentClient: RecentRow[] };

// 経営ボードの集計（重い count×10 ＋ 担当者集計）を120秒キャッシュ。書込時はタグで即時更新。
const getGrowthData = unstable_cache(async (): Promise<GrowthData | null> => {
  if (!dbConfigured) return null;
  try {
    const sb = engerAdmin();
    const pub = publicAdmin();
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const cnt = async (q: any) => { try { const { count } = await q; return count ?? 0; } catch { return 0; } };

    const [engTotal, engGithub, eng30, clientTotal, client30, jobsPub, scoutCnt, appCnt, appPass, appActive] = await Promise.all([
      cnt(pub.from("profiles").select("id", { count: "exact", head: true }).or("github_id.not.is.null,display_name.not.is.null")),
      cnt(pub.from("profiles").select("id", { count: "exact", head: true }).not("github_id", "is", null)),
      cnt(pub.from("profiles").select("id", { count: "exact", head: true }).or("github_id.not.is.null,display_name.not.is.null").gte("created_at", since30)),
      cnt(sb.from("app_users").select("email", { count: "exact", head: true }).eq("role", "client")),
      cnt(sb.from("app_users").select("email", { count: "exact", head: true }).eq("role", "client").gte("created_at", since30)),
      cnt(sb.from("jobs").select("id", { count: "exact", head: true }).eq("is_published", true)),
      cnt(sb.from("scouts").select("id", { count: "exact", head: true })),
      cnt(sb.from("applications").select("id", { count: "exact", head: true })),
      cnt(sb.from("applications").select("id", { count: "exact", head: true }).eq("stage", "面談合格")),
      cnt(sb.from("applications").select("id", { count: "exact", head: true }).eq("stage", "稼働")),
    ]);

    // エージェント別の動き
    let agents: AgentRow[] = [];
    try {
      const [pr, sc, mt] = await Promise.all([
        sb.from("proposals").select("proposer, stage").limit(5000),
        sb.from("scouts").select("agent").limit(5000),
        sb.from("meetings").select("our_owner").limit(3000),
      ]);
      const map = new Map<string, AgentRow>();
      const get = (n: string) => { const k = (n || "").trim(); if (!k) return null; if (!map.has(k)) map.set(k, { name: k, proposals: 0, scouts: 0, meetings: 0, won: 0 }); return map.get(k)!; };
      for (const p of (pr.data ?? []) as any[]) { const a = get(p.proposer); if (a) { a.proposals++; if (["面談合格", "稼働", "稼働中", "稼働決定"].includes(p.stage)) a.won++; } }
      for (const s of (sc.data ?? []) as any[]) { const a = get(s.agent); if (a) a.scouts++; }
      for (const m of (mt.data ?? []) as any[]) { const a = get(m.our_owner); if (a) a.meetings++; }
      agents = [...map.values()].sort((a, b) => (b.proposals + b.scouts + b.meetings) - (a.proposals + a.scouts + a.meetings)).slice(0, 12);
    } catch { /* 集計失敗は無視 */ }

    // 最近の登録者（誰が登録したか）— エンジニア / 企業
    let recentEng: RecentRow[] = [], recentClient: RecentRow[] = [];
    try {
      const er = await pub.from("profiles").select("display_name, github_login, primary_language, created_at").or("github_id.not.is.null,display_name.not.is.null").order("created_at", { ascending: false }).limit(6);
      recentEng = ((er.data ?? []) as any[]).map((r) => ({ name: r.display_name || r.github_login || "（無名）", at: r.created_at, sub: r.primary_language || (r.github_login ? "GitHub連携" : "メール登録") }));
      const cr = await sb.from("app_users").select("name, company_name, status, created_at").eq("role", "client").order("created_at", { ascending: false }).limit(6);
      recentClient = ((cr.data ?? []) as any[]).map((r) => ({ name: r.company_name || r.name || "（企業）", at: r.created_at, sub: r.status === "pending" ? "承認待ち" : "承認済み" }));
    } catch { /* 一覧取得失敗は無視 */ }

    return { engTotal, engGithub, eng30, clientTotal, client30, jobsPub, scoutCnt, appCnt, appPass, appActive, agents, recentEng, recentClient };
  } catch { return null; }
}, ["admin-growth-board"], { revalidate: 120, tags: ["dashboard", "sidebar-counts"] });

/**
 * 管理者向け 経営ボード：KGI(売上)につながる成長ファネルと、登録KPI、
 * エージェント別の動きを一画面で。「エンジニアが増える→企業がスカウト→成約→売上」を可視化。
 */
export async function AdminGrowthBoard() {
  const data = await getGrowthData();
  if (!data) return null;
  const { engTotal, engGithub, eng30, clientTotal, client30, jobsPub, scoutCnt, appCnt, appPass, appActive, agents, recentEng, recentClient } = data;
  const fmtD = (s: string | null) => (s ? new Date(s).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) : "—");

  const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const funnel = [
    { label: "登録エンジニア", v: engTotal, sub: `GitHub連携 ${engGithub}`, color: "#0b5cab" },
    { label: "スカウト送信", v: scoutCnt, sub: "企業/営業→人材", color: "#0b5cab" },
    { label: "応募", v: appCnt, sub: "人材→案件", color: "#7c3aed" },
    { label: "面談合格", v: appPass, sub: "", color: "#0891b2" },
    { label: "稼働（成約）", v: appActive, sub: "＝売上", color: "#067647" },
  ];

  return (
    <>
      {/* 成長ファネル（KGIへのつながり） */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-brand-700)" }}>trending_up</span>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>成長ファネル（KGI＝売上 へのつながり）</h3>
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>エンジニアが増える → 企業がスカウト → 応募・面談 → 稼働（売上）</span>
        </div>
        <p className="muted" style={{ fontSize: 11.5, margin: "0 0 14px" }}>各段階の数と転換率。前段が増えても次段に進まなければ、その間に施策（スカウト強化・面談化など）が必要というサインです。</p>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "stretch" }}>
          {funnel.map((f, i) => (
            <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 4, flex: "1 1 140px" }}>
              <div style={{ flex: 1, background: "var(--color-surface-soft)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "12px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: f.color }}>{f.v.toLocaleString("ja-JP")}</div>
                <div style={{ fontSize: 11.5, fontWeight: 700 }}>{f.label}</div>
                {f.sub && <div className="muted" style={{ fontSize: 10 }}>{f.sub}</div>}
                {i > 0 && <div style={{ fontSize: 10, color: "var(--color-ink-4)", marginTop: 3 }}>転換 {pctOf(f.v, funnel[i - 1].v)}%</div>}
              </div>
              {i < funnel.length - 1 && <span style={{ color: "var(--color-ink-4)", fontWeight: 700 }}>›</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 登録KPI */}
      <div className="kpi-grid">
        <div className="kpi brand"><div className="top"><div className="ico-box"><span className="material-symbols-outlined">badge</span></div></div><div><div className="val tnum">{engTotal.toLocaleString("ja-JP")}</div><div className="label">登録エンジニア（累計）</div><div className="note">直近30日 +{eng30}</div></div></div>
        <div className="kpi"><div className="top"><div className="ico-box"><span className="material-symbols-outlined">apartment</span></div></div><div><div className="val tnum">{clientTotal.toLocaleString("ja-JP")}</div><div className="label">登録企業（累計）</div><div className="note">直近30日 +{client30}</div></div></div>
        <div className="kpi"><div className="top"><div className="ico-box"><span className="material-symbols-outlined">work</span></div></div><div><div className="val tnum">{jobsPub.toLocaleString("ja-JP")}</div><div className="label">公開中の案件</div></div></div>
        <div className="kpi accent"><div className="top"><div className="ico-box"><span className="material-symbols-outlined">handshake</span></div></div><div><div className="val tnum">{appActive.toLocaleString("ja-JP")}</div><div className="label">稼働（成約）</div><div className="note">応募{appCnt}→面談合格{appPass}→稼働</div></div></div>
      </div>

      {/* エージェント別の動き */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-brand-700)" }}>groups</span>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>エージェント別の動き</h3>
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>提案・スカウト・打合せ・成約（多い順）</span>
        </div>
        {agents.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>まだ活動データがありません。</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 480 }}>
              <thead>
                <tr style={{ color: "var(--color-ink-4)", fontSize: 11 }}>
                  <th style={{ textAlign: "left", padding: "6px 10px" }}>担当者</th>
                  <th style={{ textAlign: "right", padding: "6px 10px" }}>提案</th>
                  <th style={{ textAlign: "right", padding: "6px 10px" }}>スカウト</th>
                  <th style={{ textAlign: "right", padding: "6px 10px" }}>打合せ</th>
                  <th style={{ textAlign: "right", padding: "6px 10px" }}>成約</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.name} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600 }}>{a.name}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }} className="tnum">{a.proposals}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }} className="tnum">{a.scouts}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }} className="tnum">{a.meetings}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: a.won > 0 ? "#067647" : "var(--color-ink-3)" }} className="tnum">{a.won}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 最近の登録者（誰が登録したか） */}
      <div className="duo-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span className="material-symbols-outlined" style={{ color: "var(--color-brand-700)" }}>person_add</span>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>最近の登録エンジニア</h3>
            <a href="/engineers" style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--color-brand-700)", fontWeight: 700 }}>一覧 →</a>
          </div>
          {recentEng.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>登録はまだありません。</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {recentEng.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                  {r.sub && <span className="tag" style={{ fontSize: 10.5 }}>{r.sub}</span>}
                  <span className="muted" style={{ fontSize: 11 }}>{fmtD(r.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span className="material-symbols-outlined" style={{ color: "var(--color-brand-700)" }}>domain_add</span>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>最近の登録企業</h3>
            <a href="/settings" style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--color-brand-700)", fontWeight: 700 }}>承認・管理 →</a>
          </div>
          {recentClient.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>登録はまだありません。</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {recentClient.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                  {r.sub && <span className="tag" style={{ fontSize: 10.5, color: r.sub === "承認待ち" ? "#b45309" : "#067647" }}>{r.sub}</span>}
                  <span className="muted" style={{ fontSize: 11 }}>{fmtD(r.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
