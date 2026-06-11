"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReport, coachReport, sendReportFeedback, draftReportMessage, sendReportMessage, markReportReviewed } from "@/app/reports/actions";
import type { Actuals, DailyReport } from "@/lib/daily-report";

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
      setMsg(r.ok ? "✓ 日報を保存しました（AIからの一言が「お知らせ」に届きます）" : `エラー：${r.error}`);
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

function ReportCard({ r, canReply }: { r: DailyReport; canReply?: boolean }) {
  const isAdmin = canReply; // 返信UI（バッジ・返信欄）の表示可否。管理者＝マネージャー/リーダーも返信可。
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msgText, setMsgText] = useState("");
  const [msgBusy, setMsgBusy] = useState<"draft" | "send" | null>(null);
  const [msgInfo, setMsgInfo] = useState<{ ok: boolean; text: string } | null>(null);
  const m = r.metrics ?? {};
  const sc = r.self_check ?? {};
  const coach = () => start(async () => { await coachReport(r.id); router.refresh(); });
  const draftMessage = async () => {
    setMsgBusy("draft"); setMsgInfo(null);
    const res = await draftReportMessage(r.id);
    setMsgBusy(null);
    if (res.ok && res.text) { setMsgText(res.text); setMsgInfo({ ok: true, text: "AI下書きを生成しました（編集してから送信できます）" }); }
    else setMsgInfo({ ok: false, text: res.error || "生成に失敗しました" });
  };
  const sendMessage = async () => {
    if (!msgText.trim()) { setMsgInfo({ ok: false, text: "メッセージが空です" }); return; }
    setMsgBusy("send"); setMsgInfo(null);
    const res = await sendReportMessage(r.id, msgText);
    setMsgBusy(null);
    if (res.ok) { setMsgInfo({ ok: true, text: `✓ ${r.author}さんへ送信しました（お知らせに届きました）` }); setMsgText(""); router.refresh(); }
    else setMsgInfo({ ok: false, text: res.error || "送信に失敗しました" });
  };
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <b style={{ fontSize: 13.5 }}>{r.author}</b>
          {isAdmin && (r.replied_at
            ? <span title={`${r.replied_by ?? "管理者"} が ${new Date(r.replied_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} に返信済`} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#e7f7ee", color: "#067647", border: "1px solid #bfe3cc", whiteSpace: "nowrap" }}>✓ 管理者返信済</span>
            : r.ai_replied_at
              ? <span title={`提出時にAIが自動で一言を送信済（${new Date(r.ai_replied_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）。必要なら下から個別メッセージを追送できます。`} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "var(--color-brand-25)", color: "var(--color-brand-700)", border: "1px solid var(--color-brand-100)", whiteSpace: "nowrap" }}>🤖 AI返信済</span>
              : <span title="まだ返信がありません" style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#fff6e0", color: "#9a7b12", border: "1px solid #fde9b0", whiteSpace: "nowrap" }}>未返信</span>
          )}
        </div>
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
        <button className="btn ghost btn-xs" disabled={pending} onClick={coach} style={{ alignSelf: "flex-start" }} title="AIがこの日報への所感を生成し、このカードにメモ表示します（本人には届きません）">{pending ? "生成中…" : "🤖 AIから一言（メモ・本人には届きません）"}</button>
      )}

      {isAdmin && (
        <div style={{ borderTop: "1px dashed var(--color-border)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          {/* 既に送った返信があれば表示（誰がいつ何を送ったか） */}
          {r.replied_at && r.reply_text && (
            <div style={{ fontSize: 12, color: "var(--color-ink-2)", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10.5, color: "#067647", fontWeight: 700, marginBottom: 3 }}>✓ 送信済み（{r.replied_by ?? "管理者"} · {new Date(r.replied_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{r.reply_text}</div>
            </div>
          )}
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-3)" }}>💬 {r.author}さんへ個別メッセージ{r.replied_at ? "（再送・追記）" : ""}</div>
          <textarea
            value={msgText}
            onChange={(e) => setMsgText(e.target.value)}
            placeholder="メッセージを直接入力。または「✨ AIで下書き」→編集→「送信」で本人のお知らせに届きます"
            rows={3}
            style={{ fontSize: 12.5, padding: 8, border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface)", resize: "vertical", fontFamily: "var(--font-sans)" }}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn ghost btn-xs" disabled={!!msgBusy} onClick={draftMessage} title="AIが下書きを作成します。この時点では送信されません（編集できます）">{msgBusy === "draft" ? "生成中…" : "✨ AIで下書き"}</button>
            <button type="button" className="btn brand btn-xs" disabled={!!msgBusy || !msgText.trim()} onClick={sendMessage} title="本人の「お知らせ」に通知が届きます">{msgBusy === "send" ? "送信中…" : "📨 本人へ送信"}</button>
            {msgInfo && <span style={{ fontSize: 11, color: msgInfo.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msgInfo.text}</span>}
          </div>
          <div className="muted" style={{ fontSize: 10 }}>
            ℹ 日報提出時に <b>AIの一言が自動で本人に届きます</b>（🤖 AI返信済）。ここからは <b>管理者個人のコメントを追送</b>できます。✨ AIで下書き＝下書きのみ（未送信）／📨 本人へ送信＝相手のお知らせに反映。
          </div>
        </div>
      )}
    </div>
  );
}

/** 管理者向け：誰がいつ提出したか + 返信状況の提出カレンダー（直近14日）。 */
function SubmissionCalendar({ members, reports, today }: { members: string[]; reports: DailyReport[]; today: string }) {
  const DAYS = 14;
  const days: string[] = [];
  const base = new Date(today + "T00:00:00");
  for (let i = DAYS - 1; i >= 0; i--) { const d = new Date(base); d.setDate(base.getDate() - i); days.push(d.toISOString().slice(0, 10)); }
  // (author|date) → 提出・返信状況
  type Cell = { submitted: boolean; admin: boolean; ai: boolean };
  const cellMap = new Map<string, Cell>();
  for (const r of reports) {
    cellMap.set(`${r.author}|${r.report_date}`, {
      submitted: true,
      admin: !!r.replied_at,
      ai: !r.replied_at && !!r.ai_replied_at, // 管理者返信があれば AI フラグは出さない（最終状態を1つで表現）
    });
  }
  const getCell = (n: string, d: string): Cell => cellMap.get(`${n}|${d}`) ?? { submitted: false, admin: false, ai: false };
  // メンバー：staff名 ∪ 日報の著者
  const names = Array.from(new Set([...members, ...reports.map((r) => r.author)].filter(Boolean)));
  const todaySubmitted = names.filter((n) => getCell(n, today).submitted).length;
  // 直近14日の未返信件数（提出はされたが管理者/AIどちらの返信もなし）
  const pendingReplies = days.reduce((acc, d) => acc + names.filter((n) => { const c = getCell(n, d); return c.submitted && !c.admin && !c.ai; }).length, 0);
  const wd = ["日", "月", "火", "水", "木", "金", "土"];
  const dlabel = (d: string) => { const dt = new Date(d + "T00:00:00"); return { md: `${dt.getMonth() + 1}/${dt.getDate()}`, w: wd[dt.getDay()], we: dt.getDay() === 0 || dt.getDay() === 6 }; };
  const rate = (n: string) => days.filter((d) => getCell(n, d).submitted).length;
  const repliedRate = (n: string) => days.filter((d) => { const c = getCell(n, d); return c.submitted && (c.admin || c.ai); }).length;

  // セル表示：提出 + 返信状況を1セルで表現
  const renderCell = (n: string, d: string) => {
    const c = getCell(n, d);
    const l = dlabel(d);
    const baseStyle: React.CSSProperties = {
      padding: "5px 6px", textAlign: "center", borderTop: "1px solid var(--color-border)",
      background: d === today ? "var(--color-brand-25)" : l.we ? "var(--color-surface-soft)" : undefined,
      whiteSpace: "nowrap",
    };
    if (!c.submitted) return <td key={d} style={baseStyle}><span style={{ color: "var(--color-ink-5)" }}>・</span></td>;
    if (c.admin) return <td key={d} style={baseStyle} title="提出済 + 管理者から返信済"><span style={{ color: "#067647", fontWeight: 800 }}>✓<sup style={{ fontSize: 9, marginLeft: 1 }}>💬</sup></span></td>;
    if (c.ai)    return <td key={d} style={baseStyle} title="提出済 + AIから自動返信済"><span style={{ color: "var(--color-brand-700)", fontWeight: 800 }}>✓<sup style={{ fontSize: 9, marginLeft: 1 }}>🤖</sup></span></td>;
    return <td key={d} style={baseStyle} title="提出済（返信なし）"><span style={{ color: "#9a7b12", fontWeight: 800 }}>✓</span></td>;
  };

  // 折りたたみ。デフォルトは閉。未提出/未返信があるときだけ「展開」ボタンを目立たせる。
  const [openCal, setOpenCal] = useState(false);
  return (
    <div className="card" style={{ marginBottom: 12, padding: openCal ? undefined : "10px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: openCal ? 10 : 0 }}>
        <button type="button" onClick={() => setOpenCal((v) => !v)}
          title={openCal ? "閉じる" : "開く"}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: 0, border: 0, background: "transparent", cursor: "pointer", fontFamily: "inherit" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-ink-4)", transition: "transform .15s", transform: openCal ? "rotate(90deg)" : "none", fontSize: 20 }}>chevron_right</span>
          <span className="material-symbols-outlined" style={{ color: "var(--color-brand-700)" }}>calendar_month</span>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>日報 提出カレンダー</h3>
        </button>
        <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: todaySubmitted >= names.length && names.length ? "#dcfce7" : "#fef3c7", color: todaySubmitted >= names.length && names.length ? "#166534" : "#92400e" }}>本日 {todaySubmitted}/{names.length} 名 提出</span>
        {pendingReplies > 0 && (
          <span title="返信していない日報の件数（直近14日）" style={{ fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: "#fff6e0", color: "#9a7b12", border: "1px solid #fde9b0" }}>未返信 {pendingReplies}</span>
        )}
        <span className="muted" style={{ fontSize: 11, marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span><span style={{ color: "#067647", fontWeight: 800 }}>✓<sup style={{ fontSize: 8 }}>💬</sup></span> 管理者返信</span>
          {openCal && <>
            <span><span style={{ color: "var(--color-brand-700)", fontWeight: 800 }}>✓<sup style={{ fontSize: 8 }}>🤖</sup></span> AI返信のみ</span>
            <span><span style={{ color: "#9a7b12", fontWeight: 800 }}>✓</span> 提出のみ・未返信</span>
            <span><span style={{ color: "var(--color-ink-5)" }}>・</span> 未提出</span>
          </>}
        </span>
      </div>
      {openCal && (names.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>対象メンバーがいません。設定→担当者マスタで登録してください。</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 600 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 10px", position: "sticky", left: 0, background: "var(--color-surface)", zIndex: 1 }}>メンバー</th>
                {days.map((d) => { const l = dlabel(d); return <th key={d} style={{ padding: "4px 6px", textAlign: "center", color: d === today ? "var(--color-brand-700)" : l.we ? "var(--color-ink-4)" : "var(--color-ink-3)", fontWeight: d === today ? 800 : 600, whiteSpace: "nowrap" }}>{l.md}<br /><span style={{ fontSize: 9 }}>{l.w}</span></th>; })}
                <th style={{ padding: "4px 8px", textAlign: "center" }} title="提出 / 返信済">提出 / 返信</th>
              </tr>
            </thead>
            <tbody>
              {names.map((n) => (
                <tr key={n}>
                  <td style={{ padding: "6px 10px", fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--color-surface)", borderTop: "1px solid var(--color-border)" }}>{n}</td>
                  {days.map((d) => renderCell(n, d))}
                  <td style={{ padding: "5px 8px", textAlign: "center", borderTop: "1px solid var(--color-border)", fontWeight: 700, color: "var(--color-ink-2)", whiteSpace: "nowrap" }}>
                    {rate(n)}<span style={{ color: "var(--color-ink-5)", margin: "0 2px" }}>/</span><span style={{ color: rate(n) > 0 && repliedRate(n) === rate(n) ? "#067647" : "var(--color-ink-3)" }}>{repliedRate(n)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function ReportsClient({ author, today, actuals, reports, isAdmin = false, canReply = false, members = [], reviewKind = null }: { author: string; today: string; actuals: Actuals; reports: DailyReport[]; isAdmin?: boolean; canReply?: boolean; members?: string[]; reviewKind?: "admin" | "manager" | null }) {
  const todays = reports.find((r) => r.author === author && r.report_date === today);
  const canManage = isAdmin || canReply; // 提出カレンダー＋返信UI を出す
  return (
    <>
      {canManage && (
        <SubmissionCalendar members={members} reports={reports} today={today} />
      )}
      {/* 自分の日報は誰でも提出できる（管理者・経営・マネージャー含む）。
          以前は閲覧スコープ=全体（isAdmin）だと入力フォームが消え、
          経営/マネージャーが自分の日報を書けない問題があったため、氏名があれば常時表示に変更。 */}
      {author && (
        <>
          {todays ? (
            <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>
              ✓ 本日（{today}）の日報は提出済みです。もう一度フォームから保存すると上書き更新されます。
            </div>
          ) : null}
          <ReportForm author={author} today={today} actuals={actuals} />
        </>
      )}

      <ReportArchive reports={reports} author={author} canManage={canManage} reviewKind={reviewKind} />
    </>
  );
}

/** 「これまでの日報」一覧。
 *   - 管理者/マネージャー：担当者ごとにアコーディオンで折りたたみ。未返信のある人は自動で開く。
 *   - 本人のみ：月ごとにアコーディオン。今月を自動で開く。
 *   - 「未返信のみ」トグル・氏名絞り込みつき。
 */
function ReportArchive({ reports, author, canManage, reviewKind = null }: { reports: DailyReport[]; author: string; canManage: boolean; reviewKind?: "admin" | "manager" | null }) {
  const [q, setQ] = useState("");
  const [onlyUnreplied, setOnlyUnreplied] = useState(false);
  // 役割別チェック（管理者/マネージャー）のための optimistic ローカル状態
  const [reviewedExtra, setReviewedExtra] = useState<Set<string>>(new Set()); // 自分が今チェックしたID
  const [unreviewedExtra, setUnreviewedExtra] = useState<Set<string>>(new Set()); // チェック解除したID
  // 未確認のみ表示するか（管理者/マネージャー向け既定 true）。
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(true);
  const isReviewed = (r: DailyReport) => {
    if (!reviewKind) return false;
    if (reviewedExtra.has(r.id)) return true;
    if (unreviewedExtra.has(r.id)) return false;
    return reviewKind === "admin" ? !!r.reviewed_by_admin_at : !!r.reviewed_by_manager_at;
  };
  const toggleReviewed = async (r: DailyReport) => {
    if (!reviewKind) return;
    const currentlyReviewed = isReviewed(r);
    // optimistic
    if (currentlyReviewed) {
      setReviewedExtra((s) => { const n = new Set(s); n.delete(r.id); return n; });
      setUnreviewedExtra((s) => { const n = new Set(s); n.add(r.id); return n; });
    } else {
      setUnreviewedExtra((s) => { const n = new Set(s); n.delete(r.id); return n; });
      setReviewedExtra((s) => { const n = new Set(s); n.add(r.id); return n; });
    }
    const res = await markReportReviewed(r.id, reviewKind, currentlyReviewed);
    if (!res.ok) {
      // 失敗したら元に戻す
      if (currentlyReviewed) {
        setUnreviewedExtra((s) => { const n = new Set(s); n.delete(r.id); return n; });
        setReviewedExtra((s) => { const n = new Set(s); n.add(r.id); return n; });
      } else {
        setReviewedExtra((s) => { const n = new Set(s); n.delete(r.id); return n; });
        setUnreviewedExtra((s) => { const n = new Set(s); n.add(r.id); return n; });
      }
      alert(res.error ?? "更新に失敗しました");
    }
  };
  // 担当者ごとの AI週次/月次講評ボタンの状態
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiMsg, setAiMsg] = useState<{ author: string; ok: boolean; text: string } | null>(null);
  const sendAi = async (a: string, period: "week" | "month") => {
    setAiBusy(`${a}|${period}`); setAiMsg(null);
    const r = await sendReportFeedback(a, period);
    setAiBusy(null);
    setAiMsg({ author: a, ok: !!r.ok, text: r.ok ? `✓ ${a}さんへ${period === "month" ? "月次" : "週次"}AI講評を送信しました` : `エラー：${r.error ?? "送信失敗"}` });
  };

  const needsReply = (r: DailyReport) => !r.replied_at; // 管理者本人が返信していないもの＝「まだ見ていない」
  const base = q.trim() ? reports.filter((r) => (r.author ?? "").includes(q.trim())) : reports;
  const filtered = onlyUnreplied && canManage ? base.filter(needsReply) : base;

  // グルーピング
  const groups = new Map<string, { key: string; label: string; sub: string; items: DailyReport[]; unreplied: number; latest: string }>();
  const monthLabel = (d: string) => { const dt = new Date(d + "T00:00:00"); return `${dt.getFullYear()}年${dt.getMonth() + 1}月`; };
  for (const r of filtered) {
    const key = canManage ? (r.author || "（未設定）") : (r.report_date?.slice(0, 7) || "----");
    const g = groups.get(key) ?? { key, label: canManage ? key : monthLabel(r.report_date), sub: "", items: [], unreplied: 0, latest: "" };
    g.items.push(r);
    if (needsReply(r)) g.unreplied++;
    if (r.report_date > g.latest) g.latest = r.report_date;
    groups.set(key, g);
  }
  const groupList = [...groups.values()].sort((a, b) => (canManage ? (b.unreplied - a.unreplied) || b.latest.localeCompare(a.latest) : b.key.localeCompare(a.key)));

  // 開閉状態。未指定の場合のデフォルト：管理者=未返信のある人を開く / 本人=最新グループを開く
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (g: { key: string; unreplied: number }, idx: number) =>
    open[g.key] ?? (canManage ? g.unreplied > 0 : idx === 0);
  const toggle = (k: string, cur: boolean) => setOpen((o) => ({ ...o, [k]: !cur }));
  const setAll = (v: boolean) => setOpen(Object.fromEntries(groupList.map((g) => [g.key, v])));

  const totalUnreplied = base.filter(needsReply).length;

  // ===== 管理者/マネージャー向け：新着順フラットリスト＋『確認した』チェック =====
  if (reviewKind) {
    const flat = (q.trim() ? reports.filter((r) => (r.author ?? "").includes(q.trim())) : reports)
      .slice() // 元配列保護
      .sort((a, b) => String(b.created_at ?? b.report_date ?? "").localeCompare(String(a.created_at ?? a.report_date ?? "")));
    const visible = onlyUnreviewed ? flat.filter((r) => !isReviewed(r)) : flat;
    const unreviewedCount = flat.filter((r) => !isReviewed(r)).length;
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 2px", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
            {reviewKind === "admin" ? "📓 日報チェック（全員・新着順）" : "📓 日報チェック（部署メンバー・新着順）"}
            <span className="muted" style={{ fontSize: 11.5, fontWeight: 500, marginLeft: 8 }}>
              未確認 <b style={{ color: unreviewedCount > 0 ? "#b42318" : "#067647" }}>{unreviewedCount}</b> / {flat.length}件
            </span>
          </h3>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setOnlyUnreviewed((v) => !v)}
              title={onlyUnreviewed ? "確認済みも表示" : "未確認のみ表示"}
              style={{
                cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 99,
                border: `1px solid ${onlyUnreviewed ? "#d97706" : "var(--color-border-strong)"}`,
                background: onlyUnreviewed ? "#fff6e0" : "var(--color-surface)",
                color: onlyUnreviewed ? "#92400e" : "var(--color-ink-2)",
              }}>
              {onlyUnreviewed ? "● 未確認のみ" : "○ 確認済みも表示"}
            </button>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="氏名で絞り込み…"
              style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 10px", borderRadius: 99, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
          </span>
        </div>

        {visible.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 30 }}>
            {onlyUnreviewed ? "未確認の日報はありません 🎉" : "日報がありません。"}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
            {visible.map((r) => (
              <ReviewableReportCard key={r.id} r={r} canReply={canManage} reviewKind={reviewKind} reviewed={isReviewed(r)} onToggleReviewed={() => toggleReviewed(r)} />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 2px", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>これまでの日報</h3>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {canManage && (
            <button type="button" onClick={() => setOnlyUnreplied((v) => !v)} title="あなたがまだ返信していない日報だけを表示"
              style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 99,
                border: `1px solid ${onlyUnreplied ? "#d97706" : "var(--color-border-strong)"}`,
                background: onlyUnreplied ? "#fff6e0" : "var(--color-surface)", color: onlyUnreplied ? "#92400e" : "var(--color-ink-2)" }}>
              {onlyUnreplied ? "● " : "○ "}未返信のみ{totalUnreplied > 0 && <span style={{ marginLeft: 4 }}>({totalUnreplied})</span>}
            </button>
          )}
          {groupList.length > 1 && (
            <span style={{ display: "inline-flex", gap: 4 }}>
              <button type="button" className="btn ghost btn-xs" onClick={() => setAll(true)}>すべて開く</button>
              <button type="button" className="btn ghost btn-xs" onClick={() => setAll(false)}>すべて閉じる</button>
            </span>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="氏名で絞り込み…" style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 10px", borderRadius: 99, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
          <span className="muted" style={{ fontSize: 11 }}>{filtered.length} 件</span>
        </span>
      </div>

      {groupList.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 30 }}>
          {onlyUnreplied ? "未返信の日報はありません 🎉" : "まだ日報がありません。"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groupList.map((g, idx) => {
            const o = isOpen(g, idx);
            return (
              <div key={g.key} className="card" style={{ padding: 0, overflow: "hidden" }}>
                <button type="button" onClick={() => toggle(g.key, o)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: o ? "var(--color-surface-soft)" : "var(--color-surface)", border: 0, borderBottom: o ? "1px solid var(--color-border)" : 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--color-ink-4)", transition: "transform .15s", transform: o ? "rotate(90deg)" : "none" }}>chevron_right</span>
                  <b style={{ fontSize: 13.5 }}>{g.label}</b>
                  <span className="muted" style={{ fontSize: 11 }}>{g.items.length}件{!canManage ? "" : ` ・ 最新 ${g.latest}`}</span>
                  {canManage && g.unreplied > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: "#fff6e0", color: "#92400e", border: "1px solid #fde9b0" }}>未返信 {g.unreplied}</span>
                  )}
                  {canManage && g.unreplied === 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: "#e7f7ee", color: "#067647", border: "1px solid #bfe3cc" }}>✓ 返信済</span>
                  )}
                </button>
                {o && (
                  <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                    {canManage && (
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)" }}>
                        <span style={{ fontSize: 11.5, color: "var(--color-ink-3)", fontWeight: 700 }}>🧑‍🏫 AI講評を {g.label} さんへ送る：</span>
                        <button type="button" className="btn ghost btn-xs" disabled={aiBusy === `${g.key}|week`} onClick={() => sendAi(g.key, "week")}>
                          {aiBusy === `${g.key}|week` ? "生成中…" : "📨 週次"}
                        </button>
                        <button type="button" className="btn ghost btn-xs" disabled={aiBusy === `${g.key}|month`} onClick={() => sendAi(g.key, "month")}>
                          {aiBusy === `${g.key}|month` ? "生成中…" : "📨 月次"}
                        </button>
                        {aiMsg?.author === g.key && <span style={{ fontSize: 11, color: aiMsg.ok ? "#067647" : "#b42318" }}>{aiMsg.text}</span>}
                        <span className="muted" style={{ fontSize: 10, marginLeft: "auto" }}>承認＋改善点＋次のfocus を本人の「お知らせ」に送信</span>
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
                      {g.items.sort((a, b) => b.report_date.localeCompare(a.report_date)).map((r) => <ReportCard key={r.id} r={r} canReply={canManage} />)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// 管理者/マネージャー向け：『確認した』チェック付き日報カード。
//   - 既存の ReportCard を内包し、上部に投稿者・投稿日時・チェックボタンを追加。
//   - チェック済みは画面上から消える（onlyUnreviewed=true 時）。
function ReviewableReportCard({ r, canReply, reviewKind, reviewed, onToggleReviewed }:
  { r: DailyReport; canReply: boolean; reviewKind: "admin" | "manager"; reviewed: boolean; onToggleReviewed: () => void }) {
  const ts = r.created_at ? new Date(r.created_at) : null;
  const tsStr = ts && !isNaN(ts.getTime())
    ? `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}`
    : r.report_date;
  const reviewerAt = reviewKind === "admin" ? r.reviewed_by_admin_at : r.reviewed_by_manager_at;
  const reviewerName = reviewKind === "admin" ? r.reviewed_by_admin_name : r.reviewed_by_manager_name;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, border: "1px solid var(--color-border)", borderRadius: 10, background: reviewed ? "var(--color-surface-soft)" : "var(--color-surface)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <b style={{ fontSize: 12.5 }}>{r.author}</b>
          <span className="muted mono" style={{ fontSize: 10.5 }}>{tsStr}</span>
          {r.mood && <span style={{ fontSize: 11 }}>{r.mood}</span>}
        </div>
        <button type="button" onClick={onToggleReviewed}
          title={reviewed ? `${reviewerName ?? ""} ${reviewerAt ? `(${new Date(reviewerAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })})` : ""} ・ 取り消して未確認に戻す` : "確認したらクリック（リストから消えます）"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 11, fontWeight: 800, padding: "4px 10px", borderRadius: 99, cursor: "pointer", fontFamily: "inherit",
            background: reviewed ? "#e7f7ee" : "var(--color-brand-25)",
            color: reviewed ? "#067647" : "var(--color-brand-700)",
            border: `1px solid ${reviewed ? "#bfe3cc" : "var(--color-brand-100)"}`,
          }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>{reviewed ? "check_circle" : "check_circle_outline"}</span>
          {reviewed ? "確認済み（取消）" : "確認した"}
        </button>
      </div>
      <ReportCard r={r} canReply={canReply} />
    </div>
  );
}
