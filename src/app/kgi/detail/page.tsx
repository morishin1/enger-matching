// KGI数値の「根拠」ドリルダウン。ダッシュボード/KGIの各実績数値からリンクで来る。
//   例）提案 3件 → その3件の提案（案件名・人材名・担当・日付）を一覧。件数は集計と一致する。
import type { CSSProperties } from "react";
import Link from "@/components/AppLink";
import { currentAccess } from "@/lib/accounts";
import { listKgiEvidence } from "@/lib/kpi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const METRIC_OK = new Set(["proposal", "schedule", "deal", "meeting", "jobinfo", "candinfo"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const t = new Date(d);
  return isNaN(t.getTime()) ? String(d).slice(0, 10) : `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()}`;
};

export default async function KgiDetailPage({ searchParams }: { searchParams: Promise<{ metric?: string; from?: string; to?: string; ctx?: string }> }) {
  const sp = await searchParams;
  const access = await currentAccess();
  if (!access) return <div className="page"><div className="card">ログインが必要です。</div></div>;

  const metric = String(sp.metric ?? "");
  const from = String(sp.from ?? "");
  const to = String(sp.to ?? "");
  const ctx = sp.ctx ? String(sp.ctx) : null;
  const valid = METRIC_OK.has(metric) && DATE_RE.test(from) && DATE_RE.test(to);

  const ev = valid ? await listKgiEvidence({ metric, fromISO: from, toISO: to, ownerName: null }) : null;

  const th: CSSProperties = { textAlign: "left", padding: "9px 12px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, whiteSpace: "nowrap" };
  const td: CSSProperties = { padding: "10px 12px", fontSize: 13, borderTop: "1px solid var(--color-border)", verticalAlign: "top" };
  const isMeeting = metric === "meeting" || metric === "jobinfo" || metric === "candinfo";

  return (
    <div className="page">
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="meta">KGI / KPI · 根拠データ</div>
          <h1 style={{ fontSize: 22 }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 24, verticalAlign: "-5px", marginRight: 8, color: "var(--color-brand-700)" }}>fact_check</span>
            {ev ? ev.label : "根拠データ"}
            {ev && <span className="mono" style={{ marginLeft: 10, fontSize: 18, color: "var(--color-brand-700)" }}>{ev.count}件</span>}
          </h1>
          <div className="sub">
            {DATE_RE.test(from) && DATE_RE.test(to) ? <>期間 {fmtDate(from)}〜{fmtDate(to)}</> : "期間指定なし"}
            {ctx && <span className="muted"> ・ {ctx}</span>}
            <span className="muted"> ・ この数値を構成する{isMeeting ? "打ち合わせ記録" : "提案"}の一覧です（集計と件数一致）。</span>
          </div>
        </div>
        <Link href="/kgi" prefetch={false} className="btn ghost" style={{ textDecoration: "none" }}>← KGI/KPI へ戻る</Link>
      </div>

      {!valid ? (
        <div className="card" style={{ color: "var(--color-ink-4)" }}>パラメータが不正です（metric / from / to）。</div>
      ) : ev && ev.count === 0 ? (
        <div className="card" style={{ color: "var(--color-ink-4)" }}>この期間・指標に該当するデータはありません。</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>
                <th style={th}>#</th>
                <th style={th}>{isMeeting ? "企業" : "案件"}</th>
                <th style={th}>{isMeeting ? "獲得情報" : "人材 / 企業"}</th>
                <th style={th}>担当</th>
                <th style={th}>{isMeeting ? "打合せ日" : "日付"}</th>
                <th style={th}></th>
              </tr></thead>
              <tbody>
                {ev!.items.map((it, i) => (
                  <tr key={it.id}>
                    <td style={{ ...td, color: "var(--color-ink-4)" }} className="mono">{i + 1}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{it.primary}</td>
                    <td style={td}>{it.secondary ?? "—"}</td>
                    <td style={td}>{it.owner ?? "—"}</td>
                    <td style={td} className="mono">{fmtDate(it.at)}</td>
                    <td style={td}>
                      <Link href={isMeeting ? "/meetings" : "/proposals"} prefetch={false} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>
                        {isMeeting ? "打合せ記録へ" : "提案管理へ"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
