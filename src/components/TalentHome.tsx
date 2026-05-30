// 人材(candidate)ロール用の最小ダッシュボード。承認後に表示される。
// まずは「ようこそ＋登録状況」を案内。今後、自分のスキルシート編集やスカウト受信などを拡張予定。

export function TalentHome({ displayName }: { displayName?: string | null }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="meta">Talent · 人材ダッシュボード</div>
          <h1>ようこそ{displayName ? `、${displayName} さん` : ""}</h1>
          <div className="sub">登録が承認されました。ENGER があなたに合った案件をご紹介します。</div>
        </div>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#067647", background: "#e7f7ee", border: "1px solid #bfe3cc", borderRadius: 99, padding: "4px 12px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>verified</span>承認済み
          </span>
          <span className="muted" style={{ fontSize: 12 }}>担当エージェントがあなたのプロフィールを確認し、マッチング次第ご連絡します。</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 12 }}>
          {[
            { icon: "badge", t: "プロフィール", d: "スキル・希望単価・稼働時期などを担当にお伝えください。" },
            { icon: "work", t: "案件紹介", d: "ご経歴に合う案件が出たら、担当からご連絡します。" },
            { icon: "support_agent", t: "ご相談", d: "ご希望条件の変更や質問は担当エージェントへ。" },
          ].map((c) => (
            <div key={c.t} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 14 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: "var(--color-brand-700)" }}>{c.icon}</span>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 6 }}>{c.t}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.7 }}>{c.d}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 12.5, color: "var(--color-ink-2)" }}>
        ※ この画面は人材（エンジニア）向けです。スキルシートのアップロードやスカウト受信などの機能は順次追加予定です。
      </div>
    </div>
  );
}
