"use client";

// 提案詳細の「案件クローズ / 人材クローズ」ボタン。
//   ・押すと確認モーダル：理由（選択式＋自由記述）を入れないと確定不可。理由候補は案件/人材で分ける。
//   ・「もらったばかり」ガード：受領(created_at)が浅い or 初期段階(承認待ち/所属確認/提案中)のとき
//     強めの警告＋「本当にクローズする」チェックを入れないと実行できない（即クローズ抑止）。
//   ・確定で is_closed=true、ボタンは「クローズ済み」に。理由はメモ履歴へ自動追記。
//   ・会社/人材会社起因の理由は会社マスタの「取引注意」を加点（会社評価に連動）。
//   ・クローズ済みのときは押すと再開（is_closed=false）。
import { useState } from "react";
import { useRouter } from "next/navigation";
import { closeProposalEntity, bulkSetClosed } from "@/lib/actions";

// attribution: "self"=自社起因 / "counterparty"=会社・人材会社起因（取引注意加点） / "neutral"=中立。
type Reason = { value: string; attr: "self" | "counterparty" | "neutral" };
const JOB_REASONS: Reason[] = [
  { value: "募集終了・充足", attr: "neutral" },
  { value: "単価折り合わず", attr: "counterparty" },
  { value: "商流NG", attr: "counterparty" },
  { value: "連絡途絶（先方）", attr: "counterparty" },
  { value: "自社フォロー不足", attr: "self" },
  { value: "その他", attr: "neutral" },
];
const CAND_REASONS: Reason[] = [
  { value: "他決", attr: "neutral" },
  { value: "条件折り合わず", attr: "counterparty" },
  { value: "連絡途絶（人材）", attr: "counterparty" },
  { value: "品質懸念", attr: "counterparty" },
  { value: "自社フォロー不足", attr: "self" },
  { value: "その他", attr: "neutral" },
];

const EARLY_STAGES = new Set(["承認待ち", "所属確認", "提案中"]);

export function ProposalCloseControls({ side, label, no, closed, company, stage, createdAt, proposalId }: {
  side: "job" | "cand";
  label: string;          // 「案件」or「人材」
  no: number | null | undefined;
  closed: boolean;
  company?: string | null;
  stage?: string | null;
  createdAt?: string | null;
  proposalId?: string | null;
}) {
  const router = useRouter();
  const table = side === "job" ? "jobs" : "candidates";
  const idField = side === "job" ? "job_no" : "candidate_no";
  const REASONS = side === "job" ? JOB_REASONS : CAND_REASONS;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [caution, setCaution] = useState(false);
  const [confirmEarly, setConfirmEarly] = useState(false);

  // 受領日数＋ステージで「もらったばかり/提案前」を判定（強めの警告）。
  const days = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : null;
  const tooEarly = (days != null && days < 3) || EARLY_STAGES.has((stage ?? "").trim());

  const reset = () => { setReason(""); setNote(""); setCaution(false); setConfirmEarly(false); };
  const pickReason = (v: string) => {
    setReason(v);
    const r = REASONS.find((x) => x.value === v);
    setCaution(r?.attr === "counterparty"); // 会社・人材会社起因は既定で取引注意ON
  };

  const canSubmit = !!reason.trim() && (!tooEarly || confirmEarly) && !busy;

  const runClose = () => {
    if (!no) { alert(`${label}No が不明のためクローズできません`); return; }
    if (!canSubmit) return;
    setBusy(true);
    closeProposalEntity({ table, id: no, reason, note: note || null, company: company ?? null, caution, proposalId: proposalId ?? null, sideLabel: label })
      .then((r) => {
        setBusy(false);
        if (r.ok) { setOpen(false); reset(); router.refresh(); }
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
      <button type="button" className="btn ghost btn-xs" disabled={!no} onClick={() => { reset(); setOpen(true); }}
        title={no ? `${label}をクローズ（理由が必要）` : `${label}No が不明`} style={{ display: "inline-flex", alignItems: "center", gap: 5, width: "100%", justifyContent: "center" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>block</span>
        {label}クローズ
      </button>

      {open && (
        <div onClick={() => !busy && setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 500, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{label}をクローズ</h3>
              <button type="button" className="btn ghost btn-xs" disabled={busy} onClick={() => setOpen(false)}>閉じる</button>
            </div>

            {tooEarly && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 10, background: "#fdecef", border: "1px solid #f3a9b6", color: "#b42318", fontSize: 12, lineHeight: 1.7 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>warning</span>
                  <span><b>受領 {days != null ? `${days}日` : "間もない"}・まだ提案前です。</b>本当にクローズしますか？「もらったばかり」のクローズは機会損失になります。</span>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                  <input type="checkbox" checked={confirmEarly} onChange={(e) => setConfirmEarly(e.target.checked)} />
                  内容を確認のうえ、それでもクローズする
                </label>
              </div>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--color-ink-3)" }}>
              クローズ理由（必須・選択）
              <select value={reason} onChange={(e) => pickReason(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${reason ? "var(--color-border-strong)" : "var(--color-danger)"}`, fontSize: 13, fontFamily: "inherit" }}>
                <option value="">— 選択してください —</option>
                {REASONS.map((r) => <option key={r.value} value={r.value}>{r.value}</option>)}
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: "var(--color-ink-3)" }}>
              自由記述（任意・補足）
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="具体的な事情があれば記入（例：単価−5万で他社決定 / 3日連絡つかず 等）"
                style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
            </label>

            {company && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-ink-2)" }}>
                <input type="checkbox" checked={caution} onChange={(e) => setCaution(e.target.checked)} />
                <span>この会社（<b>{company}</b>）を<b>取引注意に加点</b>（会社評価に連動・一定回数で要注意会社）</span>
              </label>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span className="muted" style={{ fontSize: 10.5 }}>※ 理由はメモ履歴に自動記録されます。</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn ghost btn-xs" disabled={busy} onClick={() => setOpen(false)}>キャンセル</button>
                <button type="button" className="btn btn-sm" disabled={!canSubmit} onClick={runClose}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {busy && <span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />}
                  クローズする
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
