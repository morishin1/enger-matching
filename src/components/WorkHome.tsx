import Link from "@/components/AppLink";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { listNotifications } from "@/lib/notifications";

type WLink = { href: string; label: string; icon: string; desc: string };

/** 非営業（バックオフィス/EC/サポート等）向けのシンプルな業務ホーム。 */
export async function WorkHome({ name, functions }: { name: string; functions: string[] }) {
  const today = new Date().toISOString().slice(0, 10);
  let reportToday = false;
  if (dbConfigured && name) {
    try { const sb = engerClient(); const { data } = await sb.from("daily_reports").select("id").eq("author", name).eq("report_date", today).maybeSingle(); reportToday = !!data; } catch { /* noop */ }
  }
  const notes = (await listNotifications(name)).slice(0, 4);

  // 職能に応じた業務リンク
  const links: WLink[] = [];
  if (functions.includes("バックオフィス")) {
    links.push({ href: "/billing", label: "請求・勤怠", icon: "💴", desc: "勤怠チェックと請求書発行のタスク" });
    links.push({ href: "/progress", label: "稼働管理", icon: "📋", desc: "契約・更新・精算の管理" });
  }
  links.push({ href: "/reports", label: "日報", icon: "📝", desc: "今日の振り返り" });
  links.push({ href: "/notifications", label: "お知らせ", icon: "🔔", desc: "管理者からの連絡・フィードバック" });

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Home · {functions.join(" / ") || "業務"}</div>
          <h1>{name ? `${name} さんのホーム` : "ホーム"}</h1>
          <div className="sub">担当業務のメニューと、日報・お知らせをここから。</div>
        </div>
      </div>

      {name && !reportToday && (
        <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: "#fff5e6", border: "1px solid #f6d9a7" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#b45309" }}>📝 今日の日報がまだ未提出です。1日の振り返りを記録しましょう。</span>
          <Link href="/reports" className="btn brand btn-xs" style={{ textDecoration: "none" }}>日報を書く →</Link>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="card" style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", gap: 4, padding: 18 }}>
            <div style={{ fontSize: 22 }}>{l.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{l.label}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{l.desc}</div>
          </Link>
        ))}
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🔔 最近のお知らせ</h3>
          <Link href="/notifications" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-700,#0b5cab)", textDecoration: "none" }}>すべて見る →</Link>
        </div>
        {notes.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>お知らせはありません。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {notes.map((n) => (
              <div key={n.id} style={{ padding: "9px 12px", border: "1px solid var(--color-border)", borderRadius: 10, background: n.read_at ? "var(--color-surface)" : "var(--color-brand-25)" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{!n.read_at && <span style={{ color: "var(--color-brand-600)" }}>● </span>}{n.title}</div>
                {n.body && <div className="muted" style={{ fontSize: 12, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>{n.body}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
