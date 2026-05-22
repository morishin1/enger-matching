import { engerClient, dbConfigured } from "@/lib/supabase";

/** ユーザー企業(client)向けの自社ポータル。自社の案件と提案状況のみ表示。 */
export async function ClientHome({ companyName, displayName }: { companyName: string | null; displayName?: string | null }) {
  let jobs: any[] = [];
  let proposals: any[] = [];
  let note: string | null = null;

  if (!companyName) {
    note = "アカウントに会社名が未設定です。管理者に会社名の登録を依頼してください。";
  } else if (dbConfigured) {
    try {
      const sb = engerClient();
      const like = `%${companyName}%`;
      const [jr, pr] = await Promise.all([
        sb.from("jobs").select("job_no, title, role_label, salary_min, salary_max, remote_type, status, created_at")
          .eq("is_published", true).ilike("client_name", like).order("created_at", { ascending: false }).limit(100),
        sb.from("proposals").select("id, job_title, c_init, rate, stage, created_at")
          .ilike("company", like).order("created_at", { ascending: false }).limit(100),
      ]);
      jobs = jr.data ?? [];
      proposals = pr.data ?? [];
    } catch (e) {
      note = "データの取得に失敗しました。時間をおいて再度お試しください。";
    }
  } else {
    note = "システム設定が未完了です。";
  }

  const salary = (a?: number | null, b?: number | null) => {
    if (!a && !b) return "—";
    const f = (n?: number | null) => (n == null ? "" : `${Math.round(n / 10000)}万`);
    return a && b ? `${f(a)}〜${f(b)}` : f(a || b);
  };
  const remote = (t?: string | null) => ({ full: "フルリモート", hybrid: "ハイブリッド", onsite: "出社" } as Record<string, string>)[t ?? ""] ?? (t || "—");

  const activeProps = proposals.filter((p) => p.stage !== "見送り" && p.stage !== "失注");
  const won = proposals.filter((p) => p.stage === "稼働決定" || p.stage === "稼働中");

  const stageTone = (s?: string) => {
    if (s === "稼働決定" || s === "稼働中") return { bg: "#e7f7ee", fg: "#067647" };
    if (s === "見送り" || s === "失注") return { bg: "#fdecef", fg: "#b42318" };
    return { bg: "#eaf4fd", fg: "#0b5cab" };
  };

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">ポータル · {companyName ?? "—"}</div>
          <h1>{displayName ? `${displayName} 様` : "自社ポータル"}</h1>
          <div className="sub">貴社の案件と、ご提案中の人材の進捗をご確認いただけます。</div>
        </div>
      </div>

      {note && (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>{note}</div>
      )}

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi brand"><div><div className="val tnum">{jobs.length}</div><div className="label">公開中の自社案件</div></div></div>
        <div className="kpi"><div><div className="val tnum">{activeProps.length}</div><div className="label">進行中のご提案</div></div></div>
        <div className="kpi accent"><div><div className="val tnum">{won.length}</div><div className="label">稼働決定</div></div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>自社の案件</h3>
          <a href="/portal/jobs" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-700, #0b5cab)", textDecoration: "none" }}>すべて見る →</a>
        </div>
        {jobs.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>公開中の案件はありません。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {jobs.map((j) => (
              <div key={j.job_no} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.title ?? "（無題）"}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{[j.role_label, remote(j.remote_type), salary(j.salary_min, j.salary_max)].filter(Boolean).join(" · ")}</div>
                </div>
                <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", flexShrink: 0 }}>#{j.job_no}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>ご提案中の人材</h3>
          <a href="/portal/candidates" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-700, #0b5cab)", textDecoration: "none" }}>マッチ度を見て評価する →</a>
        </div>
        {proposals.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>現在ご提案中の人材はありません。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {proposals.map((p) => {
              const t = stageTone(p.stage);
              return (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.c_init || p.candidate_name || "人材"}{p.rate ? `（${Math.round(p.rate / 10000)}万）` : ""}</div>
                    <div className="muted" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.job_title ?? "—"}</div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: t.bg, color: t.fg }}>{p.stage ?? "—"}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
