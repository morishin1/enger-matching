"use client";

// 期間セレクタの統一デザイン（マッチング系・提案管理で共通）。
//   見た目：フィルタアイコン＋「期間」ラベル＋丸ピル（選択でブランド色／件数バッジ任意）。
//   使い方は2通り：
//     ① controlled … value/onChange を渡してクライアント状態で制御（提案ボード/失注/承認）。
//     ② URLベース … 各ピルを Link 化したい場合は呼び出し側で onChange に router.push を渡す。
//   どの画面でも同じ見た目になるよう、装飾はここに集約する。

export type PeriodOption<K extends string = string> = { key: K; label: string; count?: number | null };

export function PeriodChips<K extends string>({
  value, onChange, options, labelText = "期間", icon = "filter_alt", note, card = false,
}: {
  value: K;
  onChange: (key: K) => void;
  options: PeriodOption<K>[];
  labelText?: string;
  icon?: string;
  note?: string;
  /** true なら .card で囲む（独立バー）。false なら素のフレックス行（タブ横などに置く）。 */
  card?: boolean;
}) {
  return (
    <div className={card ? "card" : undefined} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...(card ? { padding: "10px 14px" } : {}) }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: "var(--color-ink-2)" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 17, color: "var(--color-brand-700)" }}>{icon}</span>
        {labelText}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((o) => {
          const active = value === o.key;
          return (
            <button key={o.key} type="button" onClick={() => onChange(o.key)}
              style={{
                fontFamily: "inherit", fontSize: 12.5, fontWeight: active ? 800 : 600, cursor: "pointer",
                padding: "6px 14px", borderRadius: 99,
                border: `1px solid ${active ? "var(--color-brand-600)" : "var(--color-border)"}`,
                background: active ? "var(--color-brand-600)" : "#fff",
                color: active ? "#fff" : "var(--color-ink-2)",
              }}>
              {o.label}
              {o.count != null && <span style={{ marginLeft: 6, opacity: 0.85, fontWeight: 700 }}>{o.count}</span>}
            </button>
          );
        })}
      </div>
      {note && <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>{note}</span>}
    </div>
  );
}

// 期間キー・ラベル・範囲計算は lib/period に集約（サーバー側からも使うため）。
export { CLIENT_PERIOD_LABEL, CLIENT_PERIOD_KEYS, inClientPeriod, type ClientPeriod } from "@/lib/period";
