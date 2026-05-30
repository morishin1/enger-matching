import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "プライバシーポリシー | ENGER（エンジャー）",
  description: "ENGER のプライバシーポリシー。個人情報の取り扱い・テナント分離・第三者提供について。",
};

const wrap: React.CSSProperties = { maxWidth: 820, margin: "0 auto", padding: "40px 24px", color: "#1f2937", lineHeight: 1.9, fontSize: 14 };
const h2: React.CSSProperties = { fontSize: 18, fontWeight: 800, color: "#0F2440", marginTop: 32, marginBottom: 10 };
const meta: React.CSSProperties = { color: "#6b7280", fontSize: 12 };

export default function PrivacyPage() {
  return (
    <main style={{ background: "#fff" }}>
      <div style={wrap}>
        <div style={meta}>最終更新日：2026年5月30日</div>
        <h1 style={{ fontSize: 28, fontWeight: 900, margin: "8px 0 4px", color: "#0F2440" }}>プライバシーポリシー</h1>
        <p style={meta}>株式会社エイト（以下「当社」）は、ENGER 関連サービス（dx.enger.jp、enger.jp、ag.enger.jp、以下「本サービス」）の運営にあたり、個人情報を以下のとおり取り扱います。</p>

        <h2 style={h2}>1. 取得する情報</h2>
        <ul>
          <li>氏名、メールアドレス、電話番号、メッセージID（LINE等）</li>
          <li>所属会社名、職務経歴、スキル、希望単価、稼働条件</li>
          <li>登録元LP、登録方式（Google / GitHub / メール等）、登録日時</li>
          <li>本サービス利用に伴うアクセスログ、操作履歴、AI利用ログ</li>
        </ul>

        <h2 style={h2}>2. 利用目的</h2>
        <ul>
          <li>本サービスの提供・運営・本人確認・承認</li>
          <li>人材と案件のマッチング、提案・契約・稼働管理</li>
          <li>利用者への連絡・サポート・面談調整</li>
          <li>サービス改善、不正利用の検知・防止</li>
          <li>法令に基づく対応</li>
        </ul>

        <h2 style={h2}>3. テナント分離・匿名化（情報漏洩防止）</h2>
        <p>本サービスは複数の利用区分（ユーザー企業、パートナー企業、副業エージェント、人材、社内エージェント）が同じシステムを共有しますが、<b>他社の人材・案件情報はイニシャル・スキル・単価のみの匿名表示</b>とし、氏名・連絡先・クライアント名等は表示されません。利用者間の不要な情報接触を構造的に防いでいます。</p>

        <h2 style={h2}>4. 第三者提供</h2>
        <p>当社は、利用者の同意なく個人情報を第三者へ提供することはありません。ただし以下の場合を除きます。</p>
        <ul>
          <li>法令に基づく場合</li>
          <li>人の生命・身体・財産の保護に必要で、本人の同意を得ることが困難な場合</li>
          <li>業務委託先（Supabase、Vercel、Anthropic、OpenAI、Google 等のクラウド事業者）に、本サービス運営に必要な範囲で取り扱いを委託する場合</li>
        </ul>

        <h2 style={h2}>5. 外部サービスとAI</h2>
        <p>本サービスは Supabase（データベース・認証）、Vercel（ホスティング）、Anthropic / OpenAI / Google（AI処理）等の外部サービスを利用します。提案文生成や抽出処理のため、必要最小限の情報をこれら事業者へ送信する場合があります。</p>

        <h2 style={h2}>6. 保存期間</h2>
        <p>個人情報は利用目的の達成に必要な期間保存し、不要となった時点で適切に削除します。退会・利用停止の申し出があった場合、法令上保持義務のある情報を除き、合理的な期間内に削除します。</p>

        <h2 style={h2}>7. ご本人の権利</h2>
        <p>ご本人は、当社が保有する個人情報の開示・訂正・削除・利用停止を請求できます。下記お問い合わせ窓口までご連絡ください。</p>

        <h2 style={h2}>8. Cookie・解析</h2>
        <p>本サービスは利便性向上のため Cookie を使用する場合があります。ブラウザ設定で無効化することも可能ですが、一部機能が利用できなくなる場合があります。</p>

        <h2 style={h2}>9. 改訂</h2>
        <p>本ポリシーは随時改訂されることがあります。重要な変更がある場合は本サイトに掲載してお知らせします。</p>

        <h2 style={h2}>10. お問い合わせ</h2>
        <p>株式会社エイト ITS事業部　<a href="mailto:support_eigyo@8grp.co.jp" style={{ color: "#0095D9" }}>support_eigyo@8grp.co.jp</a></p>

        <div style={{ marginTop: 40, fontSize: 12, color: "#6b7280" }}>
          <Link href="/terms" style={{ color: "#0095D9", fontWeight: 700 }}>利用規約</Link>
          {" / "}
          <Link href="/" style={{ color: "#0095D9", fontWeight: 700 }}>トップへ戻る</Link>
        </div>
      </div>
    </main>
  );
}
