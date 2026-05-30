// パートナー企業(partner)向けホーム。漏洩防止のため限定機能のみ案内。
import Link from "next/link";

export function PartnerHome({ companyName, displayName }: { companyName?: string | null; displayName?: string | null }) {
  const cards = [
    { href: "/jobs", icon: "work", t: "案件（自社・共有）", d: "自社の案件を登録・管理。共有案件も匿名で確認できます。" },
    { href: "/people", icon: "groups", t: "人材（自社・共有）", d: "自社の人材を登録・管理。共有人材も匿名で確認できます。" },
  ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="meta">Partner · パートナー企業</div>
          <h1>ようこそ{companyName ? `、${companyName}` : displayName ? `、${displayName} さん` : ""}</h1>
          <div className="sub">自社で登録した案件・人材と、共有された案件・人材でマッチングできます。<b>他社の情報は匿名（イニシャル＋スキル＋単価）</b>で表示され、氏名・連絡先は表示されません。</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: 14 }}>
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="card" style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", gap: 6, padding: 18 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 26, color: "var(--color-brand-700)" }}>{c.icon}</span>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{c.t}</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>{c.d}</div>
          </Link>
        ))}
      </div>

      <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 12.5, color: "var(--color-ink-2)" }}>
        ※ 自社で登録した案件・人材は御社のみ閲覧できます。共有設定された案件・人材のみ、他社とマッチング対象になります（匿名表示）。
      </div>
    </div>
  );
}
