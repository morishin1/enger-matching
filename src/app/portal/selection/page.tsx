import { redirect } from "next/navigation";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";

export const dynamic = "force-dynamic";

const STAGE: Record<string, { c: string }> = {
  "応募": { c: "#64748b" }, "書類選考": { c: "#64748b" }, "面談": { c: "#0b5cab" },
  "面談合格": { c: "#0b5cab" }, "稼働": { c: "#067647" }, "見送り": { c: "#b42318" },
};
// 企業側は仲介前のため実名を出さない。先頭1文字のイニシャルのみ表示（実名確認は担当が仲介）。
const initialsOf = (name: string | null) => (name ? name.slice(0, 1) : "—");
const fmt = (s: string) => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()}`; };

/** ユーザー企業(client)向け：自社案件への応募者と選考ステージ（匿名）。 */
export default async function PortalSelectionPage() {
  const access = await currentAccess();
  if (access && access.role !== "client") redirect("/");

  const companyName = access?.companyName ?? null;
  let rows: any[] = [];
  let note: string | null = null;

  if (!companyName) {
    note = "アカウントに会社名が未設定です。管理者に会社名の登録を依頼してください。";
  } else if (dbConfigured) {
    try {
      const sb = engerClient();
      const like = `%${companyName}%`;
      const { data: jobs } = await sb.from("jobs").select("id, title").ilike("client_name", like).limit(500);
      const jobIds = (jobs ?? []).map((j: any) => j.id);
      const jobTitle = new Map((jobs ?? []).map((j: any) => [j.id, j.title]));
      if (jobIds.length) {
        const { data: apps } = await sb.from("applications")
          .select("id, engineer_name, job_id, job_title, stage, created_at")
          .in("job_id", jobIds).order("created_at", { ascending: false }).limit(300);
        rows = (apps ?? []).map((a: any) => ({ ...a, title: a.job_title || jobTitle.get(a.job_id) || "案件" }));
      }
    } catch { note = "データの取得に失敗しました。"; }
  }

  const counts = rows.reduce((m: Record<string, number>, r) => { m[r.stage || "応募"] = (m[r.stage || "応募"] ?? 0) + 1; return m; }, {});
  const order = ["応募", "書類選考", "面談", "面談合格", "稼働", "見送り"];

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">選考管理 · {companyName ?? "—"}</div>
          <h1>選考管理（応募者）</h1>
          <div className="sub">貴社案件への応募者と選考ステージです。氏名はイニシャル表示です。面談調整・実名確認は担当エージェントが仲介します。</div>
        </div>
      </div>

      {note && <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13, marginBottom: 14 }}>{note}</div>}

      {!note && (
        <>
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            {order.filter((s) => s !== "見送り").map((s) => (
              <div key={s} className="kpi"><div><div className="val tnum">{counts[s] ?? 0}</div><div className="label">{s}</div></div></div>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="card" style={{ fontSize: 13, color: "var(--color-ink-3)" }}>まだ応募者はいません。<a href="/portal/jobs" style={{ color: "var(--color-brand-700)", fontWeight: 700 }}>案件を掲載</a>すると、人材からの応募がここに表示されます。</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map((r) => {
                const st = STAGE[r.stage] ?? STAGE["応募"];
                return (
                  <div key={r.id} className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 14px" }}>
                    <div className="ava" style={{ width: 38, height: 38, flex: "0 0 38px" }}>{initialsOf(r.engineer_name)}</div>
                    <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                      <div className="muted" style={{ fontSize: 11 }}>応募 {fmt(r.created_at)}</div>
                    </div>
                    <span style={{ flex: "0 0 auto", fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 999, color: "#fff", background: st.c }}>{r.stage || "応募"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
