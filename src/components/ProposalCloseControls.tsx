"use client";

// 提案詳細の「案件クローズ / 人材クローズ」ボタン。
//   ・押すと理由入力モーダル（理由は常に必須）。実行で is_closed=true、ボタンは「クローズ済み」に。
//   ・「もらったばかり/提案前」（受領日数が浅い or ステージが提案前）は警告バナーを出す（ブロックはしない）。
//   ・理由は会社評価（取引注意フラグ）に連動できる（負の理由は既定でON）。
//   ・クローズ済みのときは押すと再開（is_closed=false。理由は残す）。
import { useState } from "react";
import { useRouter } from "next/navigation";
import { closeProposalEntity, bulkSetClosed } from "@/lib/actions";

// クローズ理由。caution=true の理由は会社を「取引注意」にする既定にする。
const CLOSE_REASONS: { value: string; caution: boolean }[] = [
  { value: "充足・決定済み（他で決まった）", caution: false },
  { value: "募集終了・案件クローズ", caution: false },
  { value: "条件・単価が合わない", caution: false },
  { value: "連絡が取れない・レスポンス不良", caution: true },
  { value: "ミスマッチが多い・質が低い", caution: true },
  { value: "取引トラブル・対応不良", caution: true },
  { value: "その他", caution: false },
];

export function ProposalCloseControls({ side, label, no, closed, company, stage, createdAt }: {
  side: "job" | "cand";
  label: string;          // 「案件」or「人材」
  no: number | null | undefined;
  closed: boolean;
  company?: string | null;
  stage?: string | null;
  createdAt?: string | null;
}) {
  const router = useRouter();
  const table = side === "job" ? "jobs" : "candidates";
  const idField = side === "job" ? "job_no" : "candidate_no";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [caution, setCaution] = useState(false);

  // 受領日数＋ステージで「もらったばかり/提案前」を警告。
  const days = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : null;
  const PRE_PROPOSAL = new Set(["承認待ち", "所属確認"]);
  const tooEarly = (days != null && days < 3) || PRE_PROPOSAL.has((stage ?? "").trim());

  const pickReason = (v: string) => {
    setReason(v);
    const r = CLOSE_REASONS.find((x) => x.value === v);
    setCaution(!!r?.caution); // 負の理由は既定で取引注意ON（連動）
  };

  const runClose = () => {
    if (!no) { alert(`${label}No が不明のためクローズできません`); return; }
    if (!reason.trim()) { alert("クローズ理由を選択してください"); return; }
    setBusy(true);
    closeProposalEntity({ table, id: no, reason, company: company ?? null, caution })
      .then((r) => {
        setBusy(false);
        if (r.ok) { setOpen(false); setReason(""); setCaution(false); router.refresh(); }
        else alert(r.error ?? "クローズに失敗しました");
      });
  };

  const reopen = () => {
    if (!no) return;
    if (!confirm(`${label}のクローズを解除して再開しますか？`)) return;
    setBusy(true);
    bulkSetClosed(table, idField, [no], false, "/proposals").then((r) => {
      setBusy(false);
      if (r.ok) router.refresh();
      else alert((r as any).error ?? "再開に失敗しました");
    });
  };

  if (closed) {
    return (
      <button type="button" className="btn ghost btn-xs" disabled={busy || !no} onClick={reopen}
        title="クリックで再開（クローズ解除）" style={{ display: "inline-flex", alignItems: "center", gap: 5, width: "100%", justifyContent: "center", color: "#067647" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>check_circle</span>
        {label}クローズ済み
      </button>
    );
  }

  return (
    <>
      <button type="button" className="btn ghost btn-xs" disabled={!no} onClick={() => setOpen(true)}
        title={no ? `${label}をクローズ（理由が必要）` : `${label}No が不明`} style={{ display: "inline-flex", alignItems: "center", gap: 5, width: "100%", justifyContent: "center" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>block</span>
        {label}クローズ
      </button>

      {open && (
        <div onClick={() => !busy && setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 500, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{label}をクローズ</h3>
              <button type="button" className="btn ghost btn-xs" disabled={busy} onClick={() => setOpen(false)}>閉じる</button>
            </div>

            {tooEarly && (
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 12px", borderRadius: 10, background: "#fff7ed", border: "1px solid #f5b97f", color: "#9a3412", fontSize: 12, lineHeight: 1.7 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>warning</span>
                <span>{PRE_PROPOSAL.has((stage ?? "").trim()) ? "まだ提案前のステージです。" : `受領から ${days} 日です。`}「もらったばかり／提案前」のクローズの可能性があります。内容を確認のうえ実行してください。</span>
              </div>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--color-ink-3)" }}>
              クローズ理由（必須）
              <select value={reason} onChange={(e) => pickReason(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${reason ? "var(--color-border-strong)" : "var(--color-danger)"}`, fontSize: 13, fontFamily: "inherit" }}>
                <option value="">— 選択してください —</option>
                {CLOSE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.value}</option>)}
              </select>
            </label>

            {company && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-ink-2)" }}>
                <input type="checkbox" checked={caution} onChange={(e) => setCaution(e.target.checked)} />
                <span>この会社（<b>{company}</b>）を<b>取引注意</b>にする（理由を会社評価に連動）</span>
              </label>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn ghost btn-xs" disabled={busy} onClick={() => setOpen(false)}>キャンセル</button>
              <button type="button" className="btn btn-sm" disabled={busy || !reason} onClick={runClose}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {busy && <span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />}
                クローズする
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
