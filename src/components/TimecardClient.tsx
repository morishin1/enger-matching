"use client";

// タイムカード本体。
//   ・上段：今日の打刻（出勤/退勤）＋当月サマリ＋月締申請
//   ・本人タブ：月カレンダー（予定=薄/実績=濃、申請中/承認/差戻アイコン）。セルクリックで編集モーダル
//   ・承認タブ（マネージャー/admin）：自部署の submitted を一覧、まとめて承認/差戻し

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  type TimeEntry, summarizeMonth, laborMinutesOf, plannedMinutesOf,
  fmtHm, fmtHmJst, monthRange, lastDayOf, deviatesFromShift,
} from "@/lib/timecard";
import {
  clockIn, clockOut, upsertTimeEntry, submitMonthForApproval,
  approveTimeEntries, rejectTimeEntries,
  submitShiftForApproval, approveShifts, rejectShifts,
} from "@/lib/actions/timecard";

type Me = { email: string; name: string; isAdmin: boolean; isManager: boolean; isTimecardUser: boolean };

const WD = ["日", "月", "火", "水", "木", "金", "土"];

const STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  open:      { bg: "#eef2ff", fg: "#3730a3", label: "下書き" },
  submitted: { bg: "#fff6e0", fg: "#9a7b12", label: "申請中" },
  approved:  { bg: "#e7f7ee", fg: "#067647", label: "承認済" },
  rejected:  { bg: "#fdecef", fg: "#b42318", label: "差戻し" },
};

// "YYYY-MM-DDTHH:MM"（datetime-local 用）を JST で組み立てる。work_date と時刻 "HH:MM" から ISO に。
function toIso(workDate: string, hm: string): string | null {
  if (!hm) return null;
  // JST(+09:00) として解釈
  const dt = new Date(`${workDate}T${hm}:00+09:00`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

export function TimecardClient({ me, ym, myEntries, approvalQueue, shiftQueue = [] }: {
  me: Me; ym: string; myEntries: TimeEntry[]; approvalQueue: TimeEntry[]; shiftQueue?: TimeEntry[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canApprove = me.isAdmin || me.isManager;
  const [tab, setTab] = useState<"self" | "shift" | "approve">(me.isTimecardUser ? "self" : "approve");

  const entryByDate = useMemo(() => {
    const m = new Map<string, TimeEntry>();
    for (const e of myEntries) m.set(e.work_date, e);
    return m;
  }, [myEntries]);

  const summary = useMemo(() => summarizeMonth(myEntries), [myEntries]);

  // 今日（JST）
  const todayJst = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const todayEntry = entryByDate.get(todayJst);
  const isThisMonth = ym === todayJst.slice(0, 7);

  const setYm = (next: string) => router.push(`/timecard?ym=${next}`);
  const shiftMonth = (delta: number) => {
    const [y, mo] = ym.split("-").map(Number);
    const d = new Date(y, mo - 1 + delta, 1);
    setYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const run = (fn: () => Promise<any>, okText: string) => {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (res?.ok) { setMsg({ ok: true, text: res.count != null ? `${okText}（${res.count}件）` : okText }); router.refresh(); }
      else setMsg({ ok: false, text: res?.error || "失敗しました" });
    });
  };

  // 編集モーダル
  const [editDate, setEditDate] = useState<string | null>(null);

  return (
    <>
      {/* 今日の打刻 + サマリ */}
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div className="meta" style={{ fontSize: 11 }}>今日（{todayJst}）</div>
            <div style={{ fontSize: 13, color: "var(--color-ink-2)" }}>
              {todayEntry?.actual_start ? <>出勤 <b>{fmtHmJst(todayEntry.actual_start)}</b></> : "未出勤"}
              {todayEntry?.actual_end ? <> ／ 退勤 <b>{fmtHmJst(todayEntry.actual_end)}</b></> : ""}
              {todayEntry && laborMinutesOf(todayEntry) > 0 ? <span style={{ marginLeft: 8, color: "var(--color-brand-700)", fontWeight: 700 }}>実働 {fmtHm(laborMinutesOf(todayEntry))}</span> : null}
            </div>
          </div>
          {me.isTimecardUser && isThisMonth && (
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn brand tc-clock-btn" disabled={pending || !!todayEntry?.actual_start}
                onClick={() => run(() => clockIn(), "出勤しました")}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: "-3px" }}>login</span> 出勤
              </button>
              <button className="btn tc-clock-btn" disabled={pending || !todayEntry?.actual_start || !!todayEntry?.actual_end}
                onClick={() => run(() => clockOut(), "退勤しました")}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: "-3px" }}>logout</span> 退勤
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <Stat label="実働日数" value={`${summary.days}日`} />
          <Stat label="実働合計" value={fmtHm(summary.laborMinutes)} tone="#067647" />
          <Stat label="予定合計" value={fmtHm(summary.plannedMinutes)} tone="#0b5cab" />
          {summary.pendingApproval > 0 && <Stat label="申請中" value={`${summary.pendingApproval}件`} tone="#9a7b12" />}
          {summary.rejected > 0 && <Stat label="差戻し" value={`${summary.rejected}件`} tone="#b42318" />}
        </div>
      </div>

      {msg && <div className="card" style={{ borderColor: msg.ok ? "var(--color-success)" : "var(--color-danger)", color: msg.ok ? "var(--color-success)" : "var(--color-danger)", fontSize: 13 }}>{msg.text}</div>}

      {/* タブ。本人ビューだけでも「自分の勤怠／シフト申請」の2タブで運用するように。
          シフト申請：先に予定（シフト）を申請→承認後に実績打刻、という運用フローのため。 */}
      {me.isTimecardUser && (
        <div role="tablist" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--color-border)" }}>
          <TabBtn on={tab === "self"} onClick={() => setTab("self")} label="自分の勤怠" />
          <TabBtn on={tab === "shift"} onClick={() => setTab("shift")} label="シフト申請" />
          {canApprove && <TabBtn on={tab === "approve"} onClick={() => setTab("approve")} label={`承認待ち${(approvalQueue.length + shiftQueue.length) ? `（${approvalQueue.length + shiftQueue.length}）` : ""}`} />}
        </div>
      )}
      {!me.isTimecardUser && canApprove && (
        <div role="tablist" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--color-border)" }}>
          <TabBtn on={tab === "approve"} onClick={() => setTab("approve")} label={`承認待ち${(approvalQueue.length + shiftQueue.length) ? `（${approvalQueue.length + shiftQueue.length}）` : ""}`} />
        </div>
      )}

      {/* === 自分の勤怠（カレンダー） === */}
      {tab === "self" && me.isTimecardUser && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="btn ghost btn-xs" onClick={() => shiftMonth(-1)} disabled={pending}>← 前月</button>
              <b style={{ fontSize: 15 }}>{ym.replace("-", "年")}月</b>
              <button className="btn ghost btn-xs" onClick={() => shiftMonth(1)} disabled={pending}>翌月 →</button>
            </div>
            <button className="btn brand btn-xs" disabled={pending}
              onClick={() => run(() => submitMonthForApproval(me.email, ym), "今月分を申請しました")}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>send</span> 今月分を申請
            </button>
          </div>

          <CalendarGrid ym={ym} entryByDate={entryByDate} today={todayJst} onPick={(d) => setEditDate(d)} />

          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap", fontSize: 11, color: "var(--color-ink-3)" }}>
            <Legend swatch="#cfe2f3" label="予定" />
            <Legend swatch="#067647" label="実績（実働あり）" />
            <span>セルをクリックで予定・実績を編集</span>
          </div>
        </div>
      )}

      {/* === シフト申請（予定の事前申請） === */}
      {tab === "shift" && me.isTimecardUser && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="btn ghost btn-xs" onClick={() => shiftMonth(-1)} disabled={pending}>← 前月</button>
              <b style={{ fontSize: 15 }}>{ym.replace("-", "年")}月のシフト</b>
              <button className="btn ghost btn-xs" onClick={() => shiftMonth(1)} disabled={pending}>翌月 →</button>
            </div>
            <button className="btn brand btn-xs" disabled={pending}
              onClick={() => run(() => submitShiftForApproval(me.email, ym), "シフトを申請しました")}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>send</span> 今月のシフトを申請
            </button>
          </div>

          <div className="muted" style={{ fontSize: 11.5, marginBottom: 10, lineHeight: 1.6 }}>
            各日のセルをタップして<b>働く予定（シフト）</b>を入れてください。入力後「今月のシフトを申請」でマネージャーに承認依頼。
            <br />
            承認後のシフト変更は管理者へ差戻し依頼が必要です。承認シフトと違う時間で働いた日は「シフト外で働いた理由」を後から入力してください。
          </div>

          <CalendarGrid ym={ym} entryByDate={entryByDate} today={todayJst} onPick={(d) => setEditDate(d)} />

          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap", fontSize: 11, color: "var(--color-ink-3)" }}>
            <ShiftLegend tone="open" label="未申請" />
            <ShiftLegend tone="submitted" label="申請中" />
            <ShiftLegend tone="approved" label="承認済" />
            <ShiftLegend tone="rejected" label="差戻し" />
            <span>セルをクリックでシフトを編集</span>
          </div>
        </div>
      )}

      {/* === 承認待ち === */}
      {tab === "approve" && canApprove && (
        <ApprovalList queue={approvalQueue} shiftQueue={shiftQueue} pending={pending} run={run} />
      )}

      {/* 編集モーダル */}
      {editDate && (
        <EditModal
          meEmail={me.email}
          workDate={editDate}
          entry={entryByDate.get(editDate) ?? null}
          onClose={() => setEditDate(null)}
          onSaved={() => { setEditDate(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div className="meta" style={{ fontSize: 10.5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: tone ?? "var(--color-ink)" }}>{value}</div>
    </div>
  );
}
function TabBtn({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick}
      style={{ padding: "10px 18px", border: 0, background: "transparent", cursor: "pointer",
        borderBottom: on ? "3px solid var(--color-brand-600)" : "3px solid transparent",
        color: on ? "var(--color-brand-700)" : "var(--color-ink-2)", fontWeight: on ? 800 : 600, fontSize: 14 }}>
      {label}
    </button>
  );
}
function Legend({ swatch, label }: { swatch: string; label: string }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: swatch, display: "inline-block" }} />{label}</span>;
}

// シフトステータスの凡例（シフト申請タブ用）
const SHIFT_TONE: Record<string, { bg: string; fg: string }> = {
  open:      { bg: "#eef2ff", fg: "#3730a3" },
  submitted: { bg: "#fff6e0", fg: "#9a7b12" },
  approved:  { bg: "#e7f7ee", fg: "#067647" },
  rejected:  { bg: "#fdecef", fg: "#b42318" },
};
function ShiftLegend({ tone, label }: { tone: keyof typeof SHIFT_TONE; label: string }) {
  const t = SHIFT_TONE[tone];
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
    <span style={{ width: 16, height: 12, borderRadius: 3, background: t.bg, border: `1px solid ${t.fg}30`, display: "inline-block" }} />
    {label}
  </span>;
}

// ── 月カレンダー ─────────────────────────────────────────────
function CalendarGrid({ ym, entryByDate, today, onPick }: {
  ym: string; entryByDate: Map<string, TimeEntry>; today: string; onPick: (d: string) => void;
}) {
  const [y, mo] = ym.split("-").map(Number);
  const first = new Date(y, mo - 1, 1);
  const startWd = first.getDay();
  const days = lastDayOf(ym);
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="tc-cal">
      {WD.map((w, i) => (
        <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, padding: "2px 0", color: i === 0 ? "#b42318" : i === 6 ? "#0b5cab" : "var(--color-ink-3)" }}>{w}</div>
      ))}
      {cells.map((date, i) => {
        if (!date) return <div key={`e${i}`} />;
        const e = entryByDate.get(date);
        const dayNum = Number(date.slice(-2));
        const wd = new Date(y, mo - 1, dayNum).getDay();
        const isToday = date === today;
        const labor = e ? laborMinutesOf(e) : 0;
        const planned = e ? plannedMinutesOf(e) : 0;
        const st = e ? STATUS_TONE[e.status] : null;
        // シフト状況：未申請=open, 申請中=submitted, 承認済=approved, 差戻し=rejected。色帯と隅マークで表示。
        const shiftSt = e?.shift_status ?? "open";
        const sst = SHIFT_TONE[shiftSt];
        const deviation = e ? deviatesFromShift(e) : false;
        return (
          <button key={date} type="button" onClick={() => onPick(date)} className={`tc-cell${isToday ? " today" : ""}`}
            style={planned > 0 || sst ? { background: sst?.bg ?? "var(--color-surface)" } : undefined}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="tc-daynum" style={{ fontSize: 12, fontWeight: 700, color: wd === 0 ? "#b42318" : wd === 6 ? "#0b5cab" : "var(--color-ink-2)" }}>{dayNum}</span>
              {st && <span className="tc-statuschip" style={{ fontSize: 8.5, fontWeight: 700, padding: "0 5px", borderRadius: 99, background: st.bg, color: st.fg }}>{st.label}</span>}
            </div>
            {/* シフト承認状態をピル表示（未申請以外） */}
            {sst && shiftSt !== "open" && (
              <div className="tc-line" style={{ background: sst.bg, color: sst.fg, fontWeight: 700 }}>
                シフト {shiftSt === "submitted" ? "申請中" : shiftSt === "approved" ? "承認済" : "差戻し"}
              </div>
            )}
            {deviation && (
              <div className="tc-line" style={{ background: "#fdecef", color: "#b42318", fontWeight: 700 }}>⚠ シフト外</div>
            )}
            {/* スマホでは表示しないテキスト行（デスクトップのみ） */}
            {planned > 0 && (
              <div className="tc-line plan">予 {fmtHmJst(e!.planned_start)}–{fmtHmJst(e!.planned_end)}</div>
            )}
            {labor > 0 && (
              <div className="tc-line act">実 {fmtHm(labor)}</div>
            )}
            {e?.actual_start && !e?.actual_end && (
              <div className="tc-line running">出勤中…</div>
            )}
            {/* スマホで状態を最小情報で伝えるドット帯（デスクトップでは @media で非表示） */}
            <div className="tc-dotrow">
              {planned > 0 && <span className="tc-dot plan" title="予定あり" />}
              {labor > 0 && <span className="tc-dot act" title="実績あり" />}
              {e?.actual_start && !e?.actual_end && <span className="tc-dot" style={{ background: "#9a7b12" }} title="出勤中" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── 承認待ち一覧 ─────────────────────────────────────────────
function ApprovalList({ queue, shiftQueue, pending, run }: {
  queue: TimeEntry[]; shiftQueue: TimeEntry[]; pending: boolean; run: (fn: () => Promise<any>, ok: string) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allIds = queue.map((e) => e.id);
  const allOn = allIds.length > 0 && allIds.every((id) => sel.has(id));
  const ids = [...sel];

  const doReject = () => {
    const reason = window.prompt("差し戻し理由を入力してください（本人に通知されます）");
    if (reason == null) return;
    run(() => rejectTimeEntries(ids, reason), "差し戻しました");
    setSel(new Set());
  };

  // 人ごとにグルーピング
  const byUser = new Map<string, TimeEntry[]>();
  for (const e of queue) {
    const k = e.user_name || e.user_email;
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k)!.push(e);
  }

  if (queue.length === 0 && shiftQueue.length === 0) {
    return <div className="card"><div className="muted" style={{ fontSize: 13 }}>承認待ちはありません。</div></div>;
  }
  // シフト申請の承認セクション（事前申請）：勤怠とは別の一覧として上に出す。
  const ShiftSection = shiftQueue.length > 0 ? <ShiftApprovalList queue={shiftQueue} pending={pending} run={run} /> : null;
  if (queue.length === 0) {
    return <>{ShiftSection}</>;
  }

  return (
    <>
    {ShiftSection}
    <div className="card">
      <div style={{ marginBottom: 10, fontWeight: 700, fontSize: 13 }}>📝 勤怠（月締）承認待ち</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(allIds))} />
          全選択（{queue.length}件）
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn brand btn-xs" disabled={pending || ids.length === 0}
            onClick={() => { run(() => approveTimeEntries(ids), "承認しました"); setSel(new Set()); }}>
            選択を承認（{ids.length}）
          </button>
          <button className="btn btn-xs" disabled={pending || ids.length === 0} onClick={doReject}
            style={{ color: "#b42318", borderColor: "#f7c5cf" }}>選択を差戻し</button>
        </div>
      </div>

      {[...byUser.entries()].map(([name, rows]) => (
        <div key={name} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, display: "flex", gap: 8, alignItems: "baseline" }}>
            {name}
            <span className="muted" style={{ fontSize: 11 }}>{rows[0].department ?? "部署未設定"} ・ {rows.length}件</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl tbl-compact" style={{ minWidth: 560 }}>
              <thead><tr><th></th><th>日付</th><th>予定</th><th>実績</th><th className="num">休憩</th><th className="num">実働</th><th>メモ</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td><input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} /></td>
                    <td>{e.work_date.slice(5)}（{WD[new Date(e.work_date + "T00:00:00+09:00").getDay()]}）</td>
                    <td style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>{plannedMinutesOf(e) > 0 ? `${fmtHmJst(e.planned_start)}–${fmtHmJst(e.planned_end)}` : "—"}</td>
                    <td style={{ fontSize: 11.5 }}>{e.actual_start ? `${fmtHmJst(e.actual_start)}–${fmtHmJst(e.actual_end) || "?"}` : "—"}</td>
                    <td className="num">{e.break_minutes ? `${e.break_minutes}分` : "—"}</td>
                    <td className="num" style={{ fontWeight: 700, color: "#067647" }}>{fmtHm(laborMinutesOf(e))}</td>
                    <td style={{ fontSize: 11.5, color: "var(--color-ink-3)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
    </>
  );
}

// ── シフト承認待ち一覧（事前申請の承認） ─────────────────────────
function ShiftApprovalList({ queue, pending, run }: {
  queue: TimeEntry[]; pending: boolean; run: (fn: () => Promise<any>, ok: string) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const allIds = queue.map((e) => e.id);
  const allOn = allIds.length > 0 && allIds.every((id) => sel.has(id));
  const ids = [...sel];

  const doReject = () => {
    const reason = window.prompt("シフト差戻し理由を入力してください（本人に表示されます）");
    if (reason == null) return;
    run(() => rejectShifts(ids, reason), "差し戻しました");
    setSel(new Set());
  };

  const byUser = new Map<string, TimeEntry[]>();
  for (const e of queue) {
    const k = e.user_name || e.user_email;
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k)!.push(e);
  }

  return (
    <div className="card" style={{ borderColor: "#fde9b0", background: "#fffbeb", marginBottom: 12 }}>
      <div style={{ marginBottom: 10, fontWeight: 700, fontSize: 13, color: "#9a5b1a" }}>📅 シフト（予定）承認待ち</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(allIds))} />
          全選択（{queue.length}件）
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn brand btn-xs" disabled={pending || ids.length === 0}
            onClick={() => { run(() => approveShifts(ids), "シフトを承認しました"); setSel(new Set()); }}>
            選択シフトを承認（{ids.length}）
          </button>
          <button className="btn btn-xs" disabled={pending || ids.length === 0} onClick={doReject}
            style={{ color: "#b42318", borderColor: "#f7c5cf" }}>選択を差戻し</button>
        </div>
      </div>
      {[...byUser.entries()].map(([name, rows]) => (
        <div key={name} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, display: "flex", gap: 8, alignItems: "baseline" }}>
            {name}
            <span className="muted" style={{ fontSize: 11 }}>{rows[0].department ?? "部署未設定"} ・ {rows.length}件</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl tbl-compact" style={{ minWidth: 460 }}>
              <thead><tr><th></th><th>日付</th><th>シフト</th><th className="num">時間</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td><input type="checkbox" checked={sel.has(e.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n; })} /></td>
                    <td>{e.work_date.slice(5)}（{WD[new Date(e.work_date + "T00:00:00+09:00").getDay()]}）</td>
                    <td style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>{e.planned_start ? `${fmtHmJst(e.planned_start)}–${fmtHmJst(e.planned_end) || "?"}` : "—"}</td>
                    <td className="num" style={{ fontWeight: 700, color: "#0b5cab" }}>{fmtHm(plannedMinutesOf(e))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// HH:MM 形式の時刻を「時」「分」の2つの select で入力する。
//   HTML5 の <input type="time"> のネイティブピッカーは、Chrome系で初回クリックが
//   ピッカーのスクロールに釣られて選択ズレが発生する（1クリックで意図した数字が選べない）。
//   ネイティブピッカーを使わず select 2つに分けることで、確実にタップ1回で選べるようにする。
function HmSelect({ value, onChange, disabled = false, step = 5 }: { value: string; onChange: (v: string) => void; disabled?: boolean; step?: 1 | 5 | 10 | 15 | 30 }) {
  const [h = "", m = ""] = (value || "").split(":");
  const hours: string[] = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes: string[] = Array.from({ length: Math.floor(60 / step) }, (_, i) => String(i * step).padStart(2, "0"));
  const setH = (nh: string) => onChange(nh ? `${nh}:${m || "00"}` : "");
  const setM = (nm: string) => onChange(h ? `${h}:${nm || "00"}` : "");
  const baseSel: React.CSSProperties = { fontSize: 13, padding: "6px 6px", border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface)", fontFamily: "inherit", minWidth: 56 };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <select aria-label="時" value={h} onChange={(e) => setH(e.target.value)} disabled={disabled} style={baseSel}>
        <option value="">--</option>
        {hours.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>:</span>
      <select aria-label="分" value={m} onChange={(e) => setM(e.target.value)} disabled={disabled} style={baseSel}>
        <option value="">--</option>
        {minutes.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </span>
  );
}

// ── 編集モーダル ─────────────────────────────────────────────
function EditModal({ meEmail, workDate, entry, onClose, onSaved }: {
  meEmail: string; workDate: string; entry: TimeEntry | null; onClose: () => void; onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ps, setPs] = useState(entry?.planned_start ? fmtHmJst(entry.planned_start) : "");
  const [pe, setPe] = useState(entry?.planned_end ? fmtHmJst(entry.planned_end) : "");
  const [as, setAs] = useState(entry?.actual_start ? fmtHmJst(entry.actual_start) : "");
  const [ae, setAe] = useState(entry?.actual_end ? fmtHmJst(entry.actual_end) : "");
  const [brk, setBrk] = useState(String(entry?.break_minutes ?? 0));
  const [note, setNote] = useState(entry?.note ?? "");
  const [devReason, setDevReason] = useState(entry?.deviation_reason ?? "");
  const locked = entry?.status === "submitted" || entry?.status === "approved";
  // シフト承認済の場合は予定（planned）を本人ロック。差し戻されたシフト or 未申請のみ編集可。
  const shiftStatus = entry?.shift_status ?? "open";
  const plannedLocked = shiftStatus === "submitted" || shiftStatus === "approved";
  // 現在の入力値で「シフト外（実績がずれている）」かどうかを動的判定
  const livePlannedStart = toIso(workDate, ps), livePlannedEnd = toIso(workDate, pe);
  const liveActualStart = toIso(workDate, as), liveActualEnd = toIso(workDate, ae);
  const isDeviating = shiftStatus === "approved" && deviatesFromShift({
    shift_status: "approved",
    planned_start: livePlannedStart ?? entry?.planned_start ?? null,
    planned_end:   livePlannedEnd   ?? entry?.planned_end   ?? null,
    actual_start:  liveActualStart  ?? null,
    actual_end:    liveActualEnd    ?? null,
  });

  const save = () => {
    setErr(null);
    // 承認済シフトと違う時間で働いた場合は理由を必須に
    if (isDeviating && !devReason.trim()) {
      setErr("承認シフトと違う時間で働いた日は「シフト外で働いた理由」が必須です");
      return;
    }
    start(async () => {
      // 本人のカレンダー編集。既存行があればその user_email、新規日は自分(meEmail)。
      // shift がロック中（申請中/承認済）の場合、planned は送らない（サーバ側もブロック）。
      const res = await upsertTimeEntry({
        userEmail: entry?.user_email || meEmail,
        workDate,
        plannedStart: plannedLocked ? undefined : toIso(workDate, ps),
        plannedEnd:   plannedLocked ? undefined : toIso(workDate, pe),
        actualStart: toIso(workDate, as), actualEnd: toIso(workDate, ae),
        breakMinutes: Number(brk) || 0, note,
        deviationReason: devReason,
      });
      if (res.ok) onSaved();
      else setErr(res.error);
    });
  };

  return (
    <div onClick={onClose} className="tc-modal-bg" style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card tc-modal" style={{ width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{workDate} の勤怠</h3>
          <button className="btn ghost btn-xs" onClick={onClose} disabled={pending}>閉じる</button>
        </div>
        {entry && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: STATUS_TONE[entry.status].bg, color: STATUS_TONE[entry.status].fg }}>勤怠 {STATUS_TONE[entry.status].label}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: SHIFT_TONE[shiftStatus]?.bg, color: SHIFT_TONE[shiftStatus]?.fg }}>
              シフト {shiftStatus === "open" ? "未申請" : shiftStatus === "submitted" ? "申請中" : shiftStatus === "approved" ? "承認済" : "差戻し"}
            </span>
            {entry.reject_reason && <span style={{ fontSize: 11.5, color: "#b42318" }}>勤怠差戻し：{entry.reject_reason}</span>}
            {entry.shift_reject_reason && <span style={{ fontSize: 11.5, color: "#b42318" }}>シフト差戻し：{entry.shift_reject_reason}</span>}
          </div>
        )}
        {locked && <div className="muted" style={{ fontSize: 11.5 }}>※ 勤怠が申請中・承認済のため編集できません（管理者に差し戻しを依頼してください）。</div>}

        <fieldset disabled={locked || pending} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div className="meta" style={{ fontSize: 11, marginBottom: 4, color: "#0b5cab" }}>
              働く予定（シフト）{plannedLocked && <span style={{ marginLeft: 6, color: "#9a7b12" }}>🔒 {shiftStatus === "approved" ? "承認済のため変更不可" : "申請中のため変更不可"}</span>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <HmSelect value={ps} onChange={setPs} disabled={plannedLocked} />
              <span>〜</span>
              <HmSelect value={pe} onChange={setPe} disabled={plannedLocked} />
            </div>
          </div>
          <div>
            <div className="meta" style={{ fontSize: 11, marginBottom: 4, color: "#067647" }}>実績</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <HmSelect value={as} onChange={setAs} />
              <span>〜</span>
              <HmSelect value={ae} onChange={setAe} />
              <label style={{ fontSize: 11.5, color: "var(--color-ink-3)", display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
                休憩 <input type="number" min={0} value={brk} onChange={(e) => setBrk(e.target.value)} style={{ ...inp, width: 64 }} />分
              </label>
            </div>
          </div>
          {/* シフト外で働いた理由：承認シフトと実績がずれているときに必須化 */}
          {(shiftStatus === "approved" || (entry?.deviation_reason ?? "")) && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="meta" style={{ fontSize: 11, color: isDeviating ? "#b42318" : "var(--color-ink-4)" }}>
                シフト外で働いた理由 {isDeviating && <b style={{ color: "#b42318" }}>※必須（承認シフトと違う時間で働いたため）</b>}
              </span>
              <input type="text" value={devReason} onChange={(e) => setDevReason(e.target.value)} style={{ ...inp, border: `1px solid ${isDeviating && !devReason.trim() ? "var(--color-danger)" : "var(--color-border-strong)"}` }}
                placeholder="例：終電遅れにより残業／開店準備で早出 など" />
            </label>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="meta" style={{ fontSize: 11 }}>メモ</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} style={inp} placeholder="任意" />
          </label>
        </fieldset>

        {err && <div style={{ fontSize: 12.5, color: "var(--color-danger)" }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose} disabled={pending}>キャンセル</button>
          <button className="btn brand" onClick={save} disabled={pending || locked}>{pending ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { fontSize: 13, padding: "6px 8px", border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface)", fontFamily: "inherit" };
