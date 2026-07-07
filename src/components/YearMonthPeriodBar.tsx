"use client";

import { useEffect, useRef, useState } from "react";

// 期間選択の統一デザイン（年ラベル＋1〜12月ピル＋カレンダー範囲選択）。
//   KGI/マッチング/提案管理/エンド開拓/PRで共通に使う「年+月」バー。
//   ・月ピル：クリックでその月を選択（アクティブ＝ブランド色塗り＋白文字）。
//   ・12月の隣のカレンダーアイコン：クリックでカレンダーが開き、任意の範囲（またはKGIのように
//     1日単位のジャンプ）を選べる。選択すると数値側のフィルタと連動する（呼び出し側が
//     onSelectRange/onPickDate で from/to や y/m のクエリに反映する）。
//   ・shortcuts：呼び出し側が「今日／今週／全期間」等のワンクリックを渡せる（任意）。
//   すべて controlled（状態は呼び出し側が持つ）。PeriodChips と同じ設計方針。

export type YearMonthShortcut = { key: string; label: string; active: boolean; onClick: () => void };

export function YearMonthPeriodBar({
  year, activeMonth, onSelectMonth, onShiftYear,
  calendarMode = "range", range, onSelectRange, onPickDate, onClearRange,
  shortcuts, minYear, maxYear,
}: {
  /** バーに表示する年（月ピル12個の対象年）。 */
  year: number;
  /** アクティブな月（1-12）。カスタム範囲選択中など、どの月とも一致しない場合は null。 */
  activeMonth: number | null;
  onSelectMonth: (year: number, month: number) => void;
  onShiftYear: (deltaYears: number) => void;
  /** "range"=2クリックで任意の期間を選択（マッチング/提案管理/エンド開拓/PR）。
   *  "single"=1日クリックで即座にその日を選ぶ（KGIのように月次集計のみで、範囲は扱えない画面向け）。 */
  calendarMode?: "range" | "single";
  /** 現在のカスタム範囲（range モードのとき、月ピルではなくカレンダーで選んだ期間があれば渡す）。 */
  range?: { from: string; to: string } | null;
  onSelectRange?: (from: string, to: string) => void;
  onPickDate?: (dateStr: string) => void;
  onClearRange?: () => void;
  shortcuts?: YearMonthShortcut[];
  minYear?: number;
  maxYear?: number;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const hasRange = calendarMode === "range" && !!range && !!range.from && !!range.to;

  return (
    <div className="card" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", position: "relative" }}>
      {shortcuts && shortcuts.length > 0 && (
        <span style={{ display: "inline-flex", gap: 6, marginRight: 4 }}>
          {shortcuts.map((s) => (
            <button key={s.key} type="button" onClick={s.onClick}
              style={{
                fontFamily: "inherit", fontSize: 12.5, fontWeight: s.active ? 800 : 600, cursor: "pointer",
                padding: "6px 13px", borderRadius: 99,
                border: `1px solid ${s.active ? "var(--color-brand-600)" : "var(--color-border)"}`,
                background: s.active ? "var(--color-brand-600)" : "#fff",
                color: s.active ? "#fff" : "var(--color-ink-2)",
              }}>{s.label}</button>
          ))}
        </span>
      )}

      <button type="button" onClick={() => onShiftYear(-1)} disabled={minYear != null && year <= minYear}
        aria-label="前年" title="前年"
        style={{ background: "transparent", border: 0, cursor: "pointer", color: "var(--color-ink-4)", display: "inline-flex", padding: 2, opacity: minYear != null && year <= minYear ? 0.35 : 1 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span>
      </button>
      <span style={{ fontWeight: 800, fontSize: 14 }}>{year}年</span>
      <button type="button" onClick={() => onShiftYear(1)} disabled={maxYear != null && year >= maxYear}
        aria-label="翌年" title="翌年"
        style={{ background: "transparent", border: 0, cursor: "pointer", color: "var(--color-ink-4)", display: "inline-flex", padding: 2, marginRight: 4, opacity: maxYear != null && year >= maxYear ? 0.35 : 1 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
      </button>

      {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => {
        const on = mm === activeMonth;
        return (
          <button key={mm} type="button" onClick={() => onSelectMonth(year, mm)}
            style={{
              fontFamily: "inherit", padding: "6px 12px", borderRadius: 8, border: 0, cursor: "pointer",
              fontSize: 13, fontWeight: on ? 800 : 600,
              background: on ? "var(--color-brand-600)" : "transparent",
              color: on ? "#fff" : "var(--color-ink-2)",
            }}>{mm}月</button>
        );
      })}

      <div ref={anchorRef} style={{ position: "relative", display: "inline-flex" }}>
        <button type="button" onClick={() => setOpen((v) => !v)}
          aria-label="カレンダーで期間を指定" title="カレンダーで期間を指定"
          style={{
            display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 8, cursor: "pointer",
            border: `1px solid ${hasRange ? "var(--color-brand-600)" : "var(--color-border-strong)"}`,
            background: hasRange ? "var(--color-brand-50)" : "transparent",
            color: hasRange ? "var(--color-brand-700)" : "var(--color-ink-3)",
          }}>
          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>calendar_month</span>
          {hasRange && <span style={{ fontSize: 11.5, fontWeight: 700 }}>{fmtShort(range!.from)}〜{fmtShort(range!.to)}</span>}
        </button>
        {open && (
          <CalendarPopover
            mode={calendarMode}
            initial={hasRange ? range! : null}
            baseYear={year}
            baseMonth={activeMonth ?? new Date().getMonth() + 1}
            onClose={() => setOpen(false)}
            onApplyRange={(from, to) => { onSelectRange?.(from, to); setOpen(false); }}
            onPickDate={(d) => { onPickDate?.(d); setOpen(false); }}
            onClear={() => { onClearRange?.(); setOpen(false); }}
            canClear={hasRange}
          />
        )}
      </div>
    </div>
  );
}

const two = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, mo0: number, d: number) => `${y}-${two(mo0 + 1)}-${two(d)}`;
const fmtShort = (iso: string) => { const [, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}`; };
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 月グリッドのカレンダーポップオーバー。range=2クリックで期間選択／single=1クリックで即決定。 */
function CalendarPopover({
  mode, initial, baseYear, baseMonth, onClose, onApplyRange, onPickDate, onClear, canClear,
}: {
  mode: "range" | "single";
  initial: { from: string; to: string } | null;
  baseYear: number;
  baseMonth: number;
  onClose: () => void;
  onApplyRange: (from: string, to: string) => void;
  onPickDate: (dateStr: string) => void;
  onClear: () => void;
  canClear: boolean;
}) {
  const initDate = initial?.from ? new Date(`${initial.from}T00:00:00`) : new Date(baseYear, baseMonth - 1, 1);
  const [cursor, setCursor] = useState(() => new Date(initDate.getFullYear(), initDate.getMonth(), 1));
  const [pickFrom, setPickFrom] = useState<string | null>(initial?.from ?? null);
  const [pickTo, setPickTo] = useState<string | null>(initial?.to ?? null);
  const popRef = useRef<HTMLDivElement>(null);

  // 外側クリック／Escで閉じる（適用はしない）。
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth(); // 0-11
  const startDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const inRange = (key: string) => pickFrom && pickTo && key >= (pickFrom < pickTo ? pickFrom : pickTo) && key <= (pickFrom < pickTo ? pickTo : pickFrom);
  const isEdge = (key: string) => key === pickFrom || key === pickTo;

  const pickDay = (d: number) => {
    const key = ymd(year, month, d);
    if (mode === "single") { onPickDate(key); return; }
    if (!pickFrom || (pickFrom && pickTo)) { setPickFrom(key); setPickTo(null); return; }
    // 2クリック目：順序を問わず from<=to に整列。
    if (key < pickFrom) { setPickTo(pickFrom); setPickFrom(key); } else { setPickTo(key); }
  };

  const navBtn = { padding: "4px 9px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink-2)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" } as const;

  return (
    <div ref={popRef} style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40, width: 296, background: "var(--color-surface)", border: "1px solid var(--color-border-strong)", borderRadius: 12, boxShadow: "0 14px 40px rgba(0,0,0,.16)", padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <button type="button" style={navBtn} onClick={() => setCursor(new Date(year, month - 1, 1))}>‹</button>
        <div style={{ flex: 1, textAlign: "center", fontSize: 13.5, fontWeight: 800 }}>{year}年 {month + 1}月</div>
        <button type="button" style={navBtn} onClick={() => setCursor(new Date(year, month + 1, 1))}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: "var(--color-border)", border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
        {WEEKDAYS.map((w, i) => (
          <div key={w} style={{ background: "var(--color-surface-inset)", textAlign: "center", padding: "4px 0", fontSize: 10.5, fontWeight: 700, color: i === 0 ? "#d23f57" : i === 6 ? "#0b5cab" : "var(--color-ink-3)" }}>{w}</div>
        ))}
        {cells.map((d, idx) => {
          if (d == null) return <div key={`e${idx}`} style={{ background: "var(--color-surface-soft)", minHeight: 34 }} />;
          const key = ymd(year, month, d);
          const dow = (startDow + d - 1) % 7;
          const selected = mode === "range" && (inRange(key) || isEdge(key));
          const edge = mode === "range" && isEdge(key);
          return (
            <button key={key} type="button" onClick={() => pickDay(d)}
              style={{
                minHeight: 34, background: edge ? "var(--color-brand-600)" : selected ? "var(--color-brand-50)" : "var(--color-surface)",
                color: edge ? "#fff" : dow === 0 ? "#d23f57" : dow === 6 ? "#0b5cab" : "var(--color-ink-2)",
                border: 0, cursor: "pointer", fontSize: 12, fontWeight: edge ? 800 : 600, fontFamily: "inherit",
              }}>{d}</button>
          );
        })}
      </div>
      {mode === "range" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <span className="muted" style={{ fontSize: 11, flex: 1 }}>
            {pickFrom ? `${fmtShort(pickFrom)} 〜 ${pickTo ? fmtShort(pickTo) : "選択中…"}` : "開始日をクリック"}
          </span>
          {canClear && <button type="button" className="btn ghost btn-xs" onClick={onClear}>クリア</button>}
          <button type="button" className="btn brand btn-xs" disabled={!pickFrom}
            onClick={() => onApplyRange(pickFrom!, pickTo ?? pickFrom!)}>適用</button>
        </div>
      )}
    </div>
  );
}
