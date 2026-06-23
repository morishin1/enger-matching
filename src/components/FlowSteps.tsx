// 営業フローのステップバー。
//   メール取込 → データ整備 → マッチング → 提案管理 → 稼働管理 の5段を
//   「番号付き丸＋アイコン＋ラベル＋ヒント＋矢印」で視覚的に表示し、
//   各ページ上部に挿入。クリックで該当画面へジャンプ可能。
//
// 現在ステップ：濃いブランドカラーで強調。
// 完了ステップ：緑のチェック。
// 次ステップ：薄いブランド枠で「ここへ進む」を示唆。

import Link from "@/components/AppLink";

export type FlowStepKey = "mail" | "data" | "matching" | "proposals" | "progress";
type Step = { key: FlowStepKey; label: string; icon: string; href: string; hint: string };

const STEPS: Step[] = [
  { key: "mail",      label: "①メール取込",   icon: "inbox",         href: "/mail",      hint: "Gmail から案件・人材を取り込む" },
  { key: "data",      label: "②データ整備",   icon: "edit_note",     href: "/jobs",      hint: "案件・人材マスタを整える" },
  { key: "matching",  label: "③マッチング",   icon: "compare_arrows",href: "/matching",  hint: "AIで案件×人材を採点・提案" },
  { key: "proposals", label: "④提案管理",     icon: "assignment",    href: "/proposals", hint: "ステージを進めてクロージング" },
  { key: "progress",  label: "⑤稼働管理",     icon: "engineering",   href: "/progress",  hint: "稼働・契約・請求の月初業務" },
];

export function FlowSteps({ current, sub }: { current: FlowStepKey; sub?: string }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="営業フロー" className="flow-steps"
      style={{ display: "flex", alignItems: "stretch", gap: 0, padding: "10px 12px", background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 14, marginBottom: 14, overflowX: "auto" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, paddingRight: 12, flexShrink: 0 }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>route</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--color-brand-800)", whiteSpace: "nowrap" }}>進め方<span className="muted" style={{ fontWeight: 500, marginLeft: 4 }}>（この順番で操作）</span></span>
      </div>
      {/* minWidth: max-content が肝。これが無いと内側が nav 幅に押し縮められ、各ステップ(minWidth:96)が
          あふれて重なる（スマホで現在ステップの白カードが隣に被る事故）。max-content で「コンテンツ幅を
          下回らない」ようにすると、狭い画面は外側 nav が横スクロール、広い画面は flex:1 で均等に広がる。 */}
      <div style={{ display: "flex", alignItems: "stretch", flex: 1, minWidth: "max-content" }}>
        {STEPS.map((s, i) => {
          const isCurrent = i === currentIdx;
          const isDone = i < currentIdx;
          const isNext = i === currentIdx + 1;
          return (
            <span key={s.key} style={{ display: "inline-flex", alignItems: "center", flex: "1 1 auto", minWidth: 0 }}>
              <Link href={s.href} prefetch={false} aria-current={isCurrent ? "page" : undefined} title={s.hint}
                style={{
                  display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4,
                  padding: "6px 10px", borderRadius: 12, textDecoration: "none",
                  background: isCurrent ? "var(--color-surface)" : "transparent",
                  boxShadow: isCurrent ? "0 1px 3px rgba(15,23,42,.06)" : "none",
                  border: isCurrent ? "1px solid var(--color-brand-200)" : "1px solid transparent",
                  flex: "1 1 0", minWidth: 96, color: "inherit",
                }}>
                {/* アイコン丸（番号は色で表現せず、ラベルに ①②… を入れる） */}
                <span aria-hidden style={{
                  width: 38, height: 38, borderRadius: 99, display: "inline-grid", placeItems: "center",
                  background: isCurrent ? "var(--color-brand-600)" : isDone ? "#067647" : isNext ? "var(--color-brand-100)" : "var(--color-surface)",
                  color: isCurrent || isDone ? "#fff" : isNext ? "var(--color-brand-700)" : "var(--color-ink-3)",
                  border: isCurrent || isDone || isNext ? 0 : "1.5px solid var(--color-border-strong)",
                  boxShadow: isCurrent ? "0 2px 6px rgba(0,149,217,.35)" : "none",
                  flexShrink: 0,
                }}>
                  {isDone
                    ? <span className="material-symbols-outlined" style={{ fontSize: 20 }}>check</span>
                    : <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{s.icon}</span>}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: isCurrent ? "var(--color-brand-800)" : isDone ? "var(--color-ink-3)" : "var(--color-ink-2)", whiteSpace: "nowrap" }}>{s.label}</span>
                <span className="muted" style={{ fontSize: 10.5, lineHeight: 1.3, textAlign: "center", maxWidth: 140, whiteSpace: "normal" }}>{isCurrent && sub ? sub : s.hint}</span>
              </Link>
              {i < STEPS.length - 1 && (
                <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-ink-5)", flexShrink: 0, padding: "0 2px" }}>chevron_right</span>
              )}
            </span>
          );
        })}
      </div>
    </nav>
  );
}
