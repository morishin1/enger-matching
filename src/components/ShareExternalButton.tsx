"use client";

// 外部共有リンクの発行ボタン＋モーダル。
//   開くと同時にリンクを発行（同一対象の有効リンクは再利用）し、
//   「外部の人に実際に見える画面」をそのまま iframe でプレビューしながら
//   URL・パスコード・案内文をコピーできる。マッチング画面などに置く。
//   children を渡すと、タイトルや人材名などの任意要素をクリックトリガーにできる。
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { createShareLink } from "@/lib/share-actions";

type Issued = { url: string; passcode: string | null; expiresAt: string | null; response?: string | null; respondedAt?: string | null };

const fmtDate = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

export function ShareExternalButton({ kind, no, compact = false, label = "外部共有", children }: {
  kind: "job" | "candidate";
  no: number;
  compact?: boolean;
  label?: string;
  /** 渡すと既定ボタンの代わりにこの要素をクリックトリガーにする（タイトル・人材名など）。 */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [usePass, setUsePass] = useState(true);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const kindLabel = kind === "job" ? "案件" : "人材";

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      try { window.prompt("以下をコピーしてください", text); } catch { /* noop */ }
    }
  };

  const issue = (pass: boolean) => {
    start(async () => {
      const r = await createShareLink(kind, no, { passcode: pass });
      if (!r.ok || !r.url) { toast(r.error || "発行に失敗しました", "error"); setOpen(false); return; }
      setIssued({ url: r.url, passcode: r.passcode ?? null, expiresAt: r.expiresAt ?? null, response: r.response ?? null, respondedAt: r.respondedAt ?? null });
    });
  };

  // 開いたら即発行（再利用によりURLは安定）。パスコード設定を切り替えたら再発行。
  useEffect(() => {
    if (open && !issued && !pending) issue(usePass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, usePass]);

  const openModal = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setOpen(true); };
  const close = () => { setOpen(false); setIssued(null); setCopied(null); };
  const togglePass = (v: boolean) => { setUsePass(v); setIssued(null); };

  // 先方へそのまま送れる案内文（URL＋パスコード）。
  const guideText = issued
    ? [
        kind === "job" ? "案件情報のご案内です。下記URLよりご確認ください。" : "人材情報のご紹介です（匿名）。下記URLよりご確認ください。",
        issued.url,
        issued.passcode ? `パスコード：${issued.passcode}` : "",
        fmtDate(issued.expiresAt) ? `（有効期限：${fmtDate(issued.expiresAt)}）` : "",
      ].filter(Boolean).join("\n")
    : "";

  return (
    <>
      {children ? (
        <button type="button" onClick={openModal}
          title={`クリックで外部共有ページ（ログイン不要・匿名サマリ）のデザインを確認してコピーできます`}
          style={{ background: "none", border: 0, padding: 0, margin: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left", display: "inline" }}>
          {children}
        </button>
      ) : (
        <button
          type="button"
          className={`btn ghost${compact ? " btn-xs" : ""}`}
          style={{ whiteSpace: "nowrap", flexShrink: 0 }}
          onClick={openModal}
          title={`ログイン不要で見られる${kindLabel}の共有リンクを発行（匿名サマリ・有効期限つき）。先方に見える画面をプレビューしてコピーできます`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: compact ? 14 : 16, verticalAlign: "-3px", marginRight: 3 }}>ios_share</span>
          {label}
        </button>
      )}

      {open && (
        <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(15,36,64,.45)", display: "grid", placeItems: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(760px, 96vw)", padding: 20, background: "var(--color-surface)", maxHeight: "92vh", overflowY: "auto" }} role="dialog" aria-modal="true">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 19, color: "var(--color-brand-700)" }}>ios_share</span>
              <div style={{ fontSize: 14.5, fontWeight: 800 }}>{kindLabel}を外部に共有（ログイン不要リンク）</div>
              <button type="button" onClick={close} className="btn ghost btn-xs" aria-label="閉じる" style={{ marginLeft: "auto", fontSize: 15 }}>×</button>
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 10 }}>
              ENGER に登録していない相手でも閲覧できる<b>専用ページのURL</b>です。
              {kind === "candidate" ? "人材は匿名（イニシャル＋スキル＋単価）で表示され、氏名・連絡先・所属会社は表示されません。" : "クライアント名・メール本文・連絡先は表示されません。"}
              有効期限30日。ページには「興味あります／見送り」の回答ボタンが付き、回答はお知らせに通知されます。
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={usePass} onChange={(e) => togglePass(e.target.checked)} />
              <span><b>パスコードで保護する（推奨）</b><span className="muted" style={{ marginLeft: 6 }}>6桁のパスコードを自動発行し、URLと一緒にお伝えします</span></span>
            </label>

            {!issued ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "18px 0", justifyContent: "center", color: "var(--color-ink-3)", fontSize: 12.5 }}>
                <span style={{ width: 14, height: 14, border: "2px solid rgba(0,0,0,.15)", borderTopColor: "var(--color-brand-600)", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />
                共有リンクを発行中…
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {issued.response && (
                  <div style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 8, padding: "8px 12px", background: issued.response === "興味あり" ? "#e7f7ee" : "#fdecef", color: issued.response === "興味あり" ? "#067647" : "#b42318", border: `1px solid ${issued.response === "興味あり" ? "#b5e3c8" : "#f7c5cf"}` }}>
                    先方の回答：{issued.response}{fmtDate(issued.respondedAt) ? `（${fmtDate(issued.respondedAt)}）` : ""}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input readOnly value={issued.url} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 220, fontFamily: "var(--font-mono, monospace)", fontSize: 12, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface-soft)", color: "var(--color-ink)" }} />
                  <button type="button" className="btn ghost btn-sm" onClick={() => copy(issued.url, "url")} style={{ whiteSpace: "nowrap" }}>{copied === "url" ? "✓ コピー済" : "URLをコピー"}</button>
                  {issued.passcode && (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>パスコード</span>
                      <b className="mono" style={{ fontSize: 15, letterSpacing: "0.18em" }}>{issued.passcode}</b>
                      <button type="button" className="btn ghost btn-xs" onClick={() => copy(issued.passcode!, "pass")}>{copied === "pass" ? "✓" : "コピー"}</button>
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button type="button" className="btn brand" onClick={() => copy(guideText, "guide")} style={{ flex: "1 1 260px" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: "-3px", marginRight: 4 }}>{copied === "guide" ? "check" : "content_copy"}</span>
                    {copied === "guide" ? "コピーしました" : "案内文をコピー（URL＋パスコード）"}
                  </button>
                  <a href={issued.url} target="_blank" rel="noopener noreferrer" className="btn ghost btn-sm" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 3 }}>open_in_new</span>
                    別タブで開く
                  </a>
                  {fmtDate(issued.expiresAt) && <span className="muted" style={{ fontSize: 11 }}>有効期限：{fmtDate(issued.expiresAt)}</span>}
                </div>

                {/* 先方に見える画面のプレビュー（実ページを iframe 表示。?preview=1 は社内ユーザーのみ
                    パスコード入力を省略して実表示を確認できる） */}
                <div>
                  <div className="muted" style={{ fontSize: 11.5, margin: "2px 0 6px" }}>先方に見える画面（プレビュー）</div>
                  <iframe src={`${issued.url}?preview=1`} title="外部共有ページのプレビュー"
                    style={{ width: "100%", height: "min(52vh, 460px)", border: "1px solid var(--color-border)", borderRadius: 10, background: "#fff" }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
