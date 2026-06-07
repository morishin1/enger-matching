import { unstable_cache } from "next/cache";
import { engerAdmin, publicAdmin, dbConfigured } from "@/lib/supabase";

type AgentRow = { name: string; proposals: number; scouts: number; meetings: number; won: number; pr: number };
type Delta = { d1: number; d7: number; d30: number; total: number };
type MetricRow = Delta & { key: string; label: string; href: string };
type GrowthData = {
  engTotal: number; engGithub: number; clientTotal: number; jobsPub: number;
  scoutCnt: number; appCnt: number; appPass: number; appActive: number;
  deltas: MetricRow[]; agents: AgentRow[];
};

const getGrowthData = unstable_cache(async (): Promise<GrowthData | null> => {
  if (!dbConfigured) return null;
  try {
    const sb = engerAdmin();
    const pub = publicAdmin();
    const ENG_FILTER = "github_id.not.is.null,display_name.not.is.null";
    const since = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
    const s1 = since(1), s7 = since(7), s30 = since(30);
    const cnt = async (q: any) => { try { const { count } = await q; return count ?? 0; } catch { return 0; } };
    const hasCol = async (table: string, col: string) => { try { const { error } = await sb.from(table).select(col, { head: true }).limit(1); return !error; } catch { return false; } };

    const candDate = (await hasCol("candidates", "imported_at")) ? "imported_at" : "created_at";
    const jobDate = (await hasCol("jobs", "imported_at")) ? "imported_at" : "created_at";

    // 指標ごとに 1日/7日/30日/累計 を集計
    const win = async (client: any, table: string, idCol: string, dateCol: string, extra?: (q: any) => any): Promise<Delta> => {
      const q = (sinceIso: string | null) => { let x = client.from(table).select(idCol, { count: "exact", head: true }); if (extra) x = extra(x); if (sinceIso) x = x.gte(dateCol, sinceIso); return cnt(x); };
      const [d1, d7, d30, total] = await Promise.all([q(s1), q(s7), q(s30), q(null)]);
      return { d1, d7, d30, total };
    };

    const [dEng, dCand, dJob, dClient, dApp, dScout] = await Promise.all([
      win(pub, "profiles", "id", "created_at", (q) => q.or(ENG_FILTER)),
      win(sb, "candidates", "candidate_no", candDate),
      win(sb, "jobs", "job_no", jobDate),
      win(sb, "app_users", "email", "created_at", (q) => q.eq("role", "client")),
      win(sb, "applications", "id", "created_at"),
      win(sb, "scouts", "id", "created_at"),
    ]);

    const deltas: MetricRow[] = [
      { key: "eng", label: "エンジャー登録", href: "/engineers", ...dEng },
      { key: "cand", label: "取込人材（CSV）", href: "/people", ...dCand },
      { key: "job", label: "取込案件（CSV）", href: "/jobs", ...dJob },
      { key: "client", label: "登録企業", href: "/settings#accounts", ...dClient },
      { key: "scout", label: "スカウト送信", href: "/engineers", ...dScout },
      { key: "app", label: "応募", href: "/proposals", ...dApp },
    ];

    // ファネル用の累計
    const [engTotal, engGithub, clientTotal, jobsPub, scoutCnt, appCnt, appPass, appActive] = await Promise.all([
      Promise.resolve(dEng.total),
      cnt(pub.from("profiles").select("id", { count: "exact", head: true }).not("github_id", "is", null)),
      Promise.resolve(dClient.total),
      cnt(sb.from("jobs").select("id", { count: "exact", head: true }).eq("is_published", true)),
      Promise.resolve(dScout.total),
      Promise.resolve(dApp.total),
      cnt(sb.from("applications").select("id", { count: "exact", head: true }).eq("stage", "面談合格")),
      cnt(sb.from("applications").select("id", { count: "exact", head: true }).eq("stage", "稼働")),
    ]);

    let agents: AgentRow[] = [];
    try {
      const week = since(7);
      const [pr, sc, mt, prp] = await Promise.all([
        sb.from("proposals").select("proposer, stage").limit(5000),
        sb.from("scouts").select("agent").limit(5000),
        sb.from("meetings").select("our_owner").limit(3000),
        sb.from("pr_posts").select("operator, created_at").gte("created_at", week).limit(5000),
      ]);
      const map = new Map<string, AgentRow>();
      const get = (n: string) => { const k = (n || "").trim(); if (!k) return null; if (!map.has(k)) map.set(k, { name: k, proposals: 0, scouts: 0, meetings: 0, won: 0, pr: 0 }); return map.get(k)!; };
      for (const p of (pr.data ?? []) as any[]) { const a = get(p.proposer); if (a) { a.proposals++; if (["合格", "面談合格", "稼働", "稼働中", "稼働決定"].includes(p.stage)) a.won++; } }
      for (const s of (sc.data ?? []) as any[]) { const a = get(s.agent); if (a) a.scouts++; }
      for (const m of (mt.data ?? []) as any[]) { const a = get(m.our_owner); if (a) a.meetings++; }
      for (const x of (prp.data ?? []) as any[]) { const a = get(x.operator); if (a) a.pr++; }
      agents = [...map.values()].sort((a, b) => (b.proposals + b.scouts + b.meetings) - (a.proposals + a.scouts + a.meetings)).slice(0, 12);
    } catch { /* 集計失敗は無視 */ }

    return { engTotal, engGithub, clientTotal, jobsPub, scoutCnt, appCnt, appPass, appActive, deltas, agents };
  } catch { return null; }
}, ["admin-growth-board"], { revalidate: 120, tags: ["dashboard", "sidebar-counts"] });

/** 管理者向け 経営ボード（シンプル版）：成長ファネル＋新規増加(1/7/30日)＋エージェント別。数値はクリックで根拠ページへ。 */
export async function AdminGrowthBoard() {
  const data = await getGrowthData();
  if (!data) return null;
  const { engTotal, engGithub, clientTotal, scoutCnt, appCnt, appPass, appActive, deltas, agents } = data;
  const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

  const funnel = [
    { label: "登録エンジニア", v: engTotal, sub: `GitHub連携 ${engGithub}`, color: "#0b5cab", href: "/engineers" },
    { label: "スカウト送信", v: scoutCnt, sub: "企業/営業→人材", color: "#0b5cab", href: "/engineers" },
    { label: "応募", v: appCnt, sub: "人材→案件", color: "#7c3aed", href: "/proposals" },
    { label: "面談合格", v: appPass, sub: "", color: "#0891b2", href: "/proposals" },
    { label: "稼働（成約）", v: appActive, sub: "＝売上", color: "#067647", href: "/progress" },
  ];

  const num = (n: number) => n.toLocaleString("ja-JP");
  const plus = (n: number) => (n > 0 ? { color: "#067647", fontWeight: 700 } : { color: "var(--color-ink-4)" });
  const td = { padding: "8px 10px", textAlign: "right" as const };

  return (
    <>
      {/* 成長ファネル（各数値クリックで根拠ページ） */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-brand-700)" }}>trending_up</span>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>成長ファネル（KGI＝売上）</h3>
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>数値をクリックで根拠（一覧）へ</span>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "stretch", marginTop: 10 }}>
          {funnel.map((f, i) => (
            <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 4, flex: "1 1 140px" }}>
              <a href={f.href} style={{ flex: 1, background: "var(--color-surface-soft)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "12px 10px", textAlign: "center", textDecoration: "none", color: "inherit" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: f.color }}>{num(f.v)}</div>
                <div style={{ fontSize: 11.5, fontWeight: 700 }}>{f.label}</div>
                {f.sub && <div className="muted" style={{ fontSize: 10 }}>{f.sub}</div>}
                {i > 0 && <div style={{ fontSize: 10, color: "var(--color-ink-4)", marginTop: 3 }}>転換 {pctOf(f.v, funnel[i - 1].v)}%</div>}
              </a>
              {i < funnel.length - 1 && <span style={{ color: "var(--color-ink-4)", fontWeight: 700 }}>›</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 新規の増加（1日 / 7日 / 30日 / 累計） */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-brand-700)" }}>insights</span>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>新規の増加</h3>
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>指標名クリックで根拠（一覧）へ</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 460 }}>
            <thead>
              <tr style={{ color: "var(--color-ink-4)", fontSize: 11 }}>
                <th style={{ textAlign: "left", padding: "8px 10px" }}>指標</th>
                <th style={td}>1日</th><th style={td}>7日</th><th style={td}>30日</th><th style={td}>累計</th>
              </tr>
            </thead>
            <tbody>
              {deltas.map((m) => (
                <tr key={m.key} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                    <a href={m.href} style={{ color: "var(--color-brand-700,#0b5cab)", textDecoration: "none" }}>{m.label} ›</a>
                  </td>
                  <td style={{ ...td, ...plus(m.d1) }} className="tnum">+{num(m.d1)}</td>
                  <td style={{ ...td, ...plus(m.d7) }} className="tnum">+{num(m.d7)}</td>
                  <td style={{ ...td, ...plus(m.d30) }} className="tnum">+{num(m.d30)}</td>
                  <td style={{ ...td, fontWeight: 700 }} className="tnum">{num(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", marginTop: 6 }}>※ 登録/取込の発生日（created_at・imported_at）基準。前段が増えても次段（スカウト→応募→稼働）が伸びなければ施策のサインです。</div>
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
                  <th style={td}>提案</th><th style={td}>スカウト</th><th style={td}>打合せ</th><th style={td}>PR(週)</th><th style={td}>成約</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.name} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600 }}>{a.name}</td>
                    <td style={td} className="tnum">{a.proposals}</td>
                    <td style={td} className="tnum">{a.scouts}</td>
                    <td style={td} className="tnum">{a.meetings}</td>
                    <td style={{ ...td, fontWeight: 700, color: a.pr > 0 ? "#0b5cab" : "#b42318" }} className="tnum">{a.pr === 0 ? "0 ⚠" : a.pr}</td>
                    <td style={{ ...td, fontWeight: 700, color: a.won > 0 ? "#067647" : "var(--color-ink-3)" }} className="tnum">{a.won}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
