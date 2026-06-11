import Link from "next/link";
import { redirect } from "next/navigation";
import { FlowSteps } from "@/components/FlowSteps";
import { CompanyApprovalBadge } from "@/components/CompanyApprovalBadge";
import { ClosedBadge } from "@/components/ClosedBadge";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getViewerScope } from "@/lib/tenant";
import { getApprovedCompanySet, isCompanyApproved } from "@/lib/company-approval";

export const dynamic = "force-dynamic";

const remoteLabel = (r?: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");
const salaryLabel = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "—";

const Row = ({ label, value }: { label: string; value?: React.ReactNode }) =>
  value ? (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--color-border)", fontSize: 13 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ color: "var(--color-ink)", whiteSpace: "pre-wrap" }}>{value}</div>
    </div>
  ) : null;

export default async function CompanyDetailPage({ params }: { params: Promise<{ name: string }> }) {
  // 企業詳細は社内向け。テナント隔離ロールは閲覧不可。
  const scope = await getViewerScope();
  if (scope.isTenant) redirect("/");

  const { name: raw } = await params;
  const name = decodeURIComponent(raw ?? "").trim();
  if (!name) redirect("/companies");

  let reg: any = null;
  let jobs: any[] = [];
  let people: any[] = [];
  let approved = false;
  let dbError: string | null = null;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      // 企業マスタ（登録情報）
      let rr: any = await sb.from("companies").select("name, industry, tier, status, owner_staff, contact_name, contact_email, phone, website, address, note, meeting_done").eq("name", name).maybeSingle();
      if (rr.error) rr = await sb.from("companies").select("name, industry, tier, status, owner_staff, contact_name, contact_email, phone, website, address, note").eq("name", name).maybeSingle();
      reg = rr.data ?? null;

      // 承認（打合せ済）判定
      try { approved = isCompanyApproved(await getApprovedCompanySet(), name); } catch { approved = !!reg?.meeting_done; }

      // この企業の案件（client_name 一致）
      const jcols = "job_no, title, role_label, salary_min, salary_max, remote_type, status, is_published, created_at";
      let jr: any = await sb.from("jobs").select(`${jcols}, is_closed`).eq("client_name", name).is("deleted_at", null).order("job_no", { ascending: false }).limit(300);
      if (jr.error) jr = await sb.from("jobs").select(jcols).eq("client_name", name).order("job_no", { ascending: false }).limit(300);
      jobs = jr.data ?? [];

      // この企業に属する人材（所属＝source_company / company / affiliation のいずれか一致）。
      //   企業名にカンマ/括弧が含まれても PostgREST の or 構文が壊れないよう値を二重引用符で囲む。
      const ccols = "candidate_no, name, initials, title, skills, rate, status, source_company, company, affiliation, created_at";
      const q = name.replace(/"/g, '\\"');
      const orExpr = `source_company.eq."${q}",company.eq."${q}",affiliation.eq."${q}"`;
      let cr: any = await sb.from("candidates").select(`${ccols}, is_closed`).or(orExpr).is("deleted_at", null).order("candidate_no", { ascending: false }).limit(300);
      if (cr.error) cr = await sb.from("candidates").select(ccols).or(orExpr).order("candidate_no", { ascending: false }).limit(300);
      people = cr.data ?? [];
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  }

  const tierLabel = reg?.tier ? `ティア${reg.tier}` : null;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820, minWidth: 0 }}>
          <div className="meta">Company · 企業詳細</div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>{name}</span>
            <CompanyApprovalBadge approved={approved} />
          </h1>
          <div className="sub">{[reg?.industry, tierLabel, reg?.status].filter(Boolean).join(" · ") || "案件・人材データから集約した企業"}</div>
        </div>
        <Link href="/companies" className="btn ghost" style={{ textDecoration: "none", flexShrink: 0 }}>← 企業一覧へ</Link>
      </div>

      <FlowSteps current="data" sub="企業詳細（案件・人材）" />

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

      {!approved && (
        <div className="card" style={{ background: "#fdecef", borderColor: "#f7c5cf", fontSize: 12.5, color: "#b42318" }}>
          この企業は<b>未承認（打合せ未完了）</b>です。提案前に打ち合わせ／顔合わせを行い、企業管理で「打ち合わせ完了」にしてください。
        </div>
      )}

      {/* 企業情報 */}
      {reg && (
        <div className="card">
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 6 }}>企業情報</div>
          <Row label="業種" value={reg.industry} />
          <Row label="ティア" value={reg.tier} />
          <Row label="ステータス" value={reg.status} />
          <Row label="自社担当" value={reg.owner_staff} />
          <Row label="先方担当" value={reg.contact_name} />
          <Row label="メール" value={reg.contact_email} />
          <Row label="電話" value={reg.phone} />
          <Row label="URL" value={reg.website ? <a href={reg.website} target="_blank" rel="noreferrer" style={{ color: "var(--color-brand-700)" }}>{reg.website}</a> : null} />
          <Row label="住所" value={reg.address} />
          <Row label="メモ" value={reg.note} />
        </div>
      )}

      {/* 案件 */}
      <div className="card">
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 10 }}>
          案件 <span className="tag brand">{jobs.length}件</span>
        </div>
        {jobs.length === 0 ? (
          <div className="muted" style={{ fontSize: 12.5, padding: "8px 2px" }}>この企業の案件はありません。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {jobs.map((j) => (
              <Link key={j.job_no} href={`/jobs/${j.job_no}`} style={{ textDecoration: "none", color: "inherit", display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", padding: "10px 4px", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-ink)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.title}</span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 400, flexShrink: 0 }}>No.{String(j.job_no).padStart(5, "0")}</span>
                    {j.is_closed && <ClosedBadge size="xs" />}
                    {j.is_published === false && <span className="tag" style={{ fontSize: 9.5, padding: "1px 6px", background: "#fdecef", color: "#b42318", border: "1px solid #f7c5cf" }}>非公開</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>{[j.role_label, remoteLabel(j.remote_type), j.status].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>{salaryLabel(j.salary_min, j.salary_max)}</div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* 人材 */}
      <div className="card">
        <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 10 }}>
          人材 <span className="tag brand">{people.length}名</span>
        </div>
        {people.length === 0 ? (
          <div className="muted" style={{ fontSize: 12.5, padding: "8px 2px" }}>この企業に紐づく人材はありません。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {people.map((c) => (
              <Link key={c.candidate_no} href={`/people/${c.candidate_no}`} style={{ textDecoration: "none", color: "inherit", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", padding: "10px 4px", borderBottom: "1px solid var(--color-border)" }}>
                <div className="ava" style={{ width: 30, height: 30, fontSize: 12 }}>{c.initials || (c.name ?? "?").slice(0, 2)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-ink)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 400, flexShrink: 0 }}>P-{String(c.candidate_no).padStart(5, "0")}</span>
                    {c.is_closed && <ClosedBadge size="xs" />}
                  </div>
                  <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[c.title, (c.skills ?? []).slice(0, 3).join(" / ")].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: 12, color: "var(--color-ink-3)", whiteSpace: "nowrap" }}>{c.rate ?? "—"}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
