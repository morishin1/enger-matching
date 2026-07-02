import type { Metadata } from "next";
import { cookies } from "next/headers";
import { currentAccess } from "@/lib/accounts";
import { getShareLink, loadShareView, shareLinkState, bumpShareView, shareCookieName, shareCookieValue, shareUrl, shareViewText } from "@/lib/share";
import { verifySharePasscode, recordShareResponse } from "@/lib/share-actions";
import { ShareToolbar } from "./ShareToolbar";

// メール版ボタンと同じエンジャーのレインボーバー（MailComposeWizard と同配色）。
const RAINBOW = "linear-gradient(90deg,#e94141,#f5a623,#ffd93d,#38c172,#0095D9,#7c3aed)";

export const dynamic = "force-dynamic";

// 外部共有ページ（ログイン不要）。検索エンジンには載せない。
export const metadata: Metadata = {
  title: "共有情報｜ENGER",
  robots: { index: false, follow: false },
};

// 共有ページの共通ガワ（中央寄せの1枚カード）。印刷時はボタン類(.no-print)を消す。
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--color-surface-soft)" }}>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } .share-card { box-shadow: none !important; border: none !important; } }`}</style>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "36px 20px 64px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/enger-logo.png" alt="ENGER" width={26} height={26} style={{ borderRadius: 6 }} />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 17, color: "var(--color-ink)" }}>ENGER</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "var(--color-brand-25)", color: "var(--color-brand-700)", border: "1px solid var(--color-brand-100)" }}>business</span>
          <span className="muted" style={{ marginLeft: "auto", fontSize: 11.5 }}>外部共有ページ</span>
        </div>
        {children}
        <div className="muted" style={{ fontSize: 11, marginTop: 20, lineHeight: 1.8 }}>
          この情報は ENGER（エンジャー）の担当者から共有されました。詳細のご確認・ご面談などのご希望は、共有元の担当者までご連絡ください。
          本ページの内容の無断転載・再配布はご遠慮ください。
        </div>
      </div>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Frame>
      <div className="card share-card" style={{ padding: 28, textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{title}</div>
        <div className="muted" style={{ fontSize: 13 }}>{body}</div>
      </div>
    </Frame>
  );
}

export default async function SharePage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ err?: string; done?: string; preview?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;

  // 社内プレビュー（?preview=1）：ログイン中の社内ユーザー（admin/agent）に限り、
  //   パスコード入力を省略して「先方に見える画面」をそのまま確認できる（発行モーダルの iframe 用）。
  //   外部の閲覧者には効かない（未ログイン→通常のパスコードゲート）。
  let isPreview = false;
  if (sp.preview) {
    try {
      const access = await currentAccess();
      isPreview = !!access && (access.role === "admin" || access.role === "agent");
    } catch { /* 未ログイン等 → 通常表示 */ }
  }

  const link = await getShareLink(token);
  if (!link) return <Notice title="リンクが無効です" body="この共有リンクは存在しないか、削除されています。共有元の担当者にご確認ください。" />;

  const state = shareLinkState(link);
  if (state === "locked") {
    return <Notice title="このリンクはロックされています" body="パスコードの入力失敗が規定回数を超えたため、安全のためこのリンクを無効化しました。共有元の担当者に再発行をご依頼ください。" />;
  }
  if (state !== "ok") {
    return <Notice title="リンクの有効期限が切れています" body="この共有リンクは有効期限切れ、または無効化されています。共有元の担当者に再発行をご依頼ください。" />;
  }

  // パスコード付きリンク：Cookie（検証済みの印）が無ければ入力フォームを出す（社内プレビューは省略）。
  if (link.passcode && !isPreview) {
    const store = await cookies();
    const cv = store.get(shareCookieName(link.token))?.value;
    if (cv !== shareCookieValue(link.token, link.passcode)) {
      return (
        <Frame>
          <div className="card share-card" style={{ padding: 28, maxWidth: 440, margin: "0 auto" }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>パスコードを入力してください</div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>この共有ページはパスコードで保護されています。共有元からご案内の6桁のパスコードを入力してください。</div>
            {sp.err && <div style={{ fontSize: 12.5, color: "var(--color-danger)", background: "#fdecef", border: "1px solid #f7c5cf", borderRadius: 8, padding: "8px 11px", marginBottom: 10 }}>パスコードが一致しません。ご確認のうえ再入力してください。</div>}
            <form action={verifySharePasscode} style={{ display: "flex", gap: 8 }}>
              <input type="hidden" name="token" value={link.token} />
              <input
                name="passcode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6桁のパスコード" required
                style={{ flex: 1, fontFamily: "var(--font-mono, monospace)", fontSize: 18, letterSpacing: "0.3em", textAlign: "center", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}
              />
              <button type="submit" className="btn brand" style={{ whiteSpace: "nowrap" }}>表示する</button>
            </form>
          </div>
        </Frame>
      );
    }
  }

  const view = await loadShareView(link);
  if (!view) return <Notice title="情報が見つかりません" body="共有対象の情報が見つかりませんでした（削除された可能性があります）。共有元の担当者にご確認ください。" />;

  if (!isPreview) await bumpShareView(link); // 社内プレビューは閲覧数に数えない
  const url = shareUrl(link.token);
  const copyText = shareViewText(view, url);
  const kindLabel = view.kind === "job" ? "案件のご案内" : "人材のご紹介（匿名）";

  return (
    <Frame>
      {isPreview && (
        <div className="no-print" style={{ fontSize: 12, fontWeight: 700, color: "#92400e", background: "#fff6e0", border: "1px solid #fde9b0", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
          社内プレビュー：外部の閲覧者には{link.passcode ? "パスコード入力後に" : ""}この画面が表示されます（回答ボタンはプレビューでは押せません）。
        </div>
      )}
      <div className="card share-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", background: "var(--color-brand-25)", borderBottom: "1px solid var(--color-brand-100)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "0.08em", color: "var(--color-brand-700)" }}>{kindLabel}</span>
          <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11 }}>{view.subheading}</span>
        </div>
        <div style={{ padding: "22px 24px" }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 4px", lineHeight: 1.4 }}>{view.heading}</h1>
          {view.closed && (
            <div style={{ fontSize: 12, fontWeight: 700, color: "#b45309", background: "#fff6e0", border: "1px solid #fde9b0", borderRadius: 8, padding: "6px 10px", margin: "8px 0" }}>
              ※ こちらは現在募集/提案を締め切っている可能性があります。最新状況は担当までご確認ください。
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            {view.rows.map((r) => (
              <div key={r.label} style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--color-border)", fontSize: 13.5 }}>
                <div className="muted" style={{ fontSize: 12 }}>{r.label}</div>
                <div style={{ color: "var(--color-ink)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.value}</div>
              </div>
            ))}
          </div>
          {view.skills.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 700, marginBottom: 8 }}>スキル</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {view.skills.map((s) => <span key={s} className="tag brand" style={{ fontSize: 12 }}>{s}</span>)}
              </div>
            </div>
          )}
          <div className="muted" style={{ fontSize: 11.5, marginTop: 18, lineHeight: 1.7 }}>
            {view.kind === "candidate"
              ? "※ 個人情報保護のため匿名（イニシャル）でご紹介しています。氏名・連絡先・所属のご確認は ENGER 担当が仲介いたします。"
              : "※ 参画条件・商流などの詳細は ENGER 担当までお問い合わせください。"}
          </div>
        </div>
      </div>

      {/* 興味あり/見送り の回答（メールで送っている「話を進める/見送り」ボタンのWEB版）。
          回答は共有元の担当者に通知される。再度選び直せば回答の変更もできる。 */}
      <div className="card share-card no-print" style={{ marginTop: 14, padding: "18px 24px" }}>
        <div style={{ height: 4, borderRadius: 2, background: RAINBOW, marginBottom: 16 }} />
        {sp.done && link.response && (
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#067647", background: "#e7f7ee", border: "1px solid #b5e3c8", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
            ご回答ありがとうございました（{link.response}）。担当者よりご連絡させていただきます。
          </div>
        )}
        <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 12 }}>ご確認のうえ、いずれかをお選びください</div>
        <form action={recordShareResponse} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input type="hidden" name="token" value={link.token} />
          <button type="submit" name="choice" value="interested" disabled={isPreview}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "inherit", fontSize: 14, fontWeight: 800, color: "#fff", background: "linear-gradient(90deg,#16a34a,#0d9488)", border: "none", borderRadius: 999, padding: "12px 26px", cursor: isPreview ? "not-allowed" : "pointer", opacity: isPreview ? 0.6 : 1, boxShadow: "0 4px 12px rgba(22,163,74,.25)" }}>
            <span style={{ display: "inline-grid", placeItems: "center", width: 18, height: 18, borderRadius: 99, background: "#fff", color: "#16a34a", fontSize: 12, fontWeight: 900, lineHeight: 1 }}>✓</span>
            興味あります
          </button>
          <button type="submit" name="choice" value="declined" disabled={isPreview}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "inherit", fontSize: 14, fontWeight: 800, color: "#dc2626", background: "#fff", border: "1.5px solid #fca5a5", borderRadius: 999, padding: "12px 26px", cursor: isPreview ? "not-allowed" : "pointer", opacity: isPreview ? 0.6 : 1 }}>
            <span style={{ display: "inline-grid", placeItems: "center", width: 18, height: 18, borderRadius: 99, background: "#dc2626", color: "#fff", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✕</span>
            見送り
          </button>
        </form>
        {link.response && !sp.done && (
          <div style={{ fontSize: 12, color: "var(--color-ink-2)", marginTop: 10 }}>
            現在のご回答：<b>{link.response}</b>（変更する場合は再度お選びください）
          </div>
        )}
        <div className="muted" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.8 }}>
          こちらのご回答で料金は発生しません。<br />
          ご回答は共有元の担当者へ通知され、進捗があり次第ご連絡させていただきます。
        </div>
        <div style={{ height: 4, borderRadius: 2, background: RAINBOW, marginTop: 16 }} />
      </div>

      <ShareToolbar copyText={copyText} />
    </Frame>
  );
}
