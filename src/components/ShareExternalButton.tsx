"use client";

// 外部共有リンクの発行ボタン＋モーダル。
//   ログイン不要で見られる匿名サマリページ(/share/<token>)のURLを発行し、
//   URL・パスコード・案内文をその場でコピーできる。マッチング画面などに置く。
import { useState, useTransition } from "react";
import { toast } from "@/components/toast";
import { createShareLink } from "@/lib/share-actions";

type Issued = { url: string; passcode: string | null; expiresAt: string | null; response?: string | null; respondedAt?: string | null };

const fmtDate = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

export function ShareExternalButton({ kind, no, compact = false }: { kind: "job" | "candidate"; no: number; compact?: boolean }) {
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

  const issue = () => {
    start(async () => {
      const r = await createShareLink(kind, no, { passcode: usePass });
      if (!r.ok || !r.url) { toast(r.error || "発行に失敗しました", "error"); return; }
      setIssued({ url: r.url, passcode: r.passcode ?? null, expiresAt: r.expiresAt ?? null, response: r.response ?? null, respondedAt: r.respondedAt ?? null });
    });
  };

  // 先方へそのまま送れる案内文（URL＋パスコード）。
  const guideText = issued
    ? [
        kind === "job" ? "案件情報のご案内です。下記URLよりご確認ください。" : "人材情報のご紹介です（匿名）。下記URLよりご確認ください。",
        issued.url,
        issued.passcode ? `パスコード：${issued.passcode}` : "",
        fmtDate(issued.expiresAt) ? `（有効期限：${fmtDate(issued.expiresAt)}）` : "",
      ].filter(Boolean).join("\n")
    : "";

  const close = () => { setOpen(false); setIssued(null); setCopied(null); };

  return (
    <>
      <button
        type="button"
        className={`btn ghost${compact ? " btn-xs" : ""}`}
        style={{ whiteSpace: "nowrap", flexShrink: 0 }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        title={`ログイン不要で見られる${kindLabel}の共有リンクを発行（匿名サマリ・有効期限つき）`}
      >
        <span className="material-symbols-outlined" style={{ fontSize: compact ? 14 : 16, verticalAlign: "-3px", marginRight: 3 }}>ios_share</span>
        外部共有
      </button>

      {open && (
        <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(15,36,64,.45)", display: "grid", placeItems: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(520px, 94vw)", padding: 20, background: "var(--color-surface)", maxHeight: "90vh", overflowY: "auto" }} role="dialog" aria-modal="true">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 19, color: "var(--color-brand-700)" }}>ios_share</span>
              <div style={{ fontSize: 14.5, fontWeight: 800 }}>{kindLabel}を外部に共有（ログイン不要リンク）</div>
              <button type="button" onClick={close} className="btn ghost btn-xs" aria-label="閉じる" style={{ marginLeft: "auto", fontSize: 15 }}>×</button>
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 12 }}>
              ENGER に登録していない相手でも閲覧できる<b>専用ページのURL</b>を発行します。
              {kind === "candidate" ? "人材は匿名（イニシャル＋スキル＋単価）で表示され、氏名・連絡先・所属会社は表示されません。" : "クライアント名・メール本文・連絡先は表示されません。"}
              リンクの有効期限は30日です。
            </div>

            {!issued ? (
              <>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 14, cursor: "pointer" }}>
                  <input type="checkbox" checked={usePass} onChange={(e) => setUsePass(e.target.checked)} />
                  <span><b>パスコードで保護する（推奨）</b><span className="muted" style={{ marginLeft: 6 }}>6桁のパスコードを自動発行し、URLと一緒にお伝えします</span></span>
                </label>
                <button type="button" className="btn brand" disabled={pending} onClick={issue} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  {pending && <span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />}
                  {pending ? "発行中…" : "共有リンクを発行する"}
                </button>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {issued.response && (
                  <div style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 8, padding: "8px 12px", background: issued.response === "興味あり" ? "#e7f7ee" : "#fdecef", color: issued.response === "興味あり" ? "#067647" : "#b42318", border: `1px solid ${issued.response === "興味あり" ? "#b5e3c8" : "#f7c5cf"}` }}>
                    先方の回答：{issued.response}{fmtDate(issued.respondedAt) ? `（${fmtDate(issued.respondedAt)}）` : ""}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input readOnly value={issued.url} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono, monospace)", fontSize: 12, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface-soft)", color: "var(--color-ink)" }} />
                  <button type="button" className="btn ghost btn-sm" onClick={() => copy(issued.url, "url")} style={{ whiteSpace: "nowrap" }}>{copied === "url" ? "✓ コピー済" : "URLをコピー"}</button>
                </div>
                {issued.passcode && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 12.5, color: "var(--color-ink-3)" }}>パスコード</span>
                    <b className="mono" style={{ fontSize: 16, letterSpacing: "0.2em" }}>{issued.passcode}</b>
                    <button type="button" className="btn ghost btn-xs" onClick={() => copy(issued.passcode!, "pass")}>{copied === "pass" ? "✓" : "コピー"}</button>
                  </div>
                )}
                <button type="button" className="btn brand" onClick={() => copy(guideText, "guide")} style={{ width: "100%" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: "-3px", marginRight: 4 }}>{copied === "guide" ? "check" : "content_copy"}</span>
                  {copied === "guide" ? "コピーしました" : "案内文をコピー（URL＋パスコード）"}
                </button>
                <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                  <a href={issued.url} target="_blank" rel="noopener noreferrer" className="btn ghost btn-sm" style={{ textDecoration: "none" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: "-2px", marginRight: 3 }}>open_in_new</span>
                    先方に見える画面を確認
                  </a>
                  {fmtDate(issued.expiresAt) && <span className="muted" style={{ fontSize: 11 }}>有効期限：{fmtDate(issued.expiresAt)}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
