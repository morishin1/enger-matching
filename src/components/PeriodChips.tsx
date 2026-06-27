"use client";

import { useState } from "react";

// 期間セレクタの統一デザイン（マッチング系・提案管理で共通）。
//   見た目：フィルタアイコン＋「期間」ラベル＋丸ピル（選択でブランド色／件数バッジ任意）。
//   使い方は2通り：
//     ① controlled … value/onChange を渡してクライアント状態で制御（提案ボード/失注/承認）。
//     ② URLベース … 各ピルを Link 化したい場合は呼び出し側で onChange に router.push を渡す。
//   どの画面でも同じ見た目になるよう、装飾はここに集約する。

export type PeriodOption<K extends string = string> = { key: K; label: string; count?: number | null };

// 任意期間（カレンダー）設定。calendarKey のチップが選択中のとき、開始/終了の日付入力を表示する。
//   from/to は "YYYY-MM-DD"（空＝無制限＝全期間）。onRange で確定する。
export type CalendarConfig<K extends string> = {
  calendarKey: K;
  from: string;
  to: string;
  onRange: (from: string, to: string) => void;
};

export function PeriodChips<K extends string>({
  value, onChange, options, labelText = "期間", icon = "filter_alt", note, card = false, calendar,
}: {
  value: K;
  onChange: (key: K) => void;
  options: PeriodOption<K>[];
  labelText?: string;
  icon?: string;
  note?: string;
  /** true なら .card で囲む（独立バー）。false なら素のフレックス行（タブ横などに置く）。 */
  card?: boolean;
  /** 「全期間」チップをカレンダー（任意期間）指定にする設定。 */
  calendar?: CalendarConfig<K>;
}) {
  const hasRange = !!calendar && (!!calendar.from || !!calendar.to);
  // 既定（全期間・範囲未指定）ではカレンダー入力を畳んでおき、1段に収める。
  //   ・「全期間」チップを押すと開く／他チップを押すと閉じる。
  //   ・URLに範囲指定がある状態で開いた場合は最初から開く。
  const [calOpenState, setCalOpenState] = useState(hasRange);
  const calOpen = !!calendar && value === calendar.calendarKey && (calOpenState || hasRange);
  return (
    <div className={card ? "card" : undefined} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...(card ? { padding: "10px 14px" } : {}) }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: "var(--color-ink-2)" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 17, color: "var(--color-brand-700)" }}>{icon}</span>
        {labelText}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {options.map((o) => {
          const isCal = calendar && o.key === calendar.calendarKey;
          const active = value === o.key;
          const handle = () => { onChange(o.key); setCalOpenState(!!isCal); };
          return (
            <button key={o.key} type="button" onClick={handle}
              style={{
                fontFamily: "inherit", fontSize: 12.5, fontWeight: active ? 800 : 600, cursor: "pointer",
                padding: "6px 14px", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: 5,
                border: `1px solid ${active ? "var(--color-brand-600)" : "var(--color-border)"}`,
                background: active ? "var(--color-brand-600)" : "#fff",
                color: active ? "#fff" : "var(--color-ink-2)",
              }}>
              {isCal && <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>calendar_month</span>}
              {o.label}
              {!isCal && o.count != null && <span style={{ marginLeft: 4, opacity: 0.85, fontWeight: 700 }}>{o.count}</span>}
              {isCal && hasRange && <span style={{ marginLeft: 4, opacity: 0.9, fontWeight: 700 }}>指定中</span>}
            </button>
          );
        })}
        {calOpen && calendar && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 4px", flexWrap: "wrap" }}>
            <input type="date" value={calendar.from} max={calendar.to || undefined}
              onChange={(e) => calendar.onRange(e.target.value, calendar.to)}
              style={{ fontFamily: "inherit", fontSize: 12, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }} />
            <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>〜</span>
            <input type="date" value={calendar.to} min={calendar.from || undefined}
              onChange={(e) => calendar.onRange(calendar.from, e.target.value)}
              style={{ fontFamily: "inherit", fontSize: 12, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }} />
            {hasRange && (
              <button type="button" onClick={() => calendar.onRange("", "")}
                className="btn ghost btn-xs" title="期間指定をクリア（全期間に戻す）">クリア</button>
            )}
          </span>
        )}
      </div>
      {note && <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>{note}</span>}
    </div>
  );
}

// 期間キー・ラベル・範囲計算は lib/period に集約（サーバー側からも使うため）。
export { CLIENT_PERIOD_LABEL, CLIENT_PERIOD_KEYS, inClientPeriod, type ClientPeriod } from "@/lib/period";
