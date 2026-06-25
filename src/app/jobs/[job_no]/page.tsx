import Link from "@/components/AppLink";
import { redirect } from "next/navigation";
import { Icons } from "@/components/icons";
import { FlowSteps } from "@/components/FlowSteps";
import { MailButton } from "@/components/MailButton";
import { EditJobButton } from "@/components/EditEntryButton";
import { DeleteEntityButton } from "@/components/DeleteEntityButton";
import { CloseToggleButton } from "@/components/CloseToggleButton";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { gmailMessageUrl, gmailSearchUrl } from "@/lib/gmail";
import { getViewerScope } from "@/lib/tenant";
import { ClosedBadge } from "@/components/ClosedBadge";
import { CompanyLink } from "@/components/CompanyLink";
import { getApprovedCompanySet, isCompanyApproved } from "@/lib/company-approval";
import { classifyJobNationality, JOB_NAT_LABEL, JOB_NAT_TONE, classifyJobAge, JOB_AGE_TONE } from "@/lib/nationality";
import { attachLatestSourceMail } from "@/lib/source-mail";

export const dynamic = "force-dynamic";

const remoteLabel = (r?: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社必須" : (r || "—");
const salaryLabel = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "—";

const Row = ({ label, value }: { label: string; value?: React.ReactNode }) =>
  value ? (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, padding: "10px 0", borderBottom: "1px dashed var(--color-border)" }}>
      <div className="muted" style={{ fontSize: 11.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{value}</div>
    </div>
  ) : null;

export default async function JobDetailPage({ params }: { params: Promise<{ job_no: string }> }) {
  // 個別詳細ページは社内(admin/agent)のみ。テナント隔離ロール(partner/freelance)は
  // 一覧のドロワー（匿名化済み）からの閲覧に限定する（漏洩防止の二重防御）。
  const scope = await getViewerScope();
  if (scope.isTenant) redirect("/jobs");

  const { job_no } = await params;
  const no = Number(job_no);
  let j: any = null;
  let dbError: string | null = null;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      // 拡張カラムが無い環境でも落ちないようフォールバック
      const cols = "id, job_no, title, client_name, role_label, skills, salary_min, salary_max, remote_type, flow_note, work_location, start_date, detail, status, is_focus, is_published, created_at";
      let r: any = await sb.from("jobs").select(`${cols}, is_closed, contact_email, contact_name, source_mail_url`).eq("job_no", no).maybeSingle();
      if (r.error) r = await sb.from("jobs").select(`${cols}, contact_email, contact_name`).eq("job_no", no).maybeSingle();
      if (r.error) r = await sb.from("jobs").select(cols).eq("job_no", no).maybeSingle();
      j = r.data;
      // 元メールリンクを直近受信メールへ更新（同案件／同送信元の最新メールに飛ぶ）。
      if (j) await attachLatestSourceMail(sb, "job", [j]);
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!j) {
    return (
      <div className="page">
        <div className="card">{dbError ? <span style={{ color: "var(--color-danger)" }}>DB: {dbError}</span> : "案件が見つかりませんでした。"} <Link href="/jobs">← 案件一覧へ</Link></div>
      </div>
    );
  }

  const origMailUrl = gmailMessageUrl(j.source_mail_url) || j.source_mail_url || gmailSearchUrl([j.client_name, j.title].filter(Boolean).join(" "));
  const clientApproved = isCompanyApproved(await getApprovedCompanySet(), j.client_name);

  // この案件への応募（LP「応募する」経由 = enger.applications）。案件単位で誰が応募したか辿れるように。
  let applicants: { id: string; engineer_name: string | null; stage: string | null; created_at: string }[] = [];
  if (dbConfigured && j.id) {
    try {
      const sb = engerClient();
      const ar: any = await sb.from("applications")
        .select("id, engineer_name, stage, created_at")
        .eq("job_id", j.id).order("created_at", { ascending: false }).limit(200);
      applicants = (ar.data ?? []) as any[];
    } catch { /* applications 未整備でも詳細は出す */ }
  }
  const APP_STAGE_TONE: Record<string, string> = {
    "応募": "#64748b", "書類選考": "#64748b", "面談": "#0b5cab", "面談合格": "#0b5cab", "稼働": "#067647", "見送り": "#b42318",
  };
  const fmtApp = (s: string) => { const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getMonth() + 1}/${d.getDate()}`; };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="meta">Job · 案件詳細</div>
          <h1>{j.title} <span className="mono" style={{ fontSize: 14, color: "var(--color-ink-4)", fontWeight: 400 }}>No.{String(j.job_no).padStart(5, "0")}</span> {j.is_closed && <ClosedBadge />}</h1>
          <div className="sub">{[j.client_name, j.role_label, remoteLabel(j.remote_type), salaryLabel(j.salary_min, j.salary_max)].filter(Boolean).join(" · ") || "—"}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center", flexWrap: "wrap" }}>
          {!j.is_closed && <Link href={`/matching?job=${j.job_no}`} className="btn brand" style={{ textDecoration: "none" }}><Icons.matching /><span>マッチング</span></Link>}
          {origMailUrl && <a href={origMailUrl} target="_blank" rel="noreferrer" className="btn ghost" style={{ textDecoration: "none" }}>↗ 元メール</a>}
          <MailButton to={j.contact_email} subject={`Re: ${j.title}`} body={""} label="窓口にメール" block />
          <EditJobButton job={j} />
          <CloseToggleButton kind="jobs" idValue={j.job_no} isClosed={!!j.is_closed} />
          <DeleteEntityButton kind="jobs" idValue={j.job_no} label={j.title ?? undefined} />
          <Link href="/jobs" className="btn ghost" style={{ textDecoration: "none" }}>← 一覧</Link>
        </div>
      </div>

      <FlowSteps current="data" sub="案件詳細" />

      <div className="card">
        <Row label="案件名" value={j.title} />
        <Row label="クライアント" value={j.client_name ? <CompanyLink name={j.client_name} approved={clientApproved} badge badgeSize="sm" /> : "—"} />
        <Row label="募集職種" value={j.role_label} />
        <Row label="必要スキル" value={(j.skills ?? []).join(" / ") || "—"} />
        <Row label="単価" value={salaryLabel(j.salary_min, j.salary_max)} />
        <Row label="リモート可否" value={remoteLabel(j.remote_type)} />
        {(() => {
          const cat = classifyJobNationality(j.detail, j.title);
          const tone = JOB_NAT_TONE[cat];
          return (
            <Row label="国籍要件" value={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}>{JOB_NAT_LABEL[cat]}</span>
                {cat === "jp_only" && <span style={{ fontSize: 11, color: "#b42318" }}>外国籍NGの可能性。提案前に確認。</span>}
                {cat === "unknown" && <span className="muted" style={{ fontSize: 11 }}>本文に記載なし（要確認）</span>}
              </span>
            } />
          );
        })()}
        {(() => {
          const { cat, label } = classifyJobAge(j.detail, j.title);
          const tone = JOB_AGE_TONE[cat];
          return (
            <Row label="年代制限" value={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}>{label}</span>
                {cat === "unknown" && <span className="muted" style={{ fontSize: 11 }}>本文に記載なし（要確認）</span>}
              </span>
            } />
          );
        })()}
        <Row label="勤務地" value={j.work_location ?? "不明"} />
        <Row label="商流" value={j.flow_note} />
        <Row label="開始希望" value={j.start_date} />
        <Row label="ステータス" value={j.status} />
        <Row label="窓口担当者" value={j.contact_name} />
        <Row label="窓口メール" value={j.contact_email} />
        <Row label="案件詳細" value={j.detail} />
      </div>

      {/* この案件への応募（LP「応募する」経由）。選考管理と同じ enger.applications を案件単位で表示。 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--color-brand-700)" }}>how_to_reg</span>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>この案件への応募</h2>
          <span className="tag brand" style={{ fontSize: 11, fontWeight: 700 }}>{applicants.length}件</span>
          <Link href="/engineers" className="muted" style={{ marginLeft: "auto", fontSize: 11.5, textDecoration: "underline" }}>LP登録者一覧 →</Link>
        </div>
        {applicants.length === 0 ? (
          <div className="muted" style={{ fontSize: 12.5 }}>まだ応募はありません。（LP「応募する」経由の応募がここに表示されます）</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {applicants.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 8 }}>
                <div className="ava" style={{ width: 32, height: 32, fontSize: 12, flex: "0 0 32px" }}>{(a.engineer_name ?? "?").slice(0, 1)}</div>
                <div style={{ minWidth: 0, flex: 1, fontSize: 13, fontWeight: 600 }}>{a.engineer_name || "（氏名未取得）"}</div>
                <span className="muted" style={{ fontSize: 11 }}>応募 {fmtApp(a.created_at)}</span>
                <span style={{ flex: "0 0 auto", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, color: "#fff", background: APP_STAGE_TONE[a.stage ?? "応募"] ?? "#64748b" }}>{a.stage || "応募"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
