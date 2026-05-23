"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReport, coachReport } from "@/app/reports/actions";
import type { Actuals, DailyReport } from "@/lib/daily-report";

const TEAMS = ["営業", "バックオフィス", "開発", "EC", "サポート", "その他"];
// チーム別「やったこと」プリセット
const DID_BY_TEAM: Record<string, string[]> = {
  営業: ["新規提案", "打合せ実施", "商談獲得", "提案先フォロー", "延長確認", "資料送付", "マッチング確認", "エンド開拓", "架電"],
  バックオフィス: ["請求書発行", "勤怠チェック", "契約書回収", "入金確認", "データ入力", "問い合わせ対応", "書類作成", "経費処理"],
  開発: ["実装", "コードレビュー", "バグ修正", "設計", "リリース", "調査・検証", "MTG", "ドキュメント"],
  EC: ["商品登録", "受注処理", "在庫管理", "発送手配", "問い合わせ対応", "広告運用", "サイト更新", "売上分析"],
  サポート: ["問い合わせ対応", "クレーム対応", "FAQ更新", "エスカレーション", "フォロー連絡", "マニュアル整備"],
  その他: ["資料作成", "MTG", "調査", "対応", "連絡", "改善活動"],
};
const NEXT = ["フォロー連絡", "資料作成", "MTG設定", "課題対応", "改善着手", "確認・検証"];
const MOODS = ["😀手応えあり", "😐普通", "😟苦戦"];
const TARGET_PROPOSALS = 3; // 営業：1日の新規提案 目安

const inp = { fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%" } as const;
const L = ({ c }: { c: string }) => <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 4 }}>{c}</div>;

function Chips({ all, sel, onToggle, color = "var(--color-brand-600)" }: { all: string[]; sel: string[]; onToggle: (v: string) => void; color?: string }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {all.map((o) => { const on = sel.includes(o); return <button key={o} type="button" onClick={() => onToggle(o)} className="tag" style={{ cursor: "pointer", fontSize: 11.5, background: on ? color : "var(--color-surface-inset)", color: on ? "#fff" : "var(--color-ink-3)", border: 0 }}>{o}</button>; })}
    </div>
  );
}

function Stat({ label, value, target, ok }: { label: string; value: number; target?: number; ok?: boolean }) {
  const reached = target == null ? true : value >= target;
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "8px 12px", minWidth: 92 }}>
      <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 600 }}>{label}{target != null ? `（目標${target}）` : ""}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: target == null ? "var(--color-ink)" : reached ? "#067647" : "#b45309" }}>{value}{target != null && !reached && <span style={{ fontSize: 11, marginLeft: 4 }}>未達</span>}</div>
    </div>
  );
}

function ReportForm({ author, today, actuals, defaultTeam }: { author: string; today: string; actuals: Actuals; defaultTeam: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [team, setTeam] = useState(defaultTeam);
  const [did, setDid] = useState<string[]>([]);
  const [nexts, setNexts] = useState<string[]>([]);
  const [f, setF] = useState({ did_note: "", learned: "", next_note: "", mood: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const didPresets = DID_BY_TEAM[team] ?? DID_BY_TEAM["その他"];

  const submit = () => {
    if (!f.learned.trim()) { setMsg("「気づき」は必須です（短くてOK）"); return; }
    const next_action = [nexts.join("、"), f.next_note.trim()].filter(Boolean).join(" / ");
    start(async () => {
      const r = await saveReport({ author, team, report_date: today, did, did_note: f.did_note, learned: f.learned, next_action, mood: f.mood, metrics: team === "営業" ? actuals : null });
      setMsg(r.ok ? "✓ 日報を保存しました" : `エラー：${r.error}`);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <b style={{ fontSize: 15 }}>📝 {today} の日報（{author || "担当者未設定"}）</b>
      </div>

      {/* チーム選択 */}
      <div><L c="チーム" /><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{TEAMS.map((t) => <button key={t} type="button" onClick={() => setTeam(t)} style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", padding: "6px 12px", borderRadius: 99, border: `1px solid ${team === t ? "var(--color-brand-600)" : "var(--color-border)"}`, background: team === t ? "var(--color-brand-50)" : "var(--color-surface)", color: team === t ? "var(--color-brand-700)" : "var(--color-ink-3)" }}>{t}</button>)}</div></div>

      {/* 自動実績（営業のみ・入力不要） */}
      {team === "営業" && (
        <div>
          <L c="今日の実績（自動集計）" />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Stat label="新規提案" value={actuals.proposalsToday} target={TARGET_PROPOSALS} />
            <Stat label="打合せ" value={actuals.meetingsToday} />
            <Stat label="進行中提案" value={actuals.activeProps} />
            <Stat label="今週の面談" value={actuals.meetingsWeek} />
          </div>
        </div>
      )}

      <div><L c="やったこと（タップ）" /><Chips all={didPresets} sel={did} onToggle={(v) => toggle(did, setDid, v)} /><input style={{ ...inp, marginTop: 6 }} value={f.did_note} onChange={(e) => setF({ ...f, did_note: e.target.value })} placeholder="補足があれば一言（任意）" /></div>

      <div><L c="気づき（必須）— うまくいった点 / 詰まった点 / なぜ？" /><textarea style={{ ...inp, resize: "vertical" }} rows={3} value={f.learned} onChange={(e) => setF({ ...f, learned: e.target.value })} placeholder="例）提案は出せたが面談化しない。単価提示のタイミングが遅い気がする…" /></div>

      <div><L c="明日の一手（必須）" /><Chips all={NEXT} sel={nexts} onToggle={(v) => toggle(nexts, setNexts, v)} color="#0b5cab" /><input style={{ ...inp, marginTop: 6 }} value={f.next_note} onChange={(e) => setF({ ...f, next_note: e.target.value })} placeholder="具体的に（任意）" /></div>

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
  const coach = () => start(async () => { await coachReport(r.id); router.refresh(); });
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <b style={{ fontSize: 13.5 }}>{r.author}</b>
          {r.team && <span className="tag" style={{ fontSize: 10 }}>{r.team}</span>}
        </span>
        <span className="muted mono" style={{ fontSize: 11 }}>{r.report_date} {r.mood ?? ""}</span>
      </div>
      {r.metrics && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--color-ink-3)" }}>
          <span>提案 <b style={{ color: "var(--color-ink)" }}>{m.proposalsToday ?? "—"}</b></span>
          <span>打合せ <b style={{ color: "var(--color-ink)" }}>{m.meetingsToday ?? "—"}</b></span>
          <span>進行中 <b style={{ color: "var(--color-ink)" }}>{m.activeProps ?? "—"}</b></span>
          <span>今週面談 <b style={{ color: "var(--color-ink)" }}>{m.meetingsWeek ?? "—"}</b></span>
        </div>
      )}
      {r.did?.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{r.did.map((d) => <span key={d} className="tag" style={{ fontSize: 10 }}>{d}</span>)}</div>}
      {r.learned && <div style={{ fontSize: 12.5, color: "var(--color-ink-2)" }}>💡 {r.learned}</div>}
      {r.next_action && <div style={{ fontSize: 12, color: "var(--color-brand-700, #0b5cab)" }}>▶ 次：{r.next_action}</div>}
      {r.ai_comment ? (
        <div style={{ fontSize: 12, color: "var(--color-ink-2)", background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 8, padding: "8px 10px", whiteSpace: "pre-wrap" }}>🤖 {r.ai_comment}</div>
      ) : (
        <button className="btn ghost btn-xs" disabled={pending} onClick={coach} style={{ alignSelf: "flex-start" }}>{pending ? "生成中…" : "🤖 AIから一言（任意）"}</button>
      )}
    </div>
  );
}

export function ReportsClient({ author, today, actuals, reports, defaultTeam = "営業" }: { author: string; today: string; actuals: Actuals; reports: DailyReport[]; defaultTeam?: string }) {
  const [teamFilter, setTeamFilter] = useState("");
  const todays = reports.find((r) => r.author === author && r.report_date === today);
  const teamsInData = [...new Set(reports.map((r) => r.team).filter(Boolean))] as string[];
  const filtered = teamFilter ? reports.filter((r) => r.team === teamFilter) : reports;
  const sel = { fontFamily: "inherit", fontSize: 12, padding: "6px 10px", borderRadius: 99, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" } as const;
  return (
    <>
      {todays ? (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>
          ✓ 本日（{today}）の日報は提出済みです。下の一覧から確認・AIコメント取得ができます。<br />
          <span className="muted" style={{ fontSize: 11.5 }}>※ もう一度フォームから保存すると上書き更新されます。</span>
        </div>
      ) : null}
      <ReportForm author={author} today={today} actuals={actuals} defaultTeam={defaultTeam} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 2px", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>これまでの日報</h3>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {teamsInData.length > 0 && (
            <select style={sel} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="">全チーム</option>
              {teamsInData.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
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
