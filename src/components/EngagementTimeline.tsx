"use client";

const DAY = 86400000;
const MONTH_W = 88; // 1ヶ月の横幅(px)
const ROW_H = 34;
const NAME_W = 150;

const STATUS_COLOR: Record<string, string> = { 稼働中: "#1aa260", 予定: "#d98a2b", 終了: "#9aa7b4" };
const parse = (d?: string | null) => { if (!d) return null; const t = new Date(d); return isNaN(t.getTime()) ? null : t; };
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

export function EngagementTimeline({ rows }: { rows: any[] }) {
  const dated = rows.filter((e) => parse(e.start_date) || parse(e.end_date));
  const undated = rows.filter((e) => !parse(e.start_date) && !parse(e.end_date));

  if (dated.length === 0) {
    return <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 30, fontSize: 13 }}>開始日・満了日が入力された稼働がありません。稼働カードで日付を入力するとここに表示されます。</div>;
  }

  const today = new Date();
  // 表示ウィンドウ：最早の開始月 〜 最遅の満了月（最低でも今日−1ヶ月〜+6ヶ月）
  let min = monthStart(today), max = addMonths(monthStart(today), 6);
  for (const e of dated) {
    const s = parse(e.start_date), en = parse(e.end_date);
    if (s && s < min) min = monthStart(s);
    if (en && en > max) max = addMonths(monthStart(en), 1);
  }
  if (addMonths(monthStart(today), -1) < min) min = addMonths(monthStart(today), -1);

  const months: Date[] = [];
  for (let d = new Date(min); d < max; d = addMonths(d, 1)) months.push(new Date(d));
  const totalW = months.length * MONTH_W;
  const pxPerDay = MONTH_W / 30.44;
  const xOf = (d: Date) => ((d.getTime() - min.getTime()) / DAY) * pxPerDay;
  const todayX = xOf(today);

  return (
    <div className="card flush" style={{ overflowX: "auto" }}>
      <div style={{ minWidth: NAME_W + totalW }}>
        {/* 月ヘッダー */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", position: "sticky", top: 0, background: "var(--color-surface)", zIndex: 2 }}>
          <div style={{ width: NAME_W, flex: `0 0 ${NAME_W}px`, padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--color-ink-3)" }}>稼働者 / 企業</div>
          <div style={{ position: "relative", width: totalW }}>
            <div style={{ display: "flex" }}>
              {months.map((m, i) => (
                <div key={i} style={{ width: MONTH_W, flex: `0 0 ${MONTH_W}px`, padding: "8px 0", textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--color-ink-3)", borderLeft: "1px solid var(--color-border)" }}>
                  {m.getFullYear() !== (months[i - 1]?.getFullYear() ?? 0) ? `${m.getFullYear()}/` : ""}{m.getMonth() + 1}月
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 行 */}
        <div style={{ position: "relative" }}>
          {/* 今日ライン */}
          {todayX >= 0 && todayX <= totalW && (
            <div style={{ position: "absolute", top: 0, bottom: 0, left: NAME_W + todayX, width: 2, background: "var(--color-brand-600)", zIndex: 1 }}>
              <span style={{ position: "absolute", top: -2, left: 3, fontSize: 9, color: "var(--color-brand-700)", fontWeight: 700, whiteSpace: "nowrap" }}>今日</span>
            </div>
          )}
          {dated.map((e, idx) => {
            const s = parse(e.start_date) ?? today;
            const en = parse(e.end_date);
            const open = !en; // 満了日未設定 → 期限なしバー
            const endD = en ?? max;
            const left = Math.max(0, xOf(s));
            const right = Math.min(totalW, xOf(endD));
            const w = Math.max(8, right - left);
            const col = STATUS_COLOR[e.status] ?? "#9aa7b4";
            const dleft = en ? Math.floor((en.getTime() - today.getTime()) / DAY) : null;
            const endSoon = dleft != null && dleft >= 0 && dleft <= 31;
            return (
              <div key={e.id ?? idx} style={{ display: "flex", height: ROW_H, borderBottom: "1px solid var(--color-border)", alignItems: "center" }}>
                <div style={{ width: NAME_W, flex: `0 0 ${NAME_W}px`, padding: "0 12px", overflow: "hidden" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.candidate_name || "—"}</div>
                  <div className="muted" style={{ fontSize: 9.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.company || ""}</div>
                </div>
                <div style={{ position: "relative", width: totalW, height: "100%" }}>
                  <div title={`${e.candidate_name ?? ""}：${e.start_date ?? "?"} 〜 ${e.end_date ?? "未設定"}（${e.status}）`}
                    style={{ position: "absolute", top: (ROW_H - 18) / 2, left, width: w, height: 18, borderRadius: 9,
                      background: open ? `repeating-linear-gradient(90deg, ${col}cc, ${col}cc 8px, ${col}77 8px, ${col}77 14px)` : col,
                      border: endSoon ? "2px solid #b45309" : "none", display: "flex", alignItems: "center", paddingLeft: 7, color: "#fff", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden" }}>
                    {endSoon ? `満了まで${dleft}日` : (open ? "期限未設定" : "")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 凡例 */}
      <div style={{ display: "flex", gap: 14, padding: "8px 12px", fontSize: 10.5, color: "var(--color-ink-4)", flexWrap: "wrap", borderTop: "1px solid var(--color-border)" }}>
        {Object.entries(STATUS_COLOR).map(([k, c]) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 10, borderRadius: 3, background: c }} />{k}</span>)}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 12, height: 10, borderRadius: 3, border: "2px solid #b45309" }} />満了30日以内</span>
        {undated.length > 0 && <span style={{ marginLeft: "auto" }}>※ 日付未設定 {undated.length} 件はリスト表示で入力してください</span>}
      </div>
    </div>
  );
}
