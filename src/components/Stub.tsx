export function Stub({ label }: { label: string }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="meta">Coming Soon</div>
          <h1>{label}</h1>
          <div className="sub">この画面は次フェーズで実装します。現在はダッシュボードを実装済みです。</div>
        </div>
      </div>
      <div className="card" style={{ display: "grid", placeItems: "center", padding: 80, color: "var(--color-ink-4)" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, textAlign: "center" }}>
          {label} 画面 — placeholder
          <div style={{ fontSize: 11, marginTop: 8 }}>次フェーズで実装します</div>
        </div>
      </div>
    </div>
  );
}
