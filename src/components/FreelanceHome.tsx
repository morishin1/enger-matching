// 副業エージェント(freelance)向けホーム（ag.enger.jp）。漏洩防止のため限定機能のみ。
import Link from "next/link";

export function FreelanceHome({ displayName }: { displayName?: string | null }) {
  const cards = [
    { href: "/matching", icon: "compare_arrows", t: "マッチング", d: "自分＋共有の案件・人材で相性の良いペアを表示（他社は匿名）。" },
    { href: "/jobs", icon: "work", t: "案件（自分・共有）", d: "あなたが集めた案件を登録・管理。共有案件も匿名で確認。" },
    { href: "/people", icon: "groups", t: "人材（自分・共有）", d: "あなたが集めた人材を登録・管理。共有人材も匿名で確認。" },
  ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="meta">ENGER Agent · 副業エージェント</div>
          <h1>ようこそ{displayName ? `、${displayName} さん` : ""}</h1>
          <div className="sub">スキマ時間で人材・案件を集め、マッチングに貢献いただけます。<b>他社の情報は匿名（イニシャル＋スキル＋単価）</b>で表示され、氏名・連絡先は表示されません。提案・契約は社内担当が仲介します。</div>
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

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>💰 報酬について</div>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
          あなたが登録した人材・案件が成約（稼働化）すると紹介報酬の対象になります。成約状況・報酬の確認機能は順次追加予定です。
          まずは<b>良質な人材・案件の登録</b>と<b>共有</b>から始めてください。
        </div>
      </div>

      <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 12.5, color: "var(--color-ink-2)" }}>
        ※ あなたが登録した案件・人材はあなたのみ閲覧できます。共有設定したものだけ、他のエージェント・企業とマッチング対象になります（匿名表示）。
      </div>
    </div>
  );
}
