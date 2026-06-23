import Link from "@/components/AppLink";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "副業エージェント募集 | ENGER（エンジャー）",
  description: "スキマ時間で、SESの人材マッチングを。あなたの人脈と営業力で案件と人材をつなぎ、成約で報酬を得られます。ENGERのマッチング機能を無料で利用できます。",
};

const NAVY = "#0F2440";
const BLUE = "#0095D9";

const sectionPad: React.CSSProperties = { maxWidth: 1040, margin: "0 auto", padding: "0 20px" };

function Step({ n, t, d }: { n: number; t: string; d: string }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{ flex: "0 0 36px", width: 36, height: 36, borderRadius: 99, background: BLUE, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontFamily: "var(--font-display)" }}>{n}</div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800, color: NAVY }}>{t}</div>
        <div style={{ fontSize: 13.5, color: "#475467", lineHeight: 1.8, marginTop: 4 }}>{d}</div>
      </div>
    </div>
  );
}

export default function AgentLP() {
  return (
    <main style={{ background: "#fff", color: NAVY, fontFamily: "var(--font-sans)" }}>
      {/* ヘッダー */}
      <header style={{ borderBottom: "1px solid #eef1f5" }}>
        <div style={{ ...sectionPad, display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/enger-logo.png" alt="ENGER" style={{ height: 26 }} />
          <Link href="/signup?as=freelance" style={{ background: BLUE, color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 13.5, padding: "9px 18px", borderRadius: 99 }}>無料で登録</Link>
        </div>
      </header>

      {/* ヒーロー */}
      <section style={{ background: `linear-gradient(160deg, #eaf6fd 0%, #f7fbff 60%, #fff 100%)` }}>
        <div style={{ ...sectionPad, padding: "64px 20px 56px", display: "grid", gridTemplateColumns: "1fr", gap: 24 }}>
          <div style={{ maxWidth: 720 }}>
            <span style={{ display: "inline-block", fontSize: 12.5, fontWeight: 800, color: BLUE, background: "#fff", border: "1px solid #cfe7f8", borderRadius: 99, padding: "5px 14px", marginBottom: 18 }}>副業エージェント募集</span>
            <h1 style={{ fontSize: 38, lineHeight: 1.3, fontWeight: 900, margin: 0, letterSpacing: ".01em" }}>
              スキマ時間で、<span style={{ color: BLUE }}>人をつなぐ</span>。<br />SESの人材マッチングを副業で。
            </h1>
            <p style={{ fontSize: 15.5, color: "#475467", lineHeight: 1.9, marginTop: 18 }}>
              あなたの人脈と営業力で、エンジニア（人材）と案件をマッチング。ENGERのマッチング機能を使って、案件探し・人材探し・クロージングまで完結。<b style={{ color: NAVY }}>成約で報酬</b>を得られます。
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
              <Link href="/signup?as=freelance" style={{ background: BLUE, color: "#fff", textDecoration: "none", fontWeight: 800, fontSize: 15, padding: "14px 30px", borderRadius: 99, boxShadow: "0 6px 18px rgba(0,149,217,.3)" }}>無料ではじめる</Link>
              <a href="#how" style={{ color: NAVY, textDecoration: "none", fontWeight: 700, fontSize: 15, padding: "14px 22px", borderRadius: 99, border: "1.5px solid #d6dce5" }}>仕組みを見る</a>
            </div>
            <div style={{ fontSize: 12, color: "#98a2b3", marginTop: 14 }}>登録は無料・審査制 / スマホ・PCどちらでもOK</div>
          </div>
        </div>
      </section>

      {/* こんな方に */}
      <section style={{ ...sectionPad, padding: "56px 20px" }}>
        <h2 style={{ fontSize: 24, fontWeight: 900, textAlign: "center", margin: "0 0 8px" }}>こんな方に向いています</h2>
        <p style={{ textAlign: "center", color: "#667085", fontSize: 14, margin: "0 0 32px" }}>特別な準備は不要。人とのつながりを活かせます。</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: 16 }}>
          {[
            { i: "groups", t: "エンジニアの人脈がある", d: "フリーランス・知人のエンジニアを案件につなげたい方。" },
            { i: "handshake", t: "営業・人材の経験がある", d: "SES・人材紹介・IT営業の経験を副業で活かしたい方。" },
            { i: "schedule", t: "スキマ時間で稼ぎたい", d: "本業のかたわら、空き時間でマッチングに取り組みたい方。" },
          ].map((c) => (
            <div key={c.t} style={{ border: "1px solid #eef1f5", borderRadius: 14, padding: 22, background: "#fff" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 30, color: BLUE }}>{c.i}</span>
              <div style={{ fontSize: 16, fontWeight: 800, marginTop: 10 }}>{c.t}</div>
              <div style={{ fontSize: 13.5, color: "#475467", lineHeight: 1.8, marginTop: 6 }}>{c.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 仕組み */}
      <section id="how" style={{ background: "#f7fafd", borderTop: "1px solid #eef1f5", borderBottom: "1px solid #eef1f5" }}>
        <div style={{ ...sectionPad, padding: "56px 20px" }}>
          <h2 style={{ fontSize: 24, fontWeight: 900, textAlign: "center", margin: "0 0 8px" }}>はじめ方は4ステップ</h2>
          <p style={{ textAlign: "center", color: "#667085", fontSize: 14, margin: "0 0 32px" }}>登録・審査のうえ、ENGERのマッチング機能を無料で使えます。</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: 28, maxWidth: 880, margin: "0 auto" }}>
            <Step n={1} t="無料登録・審査" d="メールで登録。運営の審査後、すぐにご利用いただけます。" />
            <Step n={2} t="人材・案件を集める" d="あなたが見つけたエンジニア（人材）や案件をENGERに登録します。" />
            <Step n={3} t="マッチング" d="ENGERが相性の良いペアを自動でスコアリング。案件×人材を見極めます。" />
            <Step n={4} t="クロージング → 報酬" d="商談・条件調整を進め、成約（稼働化）すると紹介報酬の対象になります。" />
          </div>
        </div>
      </section>

      {/* 報酬・特徴 */}
      <section style={{ ...sectionPad, padding: "56px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: 16 }}>
          {[
            { i: "payments", t: "成約で報酬", d: "あなたが登録した人材・案件が稼働化すると紹介報酬が発生します。" },
            { i: "shield_person", t: "情報は安全に分離", d: "他社の情報は匿名表示。あなたの登録情報はあなたのみ閲覧でき、漏洩を防ぎます。" },
            { i: "bolt", t: "ツールは無料", d: "ENGERのマッチング機能を無料で利用。面倒な管理表は不要です。" },
            { i: "support_agent", t: "運営がサポート", d: "提案・契約まわりは運営担当が仲介。はじめてでも安心して進められます。" },
          ].map((c) => (
            <div key={c.t} style={{ border: "1px solid #eef1f5", borderRadius: 14, padding: 22 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 28, color: BLUE }}>{c.i}</span>
              <div style={{ fontSize: 15.5, fontWeight: 800, marginTop: 8 }}>{c.t}</div>
              <div style={{ fontSize: 13.5, color: "#475467", lineHeight: 1.8, marginTop: 6 }}>{c.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: "#f7fafd", borderTop: "1px solid #eef1f5" }}>
        <div style={{ ...sectionPad, padding: "56px 20px", maxWidth: 760 }}>
          <h2 style={{ fontSize: 24, fontWeight: 900, textAlign: "center", margin: "0 0 28px" }}>よくある質問</h2>
          {[
            { q: "未経験でもできますか？", a: "エンジニアの知人がいる、人材・営業の経験がある方が向いています。まずは登録のうえ、運営にご相談ください。" },
            { q: "本業の会社にバレませんか？", a: "副業として個人でご利用いただけます。登録情報はあなたのみ閲覧でき、他社の情報は匿名表示です。" },
            { q: "費用はかかりますか？", a: "登録・ツール利用は無料です。成約時に紹介報酬が発生する成果報酬型です。" },
            { q: "個人情報の扱いは？", a: "他社の人材・案件はイニシャル＋スキル＋単価のみの匿名表示。連絡先・氏名は表示されません。" },
          ].map((f) => (
            <div key={f.q} style={{ borderBottom: "1px solid #e6ebf1", padding: "16px 0" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>Q. {f.q}</div>
              <div style={{ fontSize: 13.5, color: "#475467", lineHeight: 1.9, marginTop: 6 }}>{f.a}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: NAVY, color: "#fff" }}>
        <div style={{ ...sectionPad, padding: "56px 20px", textAlign: "center" }}>
          <h2 style={{ fontSize: 26, fontWeight: 900, margin: "0 0 12px" }}>あなたの人脈を、収入に。</h2>
          <p style={{ fontSize: 15, color: "#c9d4e3", margin: "0 0 28px" }}>登録は無料。まずは1人・1案件の登録から始められます。</p>
          <Link href="/signup?as=freelance" style={{ background: BLUE, color: "#fff", textDecoration: "none", fontWeight: 800, fontSize: 16, padding: "16px 40px", borderRadius: 99, display: "inline-block", boxShadow: "0 8px 22px rgba(0,149,217,.4)" }}>無料で副業エージェント登録</Link>
        </div>
      </section>

      <footer style={{ ...sectionPad, padding: "28px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, color: "#98a2b3", fontSize: 12 }}>
        <span>© ENGER</span>
        <span style={{ display: "flex", gap: 16 }}>
          <a href="/terms" target="_blank" rel="noreferrer" style={{ color: "#667085" }}>利用規約</a>
          <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: "#667085" }}>プライバシー</a>
          <Link href="/login" style={{ color: "#667085" }}>ログイン</Link>
        </span>
      </footer>
    </main>
  );
}
