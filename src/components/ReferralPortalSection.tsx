"use client";

// 企業管理の詳細モーダルに置く「紹介元ポータル」発行セクション。
//   知り合い企業（人材を紹介してくれる会社）に、会員登録なしの簡易ログイン（/ref）を発行する。
//   パスコードはハッシュ保存のため発行時に一度だけ表示（控えて相手に渡す）。
import { useEffect, useState } from "react";
import { getReferralPortalInfo, issueReferralPortal, revokeReferralPortal, type ReferralPortalInfo } from "@/lib/referral-actions";

export function ReferralPortalSection({ company }: { company: string }) {
  const [info, setInfo] = useState<ReferralPortalInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 発行直後の資格情報（一度だけ表示）。
  const [issued, setIssued] = useState<{ loginId: string; passcode: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = () => { getReferralPortalInfo(company).then((r) => { if (r.ok) setInfo(r.info ?? null); else setErr(r.error ?? null); }).catch(() => {}); };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [company]);

  const issue = async () => {
    if (info?.exists && !confirm("パスコードを再発行しますか？（現在のパスコードは使えなくなります。IDは変わりません）") && info.active) return;
    setBusy(true); setErr(null);
    try {
      const r = await issueReferralPortal(company);
      if (r.ok && r.loginId && r.passcode) { setIssued({ loginId: r.loginId, passcode: r.passcode, url: r.url ?? "" }); reload(); }
      else setErr(r.error ?? "発行に失敗しました");
    } finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!confirm("紹介元ポータルを停止しますか？（相手は即ログインできなくなります。再開はパスコード再発行で行えます）")) return;
    setBusy(true); setErr(null);
    try {
      const r = await revokeReferralPortal(company);
      if (r.ok) { setIssued(null); reload(); } else setErr(r.error ?? "停止に失敗しました");
    } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!issued) return;
    const text = `【ENGER 紹介元ポータル】\nURL：${issued.url}\nID：${issued.loginId}\nパスコード：${issued.passcode}\n\nご紹介いただいた人材と、マッチする案件をご確認いただけます。`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { try { window.prompt("コピーしてください", text); } catch { /* noop */ } }
  };

  const stateLabel = info?.state === "revoked" ? "停止中" : info?.state === "expired" ? "期限切れ" : info?.state === "locked" ? "ロック中（失敗超過）" : "有効";

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-brand-700)" }}>handshake</span>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>紹介元ポータル</span>
        <span className="muted" style={{ fontSize: 11 }}>会員登録なしの簡易ログインで、紹介人材×マッチ案件だけを見せる（/ref）</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {info?.exists && info.active && (
            <button type="button" className="btn ghost btn-xs" onClick={revoke} disabled={busy}>停止</button>
          )}
          <button type="button" className="btn brand btn-xs" onClick={issue} disabled={busy}>
            {busy ? "処理中…" : info?.exists ? "パスコード再発行" : "発行"}
          </button>
        </div>
      </div>

      {info?.exists && (
        <div className="muted" style={{ fontSize: 11.5 }}>
          ID：<span className="mono" style={{ fontWeight: 700 }}>{info.loginId}</span>
          <span style={{ marginLeft: 10 }}>状態：<b style={{ color: info.active ? "var(--color-brand-700)" : "var(--color-danger)" }}>{stateLabel}</b></span>
          <span style={{ marginLeft: 10 }}>閲覧 {info.viewCount ?? 0} 回</span>
          {(info.requestCount ?? 0) > 0 && <span style={{ marginLeft: 10 }}>提案依頼 <b>{info.requestCount}</b> 件</span>}
          {info.expiresAt && <span style={{ marginLeft: 10 }}>期限 {String(info.expiresAt).slice(0, 10)}</span>}
        </div>
      )}

      {issued && (
        <div style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 10, padding: "10px 12px", fontSize: 12.5 }}>
          <div style={{ fontWeight: 700, color: "var(--color-brand-700)", marginBottom: 4 }}>発行しました。パスコードは今だけ表示されます（控えて相手に渡してください）。</div>
          <div className="mono" style={{ lineHeight: 1.9 }}>
            URL：{issued.url}<br />ID：{issued.loginId}<br />パスコード：<b>{issued.passcode}</b>
          </div>
          <button type="button" className="btn ghost btn-xs" onClick={copy} style={{ marginTop: 6 }}>{copied ? "コピーしました" : "案内文をコピー"}</button>
        </div>
      )}

      {err && <div style={{ fontSize: 11.5, color: "var(--color-danger)" }}>{err}</div>}
    </div>
  );
}
