// 営業フローのステップバー。
//   メール取込 → マッチング → 提案管理 → 稼働管理 の4段を1行で示し、
//   現在のステップと次のステップを一目で分からせる。各ページの page-head 直下に挿入。

import Link from "next/link";

type StepKey = "mail" | "matching" | "proposals" | "progress";
type Step = { key: StepKey; label: string; icon: string; href: string; hint: string };

const STEPS: Step[] = [
  { key: "mail",      label: "メール取込",   icon: "inbox",            href: "/mail",      hint: "Gmail から案件・人材を取り込む" },
  { key: "matching",  label: "マッチング",   icon: "swap_horiz",       href: "/matching",  hint: "案件×人材を採点して提案候補へ" },
  { key: "proposals", label: "提案管理",     icon: "deployed_code",    href: "/proposals", hint: "ステージを進めてクロージング" },
  { key: "progress",  label: "稼働管理",     icon: "engineering",      href: "/progress",  hint: "稼働・契約・請求の月初業務" },
];

export function FlowSteps({ current, sub }: { current: StepKey; sub?: string }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label="営業フロー"
      style={{ display: "flex", alignItems: "stretch", gap: 4, padding: 4, background: "var(--color-surface-inset)", borderRadius: 12, marginBottom: 12, overflowX: "auto" }}>
      {STEPS.map((s, i) => {
        const isCurrent = i === currentIdx;
        const isDone = i < currentIdx;
        const isNext = i === currentIdx + 1;
        const color = isCurrent ? "var(--color-ink)" : isDone ? "var(--color-ink-3)" : isNext ? "var(--color-brand-700)" : "var(--color-ink-4)";
        const bg = isCurrent ? "var(--color-surface)" : "transparent";
        const border = isCurrent ? "0 1px 2px rgba(15,23,42,0.08)" : "none";
        return (
          <Link key={s.key} href={s.href} aria-current={isCurrent ? "page" : undefined}
            title={s.hint}
            style={{
              flex: 1, minWidth: 130,
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "8px 12px", borderRadius: 8,
              background: bg, boxShadow: border, color, textDecoration: "none",
              fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap",
            }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22, borderRadius: 99, fontSize: 11, fontWeight: 800,
              background: isCurrent ? "var(--color-brand-600)" : isDone ? "#067647" : "transparent",
              color: isCurrent || isDone ? "#fff" : "var(--color-ink-4)",
              border: isCurrent || isDone ? 0 : "1px solid var(--color-border)",
            }}>{isDone ? "✓" : i + 1}</span>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{s.icon}</span>
            <span>{s.label}</span>
            {isCurrent && sub && <span className="muted" style={{ fontSize: 10.5, fontWeight: 500, marginLeft: 4 }}>{sub}</span>}
            {isNext && <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 14, marginLeft: "auto", color: "var(--color-brand-700)" }}>chevron_right</span>}
          </Link>
        );
      })}
    </nav>
  );
}
