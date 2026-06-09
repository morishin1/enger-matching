"use client";

// ゴミ箱の一覧。復元・完全削除（admin限定）と、「指定日より前を一括ゴミ箱へ」の入口。
//   ・選択チェックで一括復元 / 一括完全削除
//   ・上部に「6/1以前の取込分を一括でゴミ箱へ」ボタン（admin限定・ドライランで件数確認→実行）

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  restoreJobs, restoreCandidates, purgeJobs, purgeCandidates, bulkTrashBefore,
} from "@/lib/actions";

type Kind = "jobs" | "candidates";
type Row = any;

const DEFAULT_CUTOFF_JST = "2026-06-01"; // JST 0:00（要望どおりの「6/1以前」）

function toJstMidnightIso(ymd: string): string {
  // YYYY-MM-DD を JST(+09:00) の 00:00 として ISO に。
  return new Date(`${ymd}T00:00:00+09:00`).toISOString();
}

export function TrashClient({ kind, rows, isAdmin }: { kind: Kind; rows: Row[]; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cutoff, setCutoff] = useState(DEFAULT_CUTOFF_JST);
  const [preview, setPreview] = useState<{ targets: number; protectedCount: number; sampleTitles: string[] } | null>(null);

  const noField: "job_no" | "candidate_no" = kind === "jobs" ? "job_no" : "candidate_no";
  const allNos = useMemo(() => rows.map((r) => r[noField]).filter((n) => typeof n === "number"), [rows, noField]);
  const allOn = allNos.length > 0 && allNos.every((n) => sel.has(n));
  const nos = [...sel];

  const run = (fn: () => Promise<any>, ok: string) => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r?.ok) { setMsg({ ok: true, text: r.count != null ? `${ok}（${r.count}件）` : (r.targets != null ? `${ok}（${r.targets}件）` : ok) }); router.refresh(); setSel(new Set()); }
      else setMsg({ ok: false, text: r?.error ?? "失敗しました" });
    });
  };

  const doRestore = () => run(
    () => kind === "jobs" ? restoreJobs(nos) : restoreCandidates(nos),
    "復元しました",
  );
  const doPurge = () => {
    if (!confirm(`選択した ${nos.length} 件を完全削除します。元には戻せません。よろしいですか？`)) return;
    run(
      () => kind === "jobs" ? purgeJobs(nos) : purgeCandidates(nos),
      "完全削除しました",
    );
  };

  // 6/1以前を一括ゴミ箱へ
  const doDryRun = () => {
    setPreview(null); setMsg(null);
    start(async () => {
      const r = await bulkTrashBefore({ kind, cutoffIso: toJstMidnightIso(cutoff), dryRun: true });
      if (r.ok) setPreview({ targets: r.targets, protectedCount: r.protectedCount, sampleTitles: r.sampleTitles });
      else setMsg({ ok: false, text: r.error });
    });
  };
  const doBulk = () => {
    if (!preview) return;
    if (!confirm(`${preview.targets} 件を ${cutoff} より前としてゴミ箱に移します。提案履歴がある ${preview.protectedCount} 件は除外されます。よろしいですか？`)) return;
    setMsg(null);
    start(async () => {
      const r = await bulkTrashBefore({ kind, cutoffIso: toJstMidnightIso(cutoff), dryRun: false });
      if (r.ok) { setMsg({ ok: true, text: `${r.targets} 件をゴミ箱に移しました（保護 ${r.protectedCount} 件）` }); setPreview(null); router.refresh(); }
      else setMsg({ ok: false, text: r.error });
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 一括移動 */}
      {isAdmin && (
        <div className="card" style={{ borderColor: "var(--color-brand-100)", background: "var(--color-brand-25)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📦 指定日より前の{kind === "jobs" ? "案件" : "人材"}を一括でゴミ箱へ</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
            <span>取込日（created_at）が</span>
            <input type="date" value={cutoff} onChange={(e) => setCutoff(e.target.value)} disabled={pending}
              style={{ fontFamily: "inherit", fontSize: 12.5, padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }} />
            <span>より前を対象（JST 0:00 基準）</span>
            <button className="btn btn-sm" onClick={doDryRun} disabled={pending}>件数を確認</button>
            {preview && (
              <button className="btn brand btn-sm" onClick={doBulk} disabled={pending || preview.targets === 0}>
                {preview.targets}件をゴミ箱へ移す
              </button>
            )}
          </div>
          {preview && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--color-ink-2)" }}>
              対象 <b>{preview.targets}件</b> / 提案履歴があり保護 <b>{preview.protectedCount}件</b>
              {preview.sampleTitles.length > 0 && (
                <div style={{ marginTop: 4, color: "var(--color-ink-4)", fontSize: 11 }}>例：{preview.sampleTitles.join(" / ")}{preview.targets > preview.sampleTitles.length ? " …" : ""}</div>
              )}
            </div>
          )}
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>※ 提案管理に1度でも紐づいた{kind === "jobs" ? "案件" : "人材"}（失注・見送り含む）は対象から除外されます。実行後もこのゴミ箱から復元できます。</div>
        </div>
      )}

      {msg && <div className="card" style={{ borderColor: msg.ok ? "var(--color-success)" : "var(--color-danger)", color: msg.ok ? "var(--color-success)" : "var(--color-danger)", fontSize: 13 }}>{msg.text}</div>}

      {/* 個別選択の操作 */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(allNos))} disabled={pending || rows.length === 0} />
            全選択（{rows.length}件）
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-xs" disabled={pending || nos.length === 0} onClick={doRestore}>選択を復元（{nos.length}）</button>
            <button className="btn btn-xs" disabled={pending || nos.length === 0 || !isAdmin} onClick={doPurge}
              title={isAdmin ? "" : "管理者のみ完全削除できます"}
              style={{ color: isAdmin ? "#b42318" : undefined, borderColor: isAdmin ? "#f7c5cf" : undefined }}>
              完全削除（{nos.length}）
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: "24px 0" }}>ゴミ箱は空です。</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl tbl-compact" style={{ minWidth: 560 }}>
              <thead><tr>
                <th></th>
                <th>{kind === "jobs" ? "案件No" : "人材No"}</th>
                <th>{kind === "jobs" ? "案件名" : "氏名"}</th>
                <th>{kind === "jobs" ? "クライアント" : "所属"}</th>
                <th>取込日</th>
                <th>削除日</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const id = r[noField];
                  const on = sel.has(id);
                  return (
                    <tr key={id}>
                      <td><input type="checkbox" checked={on} onChange={() => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })} disabled={pending} /></td>
                      <td className="mono">{kind === "jobs" ? `J-${String(id).padStart(5, "0")}` : `P-${String(id).padStart(5, "0")}`}</td>
                      <td>{kind === "jobs" ? (r.title ?? "—") : (r.name ?? r.initials ?? "—")}</td>
                      <td style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>{kind === "jobs" ? (r.client_name ?? "—") : (r.source_company ?? r.company ?? "—")}</td>
                      <td style={{ fontSize: 11 }}>{(r.created_at ?? "").slice(0, 10)}</td>
                      <td style={{ fontSize: 11 }}>{(r.deleted_at ?? "").slice(0, 10)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
