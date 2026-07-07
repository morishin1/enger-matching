"use client";

import Link from "@/components/AppLink";

// タブ切替の統一デザイン（角丸ピル・アイコン付き・アクティブ＝ブランド色塗り＋白文字）。
//   KGI/マッチング/提案管理/エンド開拓/PRなど、画面内のモード切替に共通で使う。
//   使い方は2通り：
//     ① Link型 … 各タブに href を持たせると <Link> でページ/クエリ遷移する（KGI・マッチング・エンド開拓）。
//                 href は呼び出し側（Server Component可）で事前に文字列として計算しておくこと。
//                 ※ 関数(hrefFor等)をpropsで渡すのはNG：PillTabsは"use client"のため、Server
//                    Componentから関数を渡すとRSCのシリアライズ制約に違反しエラーになる。
//     ② 制御型 … href を持たせず onSelect を渡すと、呼び出し側の state 変更で切り替える
//                （提案管理・PR。onSelect はクライアントコンポーネント同士でのみ渡せる）。
//   アイコンは Material Symbols Outlined のリガチャ名を直接文字列で渡す（例: "work"）。

export type PillTabItem = {
  key: string;
  label: string;
  /** Link化する場合の遷移先。呼び出し側で文字列として事前計算する（関数は渡さない）。 */
  href?: string;
  /** Material Symbols Outlined のリガチャ名。iconNode指定時は無視される。 */
  icon?: string;
  /** ブランドロゴ等、リガチャ以外のカスタムアイコンを使いたい場合（例：LINEロゴ）。 */
  iconNode?: React.ReactNode;
  /** 件数バッジ・NEWマーク等、自由な内容を末尾に表示（呼び出し側で組み立てる）。 */
  badge?: React.ReactNode;
};

export function PillTabs({
  tabs, active, onSelect, rightSlot, size = "md",
}: {
  tabs: PillTabItem[];
  active: string;
  /** href を持たないタブがクリックされたときに呼ばれる（制御型・クライアント専用）。 */
  onSelect?: (key: string) => void;
  rightSlot?: React.ReactNode;
  /** md=通常（画面上部タブ）／sm=画面内サブタブなど少し小さめに使いたい場合。 */
  size?: "md" | "sm";
}) {
  const pad = size === "sm" ? "6px 13px" : "8px 16px";
  const fontSize = size === "sm" ? 12.5 : 13.5;
  const iconSize = size === "sm" ? 15 : 17;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div role="tablist" style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--color-surface-inset)", borderRadius: 12, flexWrap: "wrap" }}>
        {tabs.map((t) => {
          const on = t.key === active;
          const content = (
            <>
              {t.iconNode ?? (t.icon && <span className="material-symbols-outlined" aria-hidden style={{ fontSize: iconSize, lineHeight: 1 }}>{t.icon}</span>)}
              {t.label}
              {t.badge}
            </>
          );
          const style: React.CSSProperties = {
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: pad, borderRadius: 9, textDecoration: "none",
            fontSize, fontWeight: on ? 800 : 600, fontFamily: "inherit",
            background: on ? "var(--color-brand-600)" : "transparent",
            color: on ? "#fff" : "var(--color-ink-2)",
            boxShadow: on ? "0 1px 3px rgba(15,23,42,.18)" : "none",
            border: 0, cursor: "pointer", whiteSpace: "nowrap",
            transition: "background .12s ease, color .12s ease",
          };
          return t.href ? (
            <Link key={t.key} href={t.href} role="tab" aria-selected={on} prefetch={false} style={style}>{content}</Link>
          ) : (
            <button key={t.key} type="button" role="tab" aria-selected={on} style={style} onClick={() => onSelect?.(t.key)}>{content}</button>
          );
        })}
      </div>
      {rightSlot}
    </div>
  );
}
