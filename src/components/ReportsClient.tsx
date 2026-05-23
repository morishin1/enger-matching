"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReport, coachReport, sendReportFeedback } from "@/app/reports/actions";
import type { Actuals, DailyReport } from "@/lib/daily-report";

function ManagerReview({ reports }: { reports: DailyReport[] }) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const days = period === "month" ? 30 : 7;
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const byAuthor = new Map<string, number>();
  for (const r of reports) { if (r.report_date >= from) byAuthor.set(r.author, (byAuthor.get(r.author) ?? 0) + 1); }
  const authors = [...byAuthor.entries()].sort((a, b) => b[1] - a[1]);

  const send = async (author: string) => {
    setBusy(author); setMsg(null);
    const r = await sendReportFeedback(author, period);
    setBusy(null);
    setMsg(r.ok ? `✓ ${author}さんへ${period === "month" ? "月次" : "週次"}フィードバックを送信しました` : `エラー：${r.error}`);
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🧑‍🏫 管理者：週次/月次フィードバック（AI講評をお知らせ送信）</h3>
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99 }}>
          {(["week", "month"] as const).map((p) => <button key={p} onClick={() => setPeriod(p)} style={{ padding: "5px 12px", borderRadius: 99, border: 0, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", background: period === p ? "var(--color-surface)" : "transparent", color: period === p ? "var(--color-ink)" : "var(--color-ink-3)" }}>{p === "week" ? "週次" : "月次"}</button>)}
        </div>
      </div>
      {authors.length === 0 ? (
        <div className="muted" style={{ fontSize: 12.5 }}>対象期間に日報の提出がありません。</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {authors.map(([author, cnt]) => (
            <div key={author} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", border: "1px solid var(--color-border)", borderRadius: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{author} <span className="muted" style={{ fontWeight: 400, fontSize: 11.5 }}>提出 {cnt}回 / 直近{days}日</span></span>
              <button className="btn brand btn-xs" disabled={busy === author} onClick={() => send(author)}>{busy === author ? "生成中…" : "🤖 AI講評を送る"}</button>
            </div>
          ))}
        </div>
      )}
      {msg && <div style={{ fontSize: 12.5, color: msg.startsWith("✓") ? "#067647" : "#b42318" }}>{msg}</div>}
      <div className="muted" style={{ fontSize: 10.5 }}>※ 本人の自己チェック傾向・課題・成果をAIが集計し、承認＋改善点＋次の focus を本人の「お知らせ」に送信します。</div>
    </div>
  );
}

// 誰が書いても同じ視点になる共通フレーム
const ACTIVITIES = ["顧客・関係者と接点", "提案・成果物を作成", "案件/業務を前進", "課題・トラブル対応", "改善・仕組み化", "学習・情報収集", "チーム連携・サポート", "事務・管理処理"];
// 自己チェック（同じ意識をつくる問い）
const CHECKS = [
  { k: "goal", q: "目標・優先順位を意識して動けた" },
  { k: "value", q: "相手（顧客/社内）に価値を提供できた" },
  { k: "progress", q: "案件・業務を前に進められた" },
  { k: "speed", q: "スピード感を持って動けた" },
  { k: "promise", q: "期限・約束を守れた" },
];
const CHECK_OPTS = ["○", "△", "×"];
const NEXT = ["フォロー連絡", "資料作成", "MTG設定", "課題対応", "改善着手", "確認・検証", "新規開拓"];
const MOODS = ["😀手応えあり", "😐普通", "😟苦戦"];
const TARGET_PROPOSALS = 3;

const inp = { fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%" } as const;
const L = ({ c }: { c: string }) => <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 4 }}>{c}</div>;

function Chips({ all, sel, onToggle, color = "var(--color-brand-600)" }: { all: string[]; sel: string[]; onToggle: (v: string) => void; color?: string }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {all.map((o) => { const on = sel.includes(o); return <button key={o} type="button" onClick={() => onToggle(o)} className="tag" style={{ cursor: "pointer", fontSize: 11.5, background: on ? color : "var(--color-surface-inset)", color: on ? "#fff" : "var(--color-ink-3)", border: 0 }}>{o}</button>; })}
    </div>
  );
}

function Stat({ label, value, target }: { label: string; value: number; target?: number }) {
  const reached = target == null ? true : value >= target;
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "8px 12px", minWidth: 92 }}>
      <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 600 }}>{label}{target != null ? `（目標${target}）` : ""}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: target == null ? "var(--color-ink)" : reached ? "#067647" : "#b45309" }}>{value}{target != null && !reached && <span style={{ fontSize: 11, marginLeft: 4 }}>未達</span>}</div>
    </div>
  );
}

function ReportForm({ author, today, actuals }: { author: string; today: string; actuals: Actuals }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [did, setDid] = useState<string[]>([]);
  const [nexts, setNexts] = useState<string[]>([]);
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [f, setF] = useState({ good: "", problem: "", cause: "", next_note: "", mood: "", outputs: "", contacts: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const checkColor = (v: string) => v === "○" ? "#067647" : v === "△" ? "#b45309" : v === "×" ? "#b42318" : "var(--color-ink-3)";

  const submit = () => {
    if (!f.good.trim() && !f.problem.trim()) { setMsg("「うまくいったこと」か「詰まった/課題」のどちらかは入力してください"); return; }
    const next_action = [nexts.join("、"), f.next_note.trim()].filter(Boolean).join(" / ");
    start(async () => {
      const r = await saveReport({
        author, report_date: today, did, self_check: checks, good: f.good, problem: f.problem, cause: f.cause,
        next_action, mood: f.mood, outputs: f.outputs === "" ? null : Number(f.outputs), contacts: f.contacts === "" ? null : Number(f.contacts), metrics: actuals,
      });
      setMsg(r.ok ? "✓ 日報を保存しました" : `エラー：${r.error}`);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <b style={{ fontSize: 15 }}>📝 {today} の日報（{author || "担当者未設定"}）</b>

      {/* システム集計（参考・自動） */}
      <div>
        <L c="システム集計（自動・参考）" />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Stat label="新規提案" value={actuals.proposalsToday} target={TARGET_PROPOSALS} />
          <Stat label="打合せ" value={actuals.meetingsToday} />
          <Stat label="進行中提案" value={actuals.activeProps} />
          <Stat label="今週の面談" value={actuals.meetingsWeek} />
        </div>
      </div>

      {/* 今日の活動（共通チェック） */}
      <div><L c="今日やったこと（当てはまるものをタップ）" /><Chips all={ACTIVITIES} sel={did} onToggle={(v) => toggle(did, setDid, v)} /></div>

      {/* 件数（自己申告・任意） */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 10 }}>
        <div><L c="主なアウトプット数（提案/対応など）" /><input style={inp} type="number" value={f.outputs} onChange={(e) => setF({ ...f, outputs: e.target.value })} placeholder="例）5" /></div>
        <div><L c="顧客・関係者との接点数" /><input style={inp} type="number" value={f.contacts} onChange={(e) => setF({ ...f, contacts: e.target.value })} placeholder="例）3" /></div>
      </div>

      {/* 自己チェック（同じ意識をつくる問い） */}
      <div>
        <L c="自己チェック（○できた / △まあまあ / ×できず）" />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {CHECKS.map((c) => (
            <div key={c.k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 10px", border: "1px solid var(--color-border)", borderRadius: 8 }}>
              <span style={{ fontSize: 12.5 }}>{c.q}</span>
              <div style={{ display: "flex", gap: 4 }}>
                {CHECK_OPTS.map((o) => { const on = checks[c.k] === o; return <button key={o} type="button" onClick={() => setChecks((p) => ({ ...p, [c.k]: on ? "" : o }))} style={{ cursor: "pointer", width: 30, height: 28, borderRadius: 7, fontWeight: 800, fontFamily: "inherit", border: `1px solid ${on ? checkColor(o) : "var(--color-border)"}`, background: on ? `${checkColor(o)}1a` : "var(--color-surface)", color: on ? checkColor(o) : "var(--color-ink-4)" }}>{o}</button>; })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 自問自答（KPT） */}
      <div><L c="うまくいったこと（続けたい）" /><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={f.good} onChange={(e) => setF({ ...f, good: e.target.value })} placeholder="例）打合せで案件情報を引き出せた" /></div>
      <div><L c="詰まったこと・課題" /><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} placeholder="例）提案は出せたが面談に進まない" /></div>
      <div><L c="それはなぜ？（深掘り）" /><input style={inp} value={f.cause} onChange={(e) => setF({ ...f, cause: e.target.value })} placeholder="例）単価提示のタイミングが遅い / 初動が翌日になった" /></div>

      <div><L c="明日 変える・試すこと" /><Chips all={NEXT} sel={nexts} onToggle={(v) => toggle(nexts, setNexts, v)} color="#0b5cab" /><input style={{ ...inp, marginTop: 6 }} value={f.next_note} onChange={(e) => setF({ ...f, next_note: e.target.value })} placeholder="具体的に（任意）" /></div>

      <div><L c="今日の手応え" /><div style={{ display: "flex", gap: 8 }}>{MOODS.map((m) => <button key={m} type="button" onClick={() => setF({ ...f, mood: f.mood === m ? "" : m })} style={{ cursor: "pointer", fontSize: 13, fontFamily: "inherit", padding: "7px 14px", borderRadius: 99, border: `1px solid ${f.mood === m ? "var(--color-brand-600)" : "var(--color-border)"}`, background: f.mood === m ? "var(--color-brand-50)" : "var(--color-surface)" }}>{m}</button>)}</div></div>

      {msg && <div style={{ fontSize: 12.5, color: msg.startsWith("✓") ? "#067647" : "#b42318" }}>{msg}</div>}
      <div><button className="btn brand" disabled={pending} onClick={submit}>{pending ? "保存中…" : "日報を保存"}</button></div>
    </div>
  );
}

function ReportCard({ r }: { r: DailyReport }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const m = r.metrics ?? {};
  const sc = r.self_check ?? {};
  const coach = () => start(async () => { await coachReport(r.id); router.refresh(); });
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ fontSize: 13.5 }}>{r.author}</b>
        <span className="muted mono" style={{ fontSize: 11 }}>{r.report_date} {r.mood ?? ""}</span>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "var(--color-ink-3)" }}>
        {r.outputs != null && <span>成果物 <b style={{ color: "var(--color-ink)" }}>{r.outputs}</b></span>}
        {r.contacts != null && <span>接点 <b style={{ color: "var(--color-ink)" }}>{r.contacts}</b></span>}
        {m.proposalsToday != null && <span>提案 <b style={{ color: "var(--color-ink)" }}>{m.proposalsToday}</b></span>}
        {m.meetingsToday != null && <span>打合せ <b style={{ color: "var(--color-ink)" }}>{m.meetingsToday}</b></span>}
      </div>
      {Object.keys(sc).length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", fontSize: 10.5 }}>
          {CHECKS.filter((c) => sc[c.k]).map((c) => <span key={c.k} className="tag" style={{ fontSize: 10 }}>{c.q.length > 8 ? c.q.slice(0, 8) : c.q}…{sc[c.k]}</span>)}
        </div>
      )}
      {r.did?.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{r.did.map((d) => <span key={d} className="tag" style={{ fontSize: 10 }}>{d}</span>)}</div>}
      {r.good && <div style={{ fontSize: 12.5, color: "#067647" }}>👍 {r.good}</div>}
      {r.problem && <div style={{ fontSize: 12.5, color: "var(--color-ink-2)" }}>⚠️ {r.problem}{r.cause ? <span className="muted">（なぜ：{r.cause}）</span> : ""}</div>}
      {r.next_action && <div style={{ fontSize: 12, color: "var(--color-brand-700, #0b5cab)" }}>▶ 明日：{r.next_action}</div>}
      {r.ai_comment ? (
        <div style={{ fontSize: 12, color: "var(--color-ink-2)", background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 8, padding: "8px 10px", whiteSpace: "pre-wrap" }}>🤖 {r.ai_comment}</div>
      ) : (
        <button className="btn ghost btn-xs" disabled={pending} onClick={coach} style={{ alignSelf: "flex-start" }}>{pending ? "生成中…" : "🤖 AIから一言（任意）"}</button>
      )}
    </div>
  );
}

export function ReportsClient({ author, today, actuals, reports, isAdmin = false }: { author: string; today: string; actuals: Actuals; reports: DailyReport[]; isAdmin?: boolean }) {
  const [q, setQ] = useState("");
  const todays = reports.find((r) => r.author === author && r.report_date === today);
  const filtered = q.trim() ? reports.filter((r) => (r.author ?? "").includes(q.trim())) : reports;
  return (
    <>
      {isAdmin && <ManagerReview reports={reports} />}
      {todays ? (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>
          ✓ 本日（{today}）の日報は提出済みです。もう一度フォームから保存すると上書き更新されます。
        </div>
      ) : null}
      <ReportForm author={author} today={today} actuals={actuals} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 2px", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>これまでの日報</h3>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="氏名で絞り込み…" style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 10px", borderRadius: 99, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
          <span className="muted" style={{ fontSize: 11 }}>{filtered.length} 件</span>
        </span>
      </div>
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 30 }}>まだ日報がありません。</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
          {filtered.map((r) => <ReportCard key={r.id} r={r} />)}
        </div>
      )}
    </>
  );
}
