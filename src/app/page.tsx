import type { CSSProperties } from "react";
import { Fragment } from "react";
import { Icons } from "@/components/icons";
import { MOCK } from "@/lib/mock";
import { ClientHome } from "@/components/ClientHome";
import { resolveAccess } from "@/lib/accounts";
import { authServerClient, authConfigured } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

type IconComp = (p?: { size?: number; fill?: boolean }) => React.ReactNode;

function KPI({ label, val, unit, chipText, chipTone, tone, note, Icon }: any) {
  const chipClass = chipTone === "good" ? "" : chipTone === "bad" ? "dn" : "flat";
  return (
    <div className={"kpi " + (tone || "")}>
      <div className="top">
        <div className="ico-box">{Icon && <Icon />}</div>
        {chipText && <div className={"chip " + chipClass}>{chipText}</div>}
      </div>
      <div>
        <div className="val tnum">{val}<span className="unit">{unit}</span></div>
        <div className="label">{label}</div>
        {note && <div className="note">{note}</div>}
      </div>
    </div>
  );
}

function RainbowBar({ reasons }: any) {
  const total = reasons.reduce((a: number, b: any) => a + b.n, 0);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "75fr 4fr 15fr", marginBottom: 10, fontSize: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-ink-4)", fontSize: 10, fontWeight: 600 }}>原因A · データ品質</span>
          <span style={{ color: "var(--color-ink-3)" }}><b className="display tnum" style={{ color: "var(--color-ink)", fontSize: 15 }}>75</b> 件 · <span className="tnum">83%</span></span>
        </div>
        <div />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-ink-4)", fontSize: 10, fontWeight: 600 }}>原因B · 仕組み</span>
          <span style={{ color: "var(--color-ink-3)" }}><b className="display tnum" style={{ color: "var(--color-ink)", fontSize: 15 }}>15</b> 件 · <span className="tnum">17%</span></span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "75fr 4fr 15fr", height: 38 }}>
        <div style={{ display: "flex", gap: 3, borderRadius: "10px 4px 4px 10px", overflow: "hidden" }}>
          {reasons.filter((s: any) => s.group === "A").map((s: any) => (
            <div key={s.id} style={{ flex: s.n, background: s.color, display: "grid", placeItems: "center", color: "#fff", fontSize: 11.5, fontWeight: 700, fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums" }}>{s.n}</div>
          ))}
        </div>
        <div />
        <div style={{ display: "flex", gap: 3, borderRadius: "4px 10px 10px 4px", overflow: "hidden" }}>
          {reasons.filter((s: any) => s.group === "B").map((s: any) => (
            <div key={s.id} style={{ flex: s.n, background: s.color, display: "grid", placeItems: "center", color: "#fff", fontSize: 11.5, fontWeight: 700, fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums" }}>{s.n}</div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        {reasons.map((r: any) => (
          <div key={r.id} style={{ background: "var(--color-surface-soft)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: r.color, flex: "0 0 10px" }} />
              <span style={{ fontSize: 11.5, color: "var(--color-ink-2)", fontWeight: 600 }}>{r.label}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span className="display tnum" style={{ fontSize: 22, color: "var(--color-ink)" }}>{r.n}</span>
              <span style={{ fontSize: 11, color: "var(--color-ink-4)" }}>件</span>
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: r.color, fontFamily: "var(--font-mono)", fontWeight: 600 }} className="tnum">{((r.n / total) * 100).toFixed(0)}%</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--color-ink-3)", lineHeight: 1.5 }}>{r.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InitiativeCard({ init }: any) {
  const isWarm = init.tone === "warm";
  const accent = isWarm
    ? { line: "linear-gradient(135deg, #c9504a, #e8954a, #c9a73a)", chip: "#fef0ec", chipText: "#933b35", bar: "#c9504a" }
    : { line: "linear-gradient(135deg, #5a9b6a, #3d7fa8)", chip: "#e7f1ea", chipText: "#356444", bar: "#3d7fa8" };
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 18, padding: 24, display: "flex", flexDirection: "column", gap: 16, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: accent.line }} />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 700, color: accent.bar, letterSpacing: "-0.025em", lineHeight: 1 }}>{init.no}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 600, color: accent.chipText, background: accent.chip, padding: "3px 9px", borderRadius: 99, alignSelf: "flex-start" }}>{init.tag}</span>
              <span style={{ fontSize: 11, color: "var(--color-ink-3)" }}>対象 <b style={{ color: "var(--color-ink-2)" }}>{init.target}</b> <span className="muted">/ 全体の {init.pct}%</span></span>
            </div>
          </div>
          <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, letterSpacing: "-0.012em", color: "var(--color-ink)", lineHeight: 1.4 }}>{init.title}</h3>
        </div>
      </div>
      <div style={{ fontSize: 13, color: "var(--color-ink-2)", lineHeight: 1.65 }}>{init.lede}</div>
      <div style={{ display: "grid", gap: 10, padding: "14px 0 4px", borderTop: "1px solid var(--color-border)" }}>
        {init.rules.map((r: any, i: number) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 14, alignItems: "baseline" }}>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-3)", whiteSpace: "nowrap", fontWeight: 500 }}>
              <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 99, background: accent.bar, marginRight: 8, verticalAlign: "middle" }} />
              {r.k}
            </div>
            <div style={{ fontSize: 13, color: "var(--color-ink)", fontWeight: 600 }}>{r.v}</div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 14, display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center" }}>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5, fontSize: 11, color: "var(--color-ink-3)" }}>
            <span>進捗 · <b style={{ color: "var(--color-ink-2)" }}>{init.progress.label}</b></span>
            <span className="mono tnum" style={{ fontWeight: 600, color: accent.bar }}>{init.progress.pct}%</span>
          </div>
          <div style={{ height: 5, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden" }}>
            <div style={{ width: `${init.progress.pct}%`, height: "100%", background: accent.line }} />
          </div>
          <div style={{ marginTop: 9, fontSize: 11, color: "var(--color-ink-4)" }}>
            <span style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em", fontWeight: 600 }}>EFFECT</span> · {init.impact}
          </div>
        </div>
        <button className="btn primary">{init.action} →</button>
      </div>
    </div>
  );
}

function StageFunnel({ stages }: any) {
  const max = stages[0].n;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${stages.length}, 1fr)`, gap: 16 }}>
        {stages.map((s: any, i: number) => {
          const w = (s.n / max) * 100;
          const isDrop = i === 1;
          const isFlow = i === 3 || i === 4;
          const dotColor = i === 0 ? "var(--color-ink-4)" : isDrop ? "#c9504a" : isFlow ? "#3d7fa8" : "var(--color-brand-600)";
          return (
            <div key={s.name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "var(--color-ink-2)", fontWeight: 600 }}>{s.name}</span>
                {s.yield != null && <span style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>↘ {s.yield}%</span>}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span className="display tnum" style={{ fontSize: 26, color: "var(--color-ink)" }}>{s.n}</span>
                <span style={{ fontSize: 11, color: "var(--color-ink-4)" }}>件</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden" }}>
                <div style={{ width: `${w}%`, height: "100%", background: dotColor, borderRadius: 99, transition: "width .4s" }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${stages.length}, 1fr)`, gap: 16, marginTop: 18 }}>
        <div style={{ gridColumn: "1 / 3", display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 12, background: "#fdf0ee", border: "1px solid #f7d4d0" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "#c9504a", marginTop: 5, flex: "0 0 10px" }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#933b35" }}>仕組み 01 · データ品質ゲート がここで効く</div>
            <div style={{ fontSize: 11.5, color: "#6e3a36", marginTop: 3 }}>取り込み段階で NG 規則化 → 75 件 が母数から外れる</div>
          </div>
        </div>
        <div style={{ gridColumn: "3 / 5", padding: "12px 14px" }}>
          <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>提案 → 面談 歩留まり</div>
          <div style={{ fontSize: 11.5, marginTop: 4, color: "var(--color-ink-3)" }}>業界平均 28% を上回る</div>
        </div>
        <div style={{ gridColumn: "5 / 7", display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 12, background: "var(--color-brand-50)", border: "1px solid var(--color-brand-100)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--color-brand-600)", marginTop: 5, flex: "0 0 10px" }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-800)" }}>仕組み 02 · 対応プロセス がここで効く</div>
            <div style={{ fontSize: 11.5, color: "var(--color-brand-700)", marginTop: 3 }}>自動振り分け + ステータス可視化 → 15 件 を救う</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityItem({ a }: any) {
  const map: Record<string, any> = {
    ai: { bg: "var(--color-brand-50)", c: "var(--color-brand-600)", Ico: Icons.ai },
    won: { bg: "var(--color-success-soft)", c: "#047857", Ico: Icons.check },
    msg: { bg: "var(--color-brand-50)", c: "var(--color-brand-700)", Ico: Icons.msg },
    co: { bg: "var(--color-warn-soft)", c: "var(--color-warn)", Ico: Icons.building },
    act: { bg: "var(--color-surface-inset)", c: "var(--color-ink-2)", Ico: Icons.user },
  };
  const cfg: any = map[a.kind] || { bg: "var(--color-surface-inset)", c: "var(--color-ink-2)", Ico: Icons.dot };
  const Ico = cfg.Ico as IconComp;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "32px 1fr auto", gap: 12, alignItems: "center", padding: "10px 0" }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: cfg.bg, color: cfg.c, display: "grid", placeItems: "center" }}><Ico /></div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "var(--color-ink)" }}>
          <b style={{ fontWeight: 600 }}>{a.who}</b>
          <span style={{ color: "var(--color-ink-2)" }}> — {a.what}</span>
        </div>
      </div>
      <div className="mono" style={{ color: "var(--color-ink-4)", fontSize: 11 }}>{a.when}</div>
    </div>
  );
}

export default async function DashboardPage() {
  // ユーザー企業(client)は自社ポータルを表示
  if (authConfigured) {
    try {
      const sb = await authServerClient();
      const { data: { user } } = await sb.auth.getUser();
      const em = user?.email?.toLowerCase();
      if (em) {
        const access = await resolveAccess(em);
        if (access?.role === "client") {
          return <ClientHome companyName={access.companyName} displayName={access.name} />;
        }
      }
    } catch { /* noop → 通常ダッシュボード */ }
  }

  const dateStr = "2026年 5月 21日（木）";
  const kpiIcons: IconComp[] = [Icons.user, Icons.bolt, Icons.arrow, Icons.yen];

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 860 }}>
          <div className="meta">Dashboard · {dateStr}</div>
          <h1>失注 90 件 は、ほぼ <span style={{ color: "var(--color-brand-600)" }}>仕組み</span> で解ける構造です</h1>
          <div className="sub">
            成長レバーは <b style={{ color: "var(--color-ink)" }}>人数</b> ではなく <b style={{ color: "var(--color-ink)" }}>リード品質 × 各ステージの歩留まり</b>。
            母数 412 件のうち <b className="mono tnum" style={{ color: "var(--color-ink)" }}>有効リード 337 件</b> を分母として運用します。
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          <div className="progress-card">
            <div className="progress-ring" style={{ "--p": "82%", position: "relative" } as CSSProperties}>
              <span className="v">82%</span>
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>個人目標</div>
              <div style={{ fontSize: 13, color: "var(--color-ink)", fontWeight: 600 }}>あと <span className="tnum">¥4.2M</span></div>
            </div>
          </div>
          <button className="btn brand"><Icons.plus /><span>新規案件</span></button>
        </div>
      </div>

      <div className="kpi-grid">
        {MOCK.kpis.map((k, i) => <KPI key={i} {...k} Icon={kpiIcons[i]} />)}
      </div>

      <div className="card">
        <div className="card-h" style={{ alignItems: "flex-end" }}>
          <div>
            <span style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", fontSize: 10, color: "var(--color-brand-600)", fontWeight: 700 }}>Loss analysis</span>
            <h3 style={{ fontSize: 17, marginTop: 4, fontWeight: 700 }}>今月の失注 90 件 は、なぜ起きたか</h3>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6, maxWidth: 760, lineHeight: 1.6 }}>
              <b style={{ color: "var(--color-ink-2)" }}>原因A（データ品質起因）が 83%</b>、残る 17% が <b style={{ color: "var(--color-ink-2)" }}>原因B（対応プロセスの欠落）</b>。 打ち手は両方とも「仕組み」で揃えます。
            </div>
          </div>
          <span style={{ fontSize: 11.5, color: "var(--color-ink-4)", fontFamily: "var(--font-mono)" }}>5/01 — 5/21 · 月次レポート →</span>
        </div>
        <RainbowBar reasons={MOCK.lossReasons} />
      </div>

      <div>
        <div className="sec-head">
          <div>
            <span style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", fontSize: 10, color: "var(--color-brand-600)", fontWeight: 700 }}>Initiatives</span>
            <h2 style={{ marginTop: 4 }}>2 つの仕組みで揃える</h2>
          </div>
          <span className="lk muted">どちらも採用フローで実証済みの設計です →</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap, 20px)" }}>
          {MOCK.initiatives.map((init) => <InitiativeCard key={init.no} init={init} />)}
        </div>
      </div>

      <div className="card">
        <div className="card-h" style={{ alignItems: "flex-end" }}>
          <div>
            <span style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", fontSize: 10, color: "var(--color-brand-600)", fontWeight: 700 }}>Funnel</span>
            <h3 style={{ fontSize: 17, marginTop: 4, fontWeight: 700 }}>ステージ別 歩留まり · 仕組みが効く場所</h3>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6, maxWidth: 760, lineHeight: 1.6 }}>母数 412 件 → 成約 12 件。最初のゲート（仕組み 01）と最後の 2 段（仕組み 02）が改善ポイントです。</div>
          </div>
          <span className="lk muted">ファネル分析 →</span>
        </div>
        <StageFunnel stages={MOCK.pipeline} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "var(--gap, 20px)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap, 20px)", minWidth: 0 }}>
          <div className="card" style={{ background: "linear-gradient(135deg, var(--color-brand-25), var(--color-surface) 60%)", borderColor: "var(--color-brand-100)" }}>
            <div className="card-h">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: "var(--color-brand-50)", color: "var(--color-brand-600)", display: "grid", placeItems: "center" }}><Icons.ai /></div>
                  <h3 style={{ fontSize: 14 }}>AI が推薦する 注目のマッチ</h3>
                  <span className="tag brand">NEW · 9</span>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>有効リード 337 件 から、スコア 90+ を抽出</div>
              </div>
              <span className="lk muted">すべて見る →</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              {MOCK.aiSuggestions.map((s, i) => (
                <div key={i} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span className="tag brand">マッチ {s.score}</span>
                    <div className="score">
                      <div className="ring" style={{ "--p": `${s.score}%` } as CSSProperties} />
                      <div className="num tnum">{s.score}</div>
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--color-ink)", lineHeight: 1.5 }}>{s.title}</div>
                  <div className="muted" style={{ fontSize: 12, flex: 1, lineHeight: 1.55 }}>{s.reason}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn brand" style={{ flex: 1, justifyContent: "center", padding: "8px 12px", fontSize: 12 }}>{s.action}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card flush">
            <div style={{ padding: "18px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--color-border)" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>最近のマッチング</h3>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>過去 7 日間 · 有効リードのみ</div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button className="btn ghost" style={{ padding: "7px 12px", fontSize: 12 }}><Icons.sort /><span>並び替え</span></button>
                <button className="btn ghost" style={{ padding: "7px 12px", fontSize: 12 }}><Icons.filter /><span>絞り込み</span></button>
              </div>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>ID</th><th>案件</th><th style={{ width: 100 }}>スコア</th>
                  <th style={{ width: 80 }}>候補</th><th style={{ width: 92 }}>単価</th><th style={{ width: 78 }}>締切</th><th style={{ width: 92 }}>状態</th>
                </tr>
              </thead>
              <tbody>
                {MOCK.matchingFeed.map((m) => (
                  <tr key={m.id}>
                    <td><span className="mono" style={{ color: "var(--color-ink-4)", fontSize: 11.5 }}>{m.id}</span></td>
                    <td>
                      <div className="pri">{m.job}</div>
                      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, color: "var(--color-ink-3)" }}>{m.company}</span>
                        <span style={{ color: "var(--color-ink-5)" }}>·</span>
                        <span style={{ fontSize: 11, color: "var(--color-ink-3)" }}>{m.location}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 40, height: 5, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden", position: "relative" }}>
                          <div style={{ position: "absolute", inset: 0, width: `${m.score}%`, background: m.score >= 90 ? "var(--color-brand-600)" : m.score >= 80 ? "var(--color-brand-400)" : "var(--color-ink-4)", borderRadius: 99 }} />
                        </div>
                        <span className="tnum mono" style={{ fontSize: 12.5, fontWeight: 700 }}>{m.score}</span>
                      </div>
                    </td>
                    <td><span className="tnum">{m.candidates} 名</span></td>
                    <td className="num">{m.rate}</td>
                    <td className="num muted">{m.deadline}</td>
                    <td><span className={"pill " + m.status}>{m.status === "open" ? "募集中" : m.status === "review" ? "選考中" : "下書き"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-h">
              <div><h3>最新の動き</h3><div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>チーム全体</div></div>
              <span className="lk muted">すべて →</span>
            </div>
            <div>
              {MOCK.activities.map((a, i) => (
                <Fragment key={i}>
                  <ActivityItem a={a} />
                  {i < MOCK.activities.length - 1 && <hr className="hr" />}
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap, 20px)", minWidth: 0 }}>
          <div className="card">
            <div className="card-h">
              <div><h3>本日のタスク</h3><div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{MOCK.tasks.length} 件</div></div>
              <span className="lk muted">+ 追加</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {MOCK.tasks.map((t, i) => (
                <div key={t.id} style={{ display: "grid", gridTemplateColumns: "16px 1fr auto", gap: 12, padding: "11px 0", borderBottom: i < MOCK.tasks.length - 1 ? "1px solid var(--color-border)" : "0", alignItems: "flex-start" }}>
                  <div style={{ width: 14, height: 14, borderRadius: 5, marginTop: 3, border: "1.5px solid var(--color-border-strong)", background: "var(--color-surface)" }} />
                  <div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3 }}>
                      <span className={"pill " + (t.lvl || "")} style={{ fontSize: 10, padding: "2px 7px" }}>{t.kind}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.5 }}>{t.txt}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: t.lvl === "danger" ? "var(--color-danger)" : t.lvl === "warn" ? "var(--color-warn)" : "var(--color-ink-4)", whiteSpace: "nowrap", marginTop: 3, fontWeight: 600 }}>{t.due}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: "linear-gradient(135deg, #0c1722, #1f2937)", color: "#fff", borderRadius: 18, padding: 22, display: "flex", flexDirection: "column", gap: 12, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -20, right: -30, width: 140, height: 140, borderRadius: 99, background: "radial-gradient(circle, rgba(0,149,217,0.4), transparent 65%)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(0,149,217,0.2)", color: "#7ec9eb", display: "grid", placeItems: "center" }}><Icons.bolt /></div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", fontWeight: 600 }}>TIP</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, lineHeight: 1.4, letterSpacing: "-0.01em" }}>
              NG ルールを 1 つ追加するごとに、有効リード歩留まりは <span style={{ color: "#7ec9eb" }}>+8%</span> 向上が見込めます
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>採用フロー側の実績ベース。「1週間返信なし」「重複検出」をルール化すると、母数が削れて分母が締まります。</div>
            <button className="btn" style={{ background: "#fff", color: "#0c1722", borderColor: "#fff", alignSelf: "flex-start", marginTop: 4 }}>ルールを設定する →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
