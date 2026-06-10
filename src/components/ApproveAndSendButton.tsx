"use client";

// 承認者向け：保存されたメール下書きをサーバから取得し、確認モーダルを表示。
//   「✓ 承認して送信」を押すと、SendBothMailsButton と同じ送信モーダル（SendBothModal）に
//   切り替わり、SMTP 送信→送信完了で markProposalMailSentAndApprove を呼ぶ。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getProposalPendingMail, markProposalMailSentAndApprove } from "@/lib/actions";
import { SendBothMailsButton } from "./SendBothMailsButton";

type Loaded = {
  job?: { to?: string; cc?: string; subject?: string; body?: string };
  cand?: { to?: string; cc?: string; subject?: string; body?: string };
  jobToken: string | null;
  candToken: string | null;
  jobTitle: string | null; company: string | null; candName: string | null;
};

function buildButtonHtml(siteUrl: string, token: string): string {
  const agreeUrl  = `${siteUrl}/respond?token=${token}&action=${encodeURIComponent("話を進める")}`;
  const rejectUrl = `${siteUrl}/respond?token=${token}&action=${encodeURIComponent("見送り")}`;
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:16px 0"><tr>
<td style="padding-right:12px"><a href="${agreeUrl}" target="_blank" style="display:inline-block;padding:12px 24px;background:#16a34a;color:#fff;font-weight:bold;font-size:14px;border-radius:8px;text-decoration:none;border:2px solid #15803d">話を進める</a></td>
<td><a href="${rejectUrl}" target="_blank" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;font-weight:bold;font-size:14px;border-radius:8px;text-decoration:none;border:2px solid #b91c1c">見送り</a></td>
</tr></table>`;
}

export function ApproveAndSendButton({ proposalId, jobNo, candNo }: { proposalId: string; jobNo?: number | null; candNo?: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [autoOpenSend, setAutoOpenSend] = useState(false);
  const [pending, start] = useTransition();

  const openReview = async () => {
    setOpen(true); setLoading(true); setErr(null);
    try {
      const r = await getProposalPendingMail(proposalId);
      if (!r.ok) { setErr(r.error); return; }
      if (!r.mail) { setErr("メール下書きが保存されていません。提案者にメール作成画面から再申請を依頼してください。"); return; }
      setData({ job: r.mail.job, cand: r.mail.cand, jobToken: r.jobToken, candToken: r.candToken, jobTitle: r.jobTitle, company: r.company, candName: r.candName });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "取得に失敗しました");
    } finally { setLoading(false); }
  };

  const onSent = () => {
    // 送信完了 → 承認＋ステージ進行＋送信記録
    start(async () => {
      const r = await markProposalMailSentAndApprove(proposalId);
      if (!r.ok) alert(r.error);
      setOpen(false);
      router.refresh();
    });
  };

  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
  const jobButtonHtml  = data?.jobToken  ? buildButtonHtml(siteUrl, data.jobToken)  : undefined;
  const candButtonHtml = data?.candToken ? buildButtonHtml(siteUrl, data.candToken) : undefined;

  return (
    <>
      <button type="button" className="btn brand btn-sm" disabled={pending} onClick={openReview}>📨 メール内容を確認して送信</button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "start center", zIndex: 600, padding: "32px 16px", overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-soft)" }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>✓ 承認して送信（承認者向け）</div>
              <button className="btn ghost btn-xs" onClick={() => setOpen(false)}>閉じる</button>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              {loading && <div className="muted" style={{ fontSize: 12 }}>読み込み中…</div>}
              {err && <div style={{ color: "var(--color-danger)", fontSize: 12.5 }}>{err}</div>}
              {data && (
                <>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    案件：<b>{data.jobTitle ?? "—"}</b>{data.company ? `（${data.company}）` : ""} ／ 人材：<b>{data.candName ?? "—"}</b>
                  </div>
                  <Preview label="案件側" mail={data.job} />
                  <Preview label="人材側" mail={data.cand} />
                  <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
                    内容を確認のうえ「✓ 承認して送信」を押すと、送信モーダルが開きます。送信完了で自動的に承認＋ステージ進行（→所属確認）になります。
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button type="button" className="btn ghost btn-sm" onClick={() => setOpen(false)}>キャンセル</button>
                    <SendBothMailsButton
                      label="✓ 承認して送信"
                      className="btn brand btn-sm"
                      autoOpen={autoOpenSend}
                      onAutoOpened={() => setAutoOpenSend(false)}
                      onSent={onSent}
                      jobSide={{
                        label: "案件側メール", dotColor: "#ef4444",
                        to: data.job?.to ?? "", cc: data.job?.cc ?? "",
                        subject: data.job?.subject ?? "", body: data.job?.body ?? "",
                        buttonHtml: jobButtonHtml,
                        relatedKind: "proposal_job",
                        relatedId: jobNo != null ? String(jobNo) : undefined,
                      }}
                      candSide={{
                        label: "人材側メール", dotColor: "#3b82f6",
                        to: data.cand?.to ?? "", cc: data.cand?.cc ?? "",
                        subject: data.cand?.subject ?? "", body: data.cand?.body ?? "",
                        buttonHtml: candButtonHtml,
                        relatedKind: "proposal_cand",
                        relatedId: candNo != null ? String(candNo) : undefined,
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Preview({ label, mail }: { label: string; mail?: { to?: string; cc?: string; subject?: string; body?: string } }) {
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 8 }}>
      <div style={{ padding: "8px 12px", background: "var(--color-surface-soft)", fontSize: 12, fontWeight: 700, borderBottom: "1px solid var(--color-border)" }}>{label}</div>
      <div style={{ padding: 12, fontSize: 12, color: "var(--color-ink-2)", display: "flex", flexDirection: "column", gap: 4 }}>
        <div>宛先：<span className="mono">{mail?.to || "—"}</span>{mail?.cc ? <span className="muted"> / CC: {mail.cc}</span> : null}</div>
        <div>件名：<b>{mail?.subject || "—"}</b></div>
        <details>
          <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--color-ink-3)" }}>本文を見る</summary>
          <pre style={{ marginTop: 6, fontFamily: "var(--font-sans)", fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap", background: "var(--color-surface-inset)", padding: 10, borderRadius: 6 }}>{mail?.body ?? ""}</pre>
        </details>
      </div>
    </div>
  );
}
