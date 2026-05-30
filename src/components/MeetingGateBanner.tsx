// 面談前ロックバナー。承認だけ済んだ外部ロール（client/partner/freelance/candidate）が
// 詳細を見ようとした時に表示する。LINE / メール / 電話の連絡先 CTA を一括表示。
//   - 連絡先は環境変数 NEXT_PUBLIC_AGENT_LINE_URL / NEXT_PUBLIC_AGENT_EMAIL / NEXT_PUBLIC_AGENT_PHONE
//   - 未設定なら「運営にお問い合わせください」のフォールバック

export function MeetingGateBanner({ title = "詳細はエージェント面談後に解放されます", description }: { title?: string; description?: string }) {
  const line = process.env.NEXT_PUBLIC_AGENT_LINE_URL;
  const email = process.env.NEXT_PUBLIC_AGENT_EMAIL;
  const phone = process.env.NEXT_PUBLIC_AGENT_PHONE;
  const any = !!(line || email || phone);
  return (
    <div style={{ background: "#fff6e0", border: "1px solid #fde9b0", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: "#9a7b12", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>lock</span>
        {title}
      </div>
      <div style={{ fontSize: 12.5, color: "#6b5410", lineHeight: 1.8 }}>
        {description ?? "ご利用前に担当エージェントとの面談（オンライン可）をお願いしています。下記までお気軽にご連絡ください。面談後、管理者が「面談済み」を設定すると詳細を閲覧できるようになります。"}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
        {line && <a href={line} target="_blank" rel="noreferrer" className="btn btn-xs" style={{ background: "#06C755", color: "#fff", borderColor: "#06C755", textDecoration: "none" }}>💬 LINEで相談</a>}
        {email && <a href={`mailto:${email}`} className="btn btn-xs" style={{ background: "#e0567f", color: "#fff", borderColor: "#e0567f", textDecoration: "none" }}>✉ メールで相談</a>}
        {phone && <a href={`tel:${phone}`} className="btn btn-xs" style={{ background: "#0095D9", color: "#fff", borderColor: "#0095D9", textDecoration: "none" }}>📞 電話で相談</a>}
        {!any && <span className="muted" style={{ fontSize: 11.5 }}>担当エージェントの連絡先：運営にお問い合わせください</span>}
      </div>
    </div>
  );
}
