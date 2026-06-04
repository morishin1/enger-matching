import { engerClient, dbConfigured } from "@/lib/supabase";
import { Icons } from "@/components/icons";
import { MeetingGateBanner } from "./MeetingGateBanner";

/** ユーザー企業(client)向けの自社ポータル。自社の案件と提案状況のみ表示。 */
export async function ClientHome({ companyName, displayName, needGate = false }: { companyName: string | null; displayName?: string | null; needGate?: boolean }) {
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
  const interview = proposals.filter((p) => ["面談", "面談調整", "面談設定", "面談実施", "面談合格"].includes(p.stage));
  const won = proposals.filter((p) => ["面談合格", "稼働", "稼働中", "稼働決定"].includes(p.stage));

  const stageTone = (s?: string) => {
    if (s === "面談合格" || s === "稼働" || s === "稼働中" || s === "稼働決定") return { bg: "#e7f7ee", fg: "#067647" };
    if (s === "見送り" || s === "失注") return { bg: "#fdecef", fg: "#b42318" };
    return { bg: "#eaf4fd", fg: "#0b5cab" };
  };

  return (
    <div className="page">
      {/* グリーンのヒーロー */}
      <div style={{ borderRadius: 18, padding: "26px 28px", color: "#fff", background: "linear-gradient(135deg, var(--color-brand-600), var(--color-brand-800))", boxShadow: "0 18px 40px -24px rgba(6,95,70,.6)" }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".08em", opacity: .85, textTransform: "uppercase" }}>ENGER · 企業ポータル</div>
        <h1 style={{ margin: "8px 0 6px", fontSize: 24, fontWeight: 800 }}>{displayName ? `${displayName} 様` : "自社ポータル"}</h1>
        <div style={{ fontSize: 13.5, opacity: .92, maxWidth: 640, lineHeight: 1.8 }}>
          {companyName ? <><b>{companyName}</b> の案件と、ご提案中の人材の進捗をご確認いただけます。</> : "貴社の案件と、ご提案中の人材の進捗をご確認いただけます。"}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          <a href="/portal/jobs" style={{ background: "#fff", color: "var(--color-brand-700)", fontWeight: 700, fontSize: 13, padding: "9px 16px", borderRadius: 9, textDecoration: "none" }}>自社案件を見る →</a>
          <a href="/portal/candidates" style={{ background: "rgba(255,255,255,.18)", color: "#fff", fontWeight: 700, fontSize: 13, padding: "9px 16px", borderRadius: 9, textDecoration: "none", border: "1px solid rgba(255,255,255,.35)" }}>おすすめ人材を見る →</a>
        </div>
      </div>

      {needGate && <div style={{ marginTop: 16 }}><MeetingGateBanner title="ご利用前に担当との面談をお願いしています" description="自社案件・自社情報の管理は本ポータルで先にご利用いただけますが、おすすめ人材・選考管理など人材情報を含む詳細機能は、担当エージェントとの面談後に解放されます。" /></div>}

      {note && (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13, marginTop: 16 }}>{note}</div>
      )}

      {/* ENGER business でできること（強み・機能を一目で） */}
      <div style={{ margin: "16px 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {[
          { ic: "post_add", t: "求人を無料で掲載", d: "SES／紹介／派遣を選んで掲載。審査後すぐ人材に公開。", href: "/portal/jobs", cta: "案件を掲載" },
          { ic: "auto_awesome", t: "AIが“合う人材”を提案", d: "マッチ度＋一致スキルの根拠つき。ミスマッチを減らせます。", href: "/portal/candidates", cta: "おすすめ人材" },
          { ic: "forum", t: "評価で精度UP・面談へ", d: "「会いたい/検討中/見送り」で精度向上。営業が面談まで伴走。", href: "/portal/candidates", cta: "評価する" },
        ].map((c) => (
          <a key={c.t} href={c.href} className="card" style={{ display: "flex", flexDirection: "column", gap: 7, textDecoration: "none", color: "inherit", padding: 16 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: "var(--color-brand-50)", color: "var(--color-brand-700)", display: "grid", placeItems: "center" }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>{c.ic}</span></span>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--color-ink)" }}>{c.t}</div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>{c.d}</div>
            <span style={{ marginTop: "auto", paddingTop: 6, fontSize: 12, fontWeight: 700, color: "var(--color-brand-700)" }}>{c.cta} →</span>
          </a>
        ))}
      </div>

      <div className="kpi-grid" style={{ margin: "16px 0" }}>
        <div className="kpi brand"><div className="top"><div className="ico-box"><Icons.jobs /></div></div><div><div className="val tnum">{jobs.length}</div><div className="label">公開中の自社案件</div></div></div>
        <div className="kpi"><div className="top"><div className="ico-box"><Icons.proposals /></div></div><div><div className="val tnum">{activeProps.length}</div><div className="label">進行中のご提案</div></div></div>
        <div className="kpi"><div className="top"><div className="ico-box"><Icons.cal /></div></div><div><div className="val tnum">{interview.length}</div><div className="label">面談フェーズ</div></div></div>
        <div className="kpi accent"><div className="top"><div className="ico-box"><Icons.check /></div></div><div><div className="val tnum">{won.length}</div><div className="label">合格・稼働</div></div></div>
      </div>

      {/* 2カラム：左=採用状況+自社案件 / 右=ご提案人材+CTA（LPダッシュボードと同じ構成） */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>

          {/* 採用の進み具合（ファネル） */}
          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: "var(--color-brand-700)", textTransform: "uppercase" }}>Hiring Funnel</div>
            <h3 style={{ margin: "4px 0 14px", fontSize: 15, fontWeight: 800 }}>採用の進み具合</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[["ご提案", proposals.length, "#ecfdf5", "#047857"], ["面談フェーズ", interview.length, "#dcf7e8", "#065f46"], ["合格・稼働", won.length, "#059669", "#fff"]].map(([l, v, bg, fg], i) => (
                <div key={i} style={{ flex: "1 1 120px", background: bg as string, borderRadius: 12, padding: "14px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: fg as string }}>{v as number}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: i === 2 ? "rgba(255,255,255,.9)" : "#475467" }}>{l as string}</div>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.7 }}>ご提案→面談→合格・稼働の流れです。マッチ度や評価は「おすすめ人材」からご確認いただけます。</p>
          </div>

          {/* 自社の案件 */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>自社の案件</h3>
              <a href="/portal/jobs" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-700)", textDecoration: "none" }}>すべて見る →</a>
            </div>
            {jobs.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>公開中の案件はありません。</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {jobs.slice(0, 6).map((j) => (
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
        </div>

        {/* 右サイド */}
        <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>ご提案中の人材</h3>
              <a href="/portal/candidates" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-brand-700)", textDecoration: "none" }}>評価する →</a>
            </div>
            {proposals.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>現在ご提案中の人材はありません。</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {proposals.slice(0, 6).map((p) => {
                  const t = stageTone(p.stage);
                  return (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.c_init || "人材"}{p.rate ? `（${Math.round(p.rate / 10000)}万）` : ""}</div>
                        <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.job_title ?? "—"}</div>
                      </div>
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: t.bg, color: t.fg }}>{p.stage ?? "—"}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 緑のCTAカード（LPのSkillUp枠に相当） */}
          <div style={{ borderRadius: 16, padding: 20, color: "#fff", background: "linear-gradient(135deg, var(--color-brand-700), var(--color-brand-900))" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", opacity: .85, textTransform: "uppercase" }}>Find Talent</div>
            <h3 style={{ margin: "6px 0 8px", fontSize: 16, fontWeight: 800 }}>ミスマッチなく採用</h3>
            <p style={{ fontSize: 12.5, lineHeight: 1.8, color: "rgba(255,255,255,.85)", margin: "0 0 14px" }}>マッチ度と根拠つきで、貴社に合う人材をご提案します。気になる人材はフィードバックで精度が上がります。</p>
            <a href="/portal/candidates" style={{ display: "block", textAlign: "center", background: "#fff", color: "var(--color-brand-800)", fontWeight: 700, fontSize: 13, padding: "10px", borderRadius: 9, textDecoration: "none" }}>おすすめ人材を見る →</a>
          </div>
        </div>
      </div>
    </div>
  );
}
